const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');

const router = express.Router();

// Get all inventory adjustments
router.get('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { status, startDate, endDate, branchId, adjustmentType } = req.query;
    
    let filterFormula = '';
    if (status) {
      filterFormula = `{status} = "${status}"`;
    }
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({adjustment_date}, "${startDate}"), IS_BEFORE({adjustment_date}, "${endDate}"))`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${dateFilter})` : dateFilter;
    }
    
    if (branchId && branchId !== 'all') {
      const branchFilter = `{branch_id} = "${branchId}"`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${branchFilter})` : branchFilter;
    }
    
    if (adjustmentType) {
      const typeFilter = `{adjustment_type} = "${adjustmentType}"`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${typeFilter})` : typeFilter;
    }

    const adjustments = await airtableHelpers.find(TABLES.INVENTORY_ADJUSTMENTS, filterFormula);
    
    // Enrich with adjustment items
    const enrichedAdjustments = await Promise.all(
      adjustments.map(async (adjustment) => {
        try {
          const items = await airtableHelpers.find(
            TABLES.ADJUSTMENT_ITEMS,
            `{adjustment_id} = "${adjustment.id}"`
          );
          
          return {
            ...adjustment,
            items: items || [],
            total_items: items.length,
            total_value_impact: items.reduce((sum, item) => sum + (item.value_impact || 0), 0)
          };
        } catch (error) {
          return { ...adjustment, items: [], total_items: 0, total_value_impact: 0 };
        }
      })
    );

    res.json(enrichedAdjustments);
  } catch (error) {
    console.error('Get inventory adjustments error:', error);
    res.status(500).json({ message: 'Failed to fetch inventory adjustments' });
  }
});

// Create new inventory adjustment
router.post('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('CREATE_INVENTORY_ADJUSTMENT'), async (req, res) => {
  try {
    const {
      branch_id,
      adjustment_type,
      adjustment_date,
      reason,
      reference_number,
      notes,
      items
    } = req.body;

    if (!branch_id || !adjustment_type || !adjustment_date || !items || items.length === 0) {
      return res.status(400).json({ 
        message: 'Branch, adjustment type, date, and items are required' 
      });
    }

    const validTypes = ['stock_take', 'damage', 'theft', 'expiry', 'found', 'transfer_correction', 'other'];
    if (!validTypes.includes(adjustment_type)) {
      return res.status(400).json({ message: 'Invalid adjustment type' });
    }

    // Create adjustment record
    const adjustmentData = {
      branch_id: [branch_id],
      adjustment_type,
      adjustment_date,
      reason: reason || '',
      reference_number: reference_number || `ADJ_${Date.now()}`,
      notes: notes || '',
      status: 'draft',
      created_by: [req.user.id],
      created_at: new Date().toISOString()
    };

    const adjustment = await airtableHelpers.create(TABLES.INVENTORY_ADJUSTMENTS, adjustmentData);

    // Create adjustment items and calculate impacts
    const adjustmentItems = [];
    let totalValueImpact = 0;
    let totalQuantityImpact = 0;

    for (const item of items) {
      if (!item.product_name) continue;

      // Get current stock to calculate impact
      const currentStock = await airtableHelpers.find(
        TABLES.STOCK,
        `AND({branch_id} = "${branch_id}", {product_name} = "${item.product_name}")`
      );

      const currentQuantity = currentStock.length > 0 ? currentStock[0].quantity_available : 0;
      const currentUnitPrice = currentStock.length > 0 ? currentStock[0].unit_price : 0;
      
      const systemQuantity = Number(item.system_quantity) || currentQuantity;
      const actualQuantity = Number(item.actual_quantity) || 0;
      const quantityDifference = actualQuantity - systemQuantity;
      const valueImpact = quantityDifference * currentUnitPrice;

      const adjustmentItem = await airtableHelpers.create(TABLES.ADJUSTMENT_ITEMS, {
        adjustment_id: [adjustment.id],
        product_name: item.product_name,
        system_quantity: systemQuantity,
        actual_quantity: actualQuantity,
        quantity_difference: quantityDifference,
        unit_cost: currentUnitPrice,
        value_impact: valueImpact,
        reason: item.reason || reason || '',
        notes: item.notes || ''
      });

      adjustmentItems.push(adjustmentItem);
      totalValueImpact += valueImpact;
      totalQuantityImpact += Math.abs(quantityDifference);
    }

    // Update adjustment with totals
    await airtableHelpers.update(TABLES.INVENTORY_ADJUSTMENTS, adjustment.id, {
      total_items: adjustmentItems.length,
      total_value_impact: totalValueImpact,
      total_quantity_impact: totalQuantityImpact
    });

    res.status(201).json({
      message: 'Inventory adjustment created successfully',
      adjustment: { 
        ...adjustment, 
        items: adjustmentItems,
        total_items: adjustmentItems.length,
        total_value_impact: totalValueImpact,
        total_quantity_impact: totalQuantityImpact
      }
    });
  } catch (error) {
    console.error('Create inventory adjustment error:', error);
    res.status(500).json({ 
      message: 'Failed to create inventory adjustment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Approve and apply adjustment
router.put('/:adjustmentId/approve', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('APPROVE_INVENTORY_ADJUSTMENT'), async (req, res) => {
  try {
    const { adjustmentId } = req.params;
    const { approval_notes } = req.body;

    const adjustment = await airtableHelpers.findById(TABLES.INVENTORY_ADJUSTMENTS, adjustmentId);
    if (!adjustment) {
      return res.status(404).json({ message: 'Inventory adjustment not found' });
    }

    if (adjustment.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft adjustments can be approved' });
    }

    // Get adjustment items
    const items = await airtableHelpers.find(
      TABLES.ADJUSTMENT_ITEMS,
      `{adjustment_id} = "${adjustmentId}"`
    );

    // Apply adjustments to stock
    const appliedItems = [];
    for (const item of items) {
      if (item.quantity_difference === 0) continue;

      // Find stock record
      const stockRecords = await airtableHelpers.find(
        TABLES.STOCK,
        `AND({branch_id} = "${adjustment.branch_id[0]}", {product_name} = "${item.product_name}")`
      );

      if (stockRecords.length > 0) {
        const stock = stockRecords[0];
        const newQuantity = Math.max(0, stock.quantity_available + item.quantity_difference);
        
        // Update stock quantity
        await airtableHelpers.update(TABLES.STOCK, stock.id, {
          quantity_available: newQuantity,
          last_updated: new Date().toISOString(),
          last_adjustment_date: adjustment.adjustment_date
        });

        // Create stock movement record
        await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
          to_branch_id: adjustment.branch_id,
          product_name: item.product_name,
          quantity: Math.abs(item.quantity_difference),
          movement_type: item.quantity_difference > 0 ? 'adjustment_increase' : 'adjustment_decrease',
          reason: `Inventory adjustment: ${adjustment.reason}`,
          status: 'completed',
          transfer_date: adjustment.adjustment_date,
          created_by: [req.user.id],
          adjustment_id: [adjustmentId],
          unit_cost: item.unit_cost,
          total_cost: Math.abs(item.value_impact)
        });

        appliedItems.push({
          product_name: item.product_name,
          old_quantity: stock.quantity_available,
          new_quantity: newQuantity,
          adjustment: item.quantity_difference,
          value_impact: item.value_impact
        });
      }
    }

    // Update adjustment status
    await airtableHelpers.update(TABLES.INVENTORY_ADJUSTMENTS, adjustmentId, {
      status: 'approved',
      approved_by: [req.user.id],
      approved_at: new Date().toISOString(),
      approval_notes: approval_notes || '',
      applied_items_count: appliedItems.length
    });

    res.json({
      message: 'Inventory adjustment approved and applied successfully',
      applied_items: appliedItems,
      summary: {
        total_items_adjusted: appliedItems.length,
        total_value_impact: appliedItems.reduce((sum, item) => sum + item.value_impact, 0)
      }
    });
  } catch (error) {
    console.error('Approve inventory adjustment error:', error);
    res.status(500).json({ message: 'Failed to approve inventory adjustment' });
  }
});

// Reject adjustment
router.put('/:adjustmentId/reject', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('REJECT_INVENTORY_ADJUSTMENT'), async (req, res) => {
  try {
    const { adjustmentId } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    await airtableHelpers.update(TABLES.INVENTORY_ADJUSTMENTS, adjustmentId, {
      status: 'rejected',
      rejected_by: [req.user.id],
      rejected_at: new Date().toISOString(),
      rejection_reason
    });

    res.json({ message: 'Inventory adjustment rejected successfully' });
  } catch (error) {
    console.error('Reject inventory adjustment error:', error);
    res.status(500).json({ message: 'Failed to reject inventory adjustment' });
  }
});

// Get adjustment by ID
router.get('/:adjustmentId', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { adjustmentId } = req.params;
    
    const adjustment = await airtableHelpers.findById(TABLES.INVENTORY_ADJUSTMENTS, adjustmentId);
    if (!adjustment) {
      return res.status(404).json({ message: 'Inventory adjustment not found' });
    }

    // Get adjustment items
    const items = await airtableHelpers.find(
      TABLES.ADJUSTMENT_ITEMS,
      `{adjustment_id} = "${adjustmentId}"`
    );

    res.json({
      ...adjustment,
      items,
      total_items: items.length,
      total_value_impact: items.reduce((sum, item) => sum + (item.value_impact || 0), 0)
    });
  } catch (error) {
    console.error('Get adjustment error:', error);
    res.status(500).json({ message: 'Failed to fetch inventory adjustment' });
  }
});

// Delete adjustment (only if draft)
router.delete('/:adjustmentId', authenticateToken, authorizeRoles(['admin', 'boss']), auditLog('DELETE_INVENTORY_ADJUSTMENT'), async (req, res) => {
  try {
    const { adjustmentId } = req.params;

    const adjustment = await airtableHelpers.findById(TABLES.INVENTORY_ADJUSTMENTS, adjustmentId);
    if (!adjustment) {
      return res.status(404).json({ message: 'Inventory adjustment not found' });
    }

    if (adjustment.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft adjustments can be deleted' });
    }

    // Delete adjustment items first
    const items = await airtableHelpers.find(
      TABLES.ADJUSTMENT_ITEMS,
      `{adjustment_id} = "${adjustmentId}"`
    );

    await Promise.all(
      items.map(item => airtableHelpers.delete(TABLES.ADJUSTMENT_ITEMS, item.id))
    );

    // Delete adjustment
    await airtableHelpers.delete(TABLES.INVENTORY_ADJUSTMENTS, adjustmentId);

    res.json({ message: 'Inventory adjustment deleted successfully' });
  } catch (error) {
    console.error('Delete adjustment error:', error);
    res.status(500).json({ message: 'Failed to delete inventory adjustment' });
  }
});

module.exports = router;
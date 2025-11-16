const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all inventory adjustments
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { branch_id, adjustment_type, status, startDate, endDate } = req.query;
    
    let adjustments = await airtableHelpers.find(TABLES.INVENTORY_ADJUSTMENTS);
    
    // Apply filters
    if (branch_id) {
      adjustments = adjustments.filter(adj => 
        adj.branch_id && adj.branch_id.includes(branch_id)
      );
    }
    
    if (adjustment_type) {
      adjustments = adjustments.filter(adj => adj.adjustment_type === adjustment_type);
    }
    
    if (status) {
      adjustments = adjustments.filter(adj => adj.status === status);
    }
    
    if (startDate && endDate) {
      adjustments = adjustments.filter(adj => {
        const adjDate = new Date(adj.adjustment_date);
        return adjDate >= new Date(startDate) && adjDate <= new Date(endDate);
      });
    }
    
    res.json(adjustments);
  } catch (error) {
    console.error('Get inventory adjustments error:', error);
    res.status(500).json({ message: 'Failed to fetch inventory adjustments' });
  }
});

// Create inventory adjustment
router.post('/', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const {
      branch_id,
      product_name,
      adjustment_type,
      quantity_change,
      reason,
      reference_number
    } = req.body;
    
    if (!branch_id || !product_name || !adjustment_type || !quantity_change) {
      return res.status(400).json({ 
        message: 'Branch ID, product name, adjustment type, and quantity change are required' 
      });
    }
    
    const adjustmentData = {
      branch_id: [branch_id],
      product_name,
      adjustment_type,
      quantity_change: parseInt(quantity_change),
      reason: reason || '',
      reference_number: reference_number || `ADJ_${Date.now()}`,
      status: 'pending',
      requested_by: [req.user.id],
      adjustment_date: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    };
    
    const newAdjustment = await airtableHelpers.create(TABLES.INVENTORY_ADJUSTMENTS, adjustmentData);
    
    res.status(201).json({
      success: true,
      message: 'Inventory adjustment created successfully',
      adjustment: newAdjustment
    });
  } catch (error) {
    console.error('Create inventory adjustment error:', error);
    res.status(500).json({ message: 'Failed to create inventory adjustment' });
  }
});

// Approve inventory adjustment
router.put('/:id/approve', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const adjustment = await airtableHelpers.findById(TABLES.INVENTORY_ADJUSTMENTS, id);
    if (!adjustment) {
      return res.status(404).json({ message: 'Inventory adjustment not found' });
    }
    
    // Update adjustment status
    await airtableHelpers.update(TABLES.INVENTORY_ADJUSTMENTS, id, {
      status: 'approved',
      approved_by: [req.user.id],
      approved_at: new Date().toISOString()
    });
    
    // Apply stock changes
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const stockItem = allStock.find(item => 
      item.branch_id && item.branch_id.includes(adjustment.branch_id[0]) && 
      item.product_name === adjustment.product_name
    );
    
    if (stockItem) {
      const newQuantity = Math.max(0, stockItem.quantity_available + adjustment.quantity_change);
      await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
        quantity_available: newQuantity,
        last_updated: new Date().toISOString()
      });
    }
    
    // Create stock movement record
    await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
      movement_type: 'adjustment',
      product_name: adjustment.product_name,
      quantity: Math.abs(adjustment.quantity_change),
      from_branch_id: adjustment.quantity_change < 0 ? adjustment.branch_id : null,
      to_branch_id: adjustment.quantity_change > 0 ? adjustment.branch_id : null,
      reason: `Inventory adjustment: ${adjustment.reason}`,
      status: 'completed',
      adjustment_id: [id],
      approved_by: [req.user.id],
      created_at: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Inventory adjustment approved and applied successfully'
    });
  } catch (error) {
    console.error('Approve inventory adjustment error:', error);
    res.status(500).json({ message: 'Failed to approve inventory adjustment' });
  }
});

// Reject inventory adjustment
router.put('/:id/reject', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    
    await airtableHelpers.update(TABLES.INVENTORY_ADJUSTMENTS, id, {
      status: 'rejected',
      approved_by: [req.user.id],
      approved_at: new Date().toISOString(),
      rejection_reason: rejection_reason || 'No reason provided'
    });
    
    res.json({
      success: true,
      message: 'Inventory adjustment rejected successfully'
    });
  } catch (error) {
    console.error('Reject inventory adjustment error:', error);
    res.status(500).json({ message: 'Failed to reject inventory adjustment' });
  }
});

// Get pending adjustments
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const { branch_id } = req.query;
    
    let filterFormula = '{status} = "pending"';
    if (branch_id) {
      filterFormula = `AND(${filterFormula}, FIND("${branch_id}", ARRAYJOIN({branch_id})))`;
    }
    
    const pendingAdjustments = await airtableHelpers.find(TABLES.INVENTORY_ADJUSTMENTS, filterFormula);
    
    res.json(pendingAdjustments);
  } catch (error) {
    console.error('Get pending adjustments error:', error);
    res.status(500).json({ message: 'Failed to fetch pending adjustments' });
  }
});

module.exports = router;
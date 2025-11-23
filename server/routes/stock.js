const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ 
    message: 'Stock routes are working',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

// Simple test endpoint
router.post('/test', (req, res) => {
  console.log('Test endpoint hit with body:', req.body);
  res.json({ success: true, message: 'Test endpoint working', body: req.body });
});

// Check Stock_Movements table structure
router.get('/check-movements', async (req, res) => {
  try {
    const movements = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS);
    const fields = movements.length > 0 ? Object.keys(movements[0]) : 'No records found';
    res.json({ 
      success: true, 
      recordCount: movements.length,
      availableFields: fields,
      sampleRecord: movements[0] || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    res.json(allStock);
  } catch (error) {
    console.error('Get all stock error:', error);
    res.status(500).json({ message: 'Failed to fetch all stock' });
  }
});

router.get('/branch/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const stock = allStock.filter(item => 
      item.branch_id && item.branch_id.includes(branchId)
    );
    res.json(stock);
  } catch (error) {
    console.error('Get stock error:', error);
    res.status(500).json({ message: 'Failed to fetch stock' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { branchId, product_name, product_id, quantity_available, unit_price, reorder_level, branch_id } = req.body;
    const targetBranchId = branchId || (Array.isArray(branch_id) ? branch_id[0] : branch_id);

    if (!product_name || !quantity_available || !unit_price) {
      return res.status(400).json({ message: 'Product name, quantity, and unit price are required' });
    }

    if (!targetBranchId) {
      return res.status(400).json({ message: 'Branch ID is required' });
    }

    const stockData = {
      branch_id: [targetBranchId],
      product_id: product_id || `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      product_name: product_name.trim(),
      quantity_available: parseInt(quantity_available),
      unit_price: parseFloat(unit_price),
      reorder_level: parseInt(reorder_level) || 10,
      last_updated: new Date().toISOString()
    };

    const newStock = await airtableHelpers.create(TABLES.STOCK, stockData);
    res.status(201).json(newStock);
  } catch (error) {
    console.error('Add stock error:', error);
    res.status(500).json({ message: 'Failed to add stock', error: error.message });
  }
});

router.put('/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    const { product_name, product_id, quantity_available, unit_price, reorder_level } = req.body;

    const updateData = {
      last_updated: new Date().toISOString()
    };

    if (product_name) updateData.product_name = product_name;
    if (product_id) updateData.product_id = product_id;
    if (quantity_available !== undefined) updateData.quantity_available = parseInt(quantity_available);
    if (unit_price !== undefined) updateData.unit_price = parseFloat(unit_price);
    if (reorder_level !== undefined) updateData.reorder_level = parseInt(reorder_level);

    const updatedStock = await airtableHelpers.update(TABLES.STOCK, stockId, updateData);
    res.json(updatedStock);
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({ message: 'Failed to update stock' });
  }
});

router.delete('/:stockId', async (req, res) => {
  try {
    const { stockId } = req.params;
    await airtableHelpers.delete(TABLES.STOCK, stockId);
    res.json({ message: 'Stock item deleted successfully' });
  } catch (error) {
    console.error('Delete stock error:', error);
    res.status(500).json({ message: 'Failed to delete stock' });
  }
});

// Stock movements endpoint
router.get('/movements/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    const { startDate, endDate } = req.query;
    
    let filterFormula = '';
    if (branchId !== 'all') {
      filterFormula = `OR({from_branch_id} = "${branchId}", {to_branch_id} = "${branchId}")`;
    }
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({transfer_date}, "${startDate}"), IS_BEFORE({transfer_date}, "${endDate}"))`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${dateFilter})` : dateFilter;
    }
    
    const movements = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS, filterFormula);
    res.json(movements);
  } catch (error) {
    console.error('Get stock movements error:', error);
    res.status(500).json({ message: 'Failed to fetch stock movements' });
  }
});

// Stock Movement System - Comprehensive Architecture

// Create movement (all types: new_stock, transfer_out, transfer_in, sale)
router.post('/movement', async (req, res) => {
  try {
    const { 
      movement_type, 
      product_name, 
      quantity, 
      from_branch_id, 
      to_branch_id, 
      unit_cost, 
      reason,
      package_id,
      adjustment_id 
    } = req.body;
    
    const movementData = {
      movement_type,
      product_name,
      quantity: parseInt(quantity),
      unit_cost: parseFloat(unit_cost) || 0,
      total_cost: parseInt(quantity) * (parseFloat(unit_cost) || 0),
      reason: reason || '',
      status: 'pending',
      requested_by: req.user?.id ? [req.user.id] : [],
      created_at: new Date().toISOString()
    };
    
    // Add branch fields based on movement type
    if (from_branch_id) movementData.from_branch_id = [from_branch_id];
    if (to_branch_id) movementData.to_branch_id = [to_branch_id];
    if (package_id) movementData.package_id = [package_id];
    if (adjustment_id) movementData.adjustment_id = [adjustment_id];
    
    const movement = await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, movementData);
    res.json({ success: true, movement });
  } catch (error) {
    console.error('Create movement error:', error);
    res.status(500).json({ message: 'Failed to create movement', error: error.message });
  }
});

// Transfer endpoint (backward compatibility)
router.post('/transfer', authenticateToken, async (req, res) => {
  console.log('Transfer endpoint called with:', req.body);
  
  try {
    const { product_id, to_branch_id, from_branch_id, quantity, reason } = req.body;
    
    // Use correct Stock_Movements fields
    const movementData = {
      from_branch_id: [from_branch_id],
      to_branch_id: [to_branch_id],
      product_id: product_id,
      quantity: parseInt(quantity),
      status: 'Pending',
      movement_type: 'Transfer',
      created_at: new Date().toISOString()
    };
    
    if (req.user?.id) movementData.requested_by = [req.user.id];
    
    console.log('Creating movement with data:', movementData);
    const movement = await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, movementData);
    console.log('Movement created:', movement);
    
    res.json({ 
      success: true, 
      message: 'Transfer created successfully',
      movement: movement
    });
  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({ message: 'Transfer failed', error: error.message });
  }
});

// Approve movement
router.put('/movement/:movementId/approve', async (req, res) => {
  try {
    const { movementId } = req.params;
    
    const movement = await airtableHelpers.findById(TABLES.STOCK_MOVEMENTS, movementId);
    if (!movement) {
      return res.status(404).json({ message: 'Movement not found' });
    }
    
    // Update movement status
    await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, movementId, {
      status: 'approved',
      approved_by: req.user?.id ? [req.user.id] : [],
      approved_at: new Date().toISOString()
    });
    
    // Execute stock changes based on movement type
    await executeStockMovement(movement);
    
    res.json({ success: true, message: 'Movement approved and executed' });
  } catch (error) {
    console.error('Approve movement error:', error);
    res.status(500).json({ message: 'Failed to approve movement', error: error.message });
  }
});

// Reject movement
router.put('/movement/:movementId/reject', async (req, res) => {
  try {
    const { movementId } = req.params;
    const { rejection_reason } = req.body;
    
    await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, movementId, {
      status: 'rejected',
      approved_by: req.user?.id ? [req.user.id] : [],
      approved_at: new Date().toISOString(),
      rejection_reason: rejection_reason || 'No reason provided'
    });
    
    res.json({ success: true, message: 'Movement rejected' });
  } catch (error) {
    console.error('Reject movement error:', error);
    res.status(500).json({ message: 'Failed to reject movement', error: error.message });
  }
});

// Helper function to execute stock changes
async function executeStockMovement(movement) {
  const { movement_type, product_name, quantity, from_branch_id, to_branch_id, unit_cost } = movement;
  
  switch (movement_type) {
    case 'new_stock':
      if (to_branch_id && to_branch_id[0]) {
        await addStockToBranch(to_branch_id[0], product_name, quantity, unit_cost);
      }
      break;
      
    case 'transfer_out':
      if (from_branch_id && from_branch_id[0]) {
        await reduceStockFromBranch(from_branch_id[0], product_name, quantity);
      }
      if (to_branch_id && to_branch_id[0]) {
        await addStockToBranch(to_branch_id[0], product_name, quantity, unit_cost);
      }
      break;
      
    case 'sale':
      if (from_branch_id && from_branch_id[0]) {
        await reduceStockFromBranch(from_branch_id[0], product_name, quantity);
      }
      break;
  }
}

// Helper functions for stock operations
async function addStockToBranch(branchId, productName, quantity, unitCost) {
  const allStock = await airtableHelpers.find(TABLES.STOCK);
  const existingStock = allStock.find(item => 
    item.branch_id && item.branch_id.includes(branchId) && item.product_name === productName
  );
  
  if (existingStock) {
    await airtableHelpers.update(TABLES.STOCK, existingStock.id, {
      quantity_available: existingStock.quantity_available + quantity,
      last_updated: new Date().toISOString()
    });
  } else {
    await airtableHelpers.create(TABLES.STOCK, {
      branch_id: [branchId],
      product_name: productName,
      quantity_available: quantity,
      unit_price: unitCost || 0,
      reorder_level: 10,
      last_updated: new Date().toISOString()
    });
  }
}

async function reduceStockFromBranch(branchId, productName, quantity) {
  const allStock = await airtableHelpers.find(TABLES.STOCK);
  const existingStock = allStock.find(item => 
    item.branch_id && item.branch_id.includes(branchId) && item.product_name === productName
  );
  
  if (existingStock) {
    const newQuantity = Math.max(0, existingStock.quantity_available - quantity);
    await airtableHelpers.update(TABLES.STOCK, existingStock.id, {
      quantity_available: newQuantity,
      last_updated: new Date().toISOString()
    });
  }
}

// Get pending transfers for approval
router.get('/transfers/pending/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    
    let filterFormula = '{status} = "Pending"';
    if (branchId !== 'all') {
      filterFormula = `AND(${filterFormula}, {to_branch_id} = "${branchId}")`;
    }
    
    const pendingTransfers = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS, filterFormula);
    res.json(pendingTransfers);
  } catch (error) {
    console.error('Get pending transfers error:', error);
    res.status(500).json({ message: 'Failed to fetch pending transfers' });
  }
});

router.get('/transfers/pending/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    
    let filterFormula = '{status} = "pending"';
    if (branchId !== 'all') {
      filterFormula = `AND(${filterFormula}, {to_branch_id} = "${branchId}")`;
    }
    
    const pendingTransfers = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS, filterFormula);
    
    // Group by transfer_id
    const groupedTransfers = pendingTransfers.reduce((acc, transfer) => {
      const transferId = transfer.transfer_id;
      if (!acc[transferId]) {
        acc[transferId] = {
          transferId,
          fromBranchId: transfer.from_branch_id?.[0],
          toBranchId: transfer.to_branch_id?.[0],
          transferDate: transfer.transfer_date,
          reason: transfer.reason,
          requestedBy: transfer.requested_by,
          status: transfer.status,
          items: []
        };
      }
      
      acc[transferId].items.push({
        movementId: transfer.id,
        productId: transfer.product_id,
        productName: transfer.product_name,
        quantity: transfer.quantity,
        unitCost: transfer.unit_cost,
        totalCost: transfer.total_cost
      });
      
      return acc;
    }, {});
    
    res.json(Object.values(groupedTransfers));
  } catch (error) {
    console.error('Get pending transfers error:', error);
    res.status(500).json({ message: 'Failed to fetch pending transfers' });
  }
});

router.put('/transfers/:transferId/approve', authenticateToken, async (req, res) => {
  try {
    const { transferId } = req.params;
    
    // Get the transfer record
    const transfer = await airtableHelpers.findById(TABLES.STOCK_MOVEMENTS, transferId);
    if (!transfer) {
      return res.status(404).json({ message: 'Transfer not found' });
    }
    
    const processedItems = [];
    
    // Process each movement
    for (const movement of movements) {
      // Reduce stock from source branch
      const sourceStock = await airtableHelpers.find(
        TABLES.STOCK,
        `AND({branch_id} = "${movement.from_branch_id[0]}", {product_id} = "${movement.product_id}")`
      );
      
      if (sourceStock.length > 0) {
        const newSourceQuantity = sourceStock[0].quantity_available - movement.quantity;
        await airtableHelpers.update(TABLES.STOCK, sourceStock[0].id, {
          quantity_available: Math.max(0, newSourceQuantity),
          last_updated: new Date().toISOString()
        });
      }
      
      // Add stock to destination branch
      const destStock = await airtableHelpers.find(
        TABLES.STOCK,
        `AND({branch_id} = "${movement.to_branch_id[0]}", {product_name} = "${movement.product_name}")`
      );
      
      if (destStock.length > 0) {
        // Update existing stock
        const newDestQuantity = destStock[0].quantity_available + movement.quantity;
        await airtableHelpers.update(TABLES.STOCK, destStock[0].id, {
          quantity_available: newDestQuantity,
          last_updated: new Date().toISOString()
        });
      } else {
        // Create new stock entry
        await airtableHelpers.create(TABLES.STOCK, {
          branch_id: [movement.to_branch_id[0]],
          product_id: movement.product_id,
          product_name: movement.product_name,
          quantity_available: movement.quantity,
          unit_price: movement.unit_cost,
          reorder_level: 10,
          last_updated: new Date().toISOString()
        });
      }
      
      // Update movement status
      await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, movement.id, {
        status: 'completed',
        approved_by: [req.user.id],
        approved_at: new Date().toISOString()
      });
      
      processedItems.push({
        productName: movement.product_name,
        quantity: movement.quantity,
        status: 'completed'
      });
    }
    
    res.json({
      success: true,
      message: `Transfer ${transferId} approved successfully`,
      processedItems
    });
  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ message: 'Failed to approve transfer' });
  }
});

router.put('/transfers/:transferId/reject', async (req, res) => {
  try {
    const { transferId } = req.params;
    const { reason } = req.body;
    
    // Update all movements for this transfer
    const movements = await airtableHelpers.find(
      TABLES.STOCK_MOVEMENTS,
      `{transfer_id} = "${transferId}"`
    );
    
    for (const movement of movements) {
      await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, movement.id, {
        status: 'rejected',
        rejected_by: [req.user.id],
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || 'No reason provided'
      });
    }
    
    res.json({
      success: true,
      message: `Transfer ${transferId} rejected successfully`,
      rejectedItems: movements.length
    });
  } catch (error) {
    console.error('Reject transfer error:', error);
    res.status(500).json({ message: 'Failed to reject transfer' });
  }
});

// Get transfer receipts
router.get('/transfers/:transferId/receipt', async (req, res) => {
  try {
    const { transferId } = req.params;
    
    const movements = await airtableHelpers.find(
      TABLES.STOCK_MOVEMENTS,
      `{transfer_id} = "${transferId}"`
    );
    
    if (movements.length === 0) {
      return res.status(404).json({ message: 'Transfer not found' });
    }
    
    const receipt = {
      transferId,
      status: movements[0].status,
      transferDate: movements[0].transfer_date,
      fromBranchId: movements[0].from_branch_id?.[0],
      toBranchId: movements[0].to_branch_id?.[0],
      reason: movements[0].reason,
      requestedBy: movements[0].requested_by,
      approvedBy: movements[0].approved_by,
      approvedAt: movements[0].approved_at,
      items: movements.map(m => ({
        productName: m.product_name,
        quantity: m.quantity,
        unitCost: m.unit_cost,
        totalCost: m.total_cost
      })),
      totalValue: movements.reduce((sum, m) => sum + (m.total_cost || 0), 0)
    };
    
    res.json(receipt);
  } catch (error) {
    console.error('Get transfer receipt error:', error);
    res.status(500).json({ message: 'Failed to get transfer receipt' });
  }
});

module.exports = router;
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

// Get all movements for debugging
router.get('/movements/all', async (req, res) => {
  try {
    const allMovements = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS);
    res.json({ 
      success: true, 
      count: allMovements.length,
      movements: allMovements 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
      sampleRecord: movements[0] || null,
      allRecords: movements
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

// Transfer endpoint (backward compatibility)
router.post('/transfer', authenticateToken, async (req, res) => {
  console.log('Transfer endpoint called with:', req.body);
  
  try {
    const { product_id, to_branch_id, from_branch_id, quantity, reason } = req.body;
    
    // Use only fields that work without permission issues
    const movementData = {
      from_branch_id: [from_branch_id],
      to_branch_id: [to_branch_id],
      product_id: product_id,
      quantity: parseInt(quantity)
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

// Get pending transfers for a branch (both incoming and outgoing)
router.get('/transfers/pending/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    
    // Get all movements and filter in JavaScript (simpler approach)
    const allMovements = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS);
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    const users = await airtableHelpers.find(TABLES.EMPLOYEES);
    const products = await airtableHelpers.find(TABLES.STOCK);
    
    const branchMap = branches.reduce((acc, branch) => {
      acc[branch.id] = branch.branch_name || branch.name;
      return acc;
    }, {});
    
    const userMap = users.reduce((acc, user) => {
      acc[user.id] = user.name;
      return acc;
    }, {});
    
    const productMap = products.reduce((acc, product) => {
      acc[product.product_id] = product.product_name;
      return acc;
    }, {});
    
    // Filter for this branch (either sender or receiver) and not approved
    const relevantTransfers = allMovements.filter(transfer => {
      const isRelevant = (transfer.to_branch_id && transfer.to_branch_id.includes(branchId)) ||
                        (transfer.from_branch_id && transfer.from_branch_id.includes(branchId));
      const isPending = !transfer.approved_by;
      return isRelevant && isPending;
    });
    
    // Add direction info and names
    const transfersWithDirection = relevantTransfers.map(transfer => ({
      ...transfer,
      direction: (transfer.to_branch_id && transfer.to_branch_id.includes(branchId)) ? 'incoming' : 'outgoing',
      canApprove: (transfer.to_branch_id && transfer.to_branch_id.includes(branchId)),
      from_branch_name: branchMap[Array.isArray(transfer.from_branch_id) ? transfer.from_branch_id[0] : transfer.from_branch_id] || 'Unknown',
      to_branch_name: branchMap[Array.isArray(transfer.to_branch_id) ? transfer.to_branch_id[0] : transfer.to_branch_id] || 'Unknown',
      requested_by_name: userMap[Array.isArray(transfer.requested_by) ? transfer.requested_by[0] : transfer.requested_by] || 'Unknown',
      product_name: productMap[transfer.product_id] || transfer.product_id
    }));
    
    res.json(transfersWithDirection);
  } catch (error) {
    console.error('Get pending transfers error:', error);
    res.status(500).json({ message: 'Failed to fetch pending transfers' });
  }
});

// Get completed transfers for a branch
router.get('/transfers/completed/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    
    const allMovements = await airtableHelpers.find(TABLES.STOCK_MOVEMENTS);
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    const users = await airtableHelpers.find(TABLES.EMPLOYEES);
    const products = await airtableHelpers.find(TABLES.STOCK);
    
    const branchMap = branches.reduce((acc, branch) => {
      acc[branch.id] = branch.branch_name || branch.name;
      return acc;
    }, {});
    
    const userMap = users.reduce((acc, user) => {
      acc[user.id] = user.name;
      return acc;
    }, {});
    
    const productMap = products.reduce((acc, product) => {
      acc[product.product_id] = product.product_name;
      return acc;
    }, {});
    
    // Filter for this branch and approved transfers
    const relevantTransfers = allMovements.filter(transfer => {
      const isRelevant = (transfer.to_branch_id && transfer.to_branch_id.includes(branchId)) ||
                        (transfer.from_branch_id && transfer.from_branch_id.includes(branchId));
      const isCompleted = transfer.approved_by;
      return isRelevant && isCompleted;
    });
    
    // Add direction info and names
    const transfersWithDirection = relevantTransfers.map(transfer => ({
      ...transfer,
      direction: (transfer.to_branch_id && transfer.to_branch_id.includes(branchId)) ? 'incoming' : 'outgoing',
      from_branch_name: branchMap[Array.isArray(transfer.from_branch_id) ? transfer.from_branch_id[0] : transfer.from_branch_id] || 'Unknown',
      to_branch_name: branchMap[Array.isArray(transfer.to_branch_id) ? transfer.to_branch_id[0] : transfer.to_branch_id] || 'Unknown',
      requested_by_name: userMap[Array.isArray(transfer.requested_by) ? transfer.requested_by[0] : transfer.requested_by] || 'Unknown',
      approved_by_name: userMap[Array.isArray(transfer.approved_by) ? transfer.approved_by[0] : transfer.approved_by] || 'Unknown',
      product_name: productMap[transfer.product_id] || transfer.product_id
    }));
    
    res.json(transfersWithDirection);
  } catch (error) {
    console.error('Get completed transfers error:', error);
    res.status(500).json({ message: 'Failed to fetch completed transfers' });
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
    
    // Update transfer with approval info
    await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, transferId, {
      approved_by: [req.user.id],
      approved_at: new Date().toISOString()
    });
    
    // Update stock quantities
    const { from_branch_id, to_branch_id, product_id, quantity } = transfer;
    
    // Get all stock to filter in JavaScript
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    
    // Reduce stock from source branch
    if (from_branch_id && from_branch_id[0]) {
      const sourceStock = allStock.find(stock => 
        stock.branch_id && stock.branch_id.includes(from_branch_id[0]) && stock.product_id === product_id
      );
      
      if (sourceStock) {
        const newQuantity = Math.max(0, sourceStock.quantity_available - quantity);
        await airtableHelpers.update(TABLES.STOCK, sourceStock.id, {
          quantity_available: newQuantity,
          last_updated: new Date().toISOString()
        });
      }
    }
    
    // Add stock to destination branch
    if (to_branch_id && to_branch_id[0]) {
      const destStock = allStock.find(stock => 
        stock.branch_id && stock.branch_id.includes(to_branch_id[0]) && stock.product_id === product_id
      );
      
      if (destStock) {
        // Update existing stock
        const newQuantity = destStock.quantity_available + quantity;
        await airtableHelpers.update(TABLES.STOCK, destStock.id, {
          quantity_available: newQuantity,
          last_updated: new Date().toISOString()
        });
      } else {
        // Get source stock info for creating new record
        const sourceStock = allStock.find(stock => 
          stock.branch_id && stock.branch_id.includes(from_branch_id[0]) && stock.product_id === product_id
        );
        
        if (sourceStock) {
          await airtableHelpers.create(TABLES.STOCK, {
            branch_id: [to_branch_id[0]],
            product_id: product_id,
            product_name: sourceStock.product_name,
            quantity_available: quantity,
            unit_price: sourceStock.unit_price || 0,
            reorder_level: sourceStock.reorder_level || 10,
            last_updated: new Date().toISOString()
          });
        }
      }
    }
    
    res.json({ success: true, message: 'Transfer approved and stock updated' });

  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ message: 'Failed to approve transfer' });
  }
});

router.put('/transfers/:transferId/reject', async (req, res) => {
  try {
    const { transferId } = req.params;
    const { reason } = req.body;
    
    await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, transferId, {
      approved_by: ['REJECTED'],
      approved_at: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Transfer rejected successfully' });
  } catch (error) {
    console.error('Reject transfer error:', error);
    res.status(500).json({ message: 'Failed to reject transfer' });
  }
});

module.exports = router;
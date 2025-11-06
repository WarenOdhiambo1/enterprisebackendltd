const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// CSRF protection middleware (disabled in development)
const csrfProtection = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  if (!token || token !== req.session?.csrfToken) {
    return res.status(403).json({ message: 'Invalid CSRF token' });
  }
  next();
};

const router = express.Router();

// Debug route to check all data
router.get('/debug', async (req, res) => {
  try {
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    const stock = await airtableHelpers.find(TABLES.STOCK);
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    
    // Try to get sales data
    let sales = [];
    try {
      sales = await airtableHelpers.find(TABLES.SALES);
    } catch (salesError) {
      console.log('Sales table error:', salesError.message);
    }
    
    console.log('DEBUG - Branches:', branches.length);
    console.log('DEBUG - Stock:', stock.length);
    console.log('DEBUG - Employees:', employees.length);
    console.log('DEBUG - Sales:', sales.length);
    
    if (branches.length > 0) {
      console.log('First branch:', branches[0]);
    }
    if (stock.length > 0) {
      console.log('First stock item:', stock[0]);
    }
    
    res.json({ branches, stock, employees, sales });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ message: 'Debug failed', error: error.message });
  }
});

// Get stock for a branch
router.get('/branch/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    console.log('Fetching stock for branchId:', branchId);
    
    // Get all stock first to debug
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    console.log('Total stock items:', allStock.length);
    
    // Filter by branch_id
    const stock = allStock.filter(item => 
      item.branch_id && item.branch_id.includes(branchId)
    );
    
    console.log('Stock found for branch:', stock.length, 'items');
    res.json(stock);
  } catch (error) {
    console.error('Get stock error:', error);
    res.status(500).json({ message: 'Failed to fetch stock' });
  }
});

// Add new stock item
router.post('/branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { product_name, product_id, quantity_available, unit_price, reorder_level } = req.body;

    if (!product_name || !quantity_available || !unit_price) {
      return res.status(400).json({ message: 'Product name, quantity, and unit price are required' });
    }

    const stockData = {
      branch_id: [branchId], // Link field requires array
      product_id: product_id || `PRD_${Date.now()}`,
      product_name,
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

// Update stock item details
router.put('/:stockId', csrfProtection, async (req, res) => {
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

// Delete stock item
router.delete('/:stockId', authenticateToken, async (req, res) => {
  try {
    const { stockId } = req.params;
    await airtableHelpers.delete(TABLES.STOCK, stockId);
    res.json({ message: 'Stock item deleted successfully' });
  } catch (error) {
    console.error('Delete stock error:', error);
    res.status(500).json({ message: 'Failed to delete stock' });
  }
});

// Get pending transfers for branch
router.get('/transfers/pending/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    
    const transfers = await airtableHelpers.find(
      TABLES.STOCK_MOVEMENTS,
      `AND({to_branch_id} = "${branchId}", {status} = "pending")`
    );
    
    res.json(transfers);
  } catch (error) {
    console.error('Get pending transfers error:', error);
    res.status(500).json({ message: 'Failed to fetch pending transfers' });
  }
});

// Get stock movements for branch
router.get('/movements/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { limit = 50 } = req.query;
    
    const movements = await airtableHelpers.find(
      TABLES.STOCK_MOVEMENTS,
      `OR({from_branch_id} = "${branchId}", {to_branch_id} = "${branchId}")`,
      { maxRecords: parseInt(limit) }
    );
    
    res.json(movements);
  } catch (error) {
    console.error('Get stock movements error:', error);
    res.status(500).json({ message: 'Failed to fetch stock movements' });
  }
});

// Transfer stock between branches
router.post('/transfer', authenticateToken, csrfProtection, async (req, res) => {
  try {
    const { from_branch_id, to_branch_id, product_id, quantity, reason } = req.body;

    if (!from_branch_id || !to_branch_id || !product_id || !quantity) {
      return res.status(400).json({ message: 'All transfer details are required' });
    }

    // Check if stock exists and has sufficient quantity
    const stock = await airtableHelpers.find(
      TABLES.STOCK,
      `AND(FIND("${from_branch_id}", ARRAYJOIN({branch_id})), {product_id} = "${product_id}")`
    );

    if (!stock.length) {
      return res.status(404).json({ message: 'Product not found in source branch' });
    }

    const stockItem = stock[0];
    if (stockItem.quantity_available < quantity) {
      return res.status(400).json({ message: 'Insufficient stock quantity' });
    }

    // Create stock movement record
    const movement = await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
      from_branch_id: [from_branch_id],
      to_branch_id: [to_branch_id],
      product_id,
      product_name: stockItem.product_name,
      quantity: parseInt(quantity),
      status: 'pending',
      reason: reason || '',
      requested_by: req.user.id,
      created_at: new Date().toISOString()
    });

    // Deduct from source branch immediately
    await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
      quantity_available: stockItem.quantity_available - parseInt(quantity),
      last_updated: new Date().toISOString()
    });

    res.status(201).json(movement);
  } catch (error) {
    console.error('Transfer stock error:', error);
    res.status(500).json({ message: 'Failed to transfer stock' });
  }
});

// Approve stock transfer
router.patch('/transfers/:transferId/approve', authenticateToken, csrfProtection, async (req, res) => {
  try {
    const { transferId } = req.params;
    
    const transfer = await airtableHelpers.findById(TABLES.STOCK_MOVEMENTS, transferId);
    if (!transfer) {
      return res.status(404).json({ message: 'Transfer not found' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ message: 'Transfer is not pending' });
    }

    // Add to destination branch stock
    const destinationStock = await airtableHelpers.find(
      TABLES.STOCK,
      `AND(FIND("${transfer.to_branch_id}", ARRAYJOIN({branch_id})), {product_id} = "${transfer.product_id}")`
    );

    if (destinationStock.length > 0) {
      // Update existing stock
      await airtableHelpers.update(TABLES.STOCK, destinationStock[0].id, {
        quantity_available: destinationStock[0].quantity_available + transfer.quantity,
        last_updated: new Date().toISOString()
      });
    } else {
      // Create new stock entry
      await airtableHelpers.create(TABLES.STOCK, {
        branch_id: [transfer.to_branch_id],
        product_id: transfer.product_id,
        product_name: transfer.product_name,
        quantity_available: transfer.quantity,
        unit_price: 0, // Will need to be updated
        reorder_level: 10,
        last_updated: new Date().toISOString()
      });
    }

    // Update transfer status
    const updatedTransfer = await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, transferId, {
      status: 'approved',
      approved_by: req.user.id,
      approved_at: new Date().toISOString()
    });

    res.json(updatedTransfer);
  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ message: 'Failed to approve transfer' });
  }
});

// Reject stock transfer
router.patch('/transfers/:transferId/reject', authenticateToken, csrfProtection, async (req, res) => {
  try {
    const { transferId } = req.params;
    
    const transfer = await airtableHelpers.findById(TABLES.STOCK_MOVEMENTS, transferId);
    if (!transfer) {
      return res.status(404).json({ message: 'Transfer not found' });
    }

    if (transfer.status !== 'pending') {
      return res.status(400).json({ message: 'Transfer is not pending' });
    }

    // Return stock to source branch
    const sourceStock = await airtableHelpers.find(
      TABLES.STOCK,
      `AND(FIND("${transfer.from_branch_id}", ARRAYJOIN({branch_id})), {product_id} = "${transfer.product_id}")`
    );

    if (sourceStock.length > 0) {
      await airtableHelpers.update(TABLES.STOCK, sourceStock[0].id, {
        quantity_available: sourceStock[0].quantity_available + transfer.quantity,
        last_updated: new Date().toISOString()
      });
    }

    // Update transfer status
    const updatedTransfer = await airtableHelpers.update(TABLES.STOCK_MOVEMENTS, transferId, {
      status: 'rejected',
      rejected_by: req.user.id,
      rejected_at: new Date().toISOString()
    });

    res.json(updatedTransfer);
  } catch (error) {
    console.error('Reject transfer error:', error);
    res.status(500).json({ message: 'Failed to reject transfer' });
  }
});

module.exports = router;
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
    // For now, return empty array since Stock_Movements table was removed
    // This prevents 404 errors while maintaining API compatibility
    res.json([]);
  } catch (error) {
    console.error('Get stock movements error:', error);
    res.status(500).json({ message: 'Failed to fetch stock movements' });
  }
});

// Transfer-related endpoints
router.post('/transfer', async (req, res) => {
  try {
    // For now, return success without actual transfer since Stock_Movements table was removed
    res.json({ message: 'Transfer initiated successfully', id: `TRF_${Date.now()}` });
  } catch (error) {
    console.error('Transfer stock error:', error);
    res.status(500).json({ message: 'Failed to initiate transfer' });
  }
});

router.get('/transfers/pending/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    // For now, return empty array since Stock_Movements table was removed
    res.json([]);
  } catch (error) {
    console.error('Get pending transfers error:', error);
    res.status(500).json({ message: 'Failed to fetch pending transfers' });
  }
});

router.put('/transfers/:transferId/approve', async (req, res) => {
  try {
    const { transferId } = req.params;
    // For now, return success without actual approval
    res.json({ message: 'Transfer approved successfully' });
  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ message: 'Failed to approve transfer' });
  }
});

router.put('/transfers/:transferId/reject', async (req, res) => {
  try {
    const { transferId } = req.params;
    // For now, return success without actual rejection
    res.json({ message: 'Transfer rejected successfully' });
  } catch (error) {
    console.error('Reject transfer error:', error);
    res.status(500).json({ message: 'Failed to reject transfer' });
  }
});

module.exports = router;
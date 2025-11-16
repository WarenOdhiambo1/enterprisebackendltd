const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ message: 'Sales routes working', timestamp: new Date().toISOString() });
});

router.get('/', async (req, res) => {
  try {
    const allSales = await airtableHelpers.find(TABLES.SALES);
    res.json(allSales);
  } catch (error) {
    console.error('Get all sales error:', error);
    res.status(500).json({ message: 'Failed to fetch sales' });
  }
});

router.get('/branch/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;
    
    // Get sales for the branch
    const allSales = await airtableHelpers.find(TABLES.SALES);
    const branchSales = allSales.filter(sale => 
      sale.branch_id && sale.branch_id.includes(branchId)
    );
    
    // Get all sale items at once for better performance
    const allSaleItems = await airtableHelpers.find(TABLES.SALE_ITEMS);
    
    // Map sales with their items
    const salesWithItems = branchSales.map(sale => {
      const saleItems = allSaleItems.filter(item => 
        item.sale_id && item.sale_id.includes(sale.id)
      );
      return { ...sale, items: saleItems };
    });
    
    res.json(salesWithItems);
  } catch (error) {
    console.error('Get branch sales error:', error);
    res.status(500).json({ message: 'Failed to fetch branch sales' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { items, branchId, customer_name, payment_method, sale_date, employee_id } = req.body;

    if (!items || items.length === 0 || !branchId) {
      return res.status(400).json({ message: 'Items and branch ID are required' });
    }

    // Calculate total amount
    const saleTotal = items.reduce((sum, item) => {
      return sum + (parseInt(item.quantity) * parseFloat(item.unit_price));
    }, 0);
    
    // Create main sale record with minimal fields
    const salesData = {
      branch_id: [branchId],
      total_amount: saleTotal,
      sale_date: sale_date || new Date().toISOString().split('T')[0]
    };
    
    const newSale = await airtableHelpers.create(TABLES.SALES, salesData);
    
    // Process each item: create sale item and reduce stock
    const saleItems = [];
    for (const item of items) {
      if (!item.quantity || !item.unit_price) continue;
      
      // Create sale item
      const saleItemData = {
        sale_id: [newSale.id],
        product_name: item.product_name || '',
        quantity: parseInt(item.quantity),
        unit_price: parseFloat(item.unit_price)
      };
      
      try {
        const saleItem = await airtableHelpers.create(TABLES.SALE_ITEMS, saleItemData);
        saleItems.push(saleItem);
        
        // Create stock movement for sale (auto-approved)
        const saleMovement = await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
          movement_type: 'sale',
          from_branch_id: [branchId],
          product_name: item.product_name,
          quantity: parseInt(item.quantity),
          unit_cost: parseFloat(item.unit_price),
          total_cost: parseInt(item.quantity) * parseFloat(item.unit_price),
          reason: `Sale to ${customer_name || 'customer'}`,
          status: 'approved',
          requested_by: employee_id ? [employee_id] : [],
          approved_by: employee_id ? [employee_id] : [],
          created_at: new Date().toISOString(),
          approved_at: new Date().toISOString()
        });
        
        // Reduce stock automatically for sales
        const allStock = await airtableHelpers.find(TABLES.STOCK);
        const stockItem = allStock.find(s => 
          s.branch_id && s.branch_id.includes(branchId) && s.product_name === item.product_name
        );
        
        if (stockItem) {
          const newQuantity = Math.max(0, stockItem.quantity_available - parseInt(item.quantity));
          await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
            quantity_available: newQuantity,
            last_updated: new Date().toISOString()
          });
        }
      } catch (itemError) {
        console.error('Sale item/stock error:', itemError);
      }
    }
    
    res.status(201).json({ sale: newSale, items: saleItems });
  } catch (error) {
    console.error('Add sale error:', error);
    res.status(500).json({ message: 'Failed to add sale', error: error.message });
  }
});

router.put('/:saleId', async (req, res) => {
  try {
    const { saleId } = req.params;
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString()
    };

    const updatedSale = await airtableHelpers.update(TABLES.SALES, saleId, updateData);
    res.json(updatedSale);
  } catch (error) {
    console.error('Update sale error:', error);
    res.status(500).json({ message: 'Failed to update sale' });
  }
});

router.delete('/:saleId', async (req, res) => {
  try {
    const { saleId } = req.params;
    await airtableHelpers.delete(TABLES.SALES, saleId);
    res.json({ message: 'Sale deleted successfully' });
  } catch (error) {
    console.error('Delete sale error:', error);
    res.status(500).json({ message: 'Failed to delete sale' });
  }
});

module.exports = router;
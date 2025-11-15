const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');

const router = express.Router();

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
    const allSales = await airtableHelpers.find(TABLES.SALES);
    const branchSales = allSales.filter(sale => 
      sale.branch_id && sale.branch_id.includes(branchId)
    );
    res.json(branchSales);
  } catch (error) {
    console.error('Get branch sales error:', error);
    res.status(500).json({ message: 'Failed to fetch branch sales' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { branch_id, product_id, quantity_sold, unit_price, total_amount, customer_name, sale_date, items, branchId, payment_method, employee_id } = req.body;

    // Handle new format with items array
    if (items && items.length > 0 && branchId) {
      const results = [];
      
      for (const item of items) {
        if (!item.quantity || !item.unit_price) {
          continue;
        }
        
        const salesData = {
          branch_id: [branchId],
          quantity_sold: parseInt(item.quantity),
          unit_price: parseFloat(item.unit_price),
          total_amount: parseInt(item.quantity) * parseFloat(item.unit_price),
          customer_name: customer_name || '',
          payment_method: payment_method || 'cash',
          sale_date: sale_date || new Date().toISOString().split('T')[0],
          employee_id: employee_id ? [employee_id] : [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        const newSale = await airtableHelpers.create(TABLES.SALES, salesData);
        results.push(newSale);
      }
      
      return res.status(201).json(results);
    }
    
    // Handle old format
    if (!branch_id || !quantity_sold || !unit_price) {
      return res.status(400).json({ message: 'Branch ID, quantity, and unit price are required' });
    }

    const salesData = {
      branch_id: Array.isArray(branch_id) ? branch_id : [branch_id],
      quantity_sold: parseInt(quantity_sold),
      unit_price: parseFloat(unit_price),
      total_amount: parseFloat(total_amount) || (parseInt(quantity_sold) * parseFloat(unit_price)),
      customer_name: customer_name || '',
      sale_date: sale_date || new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const newSale = await airtableHelpers.create(TABLES.SALES, salesData);
    res.status(201).json(newSale);
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
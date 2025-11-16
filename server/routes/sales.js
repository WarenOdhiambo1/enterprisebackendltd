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

// Get sales analytics
router.get('/analytics', async (req, res) => {
  try {
    const { branch_id, date_range, group_by = 'day' } = req.query;
    
    let sales = await airtableHelpers.find(TABLES.SALES);
    
    // Apply branch filter
    if (branch_id) {
      sales = sales.filter(sale => 
        sale.branch_id && sale.branch_id.includes(branch_id)
      );
    }
    
    // Apply date range filter
    if (date_range) {
      const [start_date, end_date] = date_range.split(',');
      sales = sales.filter(sale => 
        sale.sale_date >= start_date && sale.sale_date <= end_date
      );
    }
    
    // Group and calculate analytics
    const analytics = {};
    
    for (const sale of sales) {
      let groupKey;
      
      switch (group_by) {
        case 'day':
          groupKey = sale.sale_date || 'unknown';
          break;
        case 'month':
          groupKey = sale.sale_date ? sale.sale_date.substring(0, 7) : 'unknown';
          break;
        case 'branch':
          groupKey = sale.branch_id ? sale.branch_id[0] : 'unknown';
          break;
        case 'employee':
          groupKey = sale.employee_id ? sale.employee_id[0] : 'unknown';
          break;
        default:
          groupKey = 'all';
      }
      
      if (!analytics[groupKey]) {
        analytics[groupKey] = {
          count: 0,
          total_revenue: 0,
          average_sale: 0,
          sales: []
        };
      }
      
      analytics[groupKey].count++;
      analytics[groupKey].total_revenue += parseFloat(sale.total_amount) || 0;
      analytics[groupKey].sales.push(sale);
    }
    
    // Calculate averages
    for (const [key, data] of Object.entries(analytics)) {
      data.average_sale = data.count > 0 ? data.total_revenue / data.count : 0;
    }
    
    res.json({
      success: true,
      data: analytics,
      group_by,
      total_sales: sales.length,
      total_revenue: sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0)
    });
  } catch (error) {
    console.error('Get sales analytics error:', error);
    res.status(500).json({ message: 'Failed to generate sales analytics' });
  }
});

// Get sales by date
router.get('/by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { branch_id } = req.query;
    
    let filterFormula = `{sale_date} = "${date}"`;
    
    if (branch_id) {
      filterFormula = `AND(${filterFormula}, FIND("${branch_id}", ARRAYJOIN({branch_id})))`;
    }
    
    const sales = await airtableHelpers.find(TABLES.SALES, filterFormula);
    
    const summary = {
      total_sales: sales.length,
      total_revenue: sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0),
      average_sale: sales.length > 0 ? sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0) / sales.length : 0
    };
    
    res.json({ sales, summary });
  } catch (error) {
    console.error('Get sales by date error:', error);
    res.status(500).json({ message: 'Failed to fetch sales by date' });
  }
});

// Process refund
router.post('/:id/refund', async (req, res) => {
  try {
    const { id } = req.params;
    const { refund_amount, refund_reason, items_to_refund } = req.body;
    
    if (!refund_amount || refund_amount <= 0) {
      return res.status(400).json({ message: 'Valid refund amount is required' });
    }
    
    const sale = await airtableHelpers.findById(TABLES.SALES, id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    // Update sale with refund information
    await airtableHelpers.update(TABLES.SALES, id, {
      refund_amount: parseFloat(refund_amount),
      refund_reason: refund_reason || '',
      refund_date: new Date().toISOString().split('T')[0],
      status: 'refunded',
      updated_at: new Date().toISOString()
    });
    
    // If specific items are being refunded, restore stock
    if (items_to_refund && Array.isArray(items_to_refund)) {
      for (const item of items_to_refund) {
        // Create stock movement for refund
        await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
          movement_type: 'refund',
          to_branch_id: sale.branch_id,
          product_name: item.product_name,
          quantity: parseInt(item.quantity),
          reason: `Refund for sale ${id}: ${refund_reason}`,
          status: 'approved',
          created_at: new Date().toISOString(),
          approved_at: new Date().toISOString()
        });
        
        // Restore stock
        const allStock = await airtableHelpers.find(TABLES.STOCK);
        const stockItem = allStock.find(s => 
          s.branch_id && s.branch_id.includes(sale.branch_id[0]) && 
          s.product_name === item.product_name
        );
        
        if (stockItem) {
          await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
            quantity_available: stockItem.quantity_available + parseInt(item.quantity),
            last_updated: new Date().toISOString()
          });
        }
      }
    }
    
    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund_amount: parseFloat(refund_amount)
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({ message: 'Failed to process refund' });
  }
});

// Sale Items Management

// Get all sale items
router.get('/items', async (req, res) => {
  try {
    const { sale_id, product_name } = req.query;
    
    let saleItems = await airtableHelpers.find(TABLES.SALE_ITEMS);
    
    // Apply filters
    if (sale_id) {
      saleItems = saleItems.filter(item => 
        item.sale_id && item.sale_id.includes(sale_id)
      );
    }
    
    if (product_name) {
      saleItems = saleItems.filter(item => 
        item.product_name && item.product_name.toLowerCase().includes(product_name.toLowerCase())
      );
    }
    
    res.json(saleItems);
  } catch (error) {
    console.error('Get sale items error:', error);
    res.status(500).json({ message: 'Failed to fetch sale items' });
  }
});

// Get sale items by sale ID
router.get('/items/by-sale/:saleId', async (req, res) => {
  try {
    const { saleId } = req.params;
    
    const saleItems = await airtableHelpers.find(
      TABLES.SALE_ITEMS,
      `FIND("${saleId}", ARRAYJOIN({sale_id}))`
    );
    
    const summary = {
      total_items: saleItems.length,
      total_quantity: saleItems.reduce((sum, item) => sum + (item.quantity || 0), 0),
      total_value: saleItems.reduce((sum, item) => sum + ((item.quantity || 0) * (item.unit_price || 0)), 0)
    };
    
    res.json({ items: saleItems, summary });
  } catch (error) {
    console.error('Get sale items by sale error:', error);
    res.status(500).json({ message: 'Failed to fetch sale items' });
  }
});

// Add sale item
router.post('/items', async (req, res) => {
  try {
    const { sale_id, product_name, quantity, unit_price } = req.body;
    
    if (!sale_id || !product_name || !quantity || !unit_price) {
      return res.status(400).json({ 
        message: 'Sale ID, product name, quantity, and unit price are required' 
      });
    }
    
    const saleItemData = {
      sale_id: [sale_id],
      product_name,
      quantity: parseInt(quantity),
      unit_price: parseFloat(unit_price),
      total_price: parseInt(quantity) * parseFloat(unit_price)
    };
    
    const newSaleItem = await airtableHelpers.create(TABLES.SALE_ITEMS, saleItemData);
    
    // Update sale total
    const sale = await airtableHelpers.findById(TABLES.SALES, sale_id);
    if (sale) {
      const newTotal = (sale.total_amount || 0) + (parseInt(quantity) * parseFloat(unit_price));
      await airtableHelpers.update(TABLES.SALES, sale_id, {
        total_amount: newTotal,
        updated_at: new Date().toISOString()
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Sale item added successfully',
      item: newSaleItem
    });
  } catch (error) {
    console.error('Add sale item error:', error);
    res.status(500).json({ message: 'Failed to add sale item' });
  }
});

module.exports = router;
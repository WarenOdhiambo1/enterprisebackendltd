const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');

const router = express.Router();

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Sales API working', 
    timestamp: new Date().toISOString(),
    tables: Object.keys(TABLES),
    status: 'OK'
  });
});

// Test sale creation and show table schemas
router.post('/test-sale', async (req, res) => {
  try {
    console.log('Test sale request:', req.body);
    
    // Get sample data
    const sales = await airtableHelpers.find(TABLES.SALES);
    const saleItems = await airtableHelpers.find(TABLES.SALE_ITEMS);
    const stock = await airtableHelpers.find(TABLES.STOCK);
    
    res.json({
      message: 'Test successful',
      sampleData: {
        salesCount: sales.length,
        saleItemsCount: saleItems.length,
        stockCount: stock.length,
        sampleSale: sales[0] || null,
        sampleSaleItem: saleItems[0] || null,
        sampleStock: stock[0] || null
      },
      schemas: {
        salesFields: sales[0] ? Object.keys(sales[0]) : [],
        saleItemsFields: saleItems[0] ? Object.keys(saleItems[0]) : [],
        stockFields: stock[0] ? Object.keys(stock[0]) : []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    const { items, branchId, sale_date } = req.body;

    if (!items || items.length === 0 || !branchId) {
      return res.status(400).json({ message: 'Items and branch ID are required' });
    }

    // Calculate total
    const saleTotal = items.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unit_price));
    }, 0);
    
    // Create sale with minimal fields
    const salesData = {
      branch_id: [branchId],
      total_amount: saleTotal,
      sale_date: sale_date || new Date().toISOString().split('T')[0]
    };
    
    const newSale = await airtableHelpers.create(TABLES.SALES, salesData);
    
    // Get stock for reduction
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    
    // Aggregate quantities by product name
    const productTotals = {};
    
    // Create sale items and calculate totals
    const saleItems = [];
    for (const item of items) {
      if (!item.quantity || !item.unit_price || !item.product_name) continue;
      
      // Create sale item
      const saleItem = await airtableHelpers.create(TABLES.SALE_ITEMS, {
        sale_id: [newSale.id],
        product_name: item.product_name,
        quantity_sold: Number(item.quantity),
        unit_price: Number(item.unit_price)
      });
      saleItems.push(saleItem);
      
      // Aggregate quantities for same product
      const productKey = item.product_name.toLowerCase().trim();
      productTotals[productKey] = (productTotals[productKey] || 0) + Number(item.quantity);
    }
    
    console.log('Product totals for stock reduction:', productTotals);
    
    // Reduce stock once per product with total quantity
    for (const [productKey, totalQuantity] of Object.entries(productTotals)) {
      const stockItem = allStock.find(s => {
        const matchesBranch = s.branch_id && s.branch_id.includes(branchId);
        const matchesProduct = s.product_name && s.product_name.toLowerCase().trim() === productKey;
        return matchesBranch && matchesProduct;
      });
      
      if (stockItem) {
        console.log(`Reducing stock for ${productKey}: ${stockItem.quantity_available} - ${totalQuantity} = ${stockItem.quantity_available - totalQuantity}`);
        await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
          quantity_available: Math.max(0, stockItem.quantity_available - totalQuantity)
        });
      } else {
        console.log(`No stock found for product: ${productKey}`);
      }
    }
    
    res.status(201).json({ 
      success: true,
      sale: newSale, 
      items: saleItems,
      message: 'Sale created successfully'
    });
  } catch (error) {
    console.error('Sale error:', error.message);
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
      total_quantity: saleItems.reduce((sum, item) => sum + (item.quantity_sold || 0), 0),
      total_value: saleItems.reduce((sum, item) => sum + ((item.quantity_sold || 0) * (item.unit_price || 0)), 0)
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
      quantity_sold: parseInt(quantity),
      unit_price: parseFloat(unit_price)
    };
    
    const newSaleItem = await airtableHelpers.create(TABLES.SALE_ITEMS, saleItemData);
    
    // Update sale total
    const sale = await airtableHelpers.findById(TABLES.SALES, sale_id);
    if (sale) {
      const itemTotal = parseInt(quantity) * parseFloat(unit_price);
      const newTotal = (sale.total_amount || 0) + itemTotal;
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
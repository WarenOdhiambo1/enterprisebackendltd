const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');

// CSRF protection disabled for form submissions
const csrfProtection = (req, res, next) => {
  next();
};

const router = express.Router();

// Get sales for a branch
router.get('/branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { startDate, endDate, page = 1, limit = 50 } = req.query;

    // Get all sales and filter by branch
    const allSales = await airtableHelpers.find(TABLES.SALES);
    let sales = allSales.filter(sale => 
      sale.branch_id && sale.branch_id.includes(branchId)
    );
    
    // Filter by date range if provided
    if (startDate && endDate) {
      sales = sales.filter(sale => {
        if (!sale.sale_date) return false;
        const saleDate = new Date(sale.sale_date);
        return saleDate >= new Date(startDate) && saleDate <= new Date(endDate);
      });
    }

    // Get sale items for each sale
    const salesWithItems = await Promise.all(
      sales.map(async (sale) => {
        const items = await airtableHelpers.find(
          TABLES.SALE_ITEMS,
          `{sale_id} = "${sale.id}"`
        );
        return { ...sale, items };
      })
    );

    res.json(salesWithItems);
  } catch (error) {
    console.error('Get sales error:', error);
    res.status(500).json({ message: 'Failed to fetch sales' });
  }
});

// Create new sale
router.post('/branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { items, payment_method } = req.body;

    console.log('Creating sale for branch:', branchId);
    console.log('Items:', items);
    console.log('Payment method:', payment_method);

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Sale items are required' });
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => {
      return sum + (item.quantity * item.unit_price);
    }, 0);

    console.log('Total amount:', totalAmount);

    // Create sale record
    const saleData = {
      total_amount: totalAmount,
      payment_method: payment_method || 'cash',
      sale_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      recorded_by: [req.user.id]
    };
    
    // Add branch_id - use first available branch if 'default'
    if (branchId && branchId !== 'default') {
      saleData.branch_id = [branchId];
    } else {
      // Get first available branch for 'default'
      const allBranches = await airtableHelpers.find(TABLES.BRANCHES);
      if (allBranches.length > 0) {
        saleData.branch_id = [allBranches[0].id];
      }
    }
    
    // Add customer name if provided
    if (req.body.customer_name) {
      saleData.customer_name = req.body.customer_name;
    }

    console.log('Creating sale with data:', saleData);
    const sale = await airtableHelpers.create(TABLES.SALES, saleData);
    console.log('Sale created:', sale.id);
    
    // Create sale items
    const saleItems = [];
    for (const item of items) {
      const saleItemData = {
        sale_id: [sale.id],
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.quantity * item.unit_price
      };
      
      const saleItem = await airtableHelpers.create(TABLES.SALE_ITEMS, saleItemData);
      saleItems.push(saleItem);
    }

    // Get all stock for updates
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    
    // Update stock quantities and create movement records
    for (const item of items) {
      // Create stock movement record for each item sold
      const movementData = {
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: parseInt(item.quantity),
        movement_type: 'sale',
        reason: 'Product sold',
        sale_id: [sale.id],
        created_by: [req.user.id],
        created_at: new Date().toISOString(),
        status: 'completed'
      };
      
      if (branchId && branchId !== 'default') {
        movementData.from_branch_id = [branchId];
      }
      
      await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, movementData);
      
      // Update stock quantity - find by product_id
      let stockItems;
      if (branchId && branchId !== 'default') {
        stockItems = allStock.filter(s => 
          s.branch_id && s.branch_id.includes(branchId) && 
          s.product_id === item.product_id
        );
      } else {
        // For default branch, find any stock with matching product_id
        stockItems = allStock.filter(s => s.product_id === item.product_id);
      }
      
      if (stockItems.length > 0) {
        const stockItem = stockItems[0];
        const newQuantity = Math.max(0, stockItem.quantity_available - item.quantity);
        console.log('Updating stock from', stockItem.quantity_available, 'to', newQuantity);
        
        await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
          quantity_available: newQuantity,
          last_updated: new Date().toISOString()
        });
      }
    }

    res.status(201).json({
      sale: { ...sale, items: saleItems },
      message: 'Sale recorded successfully'
    });

  } catch (error) {
    console.error('Create sale error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Failed to record sale', error: error.message });
  }
});

// Get daily sales summary
router.get('/summary/daily/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { date } = req.query;
    
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    // Get all sales and filter by branch and date
    const allSales = await airtableHelpers.find(TABLES.SALES);
    const sales = allSales.filter(sale => 
      sale.branch_id && sale.branch_id.includes(branchId) &&
      sale.sale_date && sale.sale_date.startsWith(targetDate)
    );

    const summary = {
      date: targetDate,
      totalSales: sales.length,
      totalAmount: sales.reduce((sum, sale) => sum + sale.total_amount, 0),
      paymentMethods: {
        cash: sales.filter(s => s.payment_method === 'cash').length,
        card: sales.filter(s => s.payment_method === 'card').length,
        credit: sales.filter(s => s.payment_method === 'credit').length
      }
    };

    res.json(summary);
  } catch (error) {
    console.error('Get daily summary error:', error);
    res.status(500).json({ message: 'Failed to fetch daily summary' });
  }
});

// Record expense
router.post('/expenses/branch/:branchId', authenticateToken, auditLog('RECORD_EXPENSE'), async (req, res) => {
  try {
    const { branchId } = req.params;
    const {
      expense_date,
      category,
      amount,
      description,
      vehicle_plate_number
    } = req.body;

    if (!expense_date || !category || !amount) {
      return res.status(400).json({ 
        message: 'Expense date, category, and amount are required' 
      });
    }

    let vehicle_id = null;

    // If category is vehicle-related, find vehicle by plate number
    if (category === 'vehicle_related' && vehicle_plate_number) {
      const vehicles = await airtableHelpers.find(
        TABLES.VEHICLES,
        `{plate_number} = "${vehicle_plate_number}"`
      );

      if (vehicles.length === 0) {
        return res.status(400).json({ 
          message: 'Vehicle not found with the provided plate number' 
        });
      }

      vehicle_id = vehicles[0].id;
    }

    // Create expense record with proper Airtable structure
    const expenseData = {
      expense_date: expense_date,
      category: category,
      amount: parseFloat(amount),
      recorded_by: [req.user.id],
      created_at: new Date().toISOString()
    };
    
    // Only add branch_id if it's not 'default'
    if (branchId && branchId !== 'default') {
      expenseData.branch_id = [branchId];
    }
    
    if (description) expenseData.description = description;
    if (vehicle_id) expenseData.vehicle_id = [vehicle_id];
    
    const expense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);

    // If vehicle-related, auto-create maintenance record
    if (vehicle_id) {
      await airtableHelpers.create(TABLES.VEHICLE_MAINTENANCE, {
        vehicle_id: [vehicle_id],
        maintenance_date: expense_date,
        maintenance_type: 'expense',
        cost: parseFloat(amount),
        description: description || 'Expense recorded from sales',
        recorded_by: [req.user.id],
        expense_id: [expense.id]
      });
    }

    res.status(201).json(expense);
  } catch (error) {
    console.error('Record expense error:', error);
    res.status(500).json({ message: 'Failed to record expense' });
  }
});

// Get expenses for a branch
router.get('/expenses/branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { startDate, endDate, category } = req.query;

    let filterFormula = `{branch_id} = "${branchId}"`;
    
    if (startDate && endDate) {
      filterFormula += ` AND IS_AFTER({expense_date}, "${startDate}") AND IS_BEFORE({expense_date}, "${endDate}")`;
    }

    if (category) {
      filterFormula += ` AND {category} = "${category}"`;
    }

    const expenses = await airtableHelpers.find(TABLES.EXPENSES, filterFormula);

    // Get vehicle details for vehicle-related expenses
    const expensesWithDetails = await Promise.all(
      expenses.map(async (expense) => {
        if (expense.vehicle_id) {
          const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, expense.vehicle_id);
          expense.vehicle = vehicle ? {
            plate_number: vehicle.plate_number,
            vehicle_type: vehicle.vehicle_type
          } : null;
        }
        return expense;
      })
    );

    res.json(expensesWithDetails);
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch expenses' });
  }
});

// Get received funds tracking
router.get('/funds/branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { date } = req.query;
    
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    // Get all sales and filter by branch and date
    const allSales = await airtableHelpers.find(TABLES.SALES);
    const sales = allSales.filter(sale => 
      sale.branch_id && sale.branch_id.includes(branchId) &&
      sale.sale_date && sale.sale_date.startsWith(targetDate)
    );

    const totalSalesAmount = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
    const cashSales = sales.filter(s => s.payment_method === 'cash')
                          .reduce((sum, sale) => sum + sale.total_amount, 0);
    const creditSales = sales.filter(s => s.payment_method === 'credit')
                             .reduce((sum, sale) => sum + sale.total_amount, 0);

    const fundsTracking = {
      date: targetDate,
      totalSalesAmount,
      receivedFunds: cashSales, // Assuming cash sales are received immediately
      outstandingBalance: creditSales,
      salesBreakdown: {
        cash: cashSales,
        card: sales.filter(s => s.payment_method === 'card')
                   .reduce((sum, sale) => sum + sale.total_amount, 0),
        credit: creditSales
      }
    };

    res.json(fundsTracking);
  } catch (error) {
    console.error('Get funds tracking error:', error);
    res.status(500).json({ message: 'Failed to fetch funds tracking' });
  }
});

// Update sale (limited fields)
router.put('/:saleId', auditLog('UPDATE_SALE'), async (req, res) => {
  try {
    const { saleId } = req.params;
    const { payment_method, customer_name } = req.body;

    const sale = await airtableHelpers.findById(TABLES.SALES, saleId);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    // Check branch access
    if (!['boss', 'manager'].includes(req.user.role) && 
        req.user.branchId !== sale.branch_id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = {};
    if (payment_method) updateData.payment_method = payment_method;
    if (customer_name !== undefined) updateData.customer_name = customer_name;

    const updatedSale = await airtableHelpers.update(TABLES.SALES, saleId, updateData);

    res.json(updatedSale);
  } catch (error) {
    console.error('Update sale error:', error);
    res.status(500).json({ message: 'Failed to update sale' });
  }
});

module.exports = router;
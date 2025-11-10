const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');



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

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Sale items are required' });
    }

    const totalAmount = items.reduce((sum, item) => {
      return sum + (Number(item.quantity) * Number(item.unit_price));
    }, 0);

    const saleData = {
      total_amount: totalAmount,
      payment_method: payment_method || 'cash',
      sale_date: req.body.sale_date || new Date().toISOString().split('T')[0]
    };
    
    if (branchId && branchId !== 'default') {
      saleData.branch_id = [branchId];
    } else {
      // Get first available branch for 'default'
      const allBranches = await airtableHelpers.find(TABLES.BRANCHES);
      if (allBranches.length > 0) {
        saleData.branch_id = [allBranches[0].id];
      }
    }

    const sale = await airtableHelpers.create(TABLES.SALES, saleData);
    
    const saleItems = [];
    for (const item of items) {
      const saleItem = await airtableHelpers.create(TABLES.SALE_ITEMS, {
        sale_id: [sale.id],
        product_name: item.product_name,
        quantity_sold: Number(item.quantity),
        unit_price: Number(item.unit_price),
        subtotal: Number(item.quantity) * Number(item.unit_price)
      });
      saleItems.push(saleItem);
    }

    // Get all stock for updates
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    
    // Update stock quantities and create movement records
    for (const item of items) {
        // Create stock movement record for each item sold
      if (branchId && branchId !== 'default') {
        const stockItem = allStock.find(s => 
          s.branch_id && s.branch_id.includes(branchId) && 
          s.product_name === item.product_name
        );
        
        if (stockItem) {
          await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
            product_name: item.product_name,
            quantity: Number(item.quantity),
            movement_type: 'sale',
            movement_date: new Date().toISOString().split('T')[0],
            reference_id: sale.id
          });
        }
      }
      
      if (branchId && branchId !== 'default') {
        const stockItems = allStock.filter(s => 
          s.branch_id && s.branch_id.includes(branchId) && 
          s.product_name === item.product_name
        );
        
        if (stockItems.length > 0) {
          const stockItem = stockItems[0];
          const newQuantity = Math.max(0, stockItem.quantity_available - Number(item.quantity));
          
          await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
            quantity_available: newQuantity
          });
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Sale recorded successfully',
      sale: { ...sale, items: saleItems }
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

    console.log('Recording expense:', { branchId, expense_date, category, amount, description, vehicle_plate_number });

    // Validation
    if (!expense_date || !category || !amount) {
      return res.status(400).json({ 
        message: 'Expense date, category, and amount are required' 
      });
    }

    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ 
        message: 'Amount must be greater than 0' 
      });
    }

    // Get branches to validate branchId
    const allBranches = await airtableHelpers.find(TABLES.BRANCHES);
    console.log('Available branches:', allBranches.map(b => ({ id: b.id, name: b.branch_name })));
    
    let targetBranchId = null;
    
    if (branchId && branchId !== 'default') {
      const branch = allBranches.find(b => b.id === branchId);
      if (!branch) {
        return res.status(400).json({ 
          message: 'Invalid branch ID provided' 
        });
      }
      targetBranchId = branchId;
    } else {
      // Use first available branch for 'default'
      if (allBranches.length > 0) {
        targetBranchId = allBranches[0].id;
      } else {
        return res.status(400).json({ 
          message: 'No branches available to record expense' 
        });
      }
    }

    let vehicle_id = null;

    // Find vehicle by plate number if provided
    if (vehicle_plate_number && vehicle_plate_number.trim()) {
      try {
        const allVehicles = await airtableHelpers.find(TABLES.VEHICLES);
        const vehicle = allVehicles.find(v => v.plate_number === vehicle_plate_number.trim());
        
        if (vehicle) {
          vehicle_id = vehicle.id;
          console.log(`Found vehicle: ${vehicle_id} for plate ${vehicle_plate_number}`);
        } else {
          console.log(`Vehicle with plate ${vehicle_plate_number} not found`);
        }
      } catch (vehicleError) {
        console.log('Error finding vehicle:', vehicleError.message);
      }
    }

    // Create expense record with proper Airtable structure
    const expenseData = {
      expense_date: expense_date,
      category: category,
      amount: parseFloat(amount),
      branch_id: [targetBranchId],
      created_by: [req.user.id],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Add optional fields
    if (description && description.trim()) {
      expenseData.description = description.trim();
    }
    
    // Handle vehicle linking
    if (vehicle_plate_number && vehicle_plate_number.trim()) {
      expenseData.vehicle_plate_number = vehicle_plate_number.trim();
    }
    
    if (vehicle_id) {
      expenseData.vehicle_id = [vehicle_id];
    }
    
    console.log('Creating expense with data:', expenseData);
    const expense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);
    console.log('Expense created successfully:', expense.id);

    // If vehicle-related and vehicle found, auto-create maintenance record
    if (vehicle_id && (category === 'vehicle_related' || category === 'maintenance' || category === 'fuel')) {
      try {
        await airtableHelpers.create(TABLES.VEHICLE_MAINTENANCE, {
          vehicle_id: [vehicle_id],
          maintenance_date: expense_date,
          maintenance_type: category === 'fuel' ? 'fuel' : 'maintenance',
          cost: parseFloat(amount),
          description: description || `${category} expense recorded`,
          recorded_by: [req.user.id]
        });
        console.log('Vehicle maintenance record created');
      } catch (maintenanceError) {
        console.log('Failed to create maintenance record, but expense was recorded:', maintenanceError.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Expense recorded successfully',
      expense: expense
    });
  } catch (error) {
    console.error('Record expense error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Failed to record expense',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get expenses for a branch
router.get('/expenses/branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    const { startDate, endDate, category } = req.query;

    // Get all expenses and filter manually for better compatibility
    const allExpenses = await airtableHelpers.find(TABLES.EXPENSES);
    
    let expenses = allExpenses.filter(expense => 
      expense.branch_id && expense.branch_id.includes(branchId)
    );
    
    // Filter by date range if provided
    if (startDate && endDate) {
      expenses = expenses.filter(expense => {
        if (!expense.expense_date) return false;
        const expenseDate = new Date(expense.expense_date);
        return expenseDate >= new Date(startDate) && expenseDate <= new Date(endDate);
      });
    }

    // Filter by category if provided
    if (category) {
      expenses = expenses.filter(expense => expense.category === category);
    }

    // Get vehicle details for expenses with vehicle links
    const expensesWithDetails = await Promise.all(
      expenses.map(async (expense) => {
        if (expense.vehicle_id && Array.isArray(expense.vehicle_id) && expense.vehicle_id.length > 0) {
          try {
            const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, expense.vehicle_id[0]);
            expense.vehicle = vehicle ? {
              plate_number: vehicle.plate_number,
              vehicle_type: vehicle.vehicle_type
            } : null;
          } catch (vehicleError) {
            console.log('Error fetching vehicle details:', vehicleError.message);
            expense.vehicle = null;
          }
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
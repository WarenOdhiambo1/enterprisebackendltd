const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// Simple audit log middleware for backward compatibility
const auditLog = (action) => (req, res, next) => {
  // Simple logging - can be enhanced later
  console.log(`Audit: ${action} by user ${req.user?.id} at ${new Date().toISOString()}`);
  next();
};

const router = express.Router();

// Legacy Dashboard endpoints for backward compatibility
router.get('/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
    const expenses = await airtableHelpers.find(TABLES.EXPENSES);

    let filteredExpenses = expenses;
    if (startDate && endDate) {
      filteredExpenses = expenses.filter(exp => {
        const expDate = new Date(exp.expense_date);
        return expDate >= new Date(startDate) && expDate <= new Date(endDate);
      });
    }
    if (branchId) {
      filteredExpenses = filteredExpenses.filter(exp => 
        exp.branch_id && exp.branch_id.includes(branchId)
      );
    }

    const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0);
    const categoryBreakdown = filteredExpenses.reduce((acc, exp) => {
      const category = exp.category || 'other';
      acc[category] = (acc[category] || 0) + (parseFloat(exp.amount) || 0);
      return acc;
    }, {});

    res.json({
      totalExpenses,
      expenseCount: filteredExpenses.length,
      categoryBreakdown,
      recentExpenses: filteredExpenses.slice(-5)
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard summary' });
  }
});

router.get('/dashboard/trends', authenticateToken, async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const expenses = await airtableHelpers.find(TABLES.EXPENSES);
    
    const monthlyData = {};
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    expenses.forEach(exp => {
      if (exp.expense_date) {
        const expDate = new Date(exp.expense_date);
        if (expDate >= startDate) {
          const monthKey = expDate.toISOString().substring(0, 7);
          monthlyData[monthKey] = (monthlyData[monthKey] || 0) + (parseFloat(exp.amount) || 0);
        }
      }
    });

    res.json(Object.entries(monthlyData).map(([month, amount]) => ({ month, amount })));
  } catch (error) {
    console.error('Trends error:', error);
    res.status(500).json({ message: 'Failed to fetch trends' });
  }
});

// Helper function to populate expense with related data
const populateExpense = async (expense) => {
  const populated = { ...expense };
  
  // Populate branch data
  if (expense.branch_id && expense.branch_id[0]) {
    try {
      const branch = await airtableHelpers.findById(TABLES.BRANCHES, expense.branch_id[0]);
      populated.branch = {
        id: branch.id,
        name: branch.branch_name,
        location_address: branch.location_address
      };
    } catch (error) {
      populated.branch = null;
    }
  }
  
  // Populate vehicle data
  if (expense.vehicle_id && expense.vehicle_id[0]) {
    try {
      const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, expense.vehicle_id[0]);
      populated.vehicle = {
        id: vehicle.id,
        plate_number: vehicle.plate_number,
        vehicle_type: vehicle.vehicle_type
      };
    } catch (error) {
      populated.vehicle = null;
    }
  }
  
  // Populate recorded_by data
  if (expense.recorded_by && expense.recorded_by[0]) {
    try {
      const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, expense.recorded_by[0]);
      populated.recorded_by = {
        id: employee.id,
        full_name: employee.full_name,
        role: employee.role
      };
    } catch (error) {
      populated.recorded_by = null;
    }
  }
  
  // Remove array fields
  delete populated.branch_id;
  delete populated.vehicle_id;
  
  return populated;
};

// 1. Get All Expenses
router.get('/', async (req, res) => {
  try {
    const { 
      branch_id, 
      category, 
      date_from, 
      date_to, 
      vehicle_id,
      recorded_by, 
      limit = 20, 
      offset = 0,
      sort_by = 'expense_date',
      sort_order = 'desc'
    } = req.query;
    
    let expenses = await airtableHelpers.find(TABLES.EXPENSES);
    
    // Apply filters
    if (branch_id) {
      expenses = expenses.filter(expense => 
        expense.branch_id && expense.branch_id.includes(branch_id)
      );
    }
    
    if (category) {
      expenses = expenses.filter(expense => expense.category === category);
    }
    
    if (date_from) {
      expenses = expenses.filter(expense => 
        expense.expense_date >= date_from
      );
    }
    
    if (date_to) {
      expenses = expenses.filter(expense => 
        expense.expense_date <= date_to
      );
    }
    
    if (vehicle_id) {
      expenses = expenses.filter(expense => 
        expense.vehicle_id && expense.vehicle_id.includes(vehicle_id)
      );
    }
    
    if (recorded_by) {
      expenses = expenses.filter(expense => 
        expense.recorded_by && expense.recorded_by.includes(recorded_by)
      );
    }
    
    // Sort expenses
    expenses.sort((a, b) => {
      const aVal = a[sort_by];
      const bVal = b[sort_by];
      if (sort_order === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    // Pagination
    const total = expenses.length;
    const paginatedExpenses = expenses.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    // Populate related data
    const populatedExpenses = await Promise.all(
      paginatedExpenses.map(expense => populateExpense(expense))
    );
    
    res.json({
      success: true,
      data: populatedExpenses,
      pagination: {
        total,
        page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        per_page: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ 
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch expenses'
      }
    });
  }
});

// 2. Get Single Expense
router.get('/:expense_date', async (req, res) => {
  try {
    const { expense_date } = req.params;
    
    const expenses = await airtableHelpers.find(TABLES.EXPENSES, `{expense_date} = "${expense_date}"`);
    
    if (expenses.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Expense not found'
        }
      });
    }
    
    const expense = expenses[0];
    const populatedExpense = await populateExpense(expense);
    
    // Get related vehicle maintenance if category is maintenance
    if (expense.category === 'maintenance' && expense.vehicle_id) {
      try {
        const maintenance = await airtableHelpers.find(
          TABLES.VEHICLE_MAINTENANCE,
          `{vehicle_id} = "${expense.vehicle_id[0]}"`
        );
        populatedExpense.vehicle_maintenance = maintenance.map(m => ({
          id: m.id,
          maintenance_type: m.maintenance_type,
          cost: m.cost
        }));
      } catch (error) {
        populatedExpense.vehicle_maintenance = [];
      }
    }
    
    res.json({
      success: true,
      data: populatedExpense
    });
  } catch (error) {
    console.error('Get expense error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch expense'
      }
    });
  }
});

// 3. Get Expenses by Branch
router.get('/branches/:branch_id/expenses', async (req, res) => {
  try {
    const { branch_id } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    const expenses = await airtableHelpers.find(
      TABLES.EXPENSES,
      `FIND("${branch_id}", ARRAYJOIN({branch_id}))`
    );
    
    const total = expenses.length;
    const paginatedExpenses = expenses.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    const populatedExpenses = await Promise.all(
      paginatedExpenses.map(expense => populateExpense(expense))
    );
    
    res.json({
      success: true,
      data: populatedExpenses,
      pagination: {
        total,
        page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        per_page: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get branch expenses error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch branch expenses'
      }
    });
  }
});

// 4. Get Expenses by Vehicle
router.get('/vehicles/:vehicle_id/expenses', async (req, res) => {
  try {
    const { vehicle_id } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    const expenses = await airtableHelpers.find(
      TABLES.EXPENSES,
      `FIND("${vehicle_id}", ARRAYJOIN({vehicle_id}))`
    );
    
    const total = expenses.length;
    const paginatedExpenses = expenses.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    const populatedExpenses = await Promise.all(
      paginatedExpenses.map(expense => populateExpense(expense))
    );
    
    res.json({
      success: true,
      data: populatedExpenses,
      pagination: {
        total,
        page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        per_page: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vehicle expenses error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message: 'Failed to fetch vehicle expenses'
      }
    });
  }
});

// 5. Get Expense Analytics
router.get('/analytics', async (req, res) => {
  try {
    const { group_by = 'category', date_range, metric = 'sum' } = req.query;
    
    let expenses = await airtableHelpers.find(TABLES.EXPENSES);
    
    // Apply date range filter
    if (date_range) {
      const [start_date, end_date] = date_range.split(',');
      expenses = expenses.filter(expense => 
        expense.expense_date >= start_date && expense.expense_date <= end_date
      );
    }
    
    // Group and calculate metrics
    const analytics = {};
    
    for (const expense of expenses) {
      let groupKey;
      
      switch (group_by) {
        case 'branch':
          groupKey = expense.branch_id ? expense.branch_id[0] : 'unknown';
          break;
        case 'category':
          groupKey = expense.category || 'unknown';
          break;
        case 'vehicle':
          groupKey = expense.vehicle_id ? expense.vehicle_id[0] : 'no_vehicle';
          break;
        case 'month':
          groupKey = expense.expense_date ? expense.expense_date.substring(0, 7) : 'unknown';
          break;
        default:
          groupKey = 'all';
      }
      
      if (!analytics[groupKey]) {
        analytics[groupKey] = {
          count: 0,
          sum: 0,
          expenses: []
        };
      }
      
      analytics[groupKey].count++;
      analytics[groupKey].sum += parseFloat(expense.amount) || 0;
      analytics[groupKey].expenses.push(expense);
    }
    
    // Calculate final metrics
    const result = {};
    for (const [key, data] of Object.entries(analytics)) {
      switch (metric) {
        case 'sum':
          result[key] = data.sum;
          break;
        case 'avg':
          result[key] = data.count > 0 ? data.sum / data.count : 0;
          break;
        case 'count':
          result[key] = data.count;
          break;
        default:
          result[key] = {
            sum: data.sum,
            avg: data.count > 0 ? data.sum / data.count : 0,
            count: data.count
          };
      }
    }
    
    res.json({
      success: true,
      data: result,
      group_by,
      metric,
      total_expenses: expenses.length,
      total_amount: expenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0)
    });
  } catch (error) {
    console.error('Get expense analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to generate expense analytics'
      }
    });
  }
});



// 1. Create New Expense
router.post('/', async (req, res) => {
  try {
    const {
      expense_date,
      branch_id,
      category,
      amount,
      description,
      vehicle_id,
      recorded_by
    } = req.body;
    
    const expenseData = {
      expense_date: expense_date || new Date().toISOString().split('T')[0],
      category: category || 'other',
      amount: parseFloat(amount) || 0,
      description: description || '',
      created_at: new Date().toISOString()
    };
    
    // Add optional fields only if they exist
    if (branch_id) {
      expenseData.branch_id = Array.isArray(branch_id) ? branch_id : [branch_id];
    }
    if (vehicle_id) {
      expenseData.vehicle_id = Array.isArray(vehicle_id) ? vehicle_id : [vehicle_id];
    }
    if (recorded_by) {
      expenseData.recorded_by = Array.isArray(recorded_by) ? recorded_by : [recorded_by];
    }
    
    const newExpense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);
    
    res.status(201).json(newExpense);
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ message: 'Failed to create expense', error: error.message });
  }
});

// Legacy direct expenses endpoints for backward compatibility
router.get('/direct', authenticateToken, async (req, res) => {
  try {
    const { category, branchId, startDate, endDate, page = 1, limit = 50 } = req.query;
    let expenses = await airtableHelpers.find(TABLES.EXPENSES);
    
    if (category) expenses = expenses.filter(exp => exp.category === category);
    if (branchId) expenses = expenses.filter(exp => exp.branch_id && exp.branch_id.includes(branchId));
    if (startDate && endDate) {
      expenses = expenses.filter(exp => {
        const expDate = new Date(exp.expense_date);
        return expDate >= new Date(startDate) && expDate <= new Date(endDate);
      });
    }
    
    const startIndex = (page - 1) * limit;
    const paginatedExpenses = expenses.slice(startIndex, startIndex + parseInt(limit));
    
    res.json({
      expenses: paginatedExpenses,
      total: expenses.length,
      page: parseInt(page),
      totalPages: Math.ceil(expenses.length / limit)
    });
  } catch (error) {
    console.error('Get direct expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch expenses' });
  }
});

router.post('/direct', authenticateToken, auditLog('CREATE_EXPENSE'), async (req, res) => {
  try {
    const { branch_id, category, amount, description, expense_date, receipt_number, supplier_name, vehicle_id } = req.body;

    if (!branch_id || !category || !amount) {
      return res.status(400).json({ message: 'Branch ID, category, and amount are required' });
    }

    const expenseData = {
      branch_id: Array.isArray(branch_id) ? branch_id : [branch_id],
      category,
      amount: parseFloat(amount),
      description: description || '',
      expense_date: expense_date || new Date().toISOString().split('T')[0],
      recorded_by: [req.user?.id || 'system'],
      created_at: new Date().toISOString()
    };

    if (receipt_number) expenseData.receipt_number = receipt_number;
    if (supplier_name) expenseData.supplier_name = supplier_name;
    if (vehicle_id && category === 'vehicle_related') expenseData.vehicle_id = [vehicle_id];

    const newExpense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);
    res.status(201).json(newExpense);
  } catch (error) {
    console.error('Add expense error:', error);
    res.status(500).json({ message: 'Failed to add expense', error: error.message });
  }
});

router.put('/direct/:expenseId', authenticateToken, auditLog('UPDATE_EXPENSE'), async (req, res) => {
  try {
    const { expenseId } = req.params;
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString(),
      updated_by: [req.user?.id || 'system']
    };

    const updatedExpense = await airtableHelpers.update(TABLES.EXPENSES, expenseId, updateData);
    res.json(updatedExpense);
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ message: 'Failed to update expense' });
  }
});

router.delete('/direct/:expenseId', authenticateToken, auditLog('DELETE_EXPENSE'), async (req, res) => {
  try {
    const { expenseId } = req.params;
    await airtableHelpers.delete(TABLES.EXPENSES, expenseId);
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: 'Failed to delete expense' });
  }
});

// Update expense
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    const updatedExpense = await airtableHelpers.update(TABLES.EXPENSES, id, updateData);
    res.json(updatedExpense);
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ message: 'Failed to update expense' });
  }
});

// Delete expense
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.EXPENSES, id);
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: 'Failed to delete expense' });
  }
});

// 2. Bulk Create Expenses
router.post('/bulk', async (req, res) => {
  try {
    const { expenses } = req.body;
    
    if (!Array.isArray(expenses) || expenses.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Expenses array is required'
        }
      });
    }
    
    const results = [];
    const errors = [];
    
    for (let i = 0; i < expenses.length; i++) {
      const expense = expenses[i];
      
      try {
        // Validate required fields
        if (!expense.expense_date || !expense.branch_id || !expense.category || !expense.amount) {
          errors.push({
            index: i,
            message: 'Missing required fields'
          });
          continue;
        }
        
        const expenseData = {
          expense_date: expense.expense_date,
          branch_id: [expense.branch_id],
          category: expense.category,
          amount: parseFloat(expense.amount),
          description: expense.description || '',
          recorded_by: [expense.recorded_by],
          created_at: new Date().toISOString()
        };
        
        if (expense.vehicle_id) {
          expenseData.vehicle_id = [expense.vehicle_id];
        }
        
        const newExpense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);
        const populatedExpense = await populateExpense(newExpense);
        results.push(populatedExpense);
      } catch (error) {
        errors.push({
          index: i,
          message: error.message
        });
      }
    }
    
    res.status(201).json({
      success: true,
      message: `Created ${results.length} expenses`,
      data: {
        created: results,
        errors: errors
      }
    });
  } catch (error) {
    console.error('Bulk create expenses error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BULK_CREATE_ERROR',
        message: 'Failed to create expenses'
      }
    });
  }
});

module.exports = router;
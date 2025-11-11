const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all expenses with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { branchId, startDate, endDate, category, vehicleId } = req.query;
    
    let filterFormula = '';
    const filters = [];
    
    if (branchId) {
      filters.push(`FIND('${branchId}', ARRAYJOIN({branch_id}))`);
    }
    
    if (startDate && endDate) {
      filters.push(`AND(IS_AFTER({expense_date}, '${startDate}'), IS_BEFORE({expense_date}, '${endDate}'))`);
    }
    
    if (category) {
      filters.push(`{category} = '${category}'`);
    }
    
    if (vehicleId) {
      filters.push(`FIND('${vehicleId}', ARRAYJOIN({vehicle_id}))`);
    }
    
    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }
    
    const expenses = await airtableHelpers.find(TABLES.EXPENSES, filterFormula, [
      { field: 'expense_date', direction: 'desc' }
    ]);
    
    // Enrich with related data
    const enrichedExpenses = await Promise.all(expenses.map(async (expense) => {
      let branchName = 'Unknown Branch';
      let vehiclePlate = null;
      let createdByName = 'System';
      
      // Get branch name
      if (expense.branch_id && expense.branch_id.length > 0) {
        try {
          const branch = await airtableHelpers.findById(TABLES.BRANCHES, expense.branch_id[0]);
          branchName = branch.branch_name;
        } catch (err) {
          console.log('Branch not found:', expense.branch_id[0]);
        }
      }
      
      // Get vehicle plate
      if (expense.vehicle_id && expense.vehicle_id.length > 0) {
        try {
          const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, expense.vehicle_id[0]);
          vehiclePlate = vehicle.plate_number;
        } catch (err) {
          console.log('Vehicle not found:', expense.vehicle_id[0]);
        }
      }
      
      // Get creator name
      if (expense.created_by && expense.created_by.length > 0) {
        try {
          const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, expense.created_by[0]);
          createdByName = employee.full_name;
        } catch (err) {
          console.log('Employee not found:', expense.created_by[0]);
        }
      }
      
      return {
        ...expense,
        branch_name: branchName,
        vehicle_plate_number: vehiclePlate,
        created_by_name: createdByName
      };
    }));
    
    res.json(enrichedExpenses);
  } catch (error) {
    console.error('Get expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch expenses' });
  }
});

// Create new expense
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      expense_date,
      category,
      amount,
      description,
      branch_id,
      vehicle_id,
      vehicle_plate_number,
      receipt_number,
      supplier_name
    } = req.body;
    
    // Validation
    if (!expense_date || !category || !amount || !description) {
      return res.status(400).json({ 
        message: 'Expense date, category, amount, and description are required' 
      });
    }
    
    if (parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }
    
    const expenseData = {
      expense_date,
      category,
      amount: parseFloat(amount),
      description: description.trim(),
      created_at: new Date().toISOString(),
      created_by: [req.user.id]
    };
    
    // Add optional fields with proper relationship handling
    if (branch_id) {
      try {
        const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
        if (branch) expenseData.branch_id = [branch_id];
      } catch (err) {
        console.log('Branch not found:', branch_id);
      }
    }
    if (vehicle_id) {
      try {
        const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, vehicle_id);
        if (vehicle) {
          expenseData.vehicle_id = [vehicle_id];
          expenseData.vehicle_plate_number = vehicle.plate_number;
        }
      } catch (err) {
        console.log('Vehicle not found:', vehicle_id);
      }
    } else if (vehicle_plate_number) {
      expenseData.vehicle_plate_number = vehicle_plate_number;
    }
    if (receipt_number) expenseData.receipt_number = receipt_number;
    if (supplier_name) expenseData.supplier_name = supplier_name;
    
    const expense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);
    
    res.status(201).json({
      id: expense.id,
      ...expense.fields,
      message: 'Expense created successfully'
    });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ message: 'Failed to create expense' });
  }
});

// Update expense
router.put('/:expenseId', authenticateToken, async (req, res) => {
  try {
    const { expenseId } = req.params;
    const {
      expense_date,
      category,
      amount,
      description,
      branch_id,
      vehicle_id,
      vehicle_plate_number,
      receipt_number,
      supplier_name
    } = req.body;
    
    const updateData = {};
    
    if (expense_date) updateData.expense_date = expense_date;
    if (category) updateData.category = category;
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (description) updateData.description = description.trim();
    if (branch_id) {
      try {
        const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
        if (branch) updateData.branch_id = [branch_id];
      } catch (err) {
        console.log('Branch not found:', branch_id);
      }
    }
    if (vehicle_id) {
      try {
        const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, vehicle_id);
        if (vehicle) {
          updateData.vehicle_id = [vehicle_id];
          updateData.vehicle_plate_number = vehicle.plate_number;
        }
      } catch (err) {
        console.log('Vehicle not found:', vehicle_id);
      }
    }
    if (vehicle_plate_number !== undefined) updateData.vehicle_plate_number = vehicle_plate_number;
    if (receipt_number !== undefined) updateData.receipt_number = receipt_number;
    if (supplier_name !== undefined) updateData.supplier_name = supplier_name;
    
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = [req.user.id];
    
    const expense = await airtableHelpers.update(TABLES.EXPENSES, expenseId, updateData);
    
    res.json({
      id: expense.id,
      ...expense.fields,
      message: 'Expense updated successfully'
    });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ message: 'Failed to update expense' });
  }
});

// Delete expense
router.delete('/:expenseId', authenticateToken, authorizeRoles(['admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { expenseId } = req.params;
    
    await airtableHelpers.delete(TABLES.EXPENSES, expenseId);
    
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: 'Failed to delete expense' });
  }
});

// Get expense categories
router.get('/categories', (req, res) => {
  const categories = [
    { value: 'fuel', label: 'Fuel & Transportation', icon: '⛽' },
    { value: 'office_supplies', label: 'Office Supplies', icon: '📝' },
    { value: 'utilities', label: 'Utilities (Phone, Internet)', icon: '💡' },
    { value: 'maintenance', label: 'Equipment Maintenance', icon: '🔧' },
    { value: 'marketing', label: 'Marketing & Advertising', icon: '📢' },
    { value: 'meals', label: 'Business Meals', icon: '🍽️' },
    { value: 'travel', label: 'Travel Expenses', icon: '✈️' },
    { value: 'rent', label: 'Rent & Facilities', icon: '🏢' },
    { value: 'insurance', label: 'Insurance', icon: '🛡️' },
    { value: 'professional_services', label: 'Professional Services', icon: '👔' },
    { value: 'other', label: 'Other Business Expenses', icon: '📋' }
  ];
  
  res.json(categories);
});

// Get expense summary by category
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { branchId, startDate, endDate } = req.query;
    
    let filterFormula = '';
    const filters = [];
    
    if (branchId) {
      filters.push(`FIND('${branchId}', ARRAYJOIN({branch_id}))`);
    }
    
    if (startDate && endDate) {
      filters.push(`AND(IS_AFTER({expense_date}, '${startDate}'), IS_BEFORE({expense_date}, '${endDate}'))`);
    }
    
    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }
    
    const expenses = await airtableHelpers.find(TABLES.EXPENSES, filterFormula);
    
    // Group by category
    const summary = expenses.reduce((acc, expense) => {
      const category = expense.category || 'other';
      const amount = parseFloat(expense.amount) || 0;
      
      if (!acc[category]) {
        acc[category] = {
          category,
          total_amount: 0,
          count: 0,
          expenses: []
        };
      }
      
      acc[category].total_amount += amount;
      acc[category].count += 1;
      acc[category].expenses.push({
        id: expense.id,
        expense_date: expense.expense_date,
        amount: expense.amount,
        description: expense.description
      });
      
      return acc;
    }, {});
    
    const totalAmount = Object.values(summary).reduce((sum, cat) => sum + cat.total_amount, 0);
    
    res.json({
      summary: Object.values(summary),
      total_amount: totalAmount,
      total_expenses: expenses.length,
      period: { startDate, endDate }
    });
  } catch (error) {
    console.error('Get expense summary error:', error);
    res.status(500).json({ message: 'Failed to get expense summary' });
  }
});

module.exports = router;
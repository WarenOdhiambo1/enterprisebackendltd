const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, auditLog } = require('../middleware/auth');

const router = express.Router();

// Dashboard endpoints
router.get('/dashboard/summary', async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
    const [expenses, bills, payments] = await Promise.all([
      airtableHelpers.find(TABLES.EXPENSES),
      airtableHelpers.find(TABLES.BILLS),
      airtableHelpers.find(TABLES.PAYMENTS_MADE)
    ]);

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
    const totalBills = bills.reduce((sum, bill) => sum + (parseFloat(bill.total_amount) || 0), 0);
    const totalPayments = payments.reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
    const outstandingBills = bills.filter(bill => bill.payment_status !== 'paid');

    const categoryBreakdown = filteredExpenses.reduce((acc, exp) => {
      const category = exp.category || 'other';
      acc[category] = (acc[category] || 0) + (parseFloat(exp.amount) || 0);
      return acc;
    }, {});

    res.json({
      totalExpenses,
      totalBills,
      totalPayments,
      outstandingAmount: totalBills - totalPayments,
      expenseCount: filteredExpenses.length,
      billCount: bills.length,
      outstandingBillCount: outstandingBills.length,
      categoryBreakdown,
      recentExpenses: filteredExpenses.slice(-5)
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard summary' });
  }
});

router.get('/dashboard/trends', async (req, res) => {
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

// Direct expenses
router.get('/direct', async (req, res) => {
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

router.get('/', async (req, res) => {
  try {
    const allExpenses = await airtableHelpers.find(TABLES.EXPENSES);
    res.json(allExpenses);
  } catch (error) {
    console.error('Get all expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch expenses' });
  }
});

router.post('/direct', auditLog('CREATE_EXPENSE'), async (req, res) => {
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
      recorded_by: [req.user.id]
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

router.post('/', async (req, res) => {
  try {
    const { branch_id, category, amount, description, expense_date, receipt_number, supplier_name } = req.body;

    if (!branch_id || !category || !amount) {
      return res.status(400).json({ message: 'Branch ID, category, and amount are required' });
    }

    const expenseData = {
      branch_id: Array.isArray(branch_id) ? branch_id : [branch_id],
      category,
      amount: parseFloat(amount),
      description: description || '',
      expense_date: expense_date || new Date().toISOString().split('T')[0]
    };

    // Add optional fields if provided
    if (receipt_number) expenseData.receipt_number = receipt_number;
    if (supplier_name) expenseData.supplier_name = supplier_name;

    const newExpense = await airtableHelpers.create(TABLES.EXPENSES, expenseData);
    res.status(201).json(newExpense);
  } catch (error) {
    console.error('Add expense error:', error);
    res.status(500).json({ message: 'Failed to add expense', error: error.message });
  }
});

router.put('/direct/:expenseId', auditLog('UPDATE_EXPENSE'), async (req, res) => {
  try {
    const { expenseId } = req.params;
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };

    const updatedExpense = await airtableHelpers.update(TABLES.EXPENSES, expenseId, updateData);
    res.json(updatedExpense);
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ message: 'Failed to update expense' });
  }
});

router.put('/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString()
    };

    const updatedExpense = await airtableHelpers.update(TABLES.EXPENSES, expenseId, updateData);
    res.json(updatedExpense);
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ message: 'Failed to update expense' });
  }
});

router.delete('/direct/:expenseId', auditLog('DELETE_EXPENSE'), async (req, res) => {
  try {
    const { expenseId } = req.params;
    await airtableHelpers.delete(TABLES.EXPENSES, expenseId);
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: 'Failed to delete expense' });
  }
});

router.delete('/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;
    await airtableHelpers.delete(TABLES.EXPENSES, expenseId);
    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ message: 'Failed to delete expense' });
  }
});

module.exports = router;
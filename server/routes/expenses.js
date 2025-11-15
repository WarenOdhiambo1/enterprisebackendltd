const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const allExpenses = await airtableHelpers.find(TABLES.EXPENSES);
    res.json(allExpenses);
  } catch (error) {
    console.error('Get all expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch expenses' });
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
const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { base: airtableBase, TABLES } = require('../config/airtable');

// Generate sales report
router.get('/sales', authenticateToken, authorizeRoles(['boss', 'manager', 'admin', 'sales']), async (req, res) => {
  try {
    const { branchId, period, startDate, endDate } = req.query;
    
    let dateFilter = '';
    if (period === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      dateFilter = `{sale_date} >= '${weekAgo.toISOString().split('T')[0]}'`;
    } else if (period === 'month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      dateFilter = `{sale_date} >= '${monthAgo.toISOString().split('T')[0]}'`;
    } else if (period === 'year') {
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      dateFilter = `{sale_date} >= '${yearAgo.toISOString().split('T')[0]}'`;
    } else if (startDate && endDate) {
      dateFilter = `AND({sale_date} >= '${startDate}', {sale_date} <= '${endDate}')`;
    }

    let filter = dateFilter;
    if (branchId && req.user.role !== 'boss') {
      filter = filter ? `AND(${filter}, {branch_id} = '${branchId}')` : `{branch_id} = '${branchId}'`;
    }

    const sales = await airtableBase(TABLES.SALES).select({
      filterByFormula: filter || 'TRUE()'
    }).firstPage();

    const reportData = sales.map(record => ({
      id: record.id,
      date: record.fields.sale_date,
      branch: record.fields.branch_name,
      total: record.fields.total_amount,
      payment_method: record.fields.payment_method
    }));

    const summary = {
      totalSales: reportData.length,
      totalRevenue: reportData.reduce((sum, sale) => sum + (sale.total || 0), 0),
      cashSales: reportData.filter(s => s.payment_method === 'cash').length,
      creditSales: reportData.filter(s => s.payment_method === 'credit').length
    };

    res.json({ sales: reportData, summary });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate sales report', error: error.message });
  }
});

// Generate expense report
router.get('/expenses', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const { branchId, startDate, endDate } = req.query;
    
    let filter = '';
    if (startDate && endDate) {
      filter = `AND({expense_date} >= '${startDate}', {expense_date} <= '${endDate}')`;
    }
    if (branchId && req.user.role !== 'boss') {
      filter = filter ? `AND(${filter}, {branch_id} = '${branchId}')` : `{branch_id} = '${branchId}'`;
    }

    const expenses = await airtableBase(TABLES.EXPENSES).select({
      filterByFormula: filter || 'TRUE()'
    }).firstPage();

    const reportData = expenses.map(record => ({
      id: record.id,
      date: record.fields.expense_date,
      description: record.fields.description,
      amount: record.fields.amount,
      category: record.fields.category,
      branch: record.fields.branch_name
    }));

    const summary = {
      totalExpenses: reportData.length,
      totalAmount: reportData.reduce((sum, exp) => sum + (exp.amount || 0), 0)
    };

    res.json({ expenses: reportData, summary });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate expense report', error: error.message });
  }
});

// Generate payroll report
router.get('/payroll', authenticateToken, authorizeRoles(['boss', 'hr']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let filter = '';
    if (startDate && endDate) {
      filter = `AND({pay_period_start} >= '${startDate}', {pay_period_end} <= '${endDate}')`;
    }

    const payroll = await airtableBase(TABLES.PAYROLL).select({
      filterByFormula: filter || 'TRUE()'
    }).firstPage();

    const reportData = payroll.map(record => ({
      id: record.id,
      employee_name: record.fields.employee_name,
      period_start: record.fields.pay_period_start,
      period_end: record.fields.pay_period_end,
      gross_salary: record.fields.gross_salary,
      deductions: record.fields.deductions,
      net_salary: record.fields.net_salary
    }));

    const summary = {
      totalEmployees: reportData.length,
      totalGross: reportData.reduce((sum, p) => sum + (p.gross_salary || 0), 0),
      totalNet: reportData.reduce((sum, p) => sum + (p.net_salary || 0), 0)
    };

    res.json({ payroll: reportData, summary });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate payroll report', error: error.message });
  }
});

module.exports = router;
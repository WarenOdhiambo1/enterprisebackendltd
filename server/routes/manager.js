const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get manager dashboard data
router.get('/dashboard/:branchId', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const { branchId } = req.params;
    console.log('Manager dashboard request for branchId:', branchId);

    // Get branch info
    const branch = await airtableHelpers.findById(TABLES.BRANCHES, branchId);
    console.log('Branch found:', branch?.branch_name);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    // Get all employees and filter by branch
    const allEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employees = allEmployees.filter(emp => 
      emp.branch_id && emp.branch_id.includes(branchId)
    );
    console.log('Employees found:', employees.length);

    // Get all stock and filter by branch
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const stock = allStock.filter(item => 
      item.branch_id && item.branch_id.includes(branchId)
    );
    console.log('Stock items found:', stock.length, 'for branch:', branchId);

    // Get all sales and filter by branch
    const allSales = await airtableHelpers.find(TABLES.SALES);
    const branchSales = allSales.filter(sale => 
      sale.branch_id && sale.branch_id.includes(branchId)
    );
    
    // Filter for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sales = branchSales.filter(sale => {
      if (!sale.sale_date) return false;
      const saleDate = new Date(sale.sale_date);
      return saleDate >= thirtyDaysAgo;
    });

    // Get today's sales
    const today = new Date().toISOString().split('T')[0];
    const todaySales = branchSales.filter(sale => 
      sale.sale_date && sale.sale_date.startsWith(today)
    );

    // Calculate metrics
    const totalRevenue = sales.reduce((sum, sale) => sum + (sale.total_amount || 0), 0);
    const todayRevenue = todaySales.reduce((sum, sale) => sum + (sale.total_amount || 0), 0);
    const lowStockItems = stock.filter(item => 
      item.quantity_available <= (item.reorder_level || 0)
    );

    // Generate weekly sales data for chart
    const weeklyData = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const daySales = sales.filter(sale => 
        sale.sale_date && sale.sale_date.startsWith(dateStr)
      );
      
      weeklyData.push({
        name: date.toLocaleDateString('en-US', { weekday: 'short' }),
        sales: daySales.reduce((sum, sale) => sum + (sale.total_amount || 0), 0),
        target: 50000 // Default target
      });
    }

    console.log('Final response data:', {
      branchName: branch.branch_name,
      employeesCount: employees.length,
      stockCount: stock.length,
      lowStockCount: lowStockItems.length
    });

    res.json({
      branch,
      summary: {
        totalEmployees: employees.length,
        totalStock: stock.length,
        lowStockAlerts: lowStockItems.length,
        todayRevenue,
        totalRevenue,
        todaySalesCount: todaySales.length
      },
      employees,
      stock,
      sales: sales.slice(-10).reverse(),
      lowStockItems,
      weeklyData
    });
  } catch (error) {
    console.error('Manager dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;
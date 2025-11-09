const express = require('express');
const { TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Test route without auth
router.get('/test', async (req, res) => {
  res.json({ message: 'Manager routes working', timestamp: new Date().toISOString() });
});

// Get manager dashboard data with direct Airtable calls
router.get('/dashboard/:branchId', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const { branchId } = req.params;
    console.log('Manager dashboard request for branchId:', branchId);
    console.log('User from token:', req.user);

    // Direct Airtable connection
    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

    // Get branch info
    let branch;
    try {
      const branchRecord = await base('Branches').find(branchId);
      branch = {
        id: branchRecord.id,
        ...branchRecord.fields
      };
      console.log('Branch found:', branch.branch_name);
    } catch (branchError) {
      console.error('Branch not found:', branchError.message);
      return res.status(404).json({ message: 'Branch not found' });
    }

    // Get all employees
    const employeeRecords = await base('Employees').select().all();
    const allEmployees = employeeRecords.map(record => ({
      id: record.id,
      ...record.fields
    }));
    
    // Filter employees by branch
    const employees = allEmployees.filter(emp => 
      emp.branch_id && emp.branch_id.includes(branchId)
    );
    console.log('Employees found:', employees.length);

    // Get all stock
    const stockRecords = await base('Stock').select().all();
    const allStock = stockRecords.map(record => ({
      id: record.id,
      ...record.fields
    }));
    
    // Filter stock by branch
    const stock = allStock.filter(item => 
      item.branch_id && item.branch_id.includes(branchId)
    );
    console.log('Stock items found:', stock.length, 'for branch:', branchId);

    // Get all sales
    const salesRecords = await base('Sales').select().all();
    const allSales = salesRecords.map(record => ({
      id: record.id,
      ...record.fields
    }));
    
    // Filter sales by branch
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
    res.status(500).json({ 
      message: 'Failed to fetch dashboard data', 
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;
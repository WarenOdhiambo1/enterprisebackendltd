const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');

const router = express.Router();

// Get dashboard overview
router.get('/dashboard', async (req, res) => {
  try {
    // Get all branches
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    
    // Get total sales across all branches
    const allSales = await airtableHelpers.find(TABLES.SALES);
    const totalSales = allSales.reduce((sum, sale) => sum + sale.total_amount, 0);
    
    // Get total expenses across all branches
    const allExpenses = await airtableHelpers.find(TABLES.EXPENSES);
    const totalExpenses = allExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    
    // Get stock levels across branches
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const lowStockItems = allStock.filter(item => 
      item.quantity_available <= item.reorder_level
    );
    
    // Get recent orders
    const recentOrders = await airtableHelpers.find(TABLES.ORDERS);
    const pendingOrders = recentOrders.filter(order => 
      ['ordered', 'partially_paid'].includes(order.status)
    );
    
    // Get vehicle fleet summary
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    const activeVehicles = vehicles.filter(v => v.status === 'active');
    
    // Calculate today's sales
    const today = new Date().toISOString().split('T')[0];
    const todaySales = allSales.filter(sale => 
      sale.sale_date && sale.sale_date.startsWith(today)
    );
    const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total_amount, 0);

    const dashboard = {
      summary: {
        totalBranches: branches.length,
        totalSales: totalSales,
        totalExpenses: totalExpenses,
        netProfit: totalSales - totalExpenses,
        todayRevenue: todayRevenue,
        todaySalesCount: todaySales.length
      },
      alerts: {
        lowStockItems: lowStockItems.length,
        pendingOrders: pendingOrders.length,
        maintenanceVehicles: vehicles.filter(v => v.status === 'maintenance').length
      },
      fleet: {
        totalVehicles: vehicles.length,
        activeVehicles: activeVehicles.length,
        maintenanceVehicles: vehicles.filter(v => v.status === 'maintenance').length
      },
      recentActivity: {
        recentSales: allSales.slice(-10).reverse(),
        recentOrders: recentOrders.slice(-5).reverse(),
        lowStockAlerts: lowStockItems.slice(0, 10)
      }
    };

    res.json(dashboard);
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data' });
  }
});

// Get branch-specific expenses
router.get('/expenses/branch/:branchId', async (req, res) => {
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

    // Get branch details
    const branch = await airtableHelpers.findById(TABLES.BRANCHES, branchId);

    // Calculate summary
    const summary = {
      branchName: branch?.branch_name,
      totalExpenses: expenses.reduce((sum, exp) => sum + exp.amount, 0),
      expenseCount: expenses.length,
      categoryBreakdown: {}
    };

    // Group by category
    expenses.forEach(expense => {
      if (!summary.categoryBreakdown[expense.category]) {
        summary.categoryBreakdown[expense.category] = 0;
      }
      summary.categoryBreakdown[expense.category] += expense.amount;
    });

    res.json({
      summary,
      expenses
    });
  } catch (error) {
    console.error('Get branch expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch branch expenses' });
  }
});

// Get ROT (Return on Turnover) analysis
router.get('/rot-analysis', async (req, res) => {
  try {
    const { period = 'monthly', startDate, endDate } = req.query;

    // Get all sales items
    const salesItems = await airtableHelpers.find(TABLES.SALE_ITEMS);
    
    // Get all order items to get purchase prices
    const orderItems = await airtableHelpers.find(TABLES.ORDER_ITEMS);

    // Calculate ROT for each product
    const productROT = {};

    salesItems.forEach(saleItem => {
      const productId = saleItem.product_id;
      
      if (!productROT[productId]) {
        productROT[productId] = {
          product_name: saleItem.product_name,
          total_quantity_sold: 0,
          total_revenue: 0,
          total_cost: 0,
          gross_profit: 0,
          rot_percentage: 0
        };
      }

      // Find purchase price from order items
      const orderItem = orderItems.find(oi => 
        oi.product_name === saleItem.product_name
      );
      const purchasePrice = orderItem?.purchase_price_per_unit || 0;

      productROT[productId].total_quantity_sold += saleItem.quantity_sold;
      productROT[productId].total_revenue += saleItem.subtotal;
      productROT[productId].total_cost += (saleItem.quantity_sold * purchasePrice);
    });

    // Calculate ROT percentages
    Object.keys(productROT).forEach(productId => {
      const product = productROT[productId];
      product.gross_profit = product.total_revenue - product.total_cost;
      
      if (product.total_cost > 0) {
        product.rot_percentage = (product.gross_profit / product.total_cost) * 100;
      }
    });

    // Sort by ROT percentage
    const sortedProducts = Object.values(productROT)
      .sort((a, b) => b.rot_percentage - a.rot_percentage);

    // Get branch-wise ROT
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    const branchROT = await Promise.all(
      branches.map(async (branch) => {
        const branchSales = await airtableHelpers.find(
          TABLES.SALES,
          `{branch_id} = "${branch.id}"`
        );
        
        const branchRevenue = branchSales.reduce((sum, sale) => sum + sale.total_amount, 0);
        
        // Get branch expenses
        const branchExpenses = await airtableHelpers.find(
          TABLES.EXPENSES,
          `{branch_id} = "${branch.id}"`
        );
        
        const branchCosts = branchExpenses.reduce((sum, exp) => sum + exp.amount, 0);
        
        return {
          branch_id: branch.id,
          branch_name: branch.branch_name,
          revenue: branchRevenue,
          costs: branchCosts,
          profit: branchRevenue - branchCosts,
          rot_percentage: branchCosts > 0 ? ((branchRevenue - branchCosts) / branchCosts) * 100 : 0
        };
      })
    );

    res.json({
      productROT: sortedProducts,
      branchROT: branchROT.sort((a, b) => b.rot_percentage - a.rot_percentage),
      summary: {
        totalProducts: sortedProducts.length,
        averageROT: sortedProducts.reduce((sum, p) => sum + p.rot_percentage, 0) / sortedProducts.length,
        bestPerforming: sortedProducts[0],
        worstPerforming: sortedProducts[sortedProducts.length - 1]
      }
    });
  } catch (error) {
    console.error('Get ROT analysis error:', error);
    res.status(500).json({ message: 'Failed to fetch ROT analysis' });
  }
});

// Get comprehensive reports
router.get('/reports', async (req, res) => {
  try {
    const { type, startDate, endDate, branchId } = req.query;

    let reportData = {};

    switch (type) {
      case 'sales':
        let salesFilter = '';
        if (branchId) salesFilter += `{branch_id} = "${branchId}"`;
        if (startDate && endDate) {
          const dateFilter = `IS_AFTER({sale_date}, "${startDate}") AND IS_BEFORE({sale_date}, "${endDate}")`;
          salesFilter = salesFilter ? `AND(${salesFilter}, ${dateFilter})` : dateFilter;
        }

        const sales = await airtableHelpers.find(TABLES.SALES, salesFilter);
        reportData = {
          totalSales: sales.length,
          totalRevenue: sales.reduce((sum, sale) => sum + sale.total_amount, 0),
          averageSale: sales.length > 0 ? sales.reduce((sum, sale) => sum + sale.total_amount, 0) / sales.length : 0,
          paymentMethods: {
            cash: sales.filter(s => s.payment_method === 'cash').length,
            card: sales.filter(s => s.payment_method === 'card').length,
            credit: sales.filter(s => s.payment_method === 'credit').length
          },
          sales: sales
        };
        break;

      case 'inventory':
        let stockFilter = '';
        if (branchId) stockFilter = `{branch_id} = "${branchId}"`;

        const stock = await airtableHelpers.find(TABLES.STOCK, stockFilter);
        reportData = {
          totalProducts: stock.length,
          totalValue: stock.reduce((sum, item) => sum + (item.quantity_available * item.unit_price), 0),
          lowStockItems: stock.filter(item => item.quantity_available <= item.reorder_level),
          outOfStockItems: stock.filter(item => item.quantity_available === 0),
          stock: stock
        };
        break;

      case 'financial':
        let expenseFilter = '';
        if (branchId) expenseFilter += `{branch_id} = "${branchId}"`;
        if (startDate && endDate) {
          const dateFilter = `IS_AFTER({expense_date}, "${startDate}") AND IS_BEFORE({expense_date}, "${endDate}")`;
          expenseFilter = expenseFilter ? `AND(${expenseFilter}, ${dateFilter})` : dateFilter;
        }

        const expenses = await airtableHelpers.find(TABLES.EXPENSES, expenseFilter);
        
        let salesFilterFinancial = '';
        if (branchId) salesFilterFinancial += `{branch_id} = "${branchId}"`;
        if (startDate && endDate) {
          const dateFilter = `IS_AFTER({sale_date}, "${startDate}") AND IS_BEFORE({sale_date}, "${endDate}")`;
          salesFilterFinancial = salesFilterFinancial ? `AND(${salesFilterFinancial}, ${dateFilter})` : dateFilter;
        }

        const salesFinancial = await airtableHelpers.find(TABLES.SALES, salesFilterFinancial);
        
        const totalRevenue = salesFinancial.reduce((sum, sale) => sum + sale.total_amount, 0);
        const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);

        reportData = {
          totalRevenue,
          totalExpenses,
          netProfit: totalRevenue - totalExpenses,
          profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0,
          expensesByCategory: expenses.reduce((acc, exp) => {
            acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
            return acc;
          }, {}),
          expenses,
          sales: salesFinancial
        };
        break;

      default:
        return res.status(400).json({ message: 'Invalid report type' });
    }

    res.json(reportData);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ message: 'Failed to generate report' });
  }
});

// Export report (placeholder - would generate PDF/Excel)
router.get('/reports/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'pdf', ...queryParams } = req.query;

    // This would integrate with PDF/Excel generation libraries
    // For now, return the data that would be exported
    const reportData = await router.get('/reports', { query: { type, ...queryParams } });

    res.json({
      message: `${type} report exported as ${format}`,
      exportUrl: `/exports/${type}_${Date.now()}.${format}`,
      data: reportData
    });
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ message: 'Failed to export report' });
  }
});

module.exports = router;
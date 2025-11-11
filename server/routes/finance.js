const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get comprehensive financial data for profit/loss analysis
router.get('/analytics', authenticateToken, authorizeRoles(['admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { branchId, startDate, endDate } = req.query;
    
    // Date range setup
    const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];
    
    // Build filter for branch-specific data
    let branchFilter = '';
    if (branchId) {
      branchFilter = `FIND('${branchId}', ARRAYJOIN({branch_id}))`;
    }
    
    // Get all financial data
    const [sales, expenses, orders, payroll, stockMovements, saleItems] = await Promise.all([
      // Sales data
      airtableHelpers.find(TABLES.SALES, 
        branchFilter ? `AND(${branchFilter}, IS_AFTER({sale_date}, '${start}'), IS_BEFORE({sale_date}, '${end}'))` 
        : `AND(IS_AFTER({sale_date}, '${start}'), IS_BEFORE({sale_date}, '${end}'))`
      ),
      // Expenses data
      airtableHelpers.find(TABLES.EXPENSES,
        branchFilter ? `AND(${branchFilter}, IS_AFTER({expense_date}, '${start}'), IS_BEFORE({expense_date}, '${end}'))` 
        : `AND(IS_AFTER({expense_date}, '${start}'), IS_BEFORE({expense_date}, '${end}'))`
      ),
      // Purchase orders (cost of goods)
      airtableHelpers.find(TABLES.ORDERS,
        `AND(IS_AFTER({order_date}, '${start}'), IS_BEFORE({order_date}, '${end}'))`
      ),
      // Payroll expenses
      airtableHelpers.find(TABLES.PAYROLL,
        `AND(IS_AFTER({period_start}, '${start}'), IS_BEFORE({period_end}, '${end}'))`
      ),
      // Stock movements for COGS calculation
      airtableHelpers.find(TABLES.STOCK_MOVEMENTS).catch(() => []),
      // Sale items for detailed analysis
      airtableHelpers.find(TABLES.SALE_ITEMS).catch(() => [])
    ]);

    // Calculate revenue
    const totalRevenue = sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0);
    
    // Calculate cost of goods sold (from orders and stock movements)
    const totalCOGS = orders.reduce((sum, order) => sum + (parseFloat(order.total_amount) || 0), 0);
    
    // Calculate operating expenses
    const operatingExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
    
    // Calculate payroll expenses
    const payrollExpenses = payroll.reduce((sum, pay) => sum + (parseFloat(pay.net_salary) || 0), 0);
    
    // Calculate gross profit
    const grossProfit = totalRevenue - totalCOGS;
    
    // Calculate net profit
    const netProfit = grossProfit - operatingExpenses - payrollExpenses;
    
    // Calculate profit margin
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    
    // Branch-wise breakdown if no specific branch requested
    let branchBreakdown = [];
    if (!branchId) {
      const branches = await airtableHelpers.find(TABLES.BRANCHES);
      branchBreakdown = await Promise.all(branches.map(async (branch) => {
        const branchSales = sales.filter(s => s.branch_id && s.branch_id.includes(branch.id));
        const branchExpenses = expenses.filter(e => e.branch_id && e.branch_id.includes(branch.id));
        const branchRevenue = branchSales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0);
        const branchCosts = branchExpenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
        
        return {
          branch_id: branch.id,
          branch_name: branch.branch_name,
          revenue: branchRevenue,
          expenses: branchCosts,
          profit: branchRevenue - branchCosts,
          profit_margin: branchRevenue > 0 ? ((branchRevenue - branchCosts) / branchRevenue) * 100 : 0
        };
      }));
    }
    
    // Product profitability analysis
    const productAnalysis = {};
    saleItems.forEach(item => {
      const productId = item.product_id;
      if (!productAnalysis[productId]) {
        productAnalysis[productId] = {
          product_name: item.product_name,
          total_quantity_sold: 0,
          total_revenue: 0,
          average_selling_price: 0
        };
      }
      productAnalysis[productId].total_quantity_sold += parseFloat(item.quantity_sold) || 0;
      productAnalysis[productId].total_revenue += parseFloat(item.subtotal) || 0;
    });
    
    // Calculate average selling prices
    Object.keys(productAnalysis).forEach(productId => {
      const product = productAnalysis[productId];
      product.average_selling_price = product.total_quantity_sold > 0 
        ? product.total_revenue / product.total_quantity_sold 
        : 0;
    });
    
    res.json({
      period: { start, end },
      branch_id: branchId || 'all',
      summary: {
        total_revenue: totalRevenue,
        cost_of_goods_sold: totalCOGS,
        gross_profit: grossProfit,
        operating_expenses: operatingExpenses,
        payroll_expenses: payrollExpenses,
        net_profit: netProfit,
        profit_margin: profitMargin
      },
      breakdown: {
        sales_count: sales.length,
        expense_count: expenses.length,
        order_count: orders.length,
        payroll_count: payroll.length
      },
      branch_analysis: branchBreakdown,
      product_analysis: Object.values(productAnalysis).slice(0, 10), // Top 10 products
      trends: {
        daily_revenue: calculateDailyTrends(sales, start, end),
        expense_categories: calculateExpenseCategories(expenses)
      }
    });
    
  } catch (error) {
    console.error('Financial analytics error:', error);
    res.status(500).json({ message: 'Failed to generate financial analytics' });
  }
});

// Get product cost analysis with purchase prices
router.get('/product-costs', authenticateToken, authorizeRoles(['admin', 'boss', 'manager']), async (req, res) => {
  try {
    const [stock, orderItems, saleItems] = await Promise.all([
      airtableHelpers.find(TABLES.STOCK),
      airtableHelpers.find(TABLES.ORDER_ITEMS).catch(() => []),
      airtableHelpers.find(TABLES.SALE_ITEMS).catch(() => [])
    ]);
    
    const productCosts = {};
    
    // Calculate average purchase price from order items
    orderItems.forEach(item => {
      const productName = item.product_name;
      if (!productCosts[productName]) {
        productCosts[productName] = {
          product_name: productName,
          purchase_prices: [],
          selling_prices: [],
          current_stock_price: 0,
          average_purchase_price: 0,
          average_selling_price: 0,
          profit_per_unit: 0,
          profit_margin: 0
        };
      }
      if (item.unit_price) {
        productCosts[productName].purchase_prices.push(parseFloat(item.unit_price));
      }
    });
    
    // Add selling prices from sale items
    saleItems.forEach(item => {
      const productName = item.product_name;
      if (productCosts[productName] && item.unit_price) {
        productCosts[productName].selling_prices.push(parseFloat(item.unit_price));
      }
    });
    
    // Add current stock prices
    stock.forEach(item => {
      const productName = item.product_name;
      if (productCosts[productName]) {
        productCosts[productName].current_stock_price = parseFloat(item.unit_price) || 0;
      } else if (item.unit_price) {
        productCosts[productName] = {
          product_name: productName,
          purchase_prices: [],
          selling_prices: [parseFloat(item.unit_price)],
          current_stock_price: parseFloat(item.unit_price),
          average_purchase_price: 0,
          average_selling_price: parseFloat(item.unit_price),
          profit_per_unit: 0,
          profit_margin: 0
        };
      }
    });
    
    // Calculate averages and profit margins
    Object.keys(productCosts).forEach(productName => {
      const product = productCosts[productName];
      
      // Average purchase price
      if (product.purchase_prices.length > 0) {
        product.average_purchase_price = product.purchase_prices.reduce((a, b) => a + b, 0) / product.purchase_prices.length;
      }
      
      // Average selling price
      if (product.selling_prices.length > 0) {
        product.average_selling_price = product.selling_prices.reduce((a, b) => a + b, 0) / product.selling_prices.length;
      }
      
      // Profit calculations
      if (product.average_purchase_price > 0 && product.average_selling_price > 0) {
        product.profit_per_unit = product.average_selling_price - product.average_purchase_price;
        product.profit_margin = (product.profit_per_unit / product.average_selling_price) * 100;
      }
      
      // Clean up arrays for response
      delete product.purchase_prices;
      delete product.selling_prices;
    });
    
    res.json({
      products: Object.values(productCosts),
      summary: {
        total_products: Object.keys(productCosts).length,
        profitable_products: Object.values(productCosts).filter(p => p.profit_per_unit > 0).length,
        average_profit_margin: Object.values(productCosts).reduce((sum, p) => sum + p.profit_margin, 0) / Object.keys(productCosts).length
      }
    });
    
  } catch (error) {
    console.error('Product costs error:', error);
    res.status(500).json({ message: 'Failed to get product cost analysis' });
  }
});

// Helper functions
function calculateDailyTrends(sales, startDate, endDate) {
  const trends = {};
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Initialize all dates with 0
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    trends[dateStr] = 0;
  }
  
  // Add actual sales data
  sales.forEach(sale => {
    const saleDate = sale.sale_date ? sale.sale_date.split('T')[0] : null;
    if (saleDate && trends.hasOwnProperty(saleDate)) {
      trends[saleDate] += parseFloat(sale.total_amount) || 0;
    }
  });
  
  return Object.entries(trends).map(([date, amount]) => ({ date, amount }));
}

function calculateExpenseCategories(expenses) {
  const categories = {};
  expenses.forEach(expense => {
    const category = expense.category || 'other';
    if (!categories[category]) {
      categories[category] = { category, total: 0, count: 0 };
    }
    categories[category].total += parseFloat(expense.amount) || 0;
    categories[category].count += 1;
  });
  return Object.values(categories);
}

module.exports = router;
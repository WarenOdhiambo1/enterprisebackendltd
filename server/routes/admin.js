const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all products
router.get('/products', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const products = await airtableHelpers.find(TABLES.STOCK);
    
    // Group by product name to get unique products
    const uniqueProducts = {};
    products.forEach(item => {
      if (!uniqueProducts[item.product_name]) {
        uniqueProducts[item.product_name] = {
          product_name: item.product_name,
          unit_price: item.unit_price,
          reorder_level: item.reorder_level,
          total_quantity: 0,
          branches: []
        };
      }
      uniqueProducts[item.product_name].total_quantity += item.quantity_available || 0;
      uniqueProducts[item.product_name].branches.push({
        branch_id: item.branch_id,
        quantity: item.quantity_available
      });
    });

    res.json(Object.values(uniqueProducts));
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// Create new product (add to specific branch or all branches)
router.post('/products', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const { product_name, unit_price, reorder_level, branch_id, quantity_available } = req.body;

    if (!product_name || !unit_price) {
      return res.status(400).json({ message: 'Product name and unit price are required' });
    }

    let branches;
    if (branch_id) {
      // Create for specific branch
      const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
      if (!branch) {
        return res.status(404).json({ message: 'Branch not found' });
      }
      branches = [branch];
    } else {
      // Create for all branches
      branches = await airtableHelpers.find(TABLES.BRANCHES);
    }
    
    // Create stock entries
    const stockEntries = await Promise.all(
      branches.map(branch => 
        airtableHelpers.create(TABLES.STOCK, {
          product_id: `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          product_name,
          unit_price: parseFloat(unit_price),
          quantity_available: parseInt(quantity_available) || 0,
          reorder_level: parseInt(reorder_level) || 10,
          branch_id: [branch.id],
          last_updated: new Date().toISOString()
        })
      )
    );

    res.status(201).json({
      message: 'Product created successfully',
      product_name,
      branches_added: stockEntries.length,
      stock_entries: stockEntries
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ message: 'Failed to create product', error: error.message });
  }
});

// Get system overview
router.get('/overview', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const [branches, employees, stock, sales, orders, vehicles] = await Promise.all([
      airtableHelpers.find(TABLES.BRANCHES),
      airtableHelpers.find(TABLES.EMPLOYEES),
      airtableHelpers.find(TABLES.STOCK),
      airtableHelpers.find(TABLES.SALES),
      airtableHelpers.find(TABLES.ORDERS),
      airtableHelpers.find(TABLES.VEHICLES)
    ]);

    const overview = {
      branches: {
        total: branches.length,
        active: branches.filter(b => b.is_active !== false).length
      },
      employees: {
        total: employees.length,
        active: employees.filter(e => e.is_active).length,
        byRole: employees.reduce((acc, emp) => {
          acc[emp.role] = (acc[emp.role] || 0) + 1;
          return acc;
        }, {})
      },
      inventory: {
        totalProducts: new Set(stock.map(s => s.product_name)).size,
        totalItems: stock.reduce((sum, item) => sum + (item.quantity_available || 0), 0),
        lowStock: stock.filter(item => item.quantity_available <= (item.reorder_level || 0)).length
      },
      sales: {
        total: sales.length,
        totalRevenue: sales.reduce((sum, sale) => sum + (sale.total_amount || 0), 0),
        thisMonth: sales.filter(sale => {
          const saleDate = new Date(sale.sale_date);
          const now = new Date();
          return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
        }).length
      },
      orders: {
        total: orders.length,
        pending: orders.filter(o => ['ordered', 'partially_paid'].includes(o.status)).length,
        completed: orders.filter(o => o.status === 'delivered').length
      },
      fleet: {
        total: vehicles.length,
        active: vehicles.filter(v => v.status === 'active').length,
        maintenance: vehicles.filter(v => v.status === 'maintenance').length
      }
    };

    res.json(overview);
  } catch (error) {
    console.error('Get overview error:', error);
    res.status(500).json({ message: 'Failed to fetch overview' });
  }
});

module.exports = router;
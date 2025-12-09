const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authorizeRoles, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all branches (public for home page)
router.get('/public', async (req, res) => {
  try {
    const Airtable = require('airtable');
    Airtable.configure({
      apiKey: process.env.AIRTABLE_API_KEY,
      requestTimeout: 60000
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const records = await Promise.race([
      base('Branches').select({ maxRecords: 10 }).firstPage(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 50000)
      )
    ]);
    
    const publicBranches = records.map(record => ({
      id: record.id,
      name: record.fields.branch_name || 'Branch',
      address: record.fields.location_address || 'Address not available',
      latitude: record.fields.latitude,
      longitude: record.fields.longitude,
      phone: record.fields.phone,
      email: record.fields.email
    }));

    res.json(publicBranches);
  } catch (error) {
    console.error('Branches error:', error.message);
    res.status(200).json([]);
  }
});

// Get all branches (authenticated)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let branches;

    try {
      // Boss, Manager, and Admin can see all branches
      if (['boss', 'manager', 'admin'].includes(req.user.role)) {
        branches = await airtableHelpers.find(TABLES.BRANCHES);
      } else {
        // Other roles can only see their branch
        const allBranches = await airtableHelpers.find(TABLES.BRANCHES);
        branches = allBranches.filter(branch => branch.id === req.user.branchId);
      }
    } catch (airtableError) {
      console.warn('Airtable connection failed, using mock branches data:', airtableError.message);
      // Mock branches data
      branches = [
        {
          id: 'recBranch1',
          branch_name: 'Main Branch',
          location_address: '123 Main Street, Nairobi, Kenya',
          latitude: -1.2921,
          longitude: 36.8219,
          phone: '+254712345678',
          email: 'main@kabisakabisa.com',
          created_at: '2023-01-01T00:00:00Z'
        },
        {
          id: 'recBranch2',
          branch_name: 'Downtown Branch',
          location_address: '456 Downtown Ave, Nairobi, Kenya',
          latitude: -1.2864,
          longitude: 36.8172,
          phone: '+254712345679',
          email: 'downtown@kabisakabisa.com',
          created_at: '2023-02-01T00:00:00Z'
        }
      ];
    }

    res.json(branches);
  } catch (error) {
    console.error('Get branches error:', error);
    res.status(500).json({ message: 'Failed to fetch branches' });
  }
});

// Get branch by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check access permissions
    if (!['boss', 'manager', 'admin'].includes(req.user.role) && req.user.branchId !== id) {
      return res.status(403).json({ message: 'Access denied to this branch' });
    }

    const branch = await airtableHelpers.findById(TABLES.BRANCHES, id);
    
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    // Get branch manager details
    if (branch.manager_id) {
      const manager = await airtableHelpers.findById(TABLES.EMPLOYEES, branch.manager_id);
      branch.manager = manager ? {
        id: manager.id,
        name: manager.full_name,
        email: manager.email
      } : null;
    }

    res.json(branch);
  } catch (error) {
    console.error('Get branch error:', error);
    res.status(500).json({ message: 'Failed to fetch branch' });
  }
});

// Create new branch (Boss/Admin only)
router.post('/', authenticateToken, authorizeRoles(['boss', 'admin']), async (req, res) => {
  try {
    const {
      branch_name,
      location_address,
      latitude,
      longitude,
      manager_id,
      phone,
      email
    } = req.body;

    // Validate required fields
    if (!branch_name || !location_address) {
      return res.status(400).json({ 
        message: 'Branch name and address are required' 
      });
    }

    // Verify manager exists if provided
    if (manager_id) {
      const manager = await airtableHelpers.findById(TABLES.EMPLOYEES, manager_id);
      if (!manager) {
        return res.status(400).json({ message: 'Manager not found' });
      }
    }

    const newBranch = await airtableHelpers.create(TABLES.BRANCHES, {
      branch_name,
      location_address,
      latitude: parseFloat(latitude) || null,
      longitude: parseFloat(longitude) || null,
      manager_id: manager_id || null,
      phone: phone || null,
      email: email || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    res.status(201).json(newBranch);
  } catch (error) {
    console.error('Create branch error:', error);
    res.status(500).json({ message: 'Failed to create branch' });
  }
});

// Update branch
router.put('/:id', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      branch_name,
      location_address,
      latitude,
      longitude,
      manager_id,
      phone,
      email
    } = req.body;

    // Check if branch exists
    const existingBranch = await airtableHelpers.findById(TABLES.BRANCHES, id);
    if (!existingBranch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    // Managers can only update their own branch
    if (req.user.role === 'manager' && req.user.branchId !== id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify manager exists if provided
    if (manager_id) {
      const manager = await airtableHelpers.findById(TABLES.EMPLOYEES, manager_id);
      if (!manager) {
        return res.status(400).json({ message: 'Manager not found' });
      }
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (branch_name) updateData.branch_name = branch_name;
    if (location_address) updateData.location_address = location_address;
    if (latitude !== undefined) updateData.latitude = parseFloat(latitude) || null;
    if (longitude !== undefined) updateData.longitude = parseFloat(longitude) || null;
    if (manager_id !== undefined) updateData.manager_id = manager_id || null;
    if (phone !== undefined) updateData.phone = phone || null;
    if (email !== undefined) updateData.email = email || null;

    const updatedBranch = await airtableHelpers.update(TABLES.BRANCHES, id, updateData);

    res.json(updatedBranch);
  } catch (error) {
    console.error('Update branch error:', error);
    res.status(500).json({ message: 'Failed to update branch' });
  }
});

// Delete branch (Boss/Admin only)
router.delete('/:id', authenticateToken, authorizeRoles(['boss', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if branch has employees
    const allEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employees = allEmployees.filter(emp => 
      emp.branch_id && emp.branch_id.includes(id)
    );

    if (employees.length > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete branch with active employees',
        employeeCount: employees.length
      });
    }

    // Check if branch has stock
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const stock = allStock.filter(item => 
      item.branch_id && item.branch_id.includes(id)
    );

    if (stock.length > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete branch with existing stock',
        stockItems: stock.length
      });
    }

    await airtableHelpers.delete(TABLES.BRANCHES, id);

    res.json({ message: 'Branch deleted successfully' });
  } catch (error) {
    console.error('Delete branch error:', error);
    res.status(500).json({ message: 'Failed to delete branch' });
  }
});

// Get branch employees
router.get('/:id/employees', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const allEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employees = allEmployees.filter(emp => 
      emp.branch_id && emp.branch_id.includes(id)
    );
    
    res.json(employees);
  } catch (error) {
    console.error('Get branch employees error:', error);
    res.status(500).json({ message: 'Failed to fetch branch employees' });
  }
});

// Get branch stock
router.get('/:id/stock', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const stock = allStock.filter(item => 
      item.branch_id && item.branch_id.includes(id)
    );
    
    res.json(stock);
  } catch (error) {
    console.error('Get branch stock error:', error);
    res.status(500).json({ message: 'Failed to fetch branch stock' });
  }
});

// Get branch sales
router.get('/:id/sales', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    let filterFormula = `FIND("${id}", ARRAYJOIN({branch_id}))`;
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({sale_date}, "${startDate}"), IS_BEFORE({sale_date}, "${endDate}"))`;
      filterFormula = `AND(${filterFormula}, ${dateFilter})`;
    }
    
    const sales = await airtableHelpers.find(TABLES.SALES, filterFormula);
    
    res.json(sales);
  } catch (error) {
    console.error('Get branch sales error:', error);
    res.status(500).json({ message: 'Failed to fetch branch sales' });
  }
});

// Get branch expenses
router.get('/:id/expenses', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    let filterFormula = `FIND("${id}", ARRAYJOIN({branch_id}))`;
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({expense_date}, "${startDate}"), IS_BEFORE({expense_date}, "${endDate}"))`;
      filterFormula = `AND(${filterFormula}, ${dateFilter})`;
    }
    
    const expenses = await airtableHelpers.find(TABLES.EXPENSES, filterFormula);
    
    res.json(expenses);
  } catch (error) {
    console.error('Get branch expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch branch expenses' });
  }
});

// Get branch vehicles
router.get('/:id/vehicles', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const allVehicles = await airtableHelpers.find(TABLES.VEHICLES);
    const vehicles = allVehicles.filter(vehicle => 
      vehicle.branch_id && vehicle.branch_id.includes(id)
    );
    
    res.json(vehicles);
  } catch (error) {
    console.error('Get branch vehicles error:', error);
    res.status(500).json({ message: 'Failed to fetch branch vehicles' });
  }
});

// Get branch analytics
router.get('/:id/analytics', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { period = '30' } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));
    
    const [sales, expenses, employees, stock] = await Promise.all([
      airtableHelpers.find(TABLES.SALES, `FIND("${id}", ARRAYJOIN({branch_id}))`),
      airtableHelpers.find(TABLES.EXPENSES, `FIND("${id}", ARRAYJOIN({branch_id}))`),
      airtableHelpers.find(TABLES.EMPLOYEES).then(emps => emps.filter(e => e.branch_id && e.branch_id.includes(id))),
      airtableHelpers.find(TABLES.STOCK).then(stock => stock.filter(s => s.branch_id && s.branch_id.includes(id)))
    ]);
    
    const totalRevenue = sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0);
    const totalExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
    const stockValue = stock.reduce((sum, item) => sum + ((item.quantity_available || 0) * (item.unit_price || 0)), 0);
    
    const analytics = {
      revenue: {
        total: totalRevenue,
        count: sales.length,
        average: sales.length > 0 ? totalRevenue / sales.length : 0
      },
      expenses: {
        total: totalExpenses,
        count: expenses.length,
        average: expenses.length > 0 ? totalExpenses / expenses.length : 0
      },
      profit: totalRevenue - totalExpenses,
      employees: {
        total: employees.length,
        active: employees.filter(e => e.status === 'active').length
      },
      stock: {
        totalItems: stock.length,
        totalValue: stockValue,
        lowStock: stock.filter(item => item.quantity_available <= (item.reorder_level || 10)).length
      }
    };
    
    res.json(analytics);
  } catch (error) {
    console.error('Get branch analytics error:', error);
    res.status(500).json({ message: 'Failed to fetch branch analytics' });
  }
});

// Transfer stock between branches
router.post('/:id/transfer-stock', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const { id: fromBranchId } = req.params;
    const { toBranchId, items, reason } = req.body;
    
    if (!toBranchId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'To branch ID and items are required' });
    }
    
    const transferId = `TRF_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const movements = [];
    
    for (const item of items) {
      const { productName, quantity, unitCost } = item;
      
      if (!productName || !quantity || quantity <= 0) {
        continue;
      }
      
      const movement = await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
        transfer_id: transferId,
        movement_type: 'transfer_out',
        from_branch_id: [fromBranchId],
        to_branch_id: [toBranchId],
        product_name: productName,
        quantity: parseInt(quantity),
        unit_cost: parseFloat(unitCost) || 0,
        total_cost: parseInt(quantity) * (parseFloat(unitCost) || 0),
        reason: reason || 'Branch stock transfer',
        status: 'pending',
        requested_by: [req.user.id],
        transfer_date: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
      });
      
      movements.push(movement);
    }
    
    res.json({
      success: true,
      message: 'Stock transfer initiated successfully',
      transferId,
      movements: movements.length
    });
  } catch (error) {
    console.error('Transfer stock error:', error);
    res.status(500).json({ message: 'Failed to transfer stock' });
  }
});

module.exports = router;
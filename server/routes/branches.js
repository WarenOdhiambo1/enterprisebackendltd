const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authorizeRoles, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all branches (public for home page)
router.get('/public', async (req, res) => {
  try {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      return res.status(500).json({ message: 'Airtable not configured' });
    }

    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    
    const publicBranches = branches.map(branch => ({
      id: branch.id,
      name: branch.branch_name || 'Branch',
      address: branch.location_address || 'Address not available',
      latitude: branch.latitude,
      longitude: branch.longitude,
      phone: branch.phone,
      email: branch.email
    }));

    res.json(publicBranches);
  } catch (error) {
    console.error('Branches error:', error);
    res.status(500).json({ message: 'Database connection failed', error: error.message });
  }
});

// Get all branches (authenticated)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let branches;

    // Boss, Manager, and Admin can see all branches
    if (['boss', 'manager', 'admin'].includes(req.user.role)) {
      branches = await airtableHelpers.find(TABLES.BRANCHES);
    } else {
      // Other roles can only see their branch
      const allBranches = await airtableHelpers.find(TABLES.BRANCHES);
      branches = allBranches.filter(branch => branch.id === req.user.branchId);
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

module.exports = router;
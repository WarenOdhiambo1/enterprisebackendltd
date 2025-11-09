const express = require('express');
const jwt = require('jsonwebtoken');
const { airtableHelpers, TABLES } = require('../config/airtable');
const router = express.Router();

// Test login endpoint that bypasses password check
router.post('/test-login', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Find user in database
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const user = employees.find(emp => emp.email && emp.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Generate JWT tokens
    const accessToken = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role || 'sales',
        branchId: Array.isArray(user.branch_id) ? user.branch_id[0] : user.branch_id
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );
    
    const userResponse = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role || 'sales',
      branchId: Array.isArray(user.branch_id) ? user.branch_id[0] : user.branch_id
    };
    
    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: userResponse,
      message: 'Test login successful'
    });
    
  } catch (error) {
    console.error('Test login error:', error);
    res.status(500).json({ 
      message: 'Test login failed',
      error: error.message
    });
  }
});

// Get all employees for testing
router.get('/employees', async (req, res) => {
  try {
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    
    const employeeList = employees.map(emp => ({
      id: emp.id,
      email: emp.email,
      full_name: emp.full_name,
      role: emp.role,
      is_active: emp.is_active,
      has_password: !!emp.password_hash,
      branch_id: emp.branch_id
    }));
    
    res.json({
      total: employees.length,
      employees: employeeList
    });
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch employees',
      error: error.message
    });
  }
});

module.exports = router;
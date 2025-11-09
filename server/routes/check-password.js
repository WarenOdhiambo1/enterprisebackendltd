const express = require('express');
const bcrypt = require('bcryptjs');
const { airtableHelpers, TABLES } = require('../config/airtable');
const router = express.Router();

// Check what password works for an employee
router.post('/check-employee', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Find employee
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employee = employees.find(emp => emp.email && emp.email.toLowerCase() === email.toLowerCase());
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Test common passwords
    const testPasswords = [
      'bossPassword123!',
      'boss123',
      'password123',
      'Password123!',
      `${employee.role}Password123!`,
      `${employee.role}123`,
      'admin123',
      'manager123'
    ];
    
    const results = [];
    
    if (employee.password_hash) {
      for (const testPassword of testPasswords) {
        try {
          const isValid = await bcrypt.compare(testPassword, employee.password_hash);
          results.push({
            password: testPassword,
            works: isValid
          });
        } catch (error) {
          results.push({
            password: testPassword,
            works: false,
            error: error.message
          });
        }
      }
    }
    
    res.json({
      status: 'success',
      employee: {
        id: employee.id,
        email: employee.email,
        full_name: employee.full_name,
        role: employee.role,
        is_active: employee.is_active,
        has_password: !!employee.password_hash
      },
      password_tests: results,
      working_password: results.find(r => r.works)?.password || 'None found'
    });
  } catch (error) {
    console.error('Password check error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Set a known password for an employee
router.post('/set-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Find employee
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employee = employees.find(emp => emp.email && emp.email.toLowerCase() === email.toLowerCase());
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Update employee
    await airtableHelpers.update(TABLES.EMPLOYEES, employee.id, {
      password_hash: hashedPassword,
      is_active: true,
      updated_at: new Date().toISOString()
    });
    
    res.json({
      status: 'success',
      message: `Password set for ${email}`,
      password: password,
      employee: {
        id: employee.id,
        email: employee.email,
        full_name: employee.full_name,
        role: employee.role
      }
    });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

module.exports = router;
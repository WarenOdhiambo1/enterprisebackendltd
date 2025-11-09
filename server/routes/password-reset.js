const express = require('express');
const bcrypt = require('bcryptjs');
const { airtableHelpers, TABLES } = require('../config/airtable');
const router = express.Router();

// Reset password for specific employee (admin only)
router.post('/reset-employee-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    if (!email || !newPassword) {
      return res.status(400).json({ message: 'Email and new password are required' });
    }
    
    // Find employee
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employee = employees.find(emp => emp.email && emp.email.toLowerCase() === email.toLowerCase());
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Update employee
    await airtableHelpers.update(TABLES.EMPLOYEES, employee.id, {
      password_hash: hashedPassword,
      is_active: true,
      updated_at: new Date().toISOString()
    });
    
    res.json({
      status: 'success',
      message: `Password reset for ${email}`,
      employee: {
        id: employee.id,
        email: employee.email,
        full_name: employee.full_name,
        role: employee.role
      }
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

module.exports = router;
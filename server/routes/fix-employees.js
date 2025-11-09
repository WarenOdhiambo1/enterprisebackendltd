const express = require('express');
const bcrypt = require('bcryptjs');
const { airtableHelpers, TABLES } = require('../config/airtable');
const router = express.Router();

// Fix employee accounts - activate and set passwords
router.post('/activate-all', async (req, res) => {
  try {
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const updates = [];
    
    for (const employee of employees) {
      if (employee.email && employee.role) {
        const defaultPassword = `${employee.role}Password123!`;
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);
        
        await airtableHelpers.update(TABLES.EMPLOYEES, employee.id, {
          password_hash: hashedPassword,
          is_active: true,
          updated_at: new Date().toISOString()
        });
        
        updates.push({
          id: employee.id,
          email: employee.email,
          role: employee.role,
          password: defaultPassword
        });
      }
    }
    
    res.json({
      status: 'success',
      message: `Activated and set passwords for ${updates.length} employees`,
      employees: updates
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Get all employees with their status
router.get('/status', async (req, res) => {
  try {
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    
    const employeeStatus = employees.map(emp => ({
      id: emp.id,
      email: emp.email,
      full_name: emp.full_name,
      role: emp.role,
      is_active: emp.is_active,
      has_password: !!emp.password_hash
    }));
    
    res.json({
      status: 'success',
      total: employees.length,
      employees: employeeStatus
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

module.exports = router;
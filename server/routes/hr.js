const express = require('express');
const bcrypt = require('bcryptjs');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { auditLog, authenticateToken, authorizeRoles } = require('../middleware/auth');

// CSRF protection middleware (disabled in development)
const csrfProtection = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  if (!token) {
    return res.status(403).json({ message: 'CSRF token required' });
  }
  next();
};

const router = express.Router();

// Get all employees
router.get('/employees', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.query;
    
    // Get all employees first
    const allEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    
    // Filter by branch if specified
    let employees = allEmployees;
    if (branchId) {
      employees = allEmployees.filter(emp => 
        emp.branch_id && emp.branch_id.includes(branchId)
      );
    }
    
    const cleanEmployees = employees.map(emp => ({
      id: emp.id,
      full_name: emp.full_name || '',
      email: emp.email || '',
      phone: emp.phone || '',
      role: emp.role || '',
      branch_id: emp.branch_id || null,
      is_active: emp.is_active !== false,
      hire_date: emp.hire_date || '',
      salary: emp.salary || 0
    }));

    res.json(cleanEmployees);
  } catch (error) {
    console.error('Get employees error:', error.message);
    res.status(500).json({ message: 'Failed to fetch employees', error: error.message });
  }
});

// Create new employee
router.post('/employees', authenticateToken, authorizeRoles(['admin', 'boss', 'hr']), csrfProtection, async (req, res) => {
  try {
    console.log('Creating employee request:', req.body);
    const { full_name, email, phone, role, branch_id, salary, password, hire_date } = req.body;
    
    // Validate required fields
    if (!full_name || !email || !role) {
      return res.status(400).json({ message: 'Full name, email, and role are required' });
    }

    // Check if email already exists
    const existingEmployees = await airtableHelpers.find(
      TABLES.EMPLOYEES,
      `{email} = "${email}"`
    );
    
    if (existingEmployees.length > 0) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    // Use provided password or generate default
    const finalPassword = password || `${role}password123`;
    const hashedPassword = await bcrypt.hash(finalPassword, 12);
    
    const employeeData = {
      full_name: full_name.trim(),
      email: email.toLowerCase().trim(),
      role,
      password_hash: hashedPassword,
      is_active: true,
      hire_date: hire_date || new Date().toISOString().split('T')[0],
      mfa_enabled: false
    };
    
    // Add optional fields
    if (phone && phone.trim()) employeeData.phone = phone.trim();
    if (branch_id && branch_id !== '' && branch_id !== null) {
      // Verify branch exists before linking
      try {
        const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
        if (branch) {
          employeeData.branch_id = [branch_id]; // Airtable link field format
        }
      } catch (branchError) {
        console.log('Branch not found, skipping branch assignment:', branch_id);
      }
    }
    if (salary && salary !== '' && salary !== null && !isNaN(salary)) {
      employeeData.salary = salary.toString(); // Airtable expects string for currency field
    }
    
    console.log('Creating employee with data:', JSON.stringify(employeeData, null, 2));
    
    // Validate required fields before creation
    if (!employeeData.full_name || !employeeData.email || !employeeData.role) {
      throw new Error('Missing required fields: full_name, email, or role');
    }
    
    const employee = await airtableHelpers.create(TABLES.EMPLOYEES, employeeData);
    console.log('Employee created successfully:', employee.id);

    // Return clean response
    res.status(201).json({
      id: employee.id,
      full_name: employee.fields.full_name,
      email: employee.fields.email,
      role: employee.fields.role,
      branch_id: employee.fields.branch_id || null,
      is_active: employee.fields.is_active,
      hire_date: employee.fields.hire_date,
      salary: employee.fields.salary || null,
      phone: employee.fields.phone || null
    });
  } catch (error) {
    console.error('Create employee error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      message: 'Failed to create employee', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update employee
router.put('/employees/:employeeId', authenticateToken, authorizeRoles(['admin', 'boss', 'hr']), async (req, res) => {
  try {
    console.log('Updating employee:', req.params.employeeId);
    console.log('Update data:', req.body);
    
    const { employeeId } = req.params;
    const { full_name, email, phone, role, branch_id, salary, is_active, hire_date } = req.body;

    const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const updateData = {};
    if (full_name && full_name.trim()) updateData.full_name = full_name.trim();
    if (email && email.trim()) updateData.email = email.toLowerCase().trim();
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : null;
    if (role) updateData.role = role;
    if (branch_id !== undefined && branch_id !== null && branch_id !== '') {
      // Verify branch exists before linking
      try {
        const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
        if (branch) {
          updateData.branch_id = [branch_id]; // Airtable link field format
        }
      } catch (branchError) {
        console.log('Branch not found, skipping branch update:', branch_id);
      }
    } else if (branch_id === null || branch_id === '') {
      updateData.branch_id = null; // Clear branch assignment
    }
    if (salary !== undefined && salary !== null && salary !== '') {
      updateData.salary = salary.toString(); // Airtable expects string for currency field
    }
    if (is_active !== undefined) updateData.is_active = is_active;
    if (hire_date !== undefined) updateData.hire_date = hire_date;

    console.log('Final update data:', updateData);
    const updatedEmployee = await airtableHelpers.update(TABLES.EMPLOYEES, employeeId, updateData);

    res.json({
      id: updatedEmployee.id,
      full_name: updatedEmployee.fields.full_name,
      email: updatedEmployee.fields.email,
      phone: updatedEmployee.fields.phone || null,
      role: updatedEmployee.fields.role,
      branch_id: updatedEmployee.fields.branch_id || null,
      salary: updatedEmployee.fields.salary || null,
      is_active: updatedEmployee.fields.is_active,
      hire_date: updatedEmployee.fields.hire_date || null
    });
  } catch (error) {
    console.error('Update employee error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      message: 'Failed to update employee',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Delete employee (deactivate)
router.delete('/employees/:employeeId', authenticateToken, authorizeRoles(['admin', 'boss', 'hr']), async (req, res) => {
  try {
    const { employeeId } = req.params;

    await airtableHelpers.update(TABLES.EMPLOYEES, employeeId, {
      is_active: false
    });

    res.json({ message: 'Employee deactivated successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ message: 'Failed to deactivate employee' });
  }
});

// Generate payroll
router.post('/payroll/generate', csrfProtection, async (req, res) => {
  try {
    const {
      period_start,
      period_end,
      employee_ids,
      deductions_percentage = 0.15 // Default 15% deductions
    } = req.body;

    if (!period_start || !period_end) {
      return res.status(400).json({ message: 'Period start and end dates are required' });
    }

    let employees;
    if (employee_ids && employee_ids.length > 0) {
      // Generate for specific employees
      employees = await Promise.all(
        employee_ids.map(id => airtableHelpers.findById(TABLES.EMPLOYEES, id))
      );
    } else {
      // Generate for all active employees
      employees = await airtableHelpers.find(
        TABLES.EMPLOYEES,
        '{is_active} = TRUE()'
      );
    }

    const payrollRecords = await Promise.all(
      employees.map(async (employee) => {
        const grossSalary = parseFloat(employee.salary || '0');
        const deductions = grossSalary * (deductions_percentage / 100);
        const netSalary = grossSalary - deductions;

        return airtableHelpers.create(TABLES.PAYROLL, {
          employee_id: employee.id,
          period_start,
          period_end,
          gross_salary: grossSalary,
          deductions,
          net_salary: netSalary,
          payment_status: 'pending',
          generated_by: req.user?.id || 'system',
          created_at: new Date().toISOString()
        });
      })
    );

    res.status(201).json({
      message: 'Payroll generated successfully',
      records: payrollRecords.length
    });
  } catch (error) {
    console.error('Generate payroll error:', error);
    res.status(500).json({ message: 'Failed to generate payroll' });
  }
});

// Get payroll records
router.get('/payroll', async (req, res) => {
  try {
    const { period_start, period_end, employee_id, status } = req.query;
    
    let filterFormula = '';
    const filters = [];
    
    if (period_start && period_end) {
      filters.push(`AND(IS_AFTER({period_start}, "${period_start}"), IS_BEFORE({period_end}, "${period_end}"))`);
    }
    if (employee_id) filters.push(`{employee_id} = "${employee_id}"`);
    if (status) filters.push(`{payment_status} = "${status}"`);
    
    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }

    const payrollRecords = await airtableHelpers.find(TABLES.PAYROLL, filterFormula);
    
    // Get employee details for each record
    const payrollWithEmployees = await Promise.all(
      payrollRecords.map(async (record) => {
        const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, record.employee_id);
        return {
          ...record,
          employee_name: employee?.full_name,
          employee_email: employee?.email
        };
      })
    );

    res.json(payrollWithEmployees);
  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({ message: 'Failed to fetch payroll records' });
  }
});

// Mark payroll as paid
router.patch('/payroll/:payrollId/paid', async (req, res) => {
  try {
    const { payrollId } = req.params;

    const updatedPayroll = await airtableHelpers.update(TABLES.PAYROLL, payrollId, {
      payment_status: 'paid',
      payment_date: new Date().toISOString()
    });

    res.json(updatedPayroll);
  } catch (error) {
    console.error('Mark payroll paid error:', error);
    res.status(500).json({ message: 'Failed to mark payroll as paid' });
  }
});

// Send payslips (placeholder - would integrate with email service)
router.post('/payroll/send-payslips', csrfProtection, async (req, res) => {
  try {
    const { payroll_ids } = req.body;

    if (!payroll_ids || payroll_ids.length === 0) {
      return res.status(400).json({ message: 'Payroll IDs are required' });
    }

    // This would integrate with Amazon SES to send actual emails
    // For now, just mark as sent
    await Promise.all(
      payroll_ids.map(id => 
        airtableHelpers.update(TABLES.PAYROLL, id, {
          payslip_sent: true,
          payslip_sent_date: new Date().toISOString()
        })
      )
    );

    res.json({ 
      message: 'Payslips sent successfully',
      sent_count: payroll_ids.length
    });
  } catch (error) {
    console.error('Send payslips error:', error);
    res.status(500).json({ message: 'Failed to send payslips' });
  }
});

module.exports = router;
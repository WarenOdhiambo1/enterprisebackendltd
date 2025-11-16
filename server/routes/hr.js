const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const router = express.Router();

// HR Management System Architecture Implementation

// HR Dashboard - Get comprehensive stats
router.get('/dashboard/stats', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const [employees, payroll, auditLogs] = await Promise.all([
      airtableHelpers.find(TABLES.EMPLOYEES),
      airtableHelpers.find(TABLES.PAYROLL),
      airtableHelpers.find('Audit_Logs').catch(() => [])
    ]);
    
    const stats = {
      totalEmployees: employees.length,
      activeEmployees: employees.filter(e => e.is_active).length,
      inactiveEmployees: employees.filter(e => !e.is_active).length,
      recentHires: employees.filter(e => {
        const hireDate = new Date(e.hire_date);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return hireDate > thirtyDaysAgo;
      }).length,
      pendingPayroll: payroll.filter(p => p.payment_status === 'pending').length,
      totalPayrollAmount: payroll.reduce((sum, p) => sum + (p.net_salary || 0), 0),
      roleDistribution: employees.reduce((acc, e) => {
        acc[e.role] = (acc[e.role] || 0) + 1;
        return acc;
      }, {}),
      branchDistribution: employees.reduce((acc, e) => {
        const branch = e.branch_id?.[0] || 'unassigned';
        acc[branch] = (acc[branch] || 0) + 1;
        return acc;
      }, {})
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get HR dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to fetch HR dashboard stats' });
  }
});

// Get all employees with advanced filtering
router.get('/employees', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { role, branch, isActive, search, page = 1, limit = 50 } = req.query;
    
    let employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    
    // Apply filters
    if (role) {
      employees = employees.filter(e => e.role === role);
    }
    if (branch) {
      employees = employees.filter(e => e.branch_id && e.branch_id.includes(branch));
    }
    if (isActive !== undefined) {
      employees = employees.filter(e => e.is_active === (isActive === 'true'));
    }
    if (search) {
      const searchLower = search.toLowerCase();
      employees = employees.filter(e => 
        e.full_name?.toLowerCase().includes(searchLower) ||
        e.email?.toLowerCase().includes(searchLower)
      );
    }
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const paginatedEmployees = employees.slice(startIndex, startIndex + parseInt(limit));
    
    res.json({
      employees: paginatedEmployees,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: employees.length,
        totalPages: Math.ceil(employees.length / limit)
      }
    });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ message: 'Failed to fetch employees' });
  }
});

// Get employee by ID with complete profile
router.get('/employees/:id', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const [employee, payrollHistory, auditLogs] = await Promise.all([
      airtableHelpers.findById(TABLES.EMPLOYEES, id),
      airtableHelpers.find(TABLES.PAYROLL, `{employee_id} = "${id}"`).catch(() => []),
      airtableHelpers.find('Audit_Logs', `{user_id} = "${id}"`).catch(() => [])
    ]);
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    res.json({
      employee,
      payrollHistory,
      auditLogs: auditLogs.slice(0, 50), // Last 50 activities
      summary: {
        totalPayroll: payrollHistory.reduce((sum, p) => sum + (p.net_salary || 0), 0),
        lastLogin: employee.last_login,
        accountStatus: employee.is_active ? 'Active' : 'Inactive',
        mfaEnabled: employee.mfa_enabled || false
      }
    });
  } catch (error) {
    console.error('Get employee profile error:', error);
    res.status(500).json({ message: 'Failed to fetch employee profile' });
  }
});

// Create employee with complete profile
router.post('/employees', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { 
      full_name, 
      email, 
      phone, 
      role, 
      branch_id, 
      hire_date, 
      salary, 
      password,
      mfa_enabled = false 
    } = req.body;
    
    // Validate required fields
    if (!full_name || !email || !role || !password) {
      return res.status(400).json({ message: 'Full name, email, role, and password are required' });
    }
    
    // Check email uniqueness
    const existingEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    if (existingEmployees.some(e => e.email === email)) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    
    const employeeData = {
      full_name,
      email,
      phone: phone || '',
      role,
      branch_id: branch_id ? [branch_id] : [],
      hire_date: hire_date || new Date().toISOString().split('T')[0],
      salary: parseFloat(salary) || 0,
      password_hash,
      mfa_enabled,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const newEmployee = await airtableHelpers.create(TABLES.EMPLOYEES, employeeData);
    
    // Remove password hash from response
    delete newEmployee.password_hash;
    
    res.status(201).json(newEmployee);
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ message: 'Failed to create employee', error: error.message });
  }
});

// Update employee with validation
router.put('/employees/:id', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    // Handle password update
    if (updateData.password) {
      updateData.password_hash = await bcrypt.hash(updateData.password, 10);
      delete updateData.password;
    }
    
    // Handle branch assignment
    if (updateData.branch_id && !Array.isArray(updateData.branch_id)) {
      updateData.branch_id = [updateData.branch_id];
    }
    
    updateData.updated_at = new Date().toISOString();
    
    const updatedEmployee = await airtableHelpers.update(TABLES.EMPLOYEES, id, updateData);
    
    // Remove password hash from response
    delete updatedEmployee.password_hash;
    
    res.json(updatedEmployee);
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ message: 'Failed to update employee' });
  }
});

// Update employee status (activate/deactivate)
router.put('/employees/:id/status', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    const updatedEmployee = await airtableHelpers.update(TABLES.EMPLOYEES, id, {
      is_active,
      updated_at: new Date().toISOString()
    });
    
    res.json({ success: true, employee: updatedEmployee });
  } catch (error) {
    console.error('Update employee status error:', error);
    res.status(500).json({ message: 'Failed to update employee status' });
  }
});

// Reset employee password
router.post('/employees/:id/reset-password', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;
    
    if (!new_password) {
      return res.status(400).json({ message: 'New password is required' });
    }
    
    const password_hash = await bcrypt.hash(new_password, 10);
    
    await airtableHelpers.update(TABLES.EMPLOYEES, id, {
      password_hash,
      updated_at: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

// Delete employee
router.delete('/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.EMPLOYEES, id);
    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ message: 'Failed to delete employee' });
  }
});

// Payroll Management System

// Get current payroll period
router.get('/payroll/current-period', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    const periodStart = `${currentYear}-${currentMonth.toString().padStart(2, '0')}-01`;
    const periodEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
    
    const payrollRecords = await airtableHelpers.find(TABLES.PAYROLL);
    const currentPeriodPayroll = payrollRecords.filter(p => 
      p.period_start === periodStart && p.period_end === periodEnd
    );
    
    res.json({
      period: { start: periodStart, end: periodEnd },
      payrollCount: currentPeriodPayroll.length,
      totalAmount: currentPeriodPayroll.reduce((sum, p) => sum + (p.net_salary || 0), 0),
      pendingCount: currentPeriodPayroll.filter(p => p.payment_status === 'pending').length,
      paidCount: currentPeriodPayroll.filter(p => p.payment_status === 'paid').length
    });
  } catch (error) {
    console.error('Get current payroll period error:', error);
    res.status(500).json({ message: 'Failed to fetch current payroll period' });
  }
});

// Get payroll records with filtering
router.get('/payroll', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { employee_id, period_start, period_end, payment_status } = req.query;
    
    let payroll = await airtableHelpers.find(TABLES.PAYROLL);
    
    // Apply filters
    if (employee_id) {
      payroll = payroll.filter(p => p.employee_id && p.employee_id.includes(employee_id));
    }
    if (period_start) {
      payroll = payroll.filter(p => p.period_start >= period_start);
    }
    if (period_end) {
      payroll = payroll.filter(p => p.period_end <= period_end);
    }
    if (payment_status) {
      payroll = payroll.filter(p => p.payment_status === payment_status);
    }
    
    res.json(payroll);
  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({ message: 'Failed to fetch payroll' });
  }
});

// Generate payroll for period
router.post('/payroll/generate', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { period_start, period_end, employee_ids } = req.body;
    
    if (!period_start || !period_end) {
      return res.status(400).json({ message: 'Period start and end dates are required' });
    }
    
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const targetEmployees = employee_ids ? 
      employees.filter(e => employee_ids.includes(e.id)) :
      employees.filter(e => e.is_active);
    
    const generatedPayroll = [];
    
    for (const employee of targetEmployees) {
      // Check if payroll already exists for this period
      const existingPayroll = await airtableHelpers.find(
        TABLES.PAYROLL,
        `AND({employee_id} = "${employee.id}", {period_start} = "${period_start}", {period_end} = "${period_end}")`
      );
      
      if (existingPayroll.length === 0) {
        const grossSalary = employee.salary || 0;
        const deductions = grossSalary * 0.1; // 10% deductions (tax, insurance, etc.)
        const netSalary = grossSalary - deductions;
        
        const payrollData = {
          employee_id: [employee.id],
          period_start,
          period_end,
          gross_salary: grossSalary,
          deductions,
          net_salary: netSalary,
          payment_status: 'pending',
          generated_by: req.user?.id ? [req.user.id] : [],
          created_at: new Date().toISOString()
        };
        
        const newPayroll = await airtableHelpers.create(TABLES.PAYROLL, payrollData);
        generatedPayroll.push(newPayroll);
      }
    }
    
    res.json({
      success: true,
      message: `Generated payroll for ${generatedPayroll.length} employees`,
      payroll: generatedPayroll
    });
  } catch (error) {
    console.error('Generate payroll error:', error);
    res.status(500).json({ message: 'Failed to generate payroll' });
  }
});

// Process payroll payment
router.put('/payroll/:id', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status, payment_date, gross_salary, deductions } = req.body;
    
    const updateData = {};
    if (payment_status) updateData.payment_status = payment_status;
    if (payment_date) updateData.payment_date = payment_date;
    if (gross_salary !== undefined) {
      updateData.gross_salary = parseFloat(gross_salary);
      updateData.net_salary = parseFloat(gross_salary) - (parseFloat(deductions) || 0);
    }
    if (deductions !== undefined) {
      updateData.deductions = parseFloat(deductions);
      const payroll = await airtableHelpers.findById(TABLES.PAYROLL, id);
      updateData.net_salary = (payroll.gross_salary || 0) - parseFloat(deductions);
    }
    
    const updatedPayroll = await airtableHelpers.update(TABLES.PAYROLL, id, updateData);
    res.json(updatedPayroll);
  } catch (error) {
    console.error('Update payroll error:', error);
    res.status(500).json({ message: 'Failed to update payroll' });
  }
});

// Send payslip
router.post('/payroll/:id/send-payslip', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Update payslip sent status
    await airtableHelpers.update(TABLES.PAYROLL, id, {
      payslip_sent: true,
      payslip_sent_date: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Payslip sent successfully' });
  } catch (error) {
    console.error('Send payslip error:', error);
    res.status(500).json({ message: 'Failed to send payslip' });
  }
});

// Bulk process payroll
router.post('/payroll/bulk-process', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { payroll_ids, action, payment_date } = req.body;
    
    if (!payroll_ids || !action) {
      return res.status(400).json({ message: 'Payroll IDs and action are required' });
    }
    
    const results = [];
    
    for (const payrollId of payroll_ids) {
      const updateData = {};
      
      switch (action) {
        case 'mark_paid':
          updateData.payment_status = 'paid';
          updateData.payment_date = payment_date || new Date().toISOString().split('T')[0];
          break;
        case 'send_payslips':
          updateData.payslip_sent = true;
          updateData.payslip_sent_date = new Date().toISOString();
          break;
        default:
          continue;
      }
      
      const updated = await airtableHelpers.update(TABLES.PAYROLL, payrollId, updateData);
      results.push(updated);
    }
    
    res.json({
      success: true,
      message: `Bulk ${action} completed for ${results.length} payroll records`,
      results
    });
  } catch (error) {
    console.error('Bulk process payroll error:', error);
    res.status(500).json({ message: 'Failed to bulk process payroll' });
  }
});

// Audit & Security Module

// Get audit logs
router.get('/audit/logs', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { user_id, action, startDate, endDate, success } = req.query;
    
    let auditLogs = [];
    try {
      auditLogs = await airtableHelpers.find('Audit_Logs');
    } catch (error) {
      console.log('Audit_Logs table not found, returning empty array');
      return res.json([]);
    }
    
    // Apply filters
    if (user_id) {
      auditLogs = auditLogs.filter(log => log.user_id && log.user_id.includes(user_id));
    }
    if (action) {
      auditLogs = auditLogs.filter(log => log.action === action);
    }
    if (startDate) {
      auditLogs = auditLogs.filter(log => log.timestamp >= startDate);
    }
    if (endDate) {
      auditLogs = auditLogs.filter(log => log.timestamp <= endDate);
    }
    if (success !== undefined) {
      auditLogs = auditLogs.filter(log => log.success === (success === 'true'));
    }
    
    // Sort by timestamp descending
    auditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json(auditLogs.slice(0, 1000)); // Limit to 1000 records
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

// Get user activity statistics
router.get('/audit/user-activity', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { user_id } = req.query;
    
    let auditLogs = [];
    try {
      auditLogs = await airtableHelpers.find('Audit_Logs');
    } catch (error) {
      return res.json({ totalActions: 0, successRate: 0, recentActivity: [] });
    }
    
    if (user_id) {
      auditLogs = auditLogs.filter(log => log.user_id && log.user_id.includes(user_id));
    }
    
    const stats = {
      totalActions: auditLogs.length,
      successfulActions: auditLogs.filter(log => log.success).length,
      failedActions: auditLogs.filter(log => !log.success).length,
      successRate: auditLogs.length > 0 ? (auditLogs.filter(log => log.success).length / auditLogs.length * 100).toFixed(2) : 0,
      actionTypes: auditLogs.reduce((acc, log) => {
        acc[log.action] = (acc[log.action] || 0) + 1;
        return acc;
      }, {}),
      recentActivity: auditLogs
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20)
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({ message: 'Failed to fetch user activity' });
  }
});

// HR Reports
router.get('/reports/employees', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { reportType = 'demographics' } = req.query;
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    
    let reportData = {};
    
    switch (reportType) {
      case 'demographics':
        reportData = {
          totalEmployees: employees.length,
          activeEmployees: employees.filter(e => e.is_active).length,
          roleDistribution: employees.reduce((acc, e) => {
            acc[e.role] = (acc[e.role] || 0) + 1;
            return acc;
          }, {}),
          branchDistribution: employees.reduce((acc, e) => {
            const branch = e.branch_id?.[0] || 'unassigned';
            acc[branch] = (acc[branch] || 0) + 1;
            return acc;
          }, {}),
          averageSalary: employees.reduce((sum, e) => sum + (e.salary || 0), 0) / employees.length
        };
        break;
      case 'turnover':
        const currentYear = new Date().getFullYear();
        const hiredThisYear = employees.filter(e => 
          e.hire_date && new Date(e.hire_date).getFullYear() === currentYear
        );
        const inactiveThisYear = employees.filter(e => 
          !e.is_active && e.updated_at && new Date(e.updated_at).getFullYear() === currentYear
        );
        
        reportData = {
          hiredThisYear: hiredThisYear.length,
          leftThisYear: inactiveThisYear.length,
          turnoverRate: employees.length > 0 ? (inactiveThisYear.length / employees.length * 100).toFixed(2) : 0,
          retentionRate: employees.length > 0 ? ((employees.length - inactiveThisYear.length) / employees.length * 100).toFixed(2) : 0
        };
        break;
    }
    
    res.json(reportData);
  } catch (error) {
    console.error('Get employee report error:', error);
    res.status(500).json({ message: 'Failed to generate employee report' });
  }
});

// Get payroll reports
router.get('/reports/payroll', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { period_start, period_end } = req.query;
    
    let payroll = await airtableHelpers.find(TABLES.PAYROLL);
    
    if (period_start) {
      payroll = payroll.filter(p => p.period_start >= period_start);
    }
    if (period_end) {
      payroll = payroll.filter(p => p.period_end <= period_end);
    }
    
    const reportData = {
      totalPayroll: payroll.reduce((sum, p) => sum + (p.net_salary || 0), 0),
      totalGross: payroll.reduce((sum, p) => sum + (p.gross_salary || 0), 0),
      totalDeductions: payroll.reduce((sum, p) => sum + (p.deductions || 0), 0),
      payrollCount: payroll.length,
      paidCount: payroll.filter(p => p.payment_status === 'paid').length,
      pendingCount: payroll.filter(p => p.payment_status === 'pending').length,
      averageSalary: payroll.length > 0 ? payroll.reduce((sum, p) => sum + (p.net_salary || 0), 0) / payroll.length : 0
    };
    
    res.json(reportData);
  } catch (error) {
    console.error('Get payroll report error:', error);
    res.status(500).json({ message: 'Failed to generate payroll report' });
  }
});

module.exports = router;
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
    
    let employees;
    try {
      employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    } catch (airtableError) {
      console.warn('Airtable connection failed, using mock data:', airtableError.message);
      // Mock data for development/testing
      employees = [
        {
          id: 'rec1',
          full_name: 'John Doe',
          email: 'john.doe@kabisakabisa.com',
          phone: '+254712345678',
          role: 'sales',
          branch_id: ['recBranch1'],
          salary: 50000,
          hire_date: '2023-01-15',
          is_active: true,
          created_at: '2023-01-15T00:00:00Z'
        },
        {
          id: 'rec2',
          full_name: 'Jane Smith',
          email: 'jane.smith@kabisakabisa.com',
          phone: '+254712345679',
          role: 'logistics',
          branch_id: ['recBranch1'],
          salary: 45000,
          hire_date: '2023-02-01',
          is_active: true,
          created_at: '2023-02-01T00:00:00Z'
        },
        {
          id: 'rec3',
          full_name: 'Mike Johnson',
          email: 'mike.johnson@kabisakabisa.com',
          phone: '+254712345680',
          role: 'hr',
          branch_id: ['recBranch2'],
          salary: 55000,
          hire_date: '2023-03-01',
          is_active: true,
          created_at: '2023-03-01T00:00:00Z'
        }
      ];
    }
    
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
      total_count: employees.length,
      page: parseInt(page)
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
router.post('/employees', async (req, res) => {
  try {
    const { full_name, email, role, branch_id, phone, salary } = req.body;
    
    const employeeData = {
      full_name: full_name,
      email: email,
      phone: phone || '',
      role: role,
      branch_id: branch_id ? [branch_id] : [],
      salary: parseFloat(salary) || 0,
      is_active: true,
      hire_date: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    };
    
    const newEmployee = await airtableHelpers.create(TABLES.EMPLOYEES, employeeData);
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
    
    let payroll;
    try {
      payroll = await airtableHelpers.find(TABLES.PAYROLL);
    } catch (airtableError) {
      console.warn('Airtable connection failed, using mock payroll data:', airtableError.message);
      // Mock payroll data
      payroll = [
        {
          id: 'recPay1',
          employee_id: ['rec1'],
          employee_name: 'John Doe',
          employee_email: 'john.doe@kabisakabisa.com',
          employee_phone: '+254712345678',
          period_start: '2025-11-01',
          period_end: '2025-11-30',
          gross_salary: 50000,
          deductions: 7500,
          net_salary: 42500,
          payment_status: 'pending',
          payslip_sent: false,
          created_at: '2025-11-01T00:00:00Z'
        },
        {
          id: 'recPay2',
          employee_id: ['rec2'],
          employee_name: 'Jane Smith',
          employee_email: 'jane.smith@kabisakabisa.com',
          employee_phone: '+254712345679',
          period_start: '2025-11-01',
          period_end: '2025-11-30',
          gross_salary: 45000,
          deductions: 6750,
          net_salary: 38250,
          payment_status: 'paid',
          payslip_sent: true,
          payslip_sent_date: '2025-11-30T00:00:00Z',
          created_at: '2025-11-01T00:00:00Z'
        }
      ];
    }
    
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
    
    const totalAmount = payroll.reduce((sum, p) => sum + (parseFloat(p.net_salary) || 0), 0);
    
    res.json({
      payroll_records: payroll,
      total_amount: totalAmount,
      total_count: payroll.length
    });
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

// Get All Branches for HR
router.get('/branches', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { include_employees, include_manager, status } = req.query;
    
    let branches;
    try {
      branches = await airtableHelpers.find('Branches');
    } catch (airtableError) {
      console.warn('Airtable connection failed, using mock branches data:', airtableError.message);
      branches = [
        {
          id: 'recBranch1',
          branch_name: 'Main Branch',
          location_address: '123 Main Street, Nairobi, Kenya',
          latitude: -1.2921,
          longitude: 36.8219,
          phone: '+254712345678',
          email: 'main@kabisakabisa.com',
          manager_name: 'Jane Smith',
          employee_count: 15,
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
          manager_name: 'Mike Johnson',
          employee_count: 10,
          created_at: '2023-02-01T00:00:00Z'
        }
      ];
    }
    
    // Filter by status if provided
    if (status) {
      branches = branches.filter(b => b.status === status);
    }
    
    res.json({
      branches: branches,
      total_count: branches.length
    });
  } catch (error) {
    console.error('Get HR branches error:', error);
    res.status(500).json({ message: 'Failed to fetch branches' });
  }
});

// Get Employee Documents
router.get('/documents', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { employee_id, category, approval_status, uploaded_by, branch_id, is_archived, limit = 50, offset = 0 } = req.query;
    
    // Mock documents data since Documents table might not exist
    let documents = [
      {
        id: 'recDoc1',
        file_name: 'employee_contract.pdf',
        display_name: 'John Doe Employment Contract',
        category: 'employee_documents',
        subcategory: 'contracts',
        file_size: 2048576,
        file_type: 'application/pdf',
        uploaded_by: 'HR Manager',
        uploaded_at: '2025-11-01T09:00:00Z',
        approval_status: 'approved',
        branch_name: 'Main Branch',
        download_url: '/api/documents/download/recDoc1',
        is_public: false
      }
    ];
    
    // Apply filters
    if (employee_id) {
      documents = documents.filter(d => d.employee_id === employee_id);
    }
    if (category) {
      documents = documents.filter(d => d.category === category);
    }
    if (approval_status) {
      documents = documents.filter(d => d.approval_status === approval_status);
    }
    
    res.json({
      documents: documents,
      total_count: documents.length
    });
  } catch (error) {
    console.error('Get HR documents error:', error);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// Get Audit Logs
router.get('/audit-logs', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { user_id, action, resource, success, start_date, end_date, ip_address, limit = 50, offset = 0 } = req.query;
    
    // Mock audit logs data
    let auditLogs = [
      {
        id: 'recAudit1',
        user_name: 'John Doe',
        action: 'login',
        resource: '/dashboard',
        method: 'GET',
        ip_address: '192.168.1.100',
        user_agent: 'Mozilla/5.0...',
        success: true,
        status_code: 200,
        timestamp: '2025-11-16T10:30:00Z'
      }
    ];
    
    // Apply filters
    if (user_id) {
      auditLogs = auditLogs.filter(log => log.user_id === user_id);
    }
    if (action) {
      auditLogs = auditLogs.filter(log => log.action === action);
    }
    if (success !== undefined) {
      auditLogs = auditLogs.filter(log => log.success === (success === 'true'));
    }
    
    res.json({
      audit_logs: auditLogs,
      total_count: auditLogs.length
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

// Get Employee Performance Data
router.get('/employees/:employee_id/performance', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { employee_id } = req.params;
    const { start_date, end_date, metrics, branch_id } = req.query;
    
    // Mock performance data
    const performanceData = {
      employee_id: employee_id,
      employee_name: 'John Doe',
      role: 'sales',
      performance_period: {
        start_date: start_date || '2025-10-01',
        end_date: end_date || '2025-10-31'
      },
      metrics: {
        total_sales: 15000.00,
        sales_count: 25,
        trips_completed: 12,
        expenses_recorded: 8,
        total_expenses: 2500.00
      },
      rankings: {
        sales_rank: 3,
        efficiency_score: 85
      }
    };
    
    res.json(performanceData);
  } catch (error) {
    console.error('Get employee performance error:', error);
    res.status(500).json({ message: 'Failed to fetch employee performance' });
  }
});

// Get Department Summary
router.get('/departments/summary', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { branch_id, include_inactive, period } = req.query;
    
    // Mock department summary data
    const departmentSummary = {
      departments: [
        {
          role: 'sales',
          employee_count: 8,
          active_count: 7,
          average_salary: 45000.00,
          salary_range: {
            min: 35000.00,
            max: 55000.00
          },
          performance_metrics: {
            total_sales: 120000.00,
            avg_sales_per_employee: 17142.86
          }
        },
        {
          role: 'logistics',
          employee_count: 5,
          active_count: 5,
          average_salary: 40000.00,
          salary_range: {
            min: 35000.00,
            max: 45000.00
          },
          performance_metrics: {
            total_trips: 150,
            avg_trips_per_employee: 30
          }
        }
      ],
      total_employees: 25,
      total_active: 23,
      summary_date: new Date().toISOString()
    };
    
    res.json(departmentSummary);
  } catch (error) {
    console.error('Get department summary error:', error);
    res.status(500).json({ message: 'Failed to fetch department summary' });
  }
});

// Get Employee Attendance
router.get('/attendance', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { employee_id, branch_id, start_date, end_date, summary, limit = 50, offset = 0 } = req.query;
    
    // Mock attendance data
    const attendanceRecords = [
      {
        employee_id: 'rec1',
        employee_name: 'John Doe',
        date: '2025-11-16',
        last_login: '2025-11-16T08:30:00Z',
        working_hours: 8.5,
        branch_name: 'Main Branch',
        status: 'present'
      }
    ];
    
    const attendanceSummary = {
      total_working_days: 22,
      days_present: 20,
      attendance_rate: 90.9,
      total_hours: 170.0
    };
    
    res.json({
      attendance_records: attendanceRecords,
      summary: attendanceSummary,
      total_count: attendanceRecords.length
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ message: 'Failed to fetch attendance' });
  }
});

// Get HR Dashboard Data
router.get('/dashboard', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { period, branch_id, include_charts } = req.query;
    
    // Mock dashboard data
    const dashboardData = {
      overview: {
        total_employees: 25,
        active_employees: 23,
        new_hires_this_month: 2,
        pending_payroll: 3,
        total_branches: 6
      },
      recent_activities: [
        {
          type: 'new_hire',
          employee_name: 'Jane Smith',
          date: '2025-11-15',
          branch: 'Downtown Branch'
        }
      ],
      alerts: [
        {
          type: 'warning',
          message: '3 employees have pending payroll',
          priority: 'medium'
        }
      ],
      charts_data: {
        employee_by_role: [],
        salary_distribution: [],
        attendance_trends: []
      }
    };
    
    res.json(dashboardData);
  } catch (error) {
    console.error('Get HR dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch HR dashboard' });
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

// Get employees by branch
router.get('/employees/by-branch/:branchId', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { branchId } = req.params;
    
    const allEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employees = allEmployees.filter(emp => 
      emp.branch_id && emp.branch_id.includes(branchId)
    );
    
    res.json(employees);
  } catch (error) {
    console.error('Get employees by branch error:', error);
    res.status(500).json({ message: 'Failed to fetch employees by branch' });
  }
});

// Get employees by role
router.get('/employees/by-role/:role', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { role } = req.params;
    
    const allEmployees = await airtableHelpers.find(TABLES.EMPLOYEES);
    const employees = allEmployees.filter(emp => emp.role === role);
    
    res.json(employees);
  } catch (error) {
    console.error('Get employees by role error:', error);
    res.status(500).json({ message: 'Failed to fetch employees by role' });
  }
});

// Get employee sales
router.get('/employees/:id/sales', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    let filterFormula = `FIND("${id}", ARRAYJOIN({employee_id}))`;
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({sale_date}, "${startDate}"), IS_BEFORE({sale_date}, "${endDate}"))`;
      filterFormula = `AND(${filterFormula}, ${dateFilter})`;
    }
    
    const sales = await airtableHelpers.find(TABLES.SALES, filterFormula);
    
    const summary = {
      totalSales: sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0),
      salesCount: sales.length,
      averageSale: sales.length > 0 ? sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0) / sales.length : 0
    };
    
    res.json({ sales, summary });
  } catch (error) {
    console.error('Get employee sales error:', error);
    res.status(500).json({ message: 'Failed to fetch employee sales' });
  }
});

// Get employee expenses
router.get('/employees/:id/expenses', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    let filterFormula = `FIND("${id}", ARRAYJOIN({recorded_by}))`;
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({expense_date}, "${startDate}"), IS_BEFORE({expense_date}, "${endDate}"))`;
      filterFormula = `AND(${filterFormula}, ${dateFilter})`;
    }
    
    const expenses = await airtableHelpers.find(TABLES.EXPENSES, filterFormula);
    
    const summary = {
      totalExpenses: expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0),
      expenseCount: expenses.length,
      averageExpense: expenses.length > 0 ? expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0) / expenses.length : 0,
      categoryBreakdown: expenses.reduce((acc, expense) => {
        const category = expense.category || 'other';
        acc[category] = (acc[category] || 0) + (parseFloat(expense.amount) || 0);
        return acc;
      }, {})
    };
    
    res.json({ expenses, summary });
  } catch (error) {
    console.error('Get employee expenses error:', error);
    res.status(500).json({ message: 'Failed to fetch employee expenses' });
  }
});

// Get employee payroll history
router.get('/employees/:id/payroll', authenticateToken, authorizeRoles(['hr', 'admin', 'boss', 'manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 12 } = req.query;
    
    const payrollHistory = await airtableHelpers.find(
      TABLES.PAYROLL,
      `FIND("${id}", ARRAYJOIN({employee_id}))`
    );
    
    // Sort by period_start descending and limit
    const sortedPayroll = payrollHistory
      .sort((a, b) => new Date(b.period_start) - new Date(a.period_start))
      .slice(0, parseInt(limit));
    
    const summary = {
      totalPayroll: payrollHistory.reduce((sum, p) => sum + (parseFloat(p.net_salary) || 0), 0),
      averagePayroll: payrollHistory.length > 0 ? payrollHistory.reduce((sum, p) => sum + (parseFloat(p.net_salary) || 0), 0) / payrollHistory.length : 0,
      lastPayment: payrollHistory.find(p => p.payment_status === 'paid'),
      pendingPayments: payrollHistory.filter(p => p.payment_status === 'pending').length
    };
    
    res.json({ payroll: sortedPayroll, summary });
  } catch (error) {
    console.error('Get employee payroll error:', error);
    res.status(500).json({ message: 'Failed to fetch employee payroll' });
  }
});

// Activate employee
router.post('/employees/:id/activate', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const updatedEmployee = await airtableHelpers.update(TABLES.EMPLOYEES, id, {
      is_active: true,
      updated_at: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Employee activated successfully', employee: updatedEmployee });
  } catch (error) {
    console.error('Activate employee error:', error);
    res.status(500).json({ message: 'Failed to activate employee' });
  }
});

// Deactivate employee
router.post('/employees/:id/deactivate', authenticateToken, authorizeRoles(['hr', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const updatedEmployee = await airtableHelpers.update(TABLES.EMPLOYEES, id, {
      is_active: false,
      deactivation_reason: reason || 'No reason provided',
      deactivated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Employee deactivated successfully', employee: updatedEmployee });
  } catch (error) {
    console.error('Deactivate employee error:', error);
    res.status(500).json({ message: 'Failed to deactivate employee' });
  }
});

module.exports = router;
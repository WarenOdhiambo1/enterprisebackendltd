const express = require('express');
const bcrypt = require('bcryptjs');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { auditLog, authenticateToken, authorizeRoles } = require('../middleware/auth');

// CSRF protection disabled
const csrfProtection = (req, res, next) => {
  next();
};

const router = express.Router();

// Get branches for HR page (public access)
router.get('/branches', async (req, res) => {
  try {
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    const publicBranches = branches.map(branch => ({
      id: branch.id,
      name: branch.branch_name || 'Branch',
      branch_name: branch.branch_name || 'Branch',
      address: branch.location_address || 'Address not available'
    }));
    res.json(publicBranches);
  } catch (error) {
    console.error('HR branches error:', error);
    res.status(200).json([]);
  }
});

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
      salary: emp.salary || 0,
      driver_license: emp.driver_license || null,
      vehicle_assigned: emp.vehicle_assigned || false
    }));

    res.json(cleanEmployees);
  } catch (error) {
    console.error('Get employees error:', error.message);
    res.status(500).json({ message: 'Failed to fetch employees', error: error.message });
  }
});

// Create new employee with admin password setting
router.post('/employees', authenticateToken, authorizeRoles(['admin', 'boss', 'hr']), async (req, res) => {
  try {
    const { full_name, email, phone, role, branch_id, salary, password, hire_date } = req.body;
    
    if (!full_name || !email || !role) {
      return res.status(400).json({ message: 'Full name, email, and role are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingEmployees = await airtableHelpers.find(
      TABLES.EMPLOYEES,
      `LOWER({email}) = "${normalizedEmail}"`
    );
    
    if (existingEmployees.length > 0) {
      return res.status(400).json({ message: 'Email already exists in the system' });
    }

    // Require password from user
    if (!password || !password.trim()) {
      return res.status(400).json({ message: 'Password is required when creating a new employee' });
    }
    
    if (password.trim().length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }
    
    const finalPassword = password.trim();
    
    const hashedPassword = await bcrypt.hash(finalPassword, 12);
    
    const employeeData = {
      full_name: full_name.trim(),
      email: normalizedEmail,
      role,
      password_hash: hashedPassword,
      is_active: true,
      hire_date: hire_date || new Date().toISOString().split('T')[0],
      mfa_enabled: false,
      password_set_by_admin: !!hashedPassword,
      temp_password: !hashedPassword,
      account_status: hashedPassword ? 'active' : 'pending_password'
    };
    
    if (phone && phone.trim()) employeeData.phone = phone.trim();
    if (branch_id && branch_id !== '' && branch_id !== null) {
      try {
        const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
        if (branch) employeeData.branch_id = [branch_id];
      } catch (branchError) {
        console.log('Branch not found, skipping branch assignment:', branch_id);
      }
    }
    if (salary && salary !== '' && salary !== null && !isNaN(salary)) {
      employeeData.salary = parseFloat(salary).toString();
    }
    
    if (role === 'logistics') {
      employeeData.driver_license = 'pending';
      employeeData.vehicle_assigned = false;
    }
    
    const employee = await airtableHelpers.create(TABLES.EMPLOYEES, employeeData);

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
    console.error('Create employee error:', error);
    res.status(500).json({ 
      message: 'Failed to create employee', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update employee with password management
router.put('/employees/:employeeId', authenticateToken, authorizeRoles(['admin', 'boss', 'hr']), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { full_name, email, phone, role, branch_id, salary, is_active, hire_date, new_password } = req.body;

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
      try {
        const branch = await airtableHelpers.findById(TABLES.BRANCHES, branch_id);
        if (branch) updateData.branch_id = [branch_id];
      } catch (branchError) {
        console.log('Branch not found, skipping branch update:', branch_id);
      }
    } else if (branch_id === null || branch_id === '') {
      updateData.branch_id = null;
    }
    if (salary !== undefined && salary !== null && salary !== '') {
      updateData.salary = salary.toString();
    }
    if (is_active !== undefined) updateData.is_active = is_active;
    if (hire_date !== undefined) updateData.hire_date = hire_date;

    // Admin password change
    if (new_password && new_password.trim() && ['admin', 'boss'].includes(req.user.role)) {
      const hashedPassword = await bcrypt.hash(new_password.trim(), 12);
      updateData.password_hash = hashedPassword;
      updateData.password_changed_at = new Date().toISOString();
      updateData.password_set_by_admin = true;
      updateData.temp_password = false;
    }

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
      hire_date: updatedEmployee.fields.hire_date || null,
      password_changed: !!new_password
    });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ 
      message: 'Failed to update employee',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Admin reset user password
router.post('/employees/:employeeId/reset-password', authenticateToken, authorizeRoles(['admin', 'boss']), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.trim().length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    const hashedPassword = await bcrypt.hash(new_password.trim(), 12);
    
    await airtableHelpers.update(TABLES.EMPLOYEES, employeeId, {
      password_hash: hashedPassword,
      password_changed_at: new Date().toISOString(),
      password_set_by_admin: true,
      temp_password: false
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Failed to reset password' });
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
router.post('/payroll/generate', async (req, res) => {
  try {
    const {
      period_start,
      period_end,
      employee_ids,
      deductions_percentage = 15 // Default 15% deductions
    } = req.body;

    console.log('Generating payroll:', { period_start, period_end, employee_ids, deductions_percentage });

    if (!period_start || !period_end) {
      return res.status(400).json({ message: 'Period start and end dates are required' });
    }

    let employees;
    if (employee_ids && employee_ids.length > 0) {
      // Generate for specific employees
      employees = await Promise.all(
        employee_ids.map(id => airtableHelpers.findById(TABLES.EMPLOYEES, id))
      );
      employees = employees.filter(emp => emp); // Remove null results
    } else {
      // Generate for all active employees with salary
      employees = await airtableHelpers.find(
        TABLES.EMPLOYEES,
        'AND({is_active} = TRUE(), {salary} != BLANK())'
      );
    }

    console.log(`Found ${employees.length} employees for payroll generation`);

    const payrollRecords = [];
    for (const employee of employees) {
      try {
        const grossSalary = parseFloat(employee.salary || '0');
        if (grossSalary <= 0) {
          console.log(`Skipping employee ${employee.full_name} - no salary set`);
          continue;
        }

        const deductionAmount = grossSalary * (deductions_percentage / 100);
        const netSalary = grossSalary - deductionAmount;

        const payrollData = {
          employee_id: [employee.id], // Airtable link field format
          employee_name: employee.full_name,
          employee_email: employee.email,
          employee_phone: employee.phone || '',
          period_start,
          period_end,
          gross_salary: grossSalary.toString(),
          deductions: deductionAmount.toString(),
          net_salary: netSalary.toString(),
          payment_status: 'pending',
          payslip_sent: false,
          generated_by: req.user?.id || 'system',
          created_at: new Date().toISOString()
        };

        console.log(`Creating payroll for ${employee.full_name}:`, payrollData);
        const record = await airtableHelpers.create(TABLES.PAYROLL, payrollData);
        payrollRecords.push(record);
      } catch (empError) {
        console.error(`Error creating payroll for employee ${employee.full_name}:`, empError);
      }
    }

    res.status(201).json({
      message: 'Payroll generated successfully',
      records: payrollRecords.length,
      total_employees: employees.length
    });
  } catch (error) {
    console.error('Generate payroll error:', error);
    res.status(500).json({ 
      message: 'Failed to generate payroll',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get payroll records
router.get('/payroll', async (req, res) => {
  try {
    const { period_start, period_end, employee_id, status } = req.query;
    
    console.log('Fetching payroll with filters:', { period_start, period_end, employee_id, status });
    
    let filterFormula = '';
    const filters = [];
    
    if (period_start && period_end) {
      filters.push(`AND(IS_AFTER({period_start}, "${period_start}"), IS_BEFORE({period_end}, "${period_end}"))`);
    }
    if (employee_id) {
      // Handle both direct ID and array format
      filters.push(`FIND("${employee_id}", ARRAYJOIN({employee_id})) > 0`);
    }
    if (status) filters.push(`{payment_status} = "${status}"`);
    
    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }

    console.log('Using filter formula:', filterFormula);
    const payrollRecords = await airtableHelpers.find(TABLES.PAYROLL, filterFormula);
    console.log(`Found ${payrollRecords.length} payroll records`);
    
    // Clean and format payroll records
    const cleanPayroll = payrollRecords.map(record => {
      return {
        id: record.id,
        employee_id: record.employee_id,
        employee_name: record.employee_name || 'Unknown Employee',
        employee_email: record.employee_email || '',
        period_start: record.period_start,
        period_end: record.period_end,
        gross_salary: record.gross_salary || '0',
        deductions: record.deductions || '0',
        net_salary: record.net_salary || '0',
        payment_status: record.payment_status || 'pending',
        payslip_sent: record.payslip_sent || false,
        payslip_sent_date: record.payslip_sent_date || null,
        created_at: record.created_at || new Date().toISOString(),
        generated_by: record.generated_by || 'system'
      };
    });

    res.json(cleanPayroll);
  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch payroll records',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Mark payroll as paid
router.patch('/payroll/:payrollId/paid', async (req, res) => {
  try {
    const { payrollId } = req.params;

    console.log('Marking payroll as paid:', payrollId);

    const updatedPayroll = await airtableHelpers.update(TABLES.PAYROLL, payrollId, {
      payment_status: 'paid',
      payment_date: new Date().toISOString()
    });

    res.json({
      id: updatedPayroll.id,
      payment_status: updatedPayroll.fields.payment_status,
      payment_date: updatedPayroll.fields.payment_date,
      message: 'Payroll marked as paid successfully'
    });
  } catch (error) {
    console.error('Mark payroll paid error:', error);
    res.status(500).json({ 
      message: 'Failed to mark payroll as paid',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Bulk update payroll status
router.patch('/payroll/bulk-update', async (req, res) => {
  try {
    const { payroll_ids, status, payment_date } = req.body;

    console.log('Bulk updating payroll:', { payroll_ids, status, payment_date });

    if (!payroll_ids || payroll_ids.length === 0) {
      return res.status(400).json({ message: 'Payroll IDs are required' });
    }

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const updateData = {
      payment_status: status
    };

    if (payment_date) {
      updateData.payment_date = payment_date;
    } else if (status === 'paid') {
      updateData.payment_date = new Date().toISOString();
    }

    let successCount = 0;
    const errors = [];

    for (const id of payroll_ids) {
      try {
        await airtableHelpers.update(TABLES.PAYROLL, id, updateData);
        successCount++;
      } catch (updateError) {
        console.error(`Error updating payroll ${id}:`, updateError);
        errors.push({ id, error: updateError.message });
      }
    }

    res.json({
      message: `Successfully updated ${successCount} payroll records`,
      updated_count: successCount,
      total_requested: payroll_ids.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Bulk update payroll error:', error);
    res.status(500).json({ 
      message: 'Failed to bulk update payroll',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Send payslips via WhatsApp with enhanced validation
router.post('/payroll/send-payslips', authenticateToken, authorizeRoles(['hr', 'boss']), async (req, res) => {
  try {
    const { payroll_ids } = req.body;

    if (!payroll_ids || payroll_ids.length === 0) {
      return res.status(400).json({ message: 'Payroll IDs are required' });
    }

    const results = [];

    console.log(`Processing ${payroll_ids.length} payslips for WhatsApp sending`);

    for (const payrollId of payroll_ids) {
      try {
        const payroll = await airtableHelpers.findById(TABLES.PAYROLL, payrollId);
        if (!payroll) {
          results.push({ payrollId, status: 'error', message: 'Payroll record not found' });
          continue;
        }

        const employeeId = Array.isArray(payroll.employee_id) ? payroll.employee_id[0] : payroll.employee_id;
        const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, employeeId);
        
        if (!employee) {
          results.push({ payrollId, status: 'error', message: 'Employee not found' });
          continue;
        }

        // Validate phone number
        if (!employee.phone || employee.phone.trim() === '') {
          results.push({ 
            payrollId, 
            status: 'error', 
            message: `Employee ${employee.full_name} has no phone number` 
          });
          continue;
        }

        // Clean and validate phone number format
        const cleanPhone = employee.phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
          results.push({ 
            payrollId, 
            status: 'error', 
            message: `Invalid phone number for ${employee.full_name}: ${employee.phone}` 
          });
          continue;
        }

        // Generate payslip PDF
        const payslipBuffer = await payslipGenerator.generatePayslip(employee, payroll);
        const fileName = `Payslip_${employee.full_name.replace(/\s+/g, '_')}_${payroll.period_start}_${payroll.period_end}.pdf`;

        console.log(`Sending payslip to ${employee.full_name} at ${employee.phone}`);

        // Send via WhatsApp
          employee.phone,
          employee.full_name,
          payslipBuffer,
          fileName
        );

          // Update payroll record
          await airtableHelpers.update(TABLES.PAYROLL, payrollId, {
            payslip_sent: true,
            payslip_sent_date: new Date().toISOString(),
          });
          
          results.push({ 
            payrollId, 
            status: 'success', 
            message: `Payslip sent to ${employee.full_name} via WhatsApp`,
            employee_name: employee.full_name,
            phone: employee.phone
          });
        } else {
          results.push({ 
            payrollId, 
            status: 'error', 
            employee_name: employee.full_name,
            phone: employee.phone
          });
        }
      } catch (error) {
        console.error(`Error processing payroll ${payrollId}:`, error);
        results.push({ 
          payrollId, 
          status: 'error', 
          message: `Processing error: ${error.message}` 
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    console.log(`WhatsApp payslip sending completed: ${successCount} sent, ${errorCount} failed`);
    
    res.json({
      message: `Payslip sending completed: ${successCount} sent via WhatsApp, ${errorCount} failed`,
      results,
      summary: { 
        success: successCount, 
        errors: errorCount,
        total: results.length
      }
    });
  } catch (error) {
    console.error('Send payslips error:', error);
    res.status(500).json({ 
      message: 'Failed to send payslips via WhatsApp',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update employee compensation
router.put('/employees/:employeeId/compensation', authenticateToken, authorizeRoles(['hr', 'boss']), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { salary, bonus_eligible, kpi_targets } = req.body;

    const updateData = {};
    if (salary !== undefined) updateData.salary = parseFloat(salary).toString();
    if (bonus_eligible !== undefined) updateData.bonus_eligible = bonus_eligible;
    if (kpi_targets !== undefined) updateData.kpi_targets = JSON.stringify(kpi_targets);
    
    const employee = await airtableHelpers.update(TABLES.EMPLOYEES, employeeId, updateData);
    res.json({ message: 'Compensation updated successfully', employee });
  } catch (error) {
    console.error('Update compensation error:', error);
    res.status(500).json({ message: 'Failed to update compensation' });
  }
});

// Generate payroll with bonuses and deductions
router.post('/payroll/generate-advanced', authenticateToken, authorizeRoles(['hr', 'boss']), async (req, res) => {
  try {
    const { employee_ids, period_start, period_end, salary_adjustments = {} } = req.body;

    if (!employee_ids || !period_start || !period_end) {
      return res.status(400).json({ message: 'Employee IDs, period start, and period end are required' });
    }

    const payrollRecords = [];
    for (const employeeId of employee_ids) {
      const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, employeeId);
      if (!employee || !employee.is_active) continue;

      const adjustments = salary_adjustments[employeeId] || {};
      const baseSalary = parseFloat(employee.salary) || 0;
      const bonuses = parseFloat(adjustments.bonuses) || 0;
      const kpiBonus = parseFloat(adjustments.kpi_bonus) || 0;
      const additionalDeductions = parseFloat(adjustments.additional_deductions) || 0;
      
      const grossSalary = baseSalary + bonuses + kpiBonus;
      const standardDeductions = grossSalary * 0.15;
      const totalDeductions = standardDeductions + additionalDeductions;
      const netSalary = grossSalary - totalDeductions;

      const payrollData = {
        employee_id: [employeeId],
        employee_name: employee.full_name,
        employee_email: employee.email,
        employee_phone: employee.phone || '',
        period_start,
        period_end,
        base_salary: baseSalary.toString(),
        bonuses: bonuses.toString(),
        kpi_bonus: kpiBonus.toString(),
        gross_salary: grossSalary.toString(),
        deductions: standardDeductions.toString(),
        additional_deductions: additionalDeductions.toString(),
        net_salary: netSalary.toString(),
        payment_status: 'pending',
        payslip_sent: false,
        created_at: new Date().toISOString()
      };

      const payroll = await airtableHelpers.create(TABLES.PAYROLL, payrollData);
      payrollRecords.push(payroll);
    }

    res.status(201).json({
      message: `Generated payroll for ${payrollRecords.length} employees`,
      payroll: payrollRecords
    });
  } catch (error) {
    console.error('Generate advanced payroll error:', error);
    res.status(500).json({ message: 'Failed to generate payroll' });
  }
});

// Get driver statistics for logistics integration
router.get('/drivers/stats', authenticateToken, async (req, res) => {
  try {
    const drivers = await airtableHelpers.find(
      TABLES.EMPLOYEES,
      '{role} = "logistics"'
    );

    const stats = {
      total_drivers: drivers.length,
      active_drivers: drivers.filter(d => d.is_active).length,
      inactive_drivers: drivers.filter(d => !d.is_active).length,
      licensed_drivers: drivers.filter(d => d.driver_license && d.driver_license !== 'pending').length,
      assigned_drivers: drivers.filter(d => d.vehicle_assigned).length
    };

    res.json({
      stats,
      drivers: drivers.map(d => ({
        id: d.id,
        full_name: d.full_name,
        email: d.email,
        phone: d.phone,
        is_active: d.is_active,
        driver_license: d.driver_license,
        vehicle_assigned: d.vehicle_assigned,
        hire_date: d.hire_date,
        salary: d.salary
      }))
    });
  } catch (error) {
    console.error('Get driver stats error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch driver statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Generate individual payslip PDF
router.get('/payroll/:payrollId/payslip', authenticateToken, authorizeRoles(['hr', 'boss']), async (req, res) => {
  try {
    const { payrollId } = req.params;
    
    const payroll = await airtableHelpers.findById(TABLES.PAYROLL, payrollId);
    if (!payroll) {
      return res.status(404).json({ message: 'Payroll record not found' });
    }

    const employee = await airtableHelpers.findById(TABLES.EMPLOYEES, payroll.employee_id[0]);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const payslipBuffer = await payslipGenerator.generatePayslip(employee, payroll);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Payslip_${employee.full_name.replace(/\s+/g, '_')}.pdf"`);
    res.send(payslipBuffer);
  } catch (error) {
    console.error('Generate payslip error:', error);
    res.status(500).json({ message: 'Failed to generate payslip' });
  }
});

module.exports = router;
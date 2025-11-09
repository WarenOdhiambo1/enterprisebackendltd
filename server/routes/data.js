const express = require('express');
const { TABLES } = require('../config/airtable');

// Direct Airtable helper functions
const directAirtableHelpers = {
  async find(tableName, filterFormula, sort) {
    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const selectOptions = {};
    if (filterFormula && typeof filterFormula === 'string' && filterFormula.trim()) {
      selectOptions.filterByFormula = filterFormula;
    }
    if (sort && Array.isArray(sort) && sort.length > 0) {
      selectOptions.sort = sort;
    }
    
    const records = await base(tableName).select(selectOptions).all();
    return records.map(record => ({
      id: record.id,
      ...record.fields
    }));
  },
  
  async create(tableName, fields) {
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    const records = await base(tableName).create([{ fields }]);
    return { id: records[0].id, ...records[0].fields };
  },
  
  async update(tableName, recordId, fields) {
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    const records = await base(tableName).update([{ id: recordId, fields }]);
    return { id: records[0].id, ...records[0].fields };
  },
  
  async delete(tableName, recordId) {
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    await base(tableName).destroy([recordId]);
    return { id: recordId, deleted: true };
  },
  
  async findById(tableName, recordId) {
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    const record = await base(tableName).find(recordId);
    return { id: record.id, ...record.fields };
  }
};
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all data for a specific table
router.get('/:tableName', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { filter, sort, limit } = req.query;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Apply branch filtering for non-boss users
    let filterFormula = filter || '';
    if (req.user.role !== 'boss' && req.user.branchId) {
      const branchFilter = `{branch_id} = '${req.user.branchId}'`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${branchFilter})` : branchFilter;
    }

    // Safely parse sort options
    let sortOptions;
    try {
      sortOptions = sort ? JSON.parse(sort) : [{ field: 'created_at', direction: 'desc' }];
      // Validate sort structure
      if (!Array.isArray(sortOptions)) {
        sortOptions = [{ field: 'created_at', direction: 'desc' }];
      }
    } catch (parseError) {
      console.warn('Invalid sort parameter:', sort);
      sortOptions = [{ field: 'created_at', direction: 'desc' }];
    }
    const records = await directAirtableHelpers.find(tableName, filterFormula, sortOptions);
    
    // Apply limit if specified
    const limitedRecords = limit ? records.slice(0, parseInt(limit)) : records;
    
    res.json(limitedRecords);
  } catch (error) {
    console.error(`Error fetching ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to fetch data', error: error.message });
  }
});

// Create new record
router.post('/:tableName', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const data = req.body;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Add audit fields
    const recordData = {
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: req.user.userId
    };

    // Add branch_id for branch-specific tables
    const branchSpecificTables = [TABLES.STOCK, TABLES.SALES, TABLES.EXPENSES, TABLES.EMPLOYEES];
    if (branchSpecificTables.includes(tableName) && req.user.branchId && !recordData.branch_id) {
      recordData.branch_id = req.user.branchId;
    }

    const record = await directAirtableHelpers.create(tableName, recordData);
    res.status(201).json(record);
  } catch (error) {
    console.error(`Error creating ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to create record', error: error.message });
  }
});

// Update record
router.put('/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    const data = req.body;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Add audit fields
    const updateData = {
      ...data,
      updated_at: new Date().toISOString(),
      updated_by: req.user.userId
    };

    const record = await directAirtableHelpers.update(tableName, recordId, updateData);
    res.json(record);
  } catch (error) {
    console.error(`Error updating ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to update record', error: error.message });
  }
});

// Delete record
router.delete('/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    await airtableHelpers.delete(tableName, recordId);
    res.json({ message: 'Record deleted successfully' });
  } catch (error) {
    console.error(`Error deleting ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to delete record', error: error.message });
  }
});

// Get record by ID
router.get('/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    const record = await directAirtableHelpers.findById(tableName, recordId);
    res.json(record);
  } catch (error) {
    console.error(`Error fetching ${req.params.tableName} record:`, error);
    res.status(500).json({ message: 'Failed to fetch record', error: error.message });
  }
});

// Bulk operations
router.post('/:tableName/bulk', authenticateToken, authorizeRoles(['boss', 'admin']), async (req, res) => {
  try {
    const { tableName } = req.params;
    const { operation, records } = req.body;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    const results = [];
    
    switch (operation) {
      case 'create':
        for (const recordData of records) {
          const record = await airtableHelpers.create(tableName, {
            ...recordData,
            created_at: new Date().toISOString(),
            created_by: req.user.userId
          });
          results.push(record);
        }
        break;
        
      case 'update':
        for (const { id, data } of records) {
          const record = await airtableHelpers.update(tableName, id, {
            ...data,
            updated_at: new Date().toISOString(),
            updated_by: req.user.userId
          });
          results.push(record);
        }
        break;
        
      case 'delete':
        for (const recordId of records) {
          await airtableHelpers.delete(tableName, recordId);
          results.push({ id: recordId, deleted: true });
        }
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid operation' });
    }
    
    res.json({ results, count: results.length });
  } catch (error) {
    console.error(`Error in bulk ${req.body.operation} for ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Bulk operation failed', error: error.message });
  }
});

// Get page-specific data with branch filtering
router.get('/page/:pageName', authenticateToken, async (req, res) => {
  try {
    const { pageName } = req.params;
    const { branchId } = req.query;
    
    // Determine which branch to filter by
    let filterBranchId = branchId;
    if (!filterBranchId && req.user.role !== 'boss' && req.user.role !== 'manager') {
      filterBranchId = req.user.branchId;
    }
    
    switch (pageName) {
      case 'hr':
        // Fetch HR-related data
        const employees = await directAirtableHelpers.find(TABLES.EMPLOYEES).catch(() => []);
        const payroll = await directAirtableHelpers.find(TABLES.PAYROLL).catch(() => []);
        const hrBranches = await directAirtableHelpers.find(TABLES.BRANCHES).catch(() => []);
        
        // Clean and format data
        const cleanEmployees = employees.map(emp => ({
          id: emp.id,
          full_name: emp.full_name || '',
          email: emp.email || '',
          phone: emp.phone || '',
          role: emp.role || '',
          branch_id: Array.isArray(emp.branch_id) ? emp.branch_id[0] : emp.branch_id,
          is_active: emp.is_active !== false,
          hire_date: emp.hire_date || '',
          salary: emp.salary || 0,
          driver_license: emp.driver_license || null,
          vehicle_assigned: emp.vehicle_assigned || false
        }));
        
        const cleanPayroll = payroll.map(p => ({
          id: p.id,
          employee_id: Array.isArray(p.employee_id) ? p.employee_id[0] : p.employee_id,
          employee_name: p.employee_name || '',
          employee_email: p.employee_email || '',
          period_start: p.period_start || '',
          period_end: p.period_end || '',
          gross_salary: p.gross_salary || '0',
          deductions: p.deductions || '0',
          net_salary: p.net_salary || '0',
          payment_status: p.payment_status || 'pending',
          payslip_sent: p.payslip_sent || false,
          payslip_sent_date: p.payslip_sent_date || null,
          created_at: p.created_at || new Date().toISOString(),
          generated_by: p.generated_by || 'system'
        }));
        
        const cleanBranches = hrBranches.map(b => ({
          id: b.id,
          branch_name: b.branch_name || '',
          location_address: b.location_address || '',
          manager_id: Array.isArray(b.manager_id) ? b.manager_id[0] : b.manager_id,
          phone: b.phone || '',
          email: b.email || ''
        }));
        
        res.json({
          employees: cleanEmployees,
          payroll: cleanPayroll,
          branches: cleanBranches
        });
        break;
        
      case 'logistics':
        // Existing logistics data logic
        const vehicles = await directAirtableHelpers.find(TABLES.VEHICLES).catch(() => []);
        const trips = await directAirtableHelpers.find(TABLES.TRIPS).catch(() => []);
        const maintenance = await directAirtableHelpers.find(TABLES.VEHICLE_MAINTENANCE).catch(() => []);
        
        res.json({
          vehicles: vehicles || [],
          trips: trips || [],
          maintenance: maintenance || []
        });
        break;
        
      case 'admin':
        // Admin page data with branch filtering
        let employeeFilter = '';
        let productFilter = '';
        
        if (filterBranchId) {
          employeeFilter = `{branch_id} = '${filterBranchId}'`;
          productFilter = `{branch_id} = '${filterBranchId}'`;
        }
        
        const adminEmployees = await airtableHelpers.find(TABLES.EMPLOYEES, employeeFilter).catch(() => []);
        const adminBranches = await airtableHelpers.find(TABLES.BRANCHES).catch(() => []);
        const products = await airtableHelpers.find(TABLES.STOCK, productFilter).catch(() => []);
        
        res.json({
          employees: adminEmployees || [],
          branches: adminBranches || [],
          products: products || [],
          selectedBranchId: filterBranchId
        });
        break;
        
      case 'sales':
        // Sales page data with branch filtering
        let stockFilter = '';
        let salesFilter = '';
        let expensesFilter = '';
        
        if (filterBranchId) {
          stockFilter = `FIND('${filterBranchId}', ARRAYJOIN({branch_id}))`;
          salesFilter = `FIND('${filterBranchId}', ARRAYJOIN({branch_id}))`;
          expensesFilter = `FIND('${filterBranchId}', ARRAYJOIN({branch_id}))`;
        }
        
        const stock = await airtableHelpers.find(TABLES.STOCK, stockFilter).catch(() => []);
        const sales = await airtableHelpers.find(TABLES.SALES, salesFilter).catch(() => []);
        const saleItems = await airtableHelpers.find(TABLES.SALE_ITEMS).catch(() => []);
        const expenses = await airtableHelpers.find(TABLES.EXPENSES, expensesFilter).catch(() => []);
        const salesBranches = await airtableHelpers.find(TABLES.BRANCHES).catch(() => []);
        
        // Clean and format stock data
        const cleanStock = stock.map(item => ({
          id: item.id,
          product_id: item.product_id || item.id,
          product_name: item.product_name || 'Unknown Product',
          quantity_available: parseInt(item.quantity_available) || 0,
          unit_price: parseFloat(item.unit_price) || 0,
          reorder_level: parseInt(item.reorder_level) || 10,
          branch_id: Array.isArray(item.branch_id) ? item.branch_id[0] : item.branch_id
        }));
        
        // Clean and format sales data
        const cleanSales = sales.map(sale => ({
          id: sale.id,
          total_amount: parseFloat(sale.total_amount) || 0,
          payment_method: sale.payment_method || 'cash',
          customer_name: sale.customer_name || '',
          sale_date: sale.sale_date || sale.created_at,
          created_at: sale.created_at || new Date().toISOString(),
          branch_id: Array.isArray(sale.branch_id) ? sale.branch_id[0] : sale.branch_id
        }));
        
        // Clean branches data
        const cleanSalesBranches = salesBranches.map(b => ({
          id: b.id,
          branch_name: b.branch_name || '',
          location_address: b.location_address || ''
        }));
        
        res.json({
          stock: cleanStock,
          sales: cleanSales,
          saleItems: saleItems || [],
          expenses: expenses || [],
          branches: cleanSalesBranches,
          selectedBranchId: filterBranchId
        });
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid page name' });
    }
  } catch (error) {
    console.error(`Error fetching ${req.params.pageName} page data:`, error);
    res.status(500).json({ message: 'Failed to fetch page data', error: error.message });
  }
});

// Get all logistics data for management (no branch filtering)
router.get('/logistics/all-data', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), async (req, res) => {
  try {
    // Fetch all logistics-related data with error handling
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES).catch(() => []);
    const trips = await airtableHelpers.find(TABLES.TRIPS).catch(() => []);
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE).catch(() => []);
    const expenses = await airtableHelpers.find(TABLES.EXPENSES).catch(() => []);

    // Calculate comprehensive statistics
    const totalProfit = trips.reduce((sum, t) => sum + ((parseFloat(t.amount_charged) || 0) - (parseFloat(t.fuel_cost) || 0)), 0);
    const stats = {
      totalVehicles: vehicles.length,
      activeVehicles: vehicles.filter(v => v.status === 'active' || !v.status).length,
      totalTrips: trips.length,
      totalRevenue: trips.reduce((sum, t) => sum + (parseFloat(t.amount_charged) || 0), 0),
      totalFuelCost: trips.reduce((sum, t) => sum + (parseFloat(t.fuel_cost) || 0), 0),
      totalProfit,
      totalDistance: trips.reduce((sum, t) => sum + (parseFloat(t.distance_km) || 0), 0),
      maintenanceCost: maintenance.reduce((sum, m) => sum + (parseFloat(m.cost) || 0), 0),
      avgProfitPerTrip: trips.length > 0 ? totalProfit / trips.length : 0
    };

    // Vehicle performance analysis
    const vehiclePerformance = vehicles.map(vehicle => {
      const vehicleTrips = trips.filter(t => t.vehicle_plate_number === vehicle.plate_number);
      const vehicleMaintenance = maintenance.filter(m => m.vehicle_plate_number === vehicle.plate_number);
      
      return {
        ...vehicle,
        tripCount: vehicleTrips.length,
        totalRevenue: vehicleTrips.reduce((sum, t) => sum + (parseFloat(t.amount_charged) || 0), 0),
        totalProfit: vehicleTrips.reduce((sum, t) => sum + ((parseFloat(t.amount_charged) || 0) - (parseFloat(t.fuel_cost) || 0)), 0),
        totalDistance: vehicleTrips.reduce((sum, t) => sum + (parseFloat(t.distance_km) || 0), 0),
        maintenanceCost: vehicleMaintenance.reduce((sum, m) => sum + (parseFloat(m.cost) || 0), 0),
        lastTripDate: vehicleTrips.length > 0 ? new Date(Math.max(...vehicleTrips.map(t => new Date(t.trip_date).getTime()))).toISOString() : null,
        lastMaintenanceDate: vehicleMaintenance.length > 0 ? new Date(Math.max(...vehicleMaintenance.map(m => new Date(m.maintenance_date).getTime()))).toISOString() : null
      };
    });

    res.json({
      vehicles,
      trips: trips.sort((a, b) => new Date(b.trip_date || 0) - new Date(a.trip_date || 0)),
      maintenance: maintenance.sort((a, b) => new Date(b.maintenance_date || 0) - new Date(a.maintenance_date || 0)),
      expenses: expenses.sort((a, b) => new Date(b.expense_date || 0) - new Date(a.expense_date || 0)),
      stats,
      vehiclePerformance
    });
  } catch (error) {
    console.error('Error fetching logistics data:', error);
    res.status(500).json({ message: 'Failed to fetch logistics data', error: error.message });
  }
});

// Get comprehensive dashboard data
router.get('/dashboard/overview', authenticateToken, async (req, res) => {
  try {
    // Fetch all necessary data for dashboard
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES).catch(() => []);
    const sales = await airtableHelpers.find(TABLES.SALES).catch(() => []);
    const stock = await airtableHelpers.find(TABLES.STOCK).catch(() => []);
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES).catch(() => []);
    const trips = await airtableHelpers.find(TABLES.TRIPS).catch(() => []);
    const payroll = await airtableHelpers.find(TABLES.PAYROLL).catch(() => []);
    
    // Calculate key metrics
    const totalEmployees = employees.length;
    const activeEmployees = employees.filter(emp => emp.is_active).length;
    const totalDrivers = employees.filter(emp => emp.role === 'logistics').length;
    const activeDrivers = employees.filter(emp => emp.role === 'logistics' && emp.is_active).length;
    
    const totalSales = sales.reduce((sum, sale) => sum + (parseFloat(sale.total_amount) || 0), 0);
    const totalVehicles = vehicles.length;
    const totalTrips = trips.length;
    const totalRevenue = trips.reduce((sum, trip) => sum + (parseFloat(trip.amount_charged) || 0), 0);
    
    const pendingPayroll = payroll.filter(p => p.payment_status === 'pending').length;
    const totalSalaryExpense = employees
      .filter(emp => emp.is_active && emp.salary)
      .reduce((sum, emp) => sum + parseFloat(emp.salary || 0), 0);
    
    res.json({
      employees: {
        total: totalEmployees,
        active: activeEmployees,
        drivers: totalDrivers,
        activeDrivers: activeDrivers
      },
      sales: {
        total: totalSales,
        count: sales.length
      },
      logistics: {
        vehicles: totalVehicles,
        trips: totalTrips,
        revenue: totalRevenue
      },
      hr: {
        pendingPayroll: pendingPayroll,
        salaryExpense: totalSalaryExpense
      },
      stock: {
        totalItems: stock.length,
        lowStock: stock.filter(item => (parseFloat(item.quantity) || 0) < 10).length
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard overview:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data', error: error.message });
  }
});

module.exports = router;
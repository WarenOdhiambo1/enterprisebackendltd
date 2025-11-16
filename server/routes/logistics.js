const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');

// CSRF protection middleware (disabled for now)
const csrfProtection = (req, res, next) => {
  // Disable CSRF protection to fix form submission issues
  return next();
};

const router = express.Router();

// Get all vehicles
router.get('/vehicles', authenticateToken, async (req, res) => {
  try {
    const { status, type, branch } = req.query;
    let vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    
    // Filter by status
    if (status) {
      vehicles = vehicles.filter(v => v.status === status);
    }
    
    // Filter by type
    if (type) {
      vehicles = vehicles.filter(v => v.vehicle_type === type);
    }
    
    // Filter by branch
    if (branch) {
      vehicles = vehicles.filter(v => 
        v.current_branch_id && v.current_branch_id.includes(branch)
      );
    }
    
    res.json(vehicles);
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
  }
});

// Get vehicle by ID
router.get('/vehicles/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, id);
    res.json(vehicle);
  } catch (error) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle' });
  }
});

// Create new vehicle
router.post('/vehicles', authenticateToken, auditLog('CREATE_VEHICLE'), async (req, res) => {
  try {
    const { plate_number, vehicle_type, purchase_date, current_branch_id } = req.body;

    if (!plate_number || !vehicle_type) {
      return res.status(400).json({ message: 'Plate number and vehicle type are required' });
    }

    const vehicleData = {
      plate_number,
      vehicle_type,
      purchase_date: purchase_date || new Date().toISOString().split('T')[0],
      status: 'active'
    };

    // Only add current_branch_id if provided
    if (current_branch_id && current_branch_id !== '') {
      vehicleData.current_branch_id = [current_branch_id]; // Airtable link field format
    }

    const vehicle = await airtableHelpers.create(TABLES.VEHICLES, vehicleData);

    res.status(201).json(vehicle);
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ message: 'Failed to create vehicle' });
  }
});

// Update vehicle
router.put('/vehicles/:id', authenticateToken, auditLog('UPDATE_VEHICLE'), async (req, res) => {
  try {
    const { id } = req.params;
    const { plate_number, vehicle_type, purchase_date, current_branch_id } = req.body;

    const vehicleData = {
      plate_number,
      vehicle_type,
      purchase_date,
      status: 'active'
    };

    if (current_branch_id && current_branch_id !== '') {
      vehicleData.current_branch_id = [current_branch_id];
    }

    const vehicle = await airtableHelpers.update(TABLES.VEHICLES, id, vehicleData);
    res.json(vehicle);
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ message: 'Failed to update vehicle' });
  }
});

// Delete vehicle
router.delete('/vehicles/:id', authenticateToken, auditLog('DELETE_VEHICLE'), async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.VEHICLES, id);
    res.json({ message: 'Vehicle deleted successfully' });
  } catch (error) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ message: 'Failed to delete vehicle' });
  }
});

// Get trips
router.get('/trips', authenticateToken, async (req, res) => {
  try {
    const { vehicleId, startDate, endDate, driver, destination } = req.query;
    
    // Get all trips and filter with JavaScript
    const allTrips = await airtableHelpers.find(TABLES.TRIPS);
    let trips = allTrips;
    
    if (vehicleId) {
      trips = trips.filter(trip => 
        trip.vehicle_id && trip.vehicle_id.includes(vehicleId)
      );
    }
    
    if (driver) {
      trips = trips.filter(trip => 
        trip.driver_id && trip.driver_id.includes(driver)
      );
    }
    
    if (destination) {
      trips = trips.filter(trip => 
        trip.destination && trip.destination.toLowerCase().includes(destination.toLowerCase())
      );
    }
    
    if (startDate && endDate) {
      trips = trips.filter(trip => {
        if (!trip.trip_date) return false;
        const tripDate = new Date(trip.trip_date);
        return tripDate >= new Date(startDate) && tripDate <= new Date(endDate);
      });
    }

    res.json(trips);
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ message: 'Failed to fetch trips' });
  }
});

// Get trip by ID
router.get('/trips/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const trip = await airtableHelpers.findById(TABLES.TRIPS, id);
    res.json(trip);
  } catch (error) {
    console.error('Get trip error:', error);
    res.status(500).json({ message: 'Failed to fetch trip' });
  }
});

// Create new trip
router.post('/trips', authenticateToken, auditLog('CREATE_TRIP'), async (req, res) => {
  try {
    const {
      vehicle_id,
      destination,
      trip_date,
      distance_km,
      fuel_cost,
      amount_charged,
      driver_id
    } = req.body;

    console.log('Creating trip with data:', req.body);

    if (!vehicle_id || !destination || !trip_date) {
      return res.status(400).json({ message: 'Vehicle, destination, and trip date are required' });
    }

    const profit = (amount_charged || 0) - (fuel_cost || 0);

    const tripData = {
      vehicle_id: [vehicle_id], // Airtable link field format
      destination,
      trip_date,
      distance_km: parseFloat(distance_km) || 0,
      fuel_cost: parseFloat(fuel_cost) || 0,
      amount_charged: parseFloat(amount_charged) || 0,
      profit,
      created_at: new Date().toISOString()
    };

    // Only add driver_id if it's provided and not empty
    if (driver_id && driver_id !== '') {
      tripData.driver_id = [driver_id]; // Airtable link field format
    }

    console.log('Creating trip with processed data:', tripData);
    const trip = await airtableHelpers.create(TABLES.TRIPS, tripData);

    res.status(201).json(trip);
  } catch (error) {
    console.error('Create trip error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Failed to create trip', error: error.message });
  }
});

// Get all maintenance records
router.get('/maintenance', authenticateToken, async (req, res) => {
  try {
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    console.log(`Fetched ${maintenance.length} maintenance records for user role: ${req.user.role}`);
    res.json(maintenance);
  } catch (error) {
    console.error('Get all maintenance error:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance records' });
  }
});

// Get vehicle maintenance records
router.get('/maintenance/:vehicleId', authenticateToken, async (req, res) => {
  try {
    const { vehicleId } = req.params;

    const maintenance = await airtableHelpers.find(
      TABLES.VEHICLE_MAINTENANCE,
      `{vehicle_id} = "${vehicleId}"`
    );

    res.json(maintenance);
  } catch (error) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance records' });
  }
});

// Create maintenance record
router.post('/maintenance', authenticateToken, auditLog('CREATE_MAINTENANCE'), async (req, res) => {
  try {
    const {
      vehicle_id,
      maintenance_date,
      maintenance_type,
      cost,
      description,
      next_service_date
    } = req.body;

    if (!vehicle_id || !maintenance_date || !maintenance_type) {
      return res.status(400).json({ message: 'Vehicle, date, and maintenance type are required' });
    }

    const maintenanceData = {
      vehicle_id: [vehicle_id], // Airtable link field format
      maintenance_date,
      maintenance_type,
      cost: parseFloat(cost) || 0,
      recorded_by: [req.user.id] // Airtable link field format
    };

    if (description) maintenanceData.description = description;
    if (next_service_date) maintenanceData.next_service_date = next_service_date;

    const maintenance = await airtableHelpers.create(TABLES.VEHICLE_MAINTENANCE, maintenanceData);

    res.status(201).json(maintenance);
  } catch (error) {
    console.error('Create maintenance error:', error);
    res.status(500).json({ message: 'Failed to create maintenance record' });
  }
});

// Get maintenance by ID
router.get('/maintenance/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const maintenance = await airtableHelpers.findById(TABLES.VEHICLE_MAINTENANCE, id);
    res.json(maintenance);
  } catch (error) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance record' });
  }
});

// Update maintenance record
router.put('/maintenance/:id', authenticateToken, auditLog('UPDATE_MAINTENANCE'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      vehicle_id,
      maintenance_date,
      maintenance_type,
      cost,
      description,
      next_service_date
    } = req.body;

    const maintenanceData = {
      vehicle_id: [vehicle_id],
      maintenance_date,
      maintenance_type,
      cost: parseFloat(cost) || 0,
      description,
      next_service_date,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };

    const maintenance = await airtableHelpers.update(TABLES.VEHICLE_MAINTENANCE, id, maintenanceData);
    res.json(maintenance);
  } catch (error) {
    console.error('Update maintenance error:', error);
    res.status(500).json({ message: 'Failed to update maintenance record' });
  }
});

// Update trip
router.put('/trips/:id', authenticateToken, auditLog('UPDATE_TRIP'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      vehicle_id,
      destination,
      trip_date,
      distance_km,
      fuel_cost,
      amount_charged,
      driver_id
    } = req.body;

    const profit = (amount_charged || 0) - (fuel_cost || 0);

    const tripData = {
      vehicle_id: [vehicle_id],
      destination,
      trip_date,
      distance_km: parseFloat(distance_km) || 0,
      fuel_cost: parseFloat(fuel_cost) || 0,
      amount_charged: parseFloat(amount_charged) || 0,
      profit,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };

    if (driver_id && driver_id !== '') {
      tripData.driver_id = [driver_id];
    }

    const trip = await airtableHelpers.update(TABLES.TRIPS, id, tripData);
    res.json(trip);
  } catch (error) {
    console.error('Update trip error:', error);
    res.status(500).json({ message: 'Failed to update trip' });
  }
});

// Get dashboard data
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const [vehicles, trips, maintenance] = await Promise.all([
      airtableHelpers.find(TABLES.VEHICLES),
      airtableHelpers.find(TABLES.TRIPS),
      airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE)
    ]);

    const activeVehicles = vehicles.filter(v => v.status === 'active' || !v.status);
    const totalRevenue = trips.reduce((sum, trip) => sum + (parseFloat(trip.amount_charged) || 0), 0);
    const totalProfit = trips.reduce((sum, trip) => sum + ((parseFloat(trip.amount_charged) || 0) - (parseFloat(trip.fuel_cost) || 0)), 0);
    const maintenanceCost = maintenance.reduce((sum, m) => sum + (parseFloat(m.cost) || 0), 0);

    // Recent trips (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentTrips = trips.filter(trip => {
      if (!trip.trip_date) return false;
      return new Date(trip.trip_date) >= sevenDaysAgo;
    });

    // Maintenance alerts (upcoming services)
    const maintenanceAlerts = maintenance.filter(m => {
      if (!m.next_service_date) return false;
      const nextService = new Date(m.next_service_date);
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      return nextService <= thirtyDaysFromNow;
    });

    res.json({
      summary: {
        totalVehicles: vehicles.length,
        activeVehicles: activeVehicles.length,
        totalTrips: trips.length,
        recentTrips: recentTrips.length,
        totalRevenue,
        totalProfit,
        maintenanceCost,
        netProfit: totalProfit - maintenanceCost
      },
      recentTrips: recentTrips.slice(0, 5),
      maintenanceAlerts: maintenanceAlerts.slice(0, 5),
      fleetStatus: {
        active: activeVehicles.length,
        maintenance: vehicles.filter(v => v.status === 'maintenance').length,
        inactive: vehicles.filter(v => v.status === 'inactive').length
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data' });
  }
});

// Delete trip
router.delete('/trips/:id', authenticateToken, auditLog('DELETE_TRIP'), async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.TRIPS, id);
    res.json({ message: 'Trip deleted successfully' });
  } catch (error) {
    console.error('Delete trip error:', error);
    res.status(500).json({ message: 'Failed to delete trip' });
  }
});

// Delete maintenance record
router.delete('/maintenance/:id', authenticateToken, auditLog('DELETE_MAINTENANCE'), async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.VEHICLE_MAINTENANCE, id);
    res.json({ message: 'Maintenance record deleted successfully' });
  } catch (error) {
    console.error('Delete maintenance error:', error);
    res.status(500).json({ message: 'Failed to delete maintenance record' });
  }
});

// Vehicle Management Routes

// Get all vehicles
router.get('/vehicles', authenticateToken, async (req, res) => {
  try {
    const { branch_id, status, vehicle_type } = req.query;
    
    let vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    
    // Apply filters
    if (branch_id) {
      vehicles = vehicles.filter(vehicle => 
        vehicle.branch_id && vehicle.branch_id.includes(branch_id)
      );
    }
    
    if (status) {
      vehicles = vehicles.filter(vehicle => vehicle.status === status);
    }
    
    if (vehicle_type) {
      vehicles = vehicles.filter(vehicle => vehicle.vehicle_type === vehicle_type);
    }
    
    res.json(vehicles);
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
  }
});

// Get single vehicle
router.get('/vehicles/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, id);
    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }
    
    // Get vehicle maintenance history
    const maintenance = await airtableHelpers.find(
      TABLES.VEHICLE_MAINTENANCE,
      `FIND("${id}", ARRAYJOIN({vehicle_id}))`
    );
    
    // Get vehicle trips
    const trips = await airtableHelpers.find(
      TABLES.TRIPS,
      `FIND("${id}", ARRAYJOIN({vehicle_id}))`
    );
    
    res.json({
      vehicle,
      maintenance_history: maintenance,
      trips_history: trips,
      summary: {
        total_trips: trips.length,
        total_maintenance: maintenance.length,
        last_maintenance: maintenance.length > 0 ? maintenance[maintenance.length - 1].maintenance_date : null
      }
    });
  } catch (error) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle' });
  }
});

// Get vehicles by branch
router.get('/vehicles/by-branch/:branchId', authenticateToken, async (req, res) => {
  try {
    const { branchId } = req.params;
    
    const allVehicles = await airtableHelpers.find(TABLES.VEHICLES);
    const vehicles = allVehicles.filter(vehicle => 
      vehicle.branch_id && vehicle.branch_id.includes(branchId)
    );
    
    res.json(vehicles);
  } catch (error) {
    console.error('Get vehicles by branch error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles by branch' });
  }
});

// Get vehicles due for maintenance
router.get('/vehicles/maintenance-due', authenticateToken, async (req, res) => {
  try {
    const { days_ahead = 30 } = req.query;
    
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    
    const dueSoon = [];
    const today = new Date();
    const checkDate = new Date(today.getTime() + (parseInt(days_ahead) * 24 * 60 * 60 * 1000));
    
    for (const vehicle of vehicles) {
      // Get last maintenance for this vehicle
      const vehicleMaintenance = maintenance
        .filter(m => m.vehicle_id && m.vehicle_id.includes(vehicle.id))
        .sort((a, b) => new Date(b.maintenance_date) - new Date(a.maintenance_date));
      
      const lastMaintenance = vehicleMaintenance[0];
      
      // Calculate next maintenance due date (assuming 90 days interval)
      if (lastMaintenance) {
        const nextDue = new Date(lastMaintenance.maintenance_date);
        nextDue.setDate(nextDue.getDate() + 90);
        
        if (nextDue <= checkDate) {
          dueSoon.push({
            ...vehicle,
            next_maintenance_due: nextDue.toISOString().split('T')[0],
            days_overdue: nextDue < today ? Math.floor((today - nextDue) / (24 * 60 * 60 * 1000)) : 0,
            last_maintenance_date: lastMaintenance.maintenance_date
          });
        }
      } else {
        // No maintenance history - assume due now
        dueSoon.push({
          ...vehicle,
          next_maintenance_due: today.toISOString().split('T')[0],
          days_overdue: 0,
          last_maintenance_date: null
        });
      }
    }
    
    res.json(dueSoon);
  } catch (error) {
    console.error('Get vehicles due for maintenance error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles due for maintenance' });
  }
});

// Create new vehicle
router.post('/vehicles', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const {
      plate_number,
      vehicle_type,
      make,
      model,
      year,
      branch_id,
      purchase_price,
      purchase_date
    } = req.body;
    
    if (!plate_number || !vehicle_type || !branch_id) {
      return res.status(400).json({ 
        message: 'Plate number, vehicle type, and branch ID are required' 
      });
    }
    
    const vehicleData = {
      plate_number,
      vehicle_type,
      make: make || '',
      model: model || '',
      year: year ? parseInt(year) : null,
      branch_id: [branch_id],
      purchase_price: purchase_price ? parseFloat(purchase_price) : null,
      purchase_date: purchase_date || null,
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    const newVehicle = await airtableHelpers.create(TABLES.VEHICLES, vehicleData);
    
    res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      vehicle: newVehicle
    });
  } catch (error) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ message: 'Failed to create vehicle' });
  }
});

// Transfer vehicle to branch
router.post('/vehicles/:id/transfer', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const { id } = req.params;
    const { to_branch_id, reason } = req.body;
    
    if (!to_branch_id) {
      return res.status(400).json({ message: 'Destination branch ID is required' });
    }
    
    const vehicle = await airtableHelpers.findById(TABLES.VEHICLES, id);
    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }
    
    // Update vehicle branch
    await airtableHelpers.update(TABLES.VEHICLES, id, {
      branch_id: [to_branch_id],
      updated_at: new Date().toISOString()
    });
    
    // Create transfer record in logistics transactions
    await airtableHelpers.create(TABLES.LOGISTICS_TRANSACTIONS, {
      transaction_type: 'vehicle_transfer',
      vehicle_id: [id],
      from_branch_id: vehicle.branch_id,
      to_branch_id: [to_branch_id],
      description: reason || 'Vehicle transfer between branches',
      status: 'completed',
      transaction_date: new Date().toISOString().split('T')[0],
      created_by: [req.user.id],
      created_at: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Vehicle transferred successfully'
    });
  } catch (error) {
    console.error('Transfer vehicle error:', error);
    res.status(500).json({ message: 'Failed to transfer vehicle' });
  }
});

// Trip Management Routes

// Get all trips
router.get('/trips', authenticateToken, async (req, res) => {
  try {
    const { vehicle_id, driver_id, status, startDate, endDate } = req.query;
    
    let trips = await airtableHelpers.find(TABLES.TRIPS);
    
    // Apply filters
    if (vehicle_id) {
      trips = trips.filter(trip => 
        trip.vehicle_id && trip.vehicle_id.includes(vehicle_id)
      );
    }
    
    if (driver_id) {
      trips = trips.filter(trip => 
        trip.driver_id && trip.driver_id.includes(driver_id)
      );
    }
    
    if (status) {
      trips = trips.filter(trip => trip.status === status);
    }
    
    if (startDate && endDate) {
      trips = trips.filter(trip => {
        const tripDate = new Date(trip.trip_date);
        return tripDate >= new Date(startDate) && tripDate <= new Date(endDate);
      });
    }
    
    res.json(trips);
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ message: 'Failed to fetch trips' });
  }
});

// Get single trip
router.get('/trips/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const trip = await airtableHelpers.findById(TABLES.TRIPS, id);
    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }
    
    // Get related vehicle and driver info
    let vehicle = null;
    let driver = null;
    
    if (trip.vehicle_id && trip.vehicle_id[0]) {
      vehicle = await airtableHelpers.findById(TABLES.VEHICLES, trip.vehicle_id[0]);
    }
    
    if (trip.driver_id && trip.driver_id[0]) {
      driver = await airtableHelpers.findById(TABLES.EMPLOYEES, trip.driver_id[0]);
    }
    
    res.json({
      trip,
      vehicle,
      driver
    });
  } catch (error) {
    console.error('Get trip error:', error);
    res.status(500).json({ message: 'Failed to fetch trip' });
  }
});

// Get trips by vehicle
router.get('/trips/by-vehicle/:vehicleId', authenticateToken, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    
    const trips = await airtableHelpers.find(
      TABLES.TRIPS,
      `FIND("${vehicleId}", ARRAYJOIN({vehicle_id}))`
    );
    
    const summary = {
      total_trips: trips.length,
      total_distance: trips.reduce((sum, trip) => sum + (trip.distance || 0), 0),
      total_fuel_cost: trips.reduce((sum, trip) => sum + (trip.fuel_cost || 0), 0),
      total_revenue: trips.reduce((sum, trip) => sum + (trip.amount_charged || 0), 0)
    };
    
    res.json({ trips, summary });
  } catch (error) {
    console.error('Get trips by vehicle error:', error);
    res.status(500).json({ message: 'Failed to fetch trips by vehicle' });
  }
});

// Get trips by driver
router.get('/trips/by-driver/:driverId', authenticateToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    
    const trips = await airtableHelpers.find(
      TABLES.TRIPS,
      `FIND("${driverId}", ARRAYJOIN({driver_id}))`
    );
    
    const summary = {
      total_trips: trips.length,
      total_distance: trips.reduce((sum, trip) => sum + (trip.distance || 0), 0),
      completed_trips: trips.filter(trip => trip.status === 'completed').length,
      total_earnings: trips.reduce((sum, trip) => sum + (trip.driver_commission || 0), 0)
    };
    
    res.json({ trips, summary });
  } catch (error) {
    console.error('Get trips by driver error:', error);
    res.status(500).json({ message: 'Failed to fetch trips by driver' });
  }
});

// Get trip analytics
router.get('/trips/analytics', authenticateToken, async (req, res) => {
  try {
    const { group_by = 'month', vehicle_id, driver_id } = req.query;
    
    let trips = await airtableHelpers.find(TABLES.TRIPS);
    
    // Apply filters
    if (vehicle_id) {
      trips = trips.filter(trip => 
        trip.vehicle_id && trip.vehicle_id.includes(vehicle_id)
      );
    }
    
    if (driver_id) {
      trips = trips.filter(trip => 
        trip.driver_id && trip.driver_id.includes(driver_id)
      );
    }
    
    // Group and calculate analytics
    const analytics = {};
    
    for (const trip of trips) {
      let groupKey;
      
      switch (group_by) {
        case 'month':
          groupKey = trip.trip_date ? trip.trip_date.substring(0, 7) : 'unknown';
          break;
        case 'vehicle':
          groupKey = trip.vehicle_id ? trip.vehicle_id[0] : 'unknown';
          break;
        case 'driver':
          groupKey = trip.driver_id ? trip.driver_id[0] : 'unknown';
          break;
        default:
          groupKey = 'all';
      }
      
      if (!analytics[groupKey]) {
        analytics[groupKey] = {
          trip_count: 0,
          total_distance: 0,
          total_fuel_cost: 0,
          total_revenue: 0,
          total_profit: 0
        };
      }
      
      analytics[groupKey].trip_count++;
      analytics[groupKey].total_distance += trip.distance || 0;
      analytics[groupKey].total_fuel_cost += trip.fuel_cost || 0;
      analytics[groupKey].total_revenue += trip.amount_charged || 0;
      analytics[groupKey].total_profit += (trip.amount_charged || 0) - (trip.fuel_cost || 0);
    }
    
    res.json({
      success: true,
      data: analytics,
      group_by,
      total_trips: trips.length
    });
  } catch (error) {
    console.error('Get trip analytics error:', error);
    res.status(500).json({ message: 'Failed to generate trip analytics' });
  }
});

// Create new trip
router.post('/trips', authenticateToken, async (req, res) => {
  try {
    const {
      vehicle_id,
      driver_id,
      origin,
      destination,
      trip_date,
      distance,
      fuel_cost,
      amount_charged,
      customer_name
    } = req.body;
    
    if (!vehicle_id || !driver_id || !origin || !destination) {
      return res.status(400).json({ 
        message: 'Vehicle ID, driver ID, origin, and destination are required' 
      });
    }
    
    const tripData = {
      vehicle_id: [vehicle_id],
      driver_id: [driver_id],
      origin,
      destination,
      trip_date: trip_date || new Date().toISOString().split('T')[0],
      distance: distance ? parseFloat(distance) : null,
      fuel_cost: fuel_cost ? parseFloat(fuel_cost) : null,
      amount_charged: amount_charged ? parseFloat(amount_charged) : null,
      customer_name: customer_name || '',
      status: 'scheduled',
      created_at: new Date().toISOString()
    };
    
    const newTrip = await airtableHelpers.create(TABLES.TRIPS, tripData);
    
    res.status(201).json({
      success: true,
      message: 'Trip created successfully',
      trip: newTrip
    });
  } catch (error) {
    console.error('Create trip error:', error);
    res.status(500).json({ message: 'Failed to create trip' });
  }
});

// Vehicle Maintenance Routes

// Get all maintenance records
router.get('/maintenance', authenticateToken, async (req, res) => {
  try {
    const { vehicle_id, maintenance_type, status } = req.query;
    
    let maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    
    // Apply filters
    if (vehicle_id) {
      maintenance = maintenance.filter(m => 
        m.vehicle_id && m.vehicle_id.includes(vehicle_id)
      );
    }
    
    if (maintenance_type) {
      maintenance = maintenance.filter(m => m.maintenance_type === maintenance_type);
    }
    
    if (status) {
      maintenance = maintenance.filter(m => m.status === status);
    }
    
    res.json(maintenance);
  } catch (error) {
    console.error('Get maintenance error:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance records' });
  }
});

// Get maintenance by vehicle
router.get('/maintenance/by-vehicle/:vehicleId', authenticateToken, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    
    const maintenance = await airtableHelpers.find(
      TABLES.VEHICLE_MAINTENANCE,
      `FIND("${vehicleId}", ARRAYJOIN({vehicle_id}))`
    );
    
    const summary = {
      total_maintenance: maintenance.length,
      total_cost: maintenance.reduce((sum, m) => sum + (m.cost || 0), 0),
      last_maintenance: maintenance.length > 0 ? 
        maintenance.sort((a, b) => new Date(b.maintenance_date) - new Date(a.maintenance_date))[0] : null
    };
    
    res.json({ maintenance, summary });
  } catch (error) {
    console.error('Get maintenance by vehicle error:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance by vehicle' });
  }
});

// Get upcoming maintenance
router.get('/maintenance/upcoming', authenticateToken, async (req, res) => {
  try {
    const { days_ahead = 30 } = req.query;
    
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    const today = new Date();
    const checkDate = new Date(today.getTime() + (parseInt(days_ahead) * 24 * 60 * 60 * 1000));
    
    const upcoming = maintenance.filter(m => {
      if (m.scheduled_date) {
        const scheduledDate = new Date(m.scheduled_date);
        return scheduledDate >= today && scheduledDate <= checkDate && m.status !== 'completed';
      }
      return false;
    });
    
    res.json(upcoming);
  } catch (error) {
    console.error('Get upcoming maintenance error:', error);
    res.status(500).json({ message: 'Failed to fetch upcoming maintenance' });
  }
});

// Create maintenance record
router.post('/maintenance', authenticateToken, authorizeRoles(['manager', 'admin', 'boss']), async (req, res) => {
  try {
    const {
      vehicle_id,
      maintenance_type,
      description,
      cost,
      maintenance_date,
      service_provider
    } = req.body;
    
    if (!vehicle_id || !maintenance_type || !cost) {
      return res.status(400).json({ 
        message: 'Vehicle ID, maintenance type, and cost are required' 
      });
    }
    
    const maintenanceData = {
      vehicle_id: [vehicle_id],
      maintenance_type,
      description: description || '',
      cost: parseFloat(cost),
      maintenance_date: maintenance_date || new Date().toISOString().split('T')[0],
      service_provider: service_provider || '',
      status: 'completed',
      created_at: new Date().toISOString()
    };
    
    const newMaintenance = await airtableHelpers.create(TABLES.VEHICLE_MAINTENANCE, maintenanceData);
    
    res.status(201).json({
      success: true,
      message: 'Maintenance record created successfully',
      maintenance: newMaintenance
    });
  } catch (error) {
    console.error('Create maintenance error:', error);
    res.status(500).json({ message: 'Failed to create maintenance record' });
  }
});

module.exports = router;
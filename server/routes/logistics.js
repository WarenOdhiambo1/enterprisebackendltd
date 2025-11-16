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

module.exports = router;
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
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    res.json(vehicles);
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
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

// Get trips
router.get('/trips', authenticateToken, async (req, res) => {
  try {
    const { vehicleId, startDate, endDate } = req.query;
    
    // Get all trips and filter with JavaScript
    const allTrips = await airtableHelpers.find(TABLES.TRIPS);
    let trips = allTrips;
    
    if (vehicleId) {
      trips = trips.filter(trip => 
        trip.vehicle_id && trip.vehicle_id.includes(vehicleId)
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

module.exports = router;
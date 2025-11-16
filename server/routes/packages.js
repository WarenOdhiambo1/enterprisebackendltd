const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, auditLog } = require('../middleware/auth');

const router = express.Router();

// Get all packages
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, origin, destination, carrier } = req.query;
    let packages = await airtableHelpers.find(TABLES.PACKAGES);
    
    // Filter by status
    if (status) {
      packages = packages.filter(pkg => pkg.status === status);
    }
    
    // Filter by origin
    if (origin) {
      packages = packages.filter(pkg => 
        pkg.origin && pkg.origin.toLowerCase().includes(origin.toLowerCase())
      );
    }
    
    // Filter by destination
    if (destination) {
      packages = packages.filter(pkg => 
        pkg.destination && pkg.destination.toLowerCase().includes(destination.toLowerCase())
      );
    }
    
    // Filter by carrier
    if (carrier) {
      packages = packages.filter(pkg => 
        pkg.carrier && pkg.carrier.toLowerCase().includes(carrier.toLowerCase())
      );
    }
    
    res.json(packages);
  } catch (error) {
    console.error('Get packages error:', error);
    res.status(500).json({ message: 'Failed to fetch packages' });
  }
});

// Get package by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const package = await airtableHelpers.findById(TABLES.PACKAGES, id);
    res.json(package);
  } catch (error) {
    console.error('Get package error:', error);
    res.status(500).json({ message: 'Failed to fetch package' });
  }
});

// Create new package
router.post('/', authenticateToken, auditLog('CREATE_PACKAGE'), async (req, res) => {
  try {
    const {
      tracking_number,
      carrier,
      origin,
      destination,
      ship_date,
      expected_delivery_date,
      status,
      items,
      weight,
      dimensions,
      special_instructions
    } = req.body;

    if (!tracking_number || !carrier || !origin || !destination) {
      return res.status(400).json({ 
        message: 'Tracking number, carrier, origin, and destination are required' 
      });
    }

    const packageData = {
      tracking_number,
      carrier,
      origin,
      destination,
      ship_date: ship_date || new Date().toISOString().split('T')[0],
      expected_delivery_date,
      status: status || 'packed',
      items: items || '',
      weight: parseFloat(weight) || 0,
      dimensions: dimensions || '',
      special_instructions: special_instructions || '',
      created_at: new Date().toISOString(),
      created_by: [req.user.id]
    };

    const package = await airtableHelpers.create(TABLES.PACKAGES, packageData);
    res.status(201).json(package);
  } catch (error) {
    console.error('Create package error:', error);
    res.status(500).json({ message: 'Failed to create package' });
  }
});

// Update package
router.put('/:id', authenticateToken, auditLog('UPDATE_PACKAGE'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tracking_number,
      carrier,
      origin,
      destination,
      ship_date,
      expected_delivery_date,
      actual_delivery_date,
      status,
      items,
      weight,
      dimensions,
      special_instructions
    } = req.body;

    const packageData = {
      tracking_number,
      carrier,
      origin,
      destination,
      ship_date,
      expected_delivery_date,
      actual_delivery_date,
      status,
      items,
      weight: parseFloat(weight) || 0,
      dimensions,
      special_instructions,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };

    const package = await airtableHelpers.update(TABLES.PACKAGES, id, packageData);
    res.json(package);
  } catch (error) {
    console.error('Update package error:', error);
    res.status(500).json({ message: 'Failed to update package' });
  }
});

// Delete package
router.delete('/:id', authenticateToken, auditLog('DELETE_PACKAGE'), async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.PACKAGES, id);
    res.json({ message: 'Package deleted successfully' });
  } catch (error) {
    console.error('Delete package error:', error);
    res.status(500).json({ message: 'Failed to delete package' });
  }
});

// Update package status
router.patch('/:id/status', authenticateToken, auditLog('UPDATE_PACKAGE_STATUS'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actual_delivery_date } = req.body;

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };

    if (status === 'delivered' && actual_delivery_date) {
      updateData.actual_delivery_date = actual_delivery_date;
    }

    const package = await airtableHelpers.update(TABLES.PACKAGES, id, updateData);
    res.json(package);
  } catch (error) {
    console.error('Update package status error:', error);
    res.status(500).json({ message: 'Failed to update package status' });
  }
});

module.exports = router;
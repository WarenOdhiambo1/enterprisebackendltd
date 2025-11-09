const express = require('express');
const router = express.Router();

// Discover available tables in Airtable base
router.get('/discover', async (req, res) => {
  try {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      return res.status(500).json({
        status: 'error',
        message: 'Airtable credentials not configured'
      });
    }

    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    // Test common table names
    const tableNames = [
      'Employees', 'employees', 'Employee', 'employee',
      'Branches', 'branches', 'Branch', 'branch',
      'Stock', 'stock', 'Products', 'products',
      'Sales', 'sales', 'Sale', 'sale',
      'Users', 'users', 'User', 'user'
    ];
    
    const results = {};
    
    for (const tableName of tableNames) {
      try {
        const records = await base(tableName).select({ maxRecords: 1 }).all();
        results[tableName] = {
          status: 'success',
          recordCount: records.length,
          fields: records.length > 0 ? Object.keys(records[0].fields) : []
        };
      } catch (error) {
        results[tableName] = {
          status: 'error',
          error: error.message
        };
      }
    }
    
    res.json({
      status: 'success',
      message: 'Table discovery completed',
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      error_type: error.name,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
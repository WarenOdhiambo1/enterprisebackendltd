const express = require('express');
const router = express.Router();

// Debug environment variables (safe version)
router.get('/env', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    env_vars: {
      JWT_SECRET: !!process.env.JWT_SECRET,
      JWT_REFRESH_SECRET: !!process.env.JWT_REFRESH_SECRET,
      AIRTABLE_API_KEY: !!process.env.AIRTABLE_API_KEY,
      AIRTABLE_BASE_ID: !!process.env.AIRTABLE_BASE_ID,
      ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
      airtable_key_length: process.env.AIRTABLE_API_KEY ? process.env.AIRTABLE_API_KEY.length : 0,
      base_id_length: process.env.AIRTABLE_BASE_ID ? process.env.AIRTABLE_BASE_ID.length : 0,
      base_id_preview: process.env.AIRTABLE_BASE_ID ? process.env.AIRTABLE_BASE_ID.substring(0, 8) + '...' : 'Not set'
    }
  });
});

// Test Airtable connection
router.get('/airtable', async (req, res) => {
  try {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      return res.status(500).json({
        status: 'error',
        message: 'Airtable credentials not configured',
        has_api_key: !!process.env.AIRTABLE_API_KEY,
        has_base_id: !!process.env.AIRTABLE_BASE_ID
      });
    }

    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const records = await base('Employees').select({ maxRecords: 1 }).all();
    
    res.json({
      status: 'success',
      message: 'Airtable connection working',
      records_found: records.length,
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
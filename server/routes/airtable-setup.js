const express = require('express');
const router = express.Router();

// Check if Airtable base exists and has any tables
router.get('/check-base', async (req, res) => {
  try {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      return res.status(500).json({
        status: 'error',
        message: 'Airtable credentials not configured'
      });
    }

    // Use Airtable REST API to get base schema
    const axios = require('axios');
    const response = await axios.get(`https://api.airtable.com/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });

    const data = response.data;
    
    res.json({
      status: 'success',
      message: 'Base schema retrieved',
      base_id: process.env.AIRTABLE_BASE_ID,
      tables: data.tables.map(table => ({
        id: table.id,
        name: table.name,
        fields: table.fields.map(field => ({
          name: field.name,
          type: field.type
        }))
      })),
      total_tables: data.tables.length,
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

// Create required tables if they don't exist
router.post('/create-tables', async (req, res) => {
  try {
    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

    // Create a test employee record to initialize the Employees table
    const testEmployee = {
      full_name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      password_hash: '$2a$12$test.hash.for.admin.user',
      is_active: true,
      hire_date: new Date().toISOString().split('T')[0],
      mfa_enabled: false,
      created_at: new Date().toISOString()
    };

    const createdRecord = await base('Employees').create([{ fields: testEmployee }]);
    
    res.json({
      status: 'success',
      message: 'Test employee created successfully',
      record_id: createdRecord[0].id,
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
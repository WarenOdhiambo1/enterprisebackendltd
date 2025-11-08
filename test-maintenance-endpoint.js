require('dotenv').config();
const { airtableHelpers, TABLES } = require('./server/config/airtable');

async function testMaintenanceEndpoint() {
  try {
    console.log('Testing Vehicle_Maintenance endpoint...');
    
    // Direct Airtable test
    console.log('\n=== Direct Airtable Test ===');
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    console.log('Maintenance records found:', maintenance.length);
    
    if (maintenance.length > 0) {
      console.log('Sample maintenance record:');
      console.log(JSON.stringify(maintenance[0], null, 2));
    }
    
    // Test if the data route works
    console.log('\n=== Testing Data Route Logic ===');
    const express = require('express');
    const router = express.Router();
    
    // Simulate the data route logic
    const tableName = 'Vehicle_Maintenance';
    const validTables = Object.values(TABLES);
    console.log('Valid tables:', validTables);
    console.log('Is Vehicle_Maintenance valid?', validTables.includes(tableName));
    
    if (validTables.includes(tableName)) {
      const records = await airtableHelpers.find(tableName);
      console.log('Records via data route logic:', records.length);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

testMaintenanceEndpoint();
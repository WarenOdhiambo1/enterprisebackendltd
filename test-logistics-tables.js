require('dotenv').config();
const { airtableHelpers, TABLES } = require('./server/config/airtable');

async function testLogisticsTables() {
  try {
    console.log('Testing Logistics Tables...');
    
    // Test Vehicles table
    console.log('\n=== VEHICLES TABLE ===');
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    console.log('Vehicles count:', vehicles.length);
    if (vehicles.length > 0) {
      console.log('Sample vehicle record:');
      console.log(JSON.stringify(vehicles[0], null, 2));
      console.log('Vehicle fields:', Object.keys(vehicles[0]));
    }
    
    // Test Trips table
    console.log('\n=== TRIPS TABLE ===');
    const trips = await airtableHelpers.find(TABLES.TRIPS);
    console.log('Trips count:', trips.length);
    if (trips.length > 0) {
      console.log('Sample trip record:');
      console.log(JSON.stringify(trips[0], null, 2));
      console.log('Trip fields:', Object.keys(trips[0]));
    }
    
    // Test Vehicle_Maintenance table
    console.log('\n=== VEHICLE_MAINTENANCE TABLE ===');
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    console.log('Maintenance count:', maintenance.length);
    if (maintenance.length > 0) {
      console.log('Sample maintenance record:');
      console.log(JSON.stringify(maintenance[0], null, 2));
      console.log('Maintenance fields:', Object.keys(maintenance[0]));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

testLogisticsTables();
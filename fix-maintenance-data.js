require('dotenv').config();
const { airtableHelpers, TABLES } = require('./server/config/airtable');

async function fixMaintenanceData() {
  try {
    console.log('=== FIXING MAINTENANCE DATA INTEGRATION ===\n');
    
    // 1. Test Vehicle_Maintenance table access
    console.log('1. Testing Vehicle_Maintenance table...');
    const maintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    console.log(`Found ${maintenance.length} maintenance records`);
    
    if (maintenance.length > 0) {
      console.log('Sample maintenance record:');
      console.log(JSON.stringify(maintenance[0], null, 2));
    }
    
    // 2. Test Vehicles table access
    console.log('\n2. Testing Vehicles table...');
    const vehicles = await airtableHelpers.find(TABLES.VEHICLES);
    console.log(`Found ${vehicles.length} vehicles`);
    
    if (vehicles.length > 0) {
      console.log('Sample vehicle record:');
      console.log(JSON.stringify(vehicles[0], null, 2));
    }
    
    // 3. Test data route simulation
    console.log('\n3. Testing data route for Vehicle_Maintenance...');
    const tableName = 'Vehicle_Maintenance';
    const validTables = Object.values(TABLES);
    console.log('Is Vehicle_Maintenance in valid tables?', validTables.includes(tableName));
    
    if (validTables.includes(tableName)) {
      const records = await airtableHelpers.find(tableName);
      console.log(`Data route would return ${records.length} records`);
    }
    
    // 4. Test logistics route simulation
    console.log('\n4. Testing logistics maintenance route...');
    const logisticsMaintenance = await airtableHelpers.find(TABLES.VEHICLE_MAINTENANCE);
    console.log(`Logistics route would return ${logisticsMaintenance.length} records`);
    
    // 5. Create proper maintenance data structure for frontend
    console.log('\n5. Creating proper data structure...');
    const maintenanceWithVehicles = maintenance.map(record => {
      const vehicleId = Array.isArray(record.vehicle_id) ? record.vehicle_id[0] : record.vehicle_id;
      const vehicle = vehicles.find(v => v.id === vehicleId);
      
      return {
        ...record,
        vehicle_plate_number: vehicle?.plate_number || 'Unknown',
        vehicle_type: vehicle?.vehicle_type || 'Unknown'
      };
    });
    
    console.log('Enhanced maintenance records:');
    console.log(JSON.stringify(maintenanceWithVehicles.slice(0, 2), null, 2));
    
    console.log('\n=== MAINTENANCE DATA INTEGRATION COMPLETE ===');
    console.log(`Total maintenance records: ${maintenance.length}`);
    console.log(`Total vehicles: ${vehicles.length}`);
    console.log('Data structure is ready for frontend integration');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

fixMaintenanceData();
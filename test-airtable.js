require('dotenv').config();
const { airtableHelpers, TABLES } = require('./server/config/airtable');
const bcrypt = require('bcryptjs');

async function testAirtable() {
  try {
    console.log('Testing Airtable connection...');
    console.log('Environment variables:');
    console.log('- AIRTABLE_API_KEY:', !!process.env.AIRTABLE_API_KEY);
    console.log('- AIRTABLE_BASE_ID:', process.env.AIRTABLE_BASE_ID);
    
    // Test 1: Try to read from Employees table
    console.log('\n1. Testing read from Employees table...');
    const employees = await airtableHelpers.find(TABLES.EMPLOYEES);
    console.log('Employees found:', employees.length);
    
    // Test 2: Try to create an admin user
    console.log('\n2. Testing create admin user...');
    const hashedPassword = await bcrypt.hash('AdminPassword123!', 12);
    
    const adminData = {
      full_name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      password_hash: hashedPassword,
      is_active: true,
      hire_date: new Date().toISOString().split('T')[0],
      mfa_enabled: false
    };
    
    console.log('Creating admin with data:', adminData);
    const admin = await airtableHelpers.create(TABLES.EMPLOYEES, adminData);
    console.log('Admin created successfully:', admin.id);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Full error:', error);
  }
}

testAirtable();
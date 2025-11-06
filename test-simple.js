require('dotenv').config();
const Airtable = require('airtable');

async function testSimple() {
  try {
    console.log('API Key length:', process.env.AIRTABLE_API_KEY?.length);
    console.log('API Key starts with:', process.env.AIRTABLE_API_KEY?.substring(0, 10));
    console.log('Base ID:', process.env.AIRTABLE_BASE_ID);
    
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    console.log('Testing direct Airtable connection...');
    const records = await base('Employees').select({ maxRecords: 1 }).firstPage();
    console.log('Success! Records found:', records.length);
    
  } catch (error) {
    console.error('Error details:');
    console.error('- Message:', error.message);
    console.error('- Status:', error.statusCode);
    console.error('- Error:', error.error);
  }
}

testSimple();
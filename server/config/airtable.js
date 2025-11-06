const Airtable = require('airtable');

Airtable.configure({
  endpointUrl: 'https://api.airtable.com',
  apiKey: process.env.AIRTABLE_API_KEY
});

const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

// Table names mapping (exact match with Airtable)
const TABLES = {
  BRANCHES: 'Branches',
  EMPLOYEES: 'Employees',
  STOCK: 'Stock',
  STOCK_MOVEMENTS: 'Stock_Movements',
  SALES: 'Sales',
  SALE_ITEMS: 'Sale_Items',
  EXPENSES: 'Expenses',
  VEHICLES: 'Vehicles',
  TRIPS: 'Trips',
  VEHICLE_MAINTENANCE: 'Vehicle_Maintenance',
  ORDERS: 'Orders',
  ORDER_ITEMS: 'Order_Items',
  PAYROLL: 'Payroll',
  AUDIT_LOGS: 'Audit_Logs',
  ERP_SETTINGS: 'ERP_Settings',
  DOCUMENTS: 'Documents'
};

// Helper functions for Airtable operations
const airtableHelpers = {
  // Create record
  async create(tableName, fields) {
    try {
      const records = await base(tableName).create([{ fields }]);
      return records[0];
    } catch (error) {
      throw new Error(`Airtable create error: ${error.message}`);
    }
  },

  // Find records with filter
  async find(tableName, filterFormula, sort) {
    try {
      const selectOptions = {};
      
      if (filterFormula && typeof filterFormula === 'string' && filterFormula.trim()) {
        selectOptions.filterByFormula = filterFormula;
      }
      if (sort && Array.isArray(sort) && sort.length > 0) {
        selectOptions.sort = sort;
      }
      
      const records = await base(tableName).select(selectOptions).all();
      return records.map(record => ({
        id: record.id,
        ...record.fields
      }));
    } catch (error) {
      throw new Error(`Airtable find error: ${error.message}`);
    }
  },

  // Update record
  async update(tableName, recordId, fields) {
    try {
      const records = await base(tableName).update([{
        id: recordId,
        fields: fields
      }]);
      return records[0];
    } catch (error) {
      throw new Error(`Airtable update error: ${error.message}`);
    }
  },

  // Delete record
  async delete(tableName, recordId) {
    try {
      const records = await base(tableName).destroy([recordId]);
      return records[0];
    } catch (error) {
      throw new Error(`Airtable delete error: ${error.message}`);
    }
  },

  // Get record by ID
  async findById(tableName, recordId) {
    try {
      const record = await base(tableName).find(recordId);
      return {
        id: record.id,
        ...record.fields
      };
    } catch (error) {
      throw new Error(`Airtable findById error: ${error.message}`);
    }
  }
};

module.exports = {
  base,
  TABLES,
  airtableHelpers
};
const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all data for a specific table
router.get('/:tableName', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const { filter, sort, limit } = req.query;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Apply branch filtering for non-boss users
    let filterFormula = filter || '';
    if (req.user.role !== 'boss' && req.user.branchId) {
      const branchFilter = `{branch_id} = '${req.user.branchId}'`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${branchFilter})` : branchFilter;
    }

    const sortOptions = sort ? JSON.parse(sort) : [{ field: 'created_at', direction: 'desc' }];
    const records = await airtableHelpers.find(tableName, filterFormula, sortOptions);
    
    // Apply limit if specified
    const limitedRecords = limit ? records.slice(0, parseInt(limit)) : records;
    
    res.json(limitedRecords);
  } catch (error) {
    console.error(`Error fetching ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to fetch data', error: error.message });
  }
});

// Create new record
router.post('/:tableName', authenticateToken, async (req, res) => {
  try {
    const { tableName } = req.params;
    const data = req.body;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Add audit fields
    const recordData = {
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: req.user.userId
    };

    // Add branch_id for branch-specific tables
    const branchSpecificTables = [TABLES.STOCK, TABLES.SALES, TABLES.EXPENSES, TABLES.EMPLOYEES];
    if (branchSpecificTables.includes(tableName) && req.user.branchId && !recordData.branch_id) {
      recordData.branch_id = req.user.branchId;
    }

    const record = await airtableHelpers.create(tableName, recordData);
    res.status(201).json(record);
  } catch (error) {
    console.error(`Error creating ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to create record', error: error.message });
  }
});

// Update record
router.put('/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    const data = req.body;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Add audit fields
    const updateData = {
      ...data,
      updated_at: new Date().toISOString(),
      updated_by: req.user.userId
    };

    const record = await airtableHelpers.update(tableName, recordId, updateData);
    res.json(record);
  } catch (error) {
    console.error(`Error updating ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to update record', error: error.message });
  }
});

// Delete record
router.delete('/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    await airtableHelpers.delete(tableName, recordId);
    res.json({ message: 'Record deleted successfully' });
  } catch (error) {
    console.error(`Error deleting ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Failed to delete record', error: error.message });
  }
});

// Get record by ID
router.get('/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    const record = await airtableHelpers.findById(tableName, recordId);
    res.json(record);
  } catch (error) {
    console.error(`Error fetching ${req.params.tableName} record:`, error);
    res.status(500).json({ message: 'Failed to fetch record', error: error.message });
  }
});

// Bulk operations
router.post('/:tableName/bulk', authenticateToken, authorizeRoles(['boss', 'admin']), async (req, res) => {
  try {
    const { tableName } = req.params;
    const { operation, records } = req.body;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    const results = [];
    
    switch (operation) {
      case 'create':
        for (const recordData of records) {
          const record = await airtableHelpers.create(tableName, {
            ...recordData,
            created_at: new Date().toISOString(),
            created_by: req.user.userId
          });
          results.push(record);
        }
        break;
        
      case 'update':
        for (const { id, data } of records) {
          const record = await airtableHelpers.update(tableName, id, {
            ...data,
            updated_at: new Date().toISOString(),
            updated_by: req.user.userId
          });
          results.push(record);
        }
        break;
        
      case 'delete':
        for (const recordId of records) {
          await airtableHelpers.delete(tableName, recordId);
          results.push({ id: recordId, deleted: true });
        }
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid operation' });
    }
    
    res.json({ results, count: results.length });
  } catch (error) {
    console.error(`Error in bulk ${req.body.operation} for ${req.params.tableName}:`, error);
    res.status(500).json({ message: 'Bulk operation failed', error: error.message });
  }
});

module.exports = router;
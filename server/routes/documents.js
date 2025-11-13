const express = require('express');
const multer = require('multer');
const { TABLES } = require('../config/airtable');
const { authenticateToken } = require('../middleware/auth');
const { 
  supportsDocuments, 
  isValidDocumentField, 
  validateBusinessDocument,
  formatAttachmentForAirtable,
  getSuggestedDocumentFields
} = require('../utils/document-helper');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Upload document to specific table and record
router.post('/upload/:tableName/:recordId/:fieldName', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    const { tableName, recordId, fieldName } = req.params;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    // Validate document for business use
    try {
      validateBusinessDocument(file);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    // Check if table supports documents and field is valid
    if (supportsDocuments(tableName) && !isValidDocumentField(tableName, fieldName)) {
      return res.status(400).json({ 
        message: `Invalid document field '${fieldName}' for table '${tableName}'`,
        suggestedFields: getSuggestedDocumentFields(tableName)
      });
    }

    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

    // Create attachment object for Airtable
    const attachment = formatAttachmentForAirtable(file, {
      uploadedBy: req.user.userId,
      uploadedAt: new Date().toISOString()
    });

    // Get existing record to preserve other attachments
    const existingRecord = await base(tableName).find(recordId);
    const existingAttachments = existingRecord.fields[fieldName] || [];

    // Add new attachment to existing ones
    const updatedAttachments = [...existingAttachments, attachment];

    // Update record with new attachment
    const updatedRecord = await base(tableName).update(recordId, {
      [fieldName]: updatedAttachments
    });

    res.json({
      message: 'Document uploaded successfully',
      attachment: {
        id: updatedRecord.fields[fieldName][updatedRecord.fields[fieldName].length - 1].id,
        filename: file.originalname,
        url: updatedRecord.fields[fieldName][updatedRecord.fields[fieldName].length - 1].url
      }
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

// Upload to Documents table
router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    const file = req.file;
    const { category, description, tags, subcategory, display_name, is_public } = req.body;
    
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

    // Create document record with attachment
    const documentRecord = await base(TABLES.DOCUMENTS).create({
      file_name: display_name || file.originalname,
      category: category || 'general',
      subcategory: subcategory || '',
      description: description || '',
      tags: tags || '',
      file_size: file.size,
      file_type: file.mimetype,
      uploaded_at: new Date().toISOString(),
      uploaded_by: req.user.userId,
      is_public: is_public === 'true' || is_public === true,
      attachments: [{
        filename: file.originalname,
        content: file.buffer
      }]
    });

    res.json({
      message: 'Document uploaded successfully',
      document: {
        id: documentRecord.id,
        filename: file.originalname,
        url: documentRecord.fields.attachments[0].url
      }
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

// Get document download URL
router.get('/download/:tableName/:recordId/:fieldName/:attachmentId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId, fieldName, attachmentId } = req.params;

    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

    const record = await base(tableName).find(recordId);
    const attachments = record.fields[fieldName] || [];
    
    const attachment = attachments.find(att => att.id === attachmentId);
    
    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    res.json({
      url: attachment.url,
      filename: attachment.filename
    });

  } catch (error) {
    console.error('Document download error:', error);
    res.status(500).json({ message: 'Download failed', error: error.message });
  }
});

// Get all documents with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category, search, limit } = req.query;
    
    let filterFormula = '';
    const filters = [];
    
    if (category && category !== 'all') {
      filters.push(`{category} = '${category}'`);
    }
    
    if (search) {
      filters.push(`OR(
        FIND(LOWER('${search}'), LOWER({file_name})) > 0,
        FIND(LOWER('${search}'), LOWER({description})) > 0,
        FIND(LOWER('${search}'), LOWER({tags})) > 0
      )`);
    }
    
    if (filters.length > 0) {
      filterFormula = filters.length === 1 ? filters[0] : `AND(${filters.join(', ')})`;
    }
    
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const records = await base(TABLES.DOCUMENTS)
      .select({
        filterByFormula: filterFormula || undefined,
        sort: [{ field: 'uploaded_at', direction: 'desc' }],
        maxRecords: limit ? parseInt(limit) : undefined
      })
      .all();
    
    const documents = records.map(record => ({
      id: record.id,
      ...record.fields,
      // Ensure attachments are properly formatted
      attachments: record.fields.attachments || []
    }));
    
    res.json(documents);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Failed to fetch documents', error: error.message });
  }
});

// Delete document
router.delete('/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    await base(TABLES.DOCUMENTS).destroy(documentId);
    
    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ message: 'Delete failed', error: error.message });
  }
});

// Get document capabilities for tables
router.get('/capabilities', authenticateToken, async (req, res) => {
  try {
    const { getDocumentEnabledTables, getDocumentFields, getSuggestedDocumentFields } = require('../utils/document-helper');
    
    const capabilities = {};
    const enabledTables = getDocumentEnabledTables();
    
    enabledTables.forEach(tableName => {
      const fields = getDocumentFields(tableName);
      const suggestions = getSuggestedDocumentFields(tableName);
      
      capabilities[tableName] = {
        tableName,
        fields: fields.fields,
        description: fields.description,
        suggestedFields: suggestions
      };
    });
    
    res.json({
      documentEnabledTables: enabledTables,
      capabilities,
      totalTables: enabledTables.length
    });
  } catch (error) {
    console.error('Get capabilities error:', error);
    res.status(500).json({ message: 'Failed to get document capabilities', error: error.message });
  }
});

// Get documents for a specific table and record
router.get('/table/:tableName/:recordId', authenticateToken, async (req, res) => {
  try {
    const { tableName, recordId } = req.params;
    
    // Validate table name
    const validTables = Object.values(TABLES);
    if (!validTables.includes(tableName)) {
      return res.status(400).json({ message: 'Invalid table name' });
    }
    
    const Airtable = require('airtable');
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const record = await base(tableName).find(recordId);
    
    // Extract all attachment fields
    const documentFields = {};
    const { getDocumentFields } = require('../utils/document-helper');
    const tableConfig = getDocumentFields(tableName);
    
    if (tableConfig) {
      tableConfig.fields.forEach(fieldName => {
        if (record.fields[fieldName]) {
          documentFields[fieldName] = record.fields[fieldName];
        }
      });
    }
    
    // Also check for any other attachment fields
    Object.keys(record.fields).forEach(fieldName => {
      if (Array.isArray(record.fields[fieldName]) && 
          record.fields[fieldName].length > 0 && 
          record.fields[fieldName][0].url) {
        documentFields[fieldName] = record.fields[fieldName];
      }
    });
    
    res.json({
      recordId,
      tableName,
      documentFields,
      totalAttachments: Object.values(documentFields).reduce((sum, field) => sum + (field?.length || 0), 0)
    });
  } catch (error) {
    console.error('Get table documents error:', error);
    res.status(500).json({ message: 'Failed to get table documents', error: error.message });
  }
});

module.exports = router;
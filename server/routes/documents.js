const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { base: airtableBase, TABLES } = require('../config/airtable');
const path = require('path');
const { google } = require('googleapis');
const stream = require('stream');

const router = express.Router();

// Configure Google Drive API
let auth;
try {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    // For Vercel deployment - decode base64 credentials
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString());
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
  } else {
    // For local development - use file
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || './google-credentials.json',
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
  }
} catch (error) {
  console.error('Google Drive configuration failed:', error.message);
  auth = null;
}

const drive = auth ? google.drive({ version: 'v3', auth }) : null;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Upload document
router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    if (!drive) {
      return res.status(503).json({ message: 'Document upload service not available' });
    }
    
    const { category, description, tags } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Upload to Google Drive
    const fileName = `${Date.now()}-${file.originalname}`;
    const bufferStream = new stream.PassThrough();
    bufferStream.end(file.buffer);

    const driveResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID || 'root']
      },
      media: {
        mimeType: file.mimetype,
        body: bufferStream
      }
    });

    // Make file accessible
    await drive.permissions.create({
      fileId: driveResponse.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    // Save to Airtable
    const documentRecord = await airtableBase(TABLES.DOCUMENTS || 'Documents').create([{
      fields: {
        file_name: file.originalname,
        display_name: req.body.display_name || file.originalname,
        file_size: file.size,
        file_type: file.mimetype,
        category: category || 'general',
        subcategory: req.body.subcategory || '',
        description: description || '',
        tags: tags || '',
        google_drive_id: driveResponse.data.id,
        google_drive_url: `https://drive.google.com/file/d/${driveResponse.data.id}/view`,
        uploaded_by: [req.user.id],
        uploaded_at: new Date().toISOString(),
        branch_id: req.user.branchId ? [req.user.branchId] : null,
        is_public: req.body.is_public === 'true' || false,
        is_archived: false,
        version: 1.0,
        approval_status: 'pending',
        access_count: 0
      }
    }]);

    res.json({
      id: documentRecord[0].id,
      fileName: file.originalname,
      category,
      description,
      uploadedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ message: 'Failed to upload document', error: error.message });
  }
});

// Get documents
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category, search } = req.query;
    
    let filter = '';
    if (category && category !== 'all') {
      filter = `{category} = '${category}'`;
    }
    if (search) {
      const searchFilter = `OR(FIND('${search}', {file_name}), FIND('${search}', {description}), FIND('${search}', {tags}))`;
      filter = filter ? `AND(${filter}, ${searchFilter})` : searchFilter;
    }

    // Branch filtering for non-boss users
    if (req.user.role !== 'boss' && req.user.branchId) {
      const branchFilter = `{branch_id} = '${req.user.branchId}'`;
      filter = filter ? `AND(${filter}, ${branchFilter})` : branchFilter;
    }

    const documents = await airtableBase(TABLES.DOCUMENTS || 'Documents').select({
      filterByFormula: filter || 'TRUE()',
      sort: [{ field: 'uploaded_at', direction: 'desc' }]
    }).firstPage();

    const documentList = documents.map(record => ({
      id: record.id,
      fileName: record.fields.file_name,
      fileSize: record.fields.file_size,
      fileType: record.fields.file_type,
      category: record.fields.category,
      description: record.fields.description,
      tags: record.fields.tags,
      uploadedAt: record.fields.uploaded_at,
      uploadedBy: record.fields.uploaded_by
    }));

    res.json(documentList);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch documents', error: error.message });
  }
});

// Download document
router.get('/download/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    
    const document = await airtableBase(TABLES.DOCUMENTS || 'Documents').find(documentId);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Get Google Drive download URL
    const driveFile = await drive.files.get({
      fileId: document.fields.google_drive_id,
      alt: 'media'
    }, { responseType: 'stream' });

    res.setHeader('Content-Disposition', `attachment; filename="${document.fields.file_name}"`);
    res.setHeader('Content-Type', document.fields.file_type);
    driveFile.data.pipe(res);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate download link', error: error.message });
  }
});

// Delete document
router.delete('/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    
    const document = await airtableBase(TABLES.DOCUMENTS || 'Documents').find(documentId);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete from Google Drive
    await drive.files.delete({
      fileId: document.fields.google_drive_id
    });

    // Delete from Airtable
    await airtableBase(TABLES.DOCUMENTS || 'Documents').destroy([documentId]);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete document', error: error.message });
  }
});

module.exports = router;
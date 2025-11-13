const { TABLES } = require('../config/airtable');

// Tables that commonly need document attachments
const DOCUMENT_ENABLED_TABLES = {
  [TABLES.EXPENSES]: {
    fields: ['receipt_attachment', 'supporting_documents'],
    description: 'Receipts, invoices, and supporting documents for expenses'
  },
  [TABLES.EMPLOYEES]: {
    fields: ['profile_photo', 'id_documents', 'contracts', 'certificates'],
    description: 'Employee photos, ID documents, contracts, and certificates'
  },
  [TABLES.VEHICLES]: {
    fields: ['registration_documents', 'insurance_documents', 'inspection_certificates'],
    description: 'Vehicle registration, insurance, and inspection documents'
  },
  [TABLES.VEHICLE_MAINTENANCE]: {
    fields: ['maintenance_receipts', 'before_after_photos', 'warranty_documents'],
    description: 'Maintenance receipts, photos, and warranty documents'
  },
  [TABLES.INVOICES]: {
    fields: ['invoice_pdf', 'supporting_documents', 'delivery_notes'],
    description: 'Invoice PDFs, supporting documents, and delivery notes'
  },
  [TABLES.SALES]: {
    fields: ['receipt_copy', 'delivery_confirmation', 'customer_signature'],
    description: 'Sales receipts, delivery confirmations, and customer signatures'
  },
  [TABLES.STOCK]: {
    fields: ['product_images', 'supplier_invoices', 'quality_certificates'],
    description: 'Product images, supplier invoices, and quality certificates'
  },
  [TABLES.BRANCHES]: {
    fields: ['branch_photos', 'lease_agreements', 'permits_licenses'],
    description: 'Branch photos, lease agreements, and permits/licenses'
  },
  [TABLES.PAYROLL]: {
    fields: ['payslip_pdf', 'tax_documents', 'bank_transfer_receipts'],
    description: 'Payslip PDFs, tax documents, and bank transfer receipts'
  }
};

// Get document fields for a specific table
const getDocumentFields = (tableName) => {
  return DOCUMENT_ENABLED_TABLES[tableName] || null;
};

// Check if a table supports documents
const supportsDocuments = (tableName) => {
  return Object.keys(DOCUMENT_ENABLED_TABLES).includes(tableName);
};

// Get all tables that support documents
const getDocumentEnabledTables = () => {
  return Object.keys(DOCUMENT_ENABLED_TABLES);
};

// Validate document field for a table
const isValidDocumentField = (tableName, fieldName) => {
  const tableConfig = DOCUMENT_ENABLED_TABLES[tableName];
  return tableConfig && tableConfig.fields.includes(fieldName);
};

// Get suggested document fields for common business scenarios
const getSuggestedDocumentFields = (tableName) => {
  const suggestions = {
    [TABLES.EXPENSES]: [
      { field: 'receipt_attachment', label: 'Receipt/Invoice', required: true },
      { field: 'supporting_documents', label: 'Supporting Documents', required: false }
    ],
    [TABLES.EMPLOYEES]: [
      { field: 'profile_photo', label: 'Profile Photo', required: false },
      { field: 'id_documents', label: 'ID Documents', required: true },
      { field: 'contracts', label: 'Employment Contract', required: true },
      { field: 'certificates', label: 'Certificates/Qualifications', required: false }
    ],
    [TABLES.VEHICLES]: [
      { field: 'registration_documents', label: 'Registration Documents', required: true },
      { field: 'insurance_documents', label: 'Insurance Documents', required: true },
      { field: 'inspection_certificates', label: 'Inspection Certificates', required: false }
    ],
    [TABLES.INVOICES]: [
      { field: 'invoice_pdf', label: 'Invoice PDF', required: true },
      { field: 'supporting_documents', label: 'Supporting Documents', required: false },
      { field: 'delivery_notes', label: 'Delivery Notes', required: false }
    ],
    [TABLES.SALES]: [
      { field: 'receipt_copy', label: 'Receipt Copy', required: true },
      { field: 'delivery_confirmation', label: 'Delivery Confirmation', required: false },
      { field: 'customer_signature', label: 'Customer Signature', required: false }
    ]
  };
  
  return suggestions[tableName] || [];
};

// Format attachment data for Airtable
const formatAttachmentForAirtable = (file, metadata = {}) => {
  return {
    filename: file.originalname,
    content: file.buffer,
    ...metadata
  };
};

// Validate file type for business documents
const validateBusinessDocument = (file) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ];
  
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error(`Invalid file type: ${file.mimetype}. Allowed types: PDF, Images, Word, Excel, CSV`);
  }
  
  if (file.size > maxSize) {
    throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size: 10MB`);
  }
  
  return true;
};

module.exports = {
  DOCUMENT_ENABLED_TABLES,
  getDocumentFields,
  supportsDocuments,
  getDocumentEnabledTables,
  isValidDocumentField,
  getSuggestedDocumentFields,
  formatAttachmentForAirtable,
  validateBusinessDocument
};
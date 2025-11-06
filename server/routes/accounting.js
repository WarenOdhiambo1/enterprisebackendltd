const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { base: airtableBase, TABLES } = require('../config/airtable');
const axios = require('axios');

// KRA eTIMS API Configuration
const ETIMS_BASE_URL = process.env.ETIMS_BASE_URL || 'https://etims-api-sbx.kra.go.ke/etims-api';
const ETIMS_API_KEY = process.env.ETIMS_API_KEY;
const ETIMS_TIN = process.env.ETIMS_TIN;

// ERP Integration Settings
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const settings = await airtableBase(TABLES.ERP_SETTINGS).select().firstPage();
    res.json(settings.map(record => ({ id: record.id, ...record.fields })));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch ERP settings', error: error.message });
  }
});

router.post('/settings', authenticateToken, async (req, res) => {
  try {
    const { erp_type, api_key, base_url, sync_enabled, etims_enabled } = req.body;
    
    const record = await airtableBase(TABLES.ERP_SETTINGS).create([{
      fields: {
        erp_type,
        api_key,
        base_url,
        sync_enabled: sync_enabled || false,
        etims_enabled: etims_enabled || false,
        created_at: new Date().toISOString(),
        updated_by: req.user.id
      }
    }]);

    res.json({ id: record[0].id, ...record[0].fields });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save ERP settings', error: error.message });
  }
});

// Sync invoices to KRA eTIMS
router.post('/sync-etims', authenticateToken, async (req, res) => {
  try {
    const { invoice_id } = req.body;
    
    // Get invoice details
    const invoice = await airtableBase(TABLES.SALES).find(invoice_id);
    const invoiceData = invoice.fields;
    
    // Get sale items
    const saleItems = await airtableBase(TABLES.SALE_ITEMS).select({
      filterByFormula: `{sale_id} = '${invoice_id}'`
    }).firstPage();

    // Format for eTIMS API
    const etimsPayload = {
      tpin: ETIMS_TIN,
      bhfId: invoiceData.branch_id?.[0] || '00',
      invcNo: invoiceData.id,
      orgInvcNo: invoiceData.id,
      custTpin: invoiceData.customer_tin || '',
      custNm: invoiceData.customer_name || 'Walk-in Customer',
      salesTyCd: 'N', // Normal sale
      rcptTyCd: 'S', // Sale receipt
      pmtTyCd: invoiceData.payment_method === 'cash' ? '01' : '02',
      salesSttsCd: '02', // Completed
      cfmDt: invoiceData.sale_date,
      salesDt: invoiceData.sale_date,
      stockRlsDt: invoiceData.sale_date,
      totItemCnt: saleItems.length,
      taxblAmtA: invoiceData.total_amount || 0,
      taxblAmtB: 0,
      taxblAmtC: 0,
      taxblAmtD: 0,
      taxRtA: 16, // VAT rate
      taxRtB: 0,
      taxRtC: 0,
      taxRtD: 0,
      taxAmtA: (invoiceData.total_amount || 0) * 0.16,
      taxAmtB: 0,
      taxAmtC: 0,
      taxAmtD: 0,
      totTaxblAmt: invoiceData.total_amount || 0,
      totTaxAmt: (invoiceData.total_amount || 0) * 0.16,
      totAmt: (invoiceData.total_amount || 0) * 1.16,
      itemList: saleItems.map((item, index) => ({
        itemSeq: index + 1,
        itemCd: item.fields.product_id?.[0] || '',
        itemClsCd: '50101501', // General goods
        itemNm: item.fields.product_name || '',
        bcd: '',
        pkgUnitCd: '01', // Each
        pkg: item.fields.quantity || 1,
        qtyUnitCd: '01',
        qty: item.fields.quantity || 1,
        prc: item.fields.unit_price || 0,
        splyAmt: item.fields.total_price || 0,
        dcRt: 0,
        dcAmt: 0,
        taxTyCd: 'A', // VAT
        taxblAmt: item.fields.total_price || 0,
        taxAmt: (item.fields.total_price || 0) * 0.16,
        totAmt: (item.fields.total_price || 0) * 1.16
      }))
    };

    // Send to eTIMS API
    const response = await axios.post(`${ETIMS_BASE_URL}/insertSalesData`, etimsPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ETIMS_API_KEY}`
      }
    });

    // Update invoice with eTIMS reference
    await airtableBase(TABLES.SALES).update(invoice_id, {
      etims_synced: true,
      etims_reference: response.data.rcptNo || '',
      etims_sync_date: new Date().toISOString()
    });

    res.json({ 
      success: true, 
      message: 'Invoice synced to eTIMS successfully',
      etims_reference: response.data.rcptNo 
    });

  } catch (error) {
    console.error('eTIMS sync error:', error);
    res.status(500).json({ 
      message: 'Failed to sync to eTIMS', 
      error: error.response?.data || error.message 
    });
  }
});

// Bulk sync invoices
router.post('/bulk-sync-etims', authenticateToken, async (req, res) => {
  try {
    const { date_from, date_to } = req.body;
    
    const invoices = await airtableBase(TABLES.SALES).select({
      filterByFormula: `AND({sale_date} >= '${date_from}', {sale_date} <= '${date_to}', {etims_synced} = FALSE())`
    }).firstPage();

    const results = [];
    
    for (const invoice of invoices) {
      try {
        await axios.post('/api/accounting/sync-etims', { invoice_id: invoice.id });
        results.push({ invoice_id: invoice.id, status: 'success' });
      } catch (error) {
        results.push({ invoice_id: invoice.id, status: 'failed', error: error.message });
      }
    }

    res.json({ 
      message: `Processed ${invoices.length} invoices`,
      results 
    });

  } catch (error) {
    res.status(500).json({ message: 'Bulk sync failed', error: error.message });
  }
});

// Generate audit reports
router.get('/audit-report', authenticateToken, async (req, res) => {
  try {
    const { date_from, date_to, report_type } = req.query;
    
    let data = {};
    
    switch (report_type) {
      case 'sales':
        const sales = await airtableBase(TABLES.SALES).select({
          filterByFormula: `AND({sale_date} >= '${date_from}', {sale_date} <= '${date_to}')`
        }).firstPage();
        data.sales = sales.map(record => ({ id: record.id, ...record.fields }));
        break;
        
      case 'expenses':
        const expenses = await airtableBase(TABLES.EXPENSES).select({
          filterByFormula: `AND({expense_date} >= '${date_from}', {expense_date} <= '${date_to}')`
        }).firstPage();
        data.expenses = expenses.map(record => ({ id: record.id, ...record.fields }));
        break;
        
      case 'payroll':
        const payroll = await airtableBase(TABLES.PAYROLL).select({
          filterByFormula: `AND({pay_period_start} >= '${date_from}', {pay_period_end} <= '${date_to}')`
        }).firstPage();
        data.payroll = payroll.map(record => ({ id: record.id, ...record.fields }));
        break;
        
      default:
        // Full audit report
        const [salesData, expensesData, payrollData] = await Promise.all([
          airtableBase(TABLES.SALES).select({
            filterByFormula: `AND({sale_date} >= '${date_from}', {sale_date} <= '${date_to}')`
          }).firstPage(),
          airtableBase(TABLES.EXPENSES).select({
            filterByFormula: `AND({expense_date} >= '${date_from}', {expense_date} <= '${date_to}')`
          }).firstPage(),
          airtableBase(TABLES.PAYROLL).select({
            filterByFormula: `AND({pay_period_start} >= '${date_from}', {pay_period_end} <= '${date_to}')`
          }).firstPage()
        ]);
        
        data = {
          sales: salesData.map(record => ({ id: record.id, ...record.fields })),
          expenses: expensesData.map(record => ({ id: record.id, ...record.fields })),
          payroll: payrollData.map(record => ({ id: record.id, ...record.fields }))
        };
    }
    
    res.json(data);
    
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate audit report', error: error.message });
  }
});

module.exports = router;
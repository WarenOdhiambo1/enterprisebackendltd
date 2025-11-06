const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { base: airtableBase, TABLES } = require('../config/airtable');

// Get receipt settings
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const settings = await airtableBase(TABLES.RECEIPT_SETTINGS || 'Receipt_Settings').select().firstPage();
    res.json(settings.map(record => ({ id: record.id, ...record.fields })));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch receipt settings', error: error.message });
  }
});

// Save receipt settings
router.post('/settings', authenticateToken, async (req, res) => {
  try {
    const { companyName, primaryColor, secondaryColor, fontFamily, fontSize, showBorder } = req.body;
    
    const record = await airtableBase(TABLES.RECEIPT_SETTINGS || 'Receipt_Settings').create([{
      fields: {
        company_name: companyName,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        font_family: fontFamily,
        font_size: fontSize,
        show_border: showBorder,
        created_at: new Date().toISOString(),
        updated_by: req.user.id
      }
    }]);

    res.json({ id: record[0].id, ...record[0].fields });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save receipt settings', error: error.message });
  }
});

// Generate receipt HTML
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { saleId, customSettings } = req.body;
    
    // Get sale data
    const sale = await airtableBase(TABLES.SALES).find(saleId);
    const saleItems = await airtableBase(TABLES.SALE_ITEMS).select({
      filterByFormula: `{sale_id} = '${saleId}'`
    }).firstPage();

    // Get settings
    const settings = customSettings || {
      companyName: 'BSN MANAGER',
      primaryColor: '#1976d2',
      secondaryColor: '#f5f5f5',
      fontFamily: 'Arial',
      fontSize: '12px'
    };

    const receiptHTML = `
      <div style="font-family: ${settings.fontFamily}; font-size: ${settings.fontSize}; max-width: 400px; margin: 0 auto; padding: 20px; border: 2px solid ${settings.primaryColor};">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: ${settings.primaryColor}; margin: 0;">${settings.companyName}</h2>
          <p>Official Receipt</p>
        </div>
        
        <div style="background: ${settings.secondaryColor}; padding: 10px; margin: 10px 0;">
          <div><strong>Receipt No:</strong> ${sale.fields.id}</div>
          <div><strong>Date:</strong> ${new Date(sale.fields.sale_date).toLocaleDateString()}</div>
          <div><strong>Branch:</strong> ${sale.fields.branch_name || 'Main Branch'}</div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <thead>
            <tr style="background: ${settings.primaryColor}; color: white;">
              <th style="padding: 8px; text-align: left;">Item</th>
              <th style="padding: 8px;">Qty</th>
              <th style="padding: 8px;">Price</th>
              <th style="padding: 8px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${saleItems.map(item => `
              <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px;">${item.fields.product_name}</td>
                <td style="padding: 8px; text-align: center;">${item.fields.quantity}</td>
                <td style="padding: 8px; text-align: right;">KSH ${item.fields.unit_price}</td>
                <td style="padding: 8px; text-align: right;">KSH ${item.fields.total_price}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="border-top: 2px solid ${settings.primaryColor}; padding-top: 10px;">
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; color: ${settings.primaryColor};">
            <span>TOTAL:</span>
            <span>KSH ${sale.fields.total_amount}</span>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; font-size: 10px;">
          <p>Thank you for your business!</p>
          <p>Powered by BSN Manager</p>
        </div>
      </div>
    `;

    res.json({ html: receiptHTML });
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate receipt', error: error.message });
  }
});

module.exports = router;
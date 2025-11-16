const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, auditLog } = require('../middleware/auth');

const router = express.Router();

// Get all vendor credits
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { vendor, status, startDate, endDate } = req.query;
    let credits = await airtableHelpers.find(TABLES.VENDOR_CREDITS);
    
    if (vendor) credits = credits.filter(c => c.vendor_name && c.vendor_name.toLowerCase().includes(vendor.toLowerCase()));
    if (status) credits = credits.filter(c => c.status === status);
    if (startDate && endDate) {
      credits = credits.filter(c => {
        const creditDate = new Date(c.credit_date);
        return creditDate >= new Date(startDate) && creditDate <= new Date(endDate);
      });
    }
    
    res.json(credits);
  } catch (error) {
    console.error('Get vendor credits error:', error);
    res.status(500).json({ message: 'Failed to fetch vendor credits' });
  }
});

// Create vendor credit
router.post('/', authenticateToken, auditLog('CREATE_VENDOR_CREDIT'), async (req, res) => {
  try {
    const { vendor_name, credit_number, amount, reason, description, bill_id } = req.body;
    
    if (!vendor_name || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Vendor name and valid amount are required' });
    }
    
    const creditData = {
      vendor_name,
      credit_number: credit_number || `CR_${Date.now()}`,
      amount: parseFloat(amount),
      reason: reason || 'other',
      description: description || '',
      credit_date: new Date().toISOString().split('T')[0],
      status: 'pending',
      created_by: [req.user.id]
    };
    
    if (bill_id) creditData.bill_id = [bill_id];
    
    const credit = await airtableHelpers.create(TABLES.VENDOR_CREDITS, creditData);
    res.status(201).json(credit);
  } catch (error) {
    console.error('Create vendor credit error:', error);
    res.status(500).json({ message: 'Failed to create vendor credit' });
  }
});

// Apply credit to bill
router.post('/:id/apply', authenticateToken, auditLog('APPLY_VENDOR_CREDIT'), async (req, res) => {
  try {
    const { id } = req.params;
    const { bill_id } = req.body;
    
    const credit = await airtableHelpers.findById(TABLES.VENDOR_CREDITS, id);
    if (!credit) {
      return res.status(404).json({ message: 'Credit not found' });
    }
    
    if (credit.status === 'applied') {
      return res.status(400).json({ message: 'Credit already applied' });
    }
    
    const bill = await airtableHelpers.findById(TABLES.BILLS, bill_id);
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    
    // Apply credit to bill
    const creditAmount = parseFloat(credit.amount);
    const newAmountPaid = (bill.amount_paid || 0) + creditAmount;
    const newBalanceDue = (bill.total_amount || 0) - newAmountPaid;
    
    await airtableHelpers.update(TABLES.BILLS, bill_id, {
      amount_paid: newAmountPaid,
      balance_due: Math.max(0, newBalanceDue),
      payment_status: newBalanceDue <= 0 ? 'paid' : 'partial'
    });
    
    // Update credit status
    await airtableHelpers.update(TABLES.VENDOR_CREDITS, id, {
      status: 'applied',
      bill_id: [bill_id],
      applied_date: new Date().toISOString().split('T')[0],
      applied_by: [req.user.id]
    });
    
    res.json({ message: 'Credit applied successfully' });
  } catch (error) {
    console.error('Apply credit error:', error);
    res.status(500).json({ message: 'Failed to apply credit' });
  }
});

// Approve credit
router.post('/:id/approve', authenticateToken, auditLog('APPROVE_VENDOR_CREDIT'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const updatedCredit = await airtableHelpers.update(TABLES.VENDOR_CREDITS, id, {
      status: 'approved',
      approved_date: new Date().toISOString().split('T')[0],
      approved_by: [req.user.id],
      approval_notes: notes || ''
    });
    
    res.json(updatedCredit);
  } catch (error) {
    console.error('Approve credit error:', error);
    res.status(500).json({ message: 'Failed to approve credit' });
  }
});

// Update vendor credit
router.put('/:id', authenticateToken, auditLog('UPDATE_VENDOR_CREDIT'), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {
      ...req.body,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };
    
    const updatedCredit = await airtableHelpers.update(TABLES.VENDOR_CREDITS, id, updateData);
    res.json(updatedCredit);
  } catch (error) {
    console.error('Update vendor credit error:', error);
    res.status(500).json({ message: 'Failed to update vendor credit' });
  }
});

// Delete vendor credit
router.delete('/:id', authenticateToken, auditLog('DELETE_VENDOR_CREDIT'), async (req, res) => {
  try {
    const { id } = req.params;
    await airtableHelpers.delete(TABLES.VENDOR_CREDITS, id);
    res.json({ message: 'Vendor credit deleted successfully' });
  } catch (error) {
    console.error('Delete vendor credit error:', error);
    res.status(500).json({ message: 'Failed to delete vendor credit' });
  }
});

module.exports = router;
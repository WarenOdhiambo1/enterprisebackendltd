const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, auditLog } = require('../middleware/auth');

const router = express.Router();

// Payments dashboard
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const payments = await airtableHelpers.find(TABLES.PAYMENTS_MADE);
    
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const totalPayments = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const monthlyPayments = payments.filter(p => new Date(p.payment_date) >= thisMonth)
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const weeklyPayments = payments.filter(p => new Date(p.payment_date) >= thisWeek)
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    
    const methodBreakdown = payments.reduce((acc, p) => {
      const method = p.payment_method || 'unknown';
      acc[method] = (acc[method] || 0) + (parseFloat(p.amount) || 0);
      return acc;
    }, {});
    
    const statusBreakdown = payments.reduce((acc, p) => {
      const status = p.status || 'pending';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      totalPayments,
      monthlyPayments,
      weeklyPayments,
      paymentCount: payments.length,
      methodBreakdown,
      statusBreakdown,
      recentPayments: payments.slice(-10)
    });
  } catch (error) {
    console.error('Payments dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch payments dashboard' });
  }
});

// Get payment queue (pending payments)
router.get('/queue', authenticateToken, async (req, res) => {
  try {
    const bills = await airtableHelpers.find(TABLES.BILLS);
    const pendingPayments = bills.filter(bill => 
      bill.payment_status !== 'paid' && 
      bill.status === 'approved' &&
      (bill.balance_due || bill.total_amount) > 0
    );
    
    res.json(pendingPayments.map(bill => ({
      id: bill.id,
      vendor_name: bill.vendor_name,
      bill_number: bill.bill_number,
      amount_due: bill.balance_due || bill.total_amount,
      due_date: bill.due_date,
      priority: new Date(bill.due_date) <= new Date() ? 'high' : 'normal'
    })));
  } catch (error) {
    console.error('Get payment queue error:', error);
    res.status(500).json({ message: 'Failed to fetch payment queue' });
  }
});

// Process single payment
router.post('/process', authenticateToken, auditLog('PROCESS_PAYMENT'), async (req, res) => {
  try {
    const { bill_id, amount, payment_method, reference_number, notes } = req.body;
    
    if (!bill_id || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Bill ID and valid amount are required' });
    }
    
    const bill = await airtableHelpers.findById(TABLES.BILLS, bill_id);
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    
    const payment = await airtableHelpers.create(TABLES.PAYMENTS_MADE, {
      bill_id: [bill_id],
      vendor_name: bill.vendor_name,
      amount: parseFloat(amount),
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: payment_method || 'bank_transfer',
      reference_number: reference_number || `PAY_${Date.now()}`,
      notes: notes || '',
      status: 'completed',
      created_by: [req.user.id]
    });
    
    // Update bill payment status
    const newAmountPaid = (bill.amount_paid || 0) + parseFloat(amount);
    const newBalanceDue = (bill.total_amount || 0) - newAmountPaid;
    
    await airtableHelpers.update(TABLES.BILLS, bill_id, {
      amount_paid: newAmountPaid,
      balance_due: Math.max(0, newBalanceDue),
      payment_status: newBalanceDue <= 0 ? 'paid' : 'partial',
      last_payment_date: new Date().toISOString().split('T')[0]
    });
    
    res.json({ message: 'Payment processed successfully', payment });
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ message: 'Failed to process payment' });
  }
});

// Batch payment processing
router.post('/batch', authenticateToken, auditLog('BATCH_PROCESS_PAYMENTS'), async (req, res) => {
  try {
    const { payments } = req.body;
    const results = [];
    
    for (const paymentData of payments) {
      try {
        const { bill_id, amount, payment_method, reference_number } = paymentData;
        
        const bill = await airtableHelpers.findById(TABLES.BILLS, bill_id);
        if (!bill) {
          results.push({ bill_id, success: false, error: 'Bill not found' });
          continue;
        }
        
        const payment = await airtableHelpers.create(TABLES.PAYMENTS_MADE, {
          bill_id: [bill_id],
          vendor_name: bill.vendor_name,
          amount: parseFloat(amount),
          payment_date: new Date().toISOString().split('T')[0],
          payment_method: payment_method || 'bank_transfer',
          reference_number: reference_number || `PAY_${Date.now()}_${bill_id}`,
          status: 'completed',
          created_by: [req.user.id]
        });
        
        const newAmountPaid = (bill.amount_paid || 0) + parseFloat(amount);
        const newBalanceDue = (bill.total_amount || 0) - newAmountPaid;
        
        await airtableHelpers.update(TABLES.BILLS, bill_id, {
          amount_paid: newAmountPaid,
          balance_due: Math.max(0, newBalanceDue),
          payment_status: newBalanceDue <= 0 ? 'paid' : 'partial'
        });
        
        results.push({ bill_id, success: true, payment });
      } catch (error) {
        results.push({ bill_id: paymentData.bill_id, success: false, error: error.message });
      }
    }
    
    res.json({ results });
  } catch (error) {
    console.error('Batch payment error:', error);
    res.status(500).json({ message: 'Failed to process batch payments' });
  }
});

// Get all payments with filtering
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { method, status, startDate, endDate, page = 1, limit = 50 } = req.query;
    let payments = await airtableHelpers.find(TABLES.PAYMENTS_MADE);
    
    if (method) payments = payments.filter(p => p.payment_method === method);
    if (status) payments = payments.filter(p => p.status === status);
    if (startDate && endDate) {
      payments = payments.filter(p => {
        const payDate = new Date(p.payment_date);
        return payDate >= new Date(startDate) && payDate <= new Date(endDate);
      });
    }
    
    const startIndex = (page - 1) * limit;
    const paginatedPayments = payments.slice(startIndex, startIndex + parseInt(limit));
    
    res.json({
      payments: paginatedPayments,
      total: payments.length,
      page: parseInt(page),
      totalPages: Math.ceil(payments.length / limit)
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ message: 'Failed to fetch payments' });
  }
});

// Update payment status
router.put('/:id/status', authenticateToken, auditLog('UPDATE_PAYMENT_STATUS'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    
    const updatedPayment = await airtableHelpers.update(TABLES.PAYMENTS_MADE, id, {
      status,
      notes: notes || '',
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    });
    
    res.json(updatedPayment);
  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({ message: 'Failed to update payment status' });
  }
});

module.exports = router;
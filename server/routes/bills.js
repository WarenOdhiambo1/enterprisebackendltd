const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');

const router = express.Router();

// Get all bills
router.get('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { status, startDate, endDate, vendorId } = req.query;
    
    let filterFormula = '';
    if (status) {
      filterFormula = `{status} = "${status}"`;
    }
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({bill_date}, "${startDate}"), IS_BEFORE({bill_date}, "${endDate}"))`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${dateFilter})` : dateFilter;
    }
    
    if (vendorId) {
      const vendorFilter = `{vendor_id} = "${vendorId}"`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${vendorFilter})` : vendorFilter;
    }

    const bills = await airtableHelpers.find(TABLES.BILLS, filterFormula);
    
    // Enrich with vendor and payment details
    const enrichedBills = await Promise.all(
      bills.map(async (bill) => {
        try {
          // Get related payments
          const payments = await airtableHelpers.find(
            TABLES.PAYMENTS_MADE,
            `{bill_id} = "${bill.id}"`
          );
          
          const totalPaid = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
          
          return {
            ...bill,
            payments: payments || [],
            total_paid: totalPaid,
            balance_due: (bill.total_amount || 0) - totalPaid,
            payment_status: totalPaid >= (bill.total_amount || 0) ? 'paid' : 
                           totalPaid > 0 ? 'partial' : 'unpaid'
          };
        } catch (error) {
          return { ...bill, payments: [], total_paid: 0, balance_due: bill.total_amount || 0 };
        }
      })
    );

    res.json(enrichedBills);
  } catch (error) {
    console.error('Get bills error:', error);
    res.status(500).json({ message: 'Failed to fetch bills' });
  }
});

// Create new bill
router.post('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('CREATE_BILL'), async (req, res) => {
  try {
    const {
      vendor_name,
      bill_number,
      bill_date,
      due_date,
      purchase_order_id,
      receive_id,
      line_items,
      subtotal,
      tax_amount,
      total_amount,
      notes,
      payment_terms
    } = req.body;

    if (!vendor_name || !bill_number || !bill_date || !total_amount) {
      return res.status(400).json({ 
        message: 'Vendor name, bill number, bill date, and total amount are required' 
      });
    }

    // Check for duplicate bill number
    const existingBill = await airtableHelpers.find(
      TABLES.BILLS,
      `{bill_number} = "${bill_number}"`
    );

    if (existingBill.length > 0) {
      return res.status(400).json({ message: 'Bill number already exists' });
    }

    // Create bill record
    const billData = {
      vendor_name,
      bill_number,
      bill_date,
      due_date: due_date || bill_date,
      purchase_order_id: purchase_order_id ? [purchase_order_id] : null,
      receive_id: receive_id ? [receive_id] : null,
      subtotal: Number(subtotal) || 0,
      tax_amount: Number(tax_amount) || 0,
      total_amount: Number(total_amount),
      amount_paid: 0,
      balance_due: Number(total_amount),
      status: 'draft',
      payment_status: 'unpaid',
      payment_terms: payment_terms || 'Net 30',
      notes: notes || '',
      created_by: [req.user.id],
      created_at: new Date().toISOString()
    };

    const bill = await airtableHelpers.create(TABLES.BILLS, billData);

    // Create bill line items if provided
    const billItems = [];
    if (line_items && line_items.length > 0) {
      for (const item of line_items) {
        if (!item.description || !item.amount) continue;

        const billItem = await airtableHelpers.create(TABLES.BILL_ITEMS, {
          bill_id: [bill.id],
          description: item.description,
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          amount: Number(item.amount),
          account_code: item.account_code || '',
          tax_rate: Number(item.tax_rate) || 0
        });

        billItems.push(billItem);
      }
    }

    // Update purchase order status if linked
    if (purchase_order_id) {
      await airtableHelpers.update(TABLES.ORDERS, purchase_order_id, {
        status: 'billed',
        billed_at: new Date().toISOString()
      });
    }

    res.status(201).json({
      message: 'Bill created successfully',
      bill: { ...bill, line_items: billItems }
    });
  } catch (error) {
    console.error('Create bill error:', error);
    res.status(500).json({ 
      message: 'Failed to create bill',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get bill by ID
router.get('/:billId', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { billId } = req.params;
    
    const bill = await airtableHelpers.findById(TABLES.BILLS, billId);
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    // Get bill line items
    const lineItems = await airtableHelpers.find(
      TABLES.BILL_ITEMS,
      `{bill_id} = "${billId}"`
    );

    // Get payments
    const payments = await airtableHelpers.find(
      TABLES.PAYMENTS_MADE,
      `{bill_id} = "${billId}"`
    );

    // Get related purchase order and receive
    const order = bill.purchase_order_id ? 
      await airtableHelpers.findById(TABLES.ORDERS, bill.purchase_order_id[0]) : null;
    
    const receive = bill.receive_id ? 
      await airtableHelpers.findById(TABLES.PURCHASE_RECEIVES, bill.receive_id[0]) : null;

    const totalPaid = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);

    res.json({
      ...bill,
      line_items: lineItems,
      payments,
      order_details: order,
      receive_details: receive,
      total_paid: totalPaid,
      balance_due: (bill.total_amount || 0) - totalPaid,
      payment_status: totalPaid >= (bill.total_amount || 0) ? 'paid' : 
                     totalPaid > 0 ? 'partial' : 'unpaid'
    });
  } catch (error) {
    console.error('Get bill error:', error);
    res.status(500).json({ message: 'Failed to fetch bill' });
  }
});

// Update bill status
router.put('/:billId/status', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('UPDATE_BILL_STATUS'), async (req, res) => {
  try {
    const { billId } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['draft', 'sent', 'approved', 'paid', 'overdue', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
      updated_by: [req.user.id]
    };

    if (notes) updateData.notes = notes;
    if (status === 'approved') updateData.approved_at = new Date().toISOString();
    if (status === 'sent') updateData.sent_at = new Date().toISOString();

    const updatedBill = await airtableHelpers.update(TABLES.BILLS, billId, updateData);

    res.json({
      message: `Bill ${status} successfully`,
      bill: updatedBill
    });
  } catch (error) {
    console.error('Update bill status error:', error);
    res.status(500).json({ message: 'Failed to update bill status' });
  }
});

// Record payment against bill
router.post('/:billId/payment', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('RECORD_BILL_PAYMENT'), async (req, res) => {
  try {
    const { billId } = req.params;
    const { amount, payment_date, payment_method, reference_number, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }

    const bill = await airtableHelpers.findById(TABLES.BILLS, billId);
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    if (amount > bill.balance_due) {
      return res.status(400).json({ 
        message: `Payment amount cannot exceed balance due (${bill.balance_due})` 
      });
    }

    // Create payment record
    const payment = await airtableHelpers.create(TABLES.PAYMENTS_MADE, {
      bill_id: [billId],
      vendor_name: bill.vendor_name,
      amount: Number(amount),
      payment_date: payment_date || new Date().toISOString().split('T')[0],
      payment_method: payment_method || 'bank_transfer',
      reference_number: reference_number || `PAY_${Date.now()}`,
      notes: notes || '',
      status: 'completed',
      created_by: [req.user.id],
      created_at: new Date().toISOString()
    });

    // Update bill payment status
    const newAmountPaid = bill.amount_paid + Number(amount);
    const newBalanceDue = bill.total_amount - newAmountPaid;
    
    let paymentStatus = 'unpaid';
    if (newBalanceDue <= 0) {
      paymentStatus = 'paid';
    } else if (newAmountPaid > 0) {
      paymentStatus = 'partial';
    }

    await airtableHelpers.update(TABLES.BILLS, billId, {
      amount_paid: newAmountPaid,
      balance_due: newBalanceDue,
      payment_status: paymentStatus,
      last_payment_date: payment_date || new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString()
    });

    res.json({
      message: 'Payment recorded successfully',
      payment,
      bill_status: {
        amount_paid: newAmountPaid,
        balance_due: newBalanceDue,
        payment_status: paymentStatus
      }
    });
  } catch (error) {
    console.error('Record bill payment error:', error);
    res.status(500).json({ message: 'Failed to record payment' });
  }
});

// Delete bill
router.delete('/:billId', authenticateToken, authorizeRoles(['admin', 'boss']), auditLog('DELETE_BILL'), async (req, res) => {
  try {
    const { billId } = req.params;

    // Delete bill items first
    const items = await airtableHelpers.find(
      TABLES.BILL_ITEMS,
      `{bill_id} = "${billId}"`
    );

    await Promise.all(
      items.map(item => airtableHelpers.delete(TABLES.BILL_ITEMS, item.id))
    );

    // Delete bill
    await airtableHelpers.delete(TABLES.BILLS, billId);

    res.json({ message: 'Bill deleted successfully' });
  } catch (error) {
    console.error('Delete bill error:', error);
    res.status(500).json({ message: 'Failed to delete bill' });
  }
});

module.exports = router;
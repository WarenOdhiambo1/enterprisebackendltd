const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');

const router = express.Router();

// Get all purchase receives
router.get('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { status, startDate, endDate, branchId } = req.query;
    
    let filterFormula = '';
    if (status) {
      filterFormula = `{status} = "${status}"`;
    }
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({receive_date}, "${startDate}"), IS_BEFORE({receive_date}, "${endDate}"))`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${dateFilter})` : dateFilter;
    }
    
    if (branchId && branchId !== 'all') {
      const branchFilter = `{receiving_branch_id} = "${branchId}"`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${branchFilter})` : branchFilter;
    }

    const receives = await airtableHelpers.find(TABLES.PURCHASE_RECEIVES, filterFormula);
    
    // Enrich with order and item details
    const enrichedReceives = await Promise.all(
      receives.map(async (receive) => {
        try {
          // Get related purchase order
          const order = receive.purchase_order_id ? 
            await airtableHelpers.findById(TABLES.ORDERS, receive.purchase_order_id[0]) : null;
          
          // Get receive items
          const items = await airtableHelpers.find(
            TABLES.RECEIVE_ITEMS,
            `{receive_id} = "${receive.id}"`
          );
          
          return {
            ...receive,
            order_details: order,
            items: items || []
          };
        } catch (error) {
          return { ...receive, order_details: null, items: [] };
        }
      })
    );

    res.json(enrichedReceives);
  } catch (error) {
    console.error('Get purchase receives error:', error);
    res.status(500).json({ message: 'Failed to fetch purchase receives' });
  }
});

// Create new purchase receive
router.post('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('CREATE_PURCHASE_RECEIVE'), async (req, res) => {
  try {
    const {
      purchase_order_id,
      receiving_branch_id,
      receive_date,
      received_by,
      notes,
      items
    } = req.body;

    if (!purchase_order_id || !receiving_branch_id || !receive_date || !items || items.length === 0) {
      return res.status(400).json({ 
        message: 'Purchase order, receiving branch, receive date, and items are required' 
      });
    }

    // Validate purchase order exists
    const order = await airtableHelpers.findById(TABLES.ORDERS, purchase_order_id);
    if (!order) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    // Create receive record
    const receiveData = {
      purchase_order_id: [purchase_order_id],
      receiving_branch_id: [receiving_branch_id],
      receive_date,
      received_by: received_by || req.user.fullName,
      status: 'received',
      notes: notes || '',
      created_by: [req.user.id],
      created_at: new Date().toISOString()
    };

    const receive = await airtableHelpers.create(TABLES.PURCHASE_RECEIVES, receiveData);

    // Create receive items
    const receiveItems = [];
    let totalReceived = 0;
    let totalOrdered = 0;

    for (const item of items) {
      if (!item.product_name || !item.quantity_received) {
        continue;
      }

      const receiveItem = await airtableHelpers.create(TABLES.RECEIVE_ITEMS, {
        receive_id: [receive.id],
        product_name: item.product_name,
        quantity_ordered: Number(item.quantity_ordered) || 0,
        quantity_received: Number(item.quantity_received),
        unit_cost: Number(item.unit_cost) || 0,
        total_cost: Number(item.quantity_received) * Number(item.unit_cost || 0),
        condition: item.condition || 'good',
        notes: item.notes || ''
      });

      receiveItems.push(receiveItem);
      totalReceived += Number(item.quantity_received);
      totalOrdered += Number(item.quantity_ordered) || 0;

      // Update stock if item is in good condition
      if (item.condition === 'good' && item.quantity_received > 0) {
        // Check if product exists in receiving branch
        const existingStock = await airtableHelpers.find(
          TABLES.STOCK,
          `AND({branch_id} = "${receiving_branch_id}", {product_name} = "${item.product_name}")`
        );

        if (existingStock.length > 0) {
          // Update existing stock
          const newQuantity = existingStock[0].quantity_available + Number(item.quantity_received);
          await airtableHelpers.update(TABLES.STOCK, existingStock[0].id, {
            quantity_available: newQuantity,
            unit_price: Number(item.unit_cost) || existingStock[0].unit_price,
            last_updated: new Date().toISOString()
          });
        } else {
          // Create new stock entry
          await airtableHelpers.create(TABLES.STOCK, {
            branch_id: [receiving_branch_id],
            product_id: `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            product_name: item.product_name,
            quantity_available: Number(item.quantity_received),
            unit_price: Number(item.unit_cost) || 0,
            reorder_level: 10,
            last_updated: new Date().toISOString()
          });
        }

        // Create stock movement record
        await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
          to_branch_id: [receiving_branch_id],
          product_name: item.product_name,
          quantity: Number(item.quantity_received),
          movement_type: 'purchase_receive',
          reason: `Goods received from PO #${order.id}`,
          status: 'completed',
          transfer_date: receive_date,
          created_by: [req.user.id],
          unit_cost: Number(item.unit_cost) || 0,
          total_cost: Number(item.quantity_received) * Number(item.unit_cost || 0)
        });
      }
    }

    // Update receive with totals
    await airtableHelpers.update(TABLES.PURCHASE_RECEIVES, receive.id, {
      total_items: receiveItems.length,
      total_quantity_received: totalReceived,
      total_quantity_ordered: totalOrdered,
      receive_status: totalReceived >= totalOrdered ? 'complete' : 'partial'
    });

    // Update purchase order status if fully received
    if (totalReceived >= totalOrdered) {
      await airtableHelpers.update(TABLES.ORDERS, purchase_order_id, {
        status: 'received'
      });
    }

    res.status(201).json({
      message: 'Purchase receive created successfully',
      receive: { ...receive, items: receiveItems },
      summary: {
        totalItems: receiveItems.length,
        totalReceived,
        totalOrdered,
        receiveStatus: totalReceived >= totalOrdered ? 'complete' : 'partial'
      }
    });
  } catch (error) {
    console.error('Create purchase receive error:', error);
    res.status(500).json({ 
      message: 'Failed to create purchase receive',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get receive by ID
router.get('/:receiveId', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { receiveId } = req.params;
    
    const receive = await airtableHelpers.findById(TABLES.PURCHASE_RECEIVES, receiveId);
    if (!receive) {
      return res.status(404).json({ message: 'Purchase receive not found' });
    }

    // Get receive items
    const items = await airtableHelpers.find(
      TABLES.RECEIVE_ITEMS,
      `{receive_id} = "${receiveId}"`
    );

    // Get related purchase order
    const order = receive.purchase_order_id ? 
      await airtableHelpers.findById(TABLES.ORDERS, receive.purchase_order_id[0]) : null;

    res.json({
      ...receive,
      items,
      order_details: order
    });
  } catch (error) {
    console.error('Get receive error:', error);
    res.status(500).json({ message: 'Failed to fetch purchase receive' });
  }
});

// Update receive status
router.put('/:receiveId/status', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('UPDATE_RECEIVE_STATUS'), async (req, res) => {
  try {
    const { receiveId } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['received', 'inspected', 'approved', 'rejected'];
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
    if (status === 'rejected') updateData.rejected_at = new Date().toISOString();

    const updatedReceive = await airtableHelpers.update(TABLES.PURCHASE_RECEIVES, receiveId, updateData);

    res.json({
      message: `Purchase receive ${status} successfully`,
      receive: updatedReceive
    });
  } catch (error) {
    console.error('Update receive status error:', error);
    res.status(500).json({ message: 'Failed to update receive status' });
  }
});

// Delete receive
router.delete('/:receiveId', authenticateToken, authorizeRoles(['admin', 'boss']), auditLog('DELETE_PURCHASE_RECEIVE'), async (req, res) => {
  try {
    const { receiveId } = req.params;

    // Delete receive items first
    const items = await airtableHelpers.find(
      TABLES.RECEIVE_ITEMS,
      `{receive_id} = "${receiveId}"`
    );

    await Promise.all(
      items.map(item => airtableHelpers.delete(TABLES.RECEIVE_ITEMS, item.id))
    );

    // Delete receive
    await airtableHelpers.delete(TABLES.PURCHASE_RECEIVES, receiveId);

    res.json({ message: 'Purchase receive deleted successfully' });
  } catch (error) {
    console.error('Delete receive error:', error);
    res.status(500).json({ message: 'Failed to delete purchase receive' });
  }
});

module.exports = router;
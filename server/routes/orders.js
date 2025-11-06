const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authorizeRoles, auditLog } = require('../middleware/auth');

// CSRF protection middleware (disabled in development)
const csrfProtection = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  if (!token) {
    return res.status(403).json({ message: 'CSRF token required' });
  }
  next();
};

const router = express.Router();

// Get all orders
router.get('/', authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;
    
    let filterFormula = '';
    if (status) {
      filterFormula = `{status} = "${status}"`;
    }
    
    if (startDate && endDate) {
      const dateFilter = `AND(IS_AFTER({order_date}, "${startDate}"), IS_BEFORE({order_date}, "${endDate}"))`;
      filterFormula = filterFormula ? `AND(${filterFormula}, ${dateFilter})` : dateFilter;
    }

    const orders = await airtableHelpers.find(TABLES.ORDERS, filterFormula);
    
    // Get order items for each order
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const items = await airtableHelpers.find(
          TABLES.ORDER_ITEMS,
          `{order_id} = "${order.id}"`
        );
        return { ...order, items };
      })
    );

    res.json(ordersWithItems);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Create new order
router.post('/', csrfProtection, authorizeRoles(['admin', 'manager', 'boss']), auditLog('CREATE_ORDER'), async (req, res) => {
  try {
    const {
      supplier_name,
      order_date,
      expected_delivery_date,
      items
    } = req.body;

    if (!supplier_name || !order_date || !items || items.length === 0) {
      return res.status(400).json({ message: 'Supplier name, order date, and items are required' });
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => {
      return sum + (item.quantity_ordered * item.purchase_price_per_unit);
    }, 0);

    // Create order
    const order = await airtableHelpers.create(TABLES.ORDERS, {
      supplier_name,
      order_date,
      expected_delivery_date: expected_delivery_date || null,
      total_amount: totalAmount,
      amount_paid: 0,
      balance_remaining: totalAmount,
      status: 'ordered',
      created_by: req.user.id
    });

    // Create order items
    const orderItems = await Promise.all(
      items.map(item => 
        airtableHelpers.create(TABLES.ORDER_ITEMS, {
          order_id: order.id,
          product_name: item.product_name,
          quantity_ordered: item.quantity_ordered,
          purchase_price_per_unit: item.purchase_price_per_unit,
          quantity_received: 0,
          branch_destination_id: item.branch_destination_id || null
        })
      )
    );

    res.status(201).json({
      order: order,
      items: orderItems
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Failed to create order' });
  }
});

// Record payment for order
router.post('/:orderId/payment', csrfProtection, authorizeRoles(['admin', 'manager', 'boss']), auditLog('RECORD_PAYMENT'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }

    const order = await airtableHelpers.findById(TABLES.ORDERS, orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const newAmountPaid = order.amount_paid + parseFloat(amount);
    const newBalance = order.total_amount - newAmountPaid;

    let newStatus = order.status;
    if (newBalance <= 0) {
      newStatus = 'paid';
    } else if (newAmountPaid > 0) {
      newStatus = 'partially_paid';
    }

    const updatedOrder = await airtableHelpers.update(TABLES.ORDERS, orderId, {
      amount_paid: newAmountPaid,
      balance_remaining: newBalance,
      status: newStatus
    });

    res.json(updatedOrder);
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ message: 'Failed to record payment' });
  }
});

// Mark items as delivered
router.post('/:orderId/delivery', csrfProtection, authorizeRoles(['admin', 'manager', 'boss']), auditLog('MARK_DELIVERED'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { deliveredItems } = req.body;

    if (!deliveredItems || deliveredItems.length === 0) {
      return res.status(400).json({ message: 'Delivered items are required' });
    }

    // Update order items and add to stock
    await Promise.all(
      deliveredItems.map(async (item) => {
        // Update order item
        await airtableHelpers.update(TABLES.ORDER_ITEMS, item.orderItemId, {
          quantity_received: item.quantityReceived
        });

        // Add to branch stock if destination specified
        if (item.branchDestinationId && item.quantityReceived > 0) {
          // Check if product already exists in branch stock
          const existingStock = await airtableHelpers.find(
            TABLES.STOCK,
            `AND({branch_id} = "${item.branchDestinationId}", {product_name} = "${item.productName}")`
          );

          if (existingStock.length > 0) {
            // Update existing stock
            const newQuantity = existingStock[0].quantity_available + item.quantityReceived;
            await airtableHelpers.update(TABLES.STOCK, existingStock[0].id, {
              quantity_available: newQuantity,
              unit_price: item.purchasePrice, // Update with latest purchase price
              last_updated: new Date().toISOString(),
              updated_by: req.user.id
            });
          } else {
            // Create new stock entry
            await airtableHelpers.create(TABLES.STOCK, {
              branch_id: item.branchDestinationId,
              product_id: `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              product_name: item.productName,
              quantity_available: item.quantityReceived,
              reorder_level: 10, // Default reorder level
              unit_price: item.purchasePrice,
              last_updated: new Date().toISOString(),
              updated_by: req.user.id
            });
          }

          // Log stock movement
          await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
            to_branch_id: item.branchDestinationId,
            product_id: item.productId || `PRD_${Date.now()}`,
            quantity: item.quantityReceived,
            movement_type: 'new_stock',
            status: 'approved',
            requested_by: req.user.id,
            approved_by: req.user.id,
            created_at: new Date().toISOString(),
            approved_at: new Date().toISOString()
          });
        }
      })
    );

    // Check if order is fully delivered
    const orderItems = await airtableHelpers.find(
      TABLES.ORDER_ITEMS,
      `{order_id} = "${orderId}"`
    );

    const fullyDelivered = orderItems.every(item => 
      item.quantity_received >= item.quantity_ordered
    );

    if (fullyDelivered) {
      await airtableHelpers.update(TABLES.ORDERS, orderId, {
        status: 'completed'
      });
    } else {
      await airtableHelpers.update(TABLES.ORDERS, orderId, {
        status: 'delivered'
      });
    }

    res.json({ message: 'Delivery recorded successfully' });
  } catch (error) {
    console.error('Mark delivered error:', error);
    res.status(500).json({ message: 'Failed to record delivery' });
  }
});

// Update order
router.put('/:orderId', csrfProtection, authorizeRoles(['admin', 'manager', 'boss']), auditLog('UPDATE_ORDER'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { supplier_name, expected_delivery_date, status } = req.body;

    const updateData = {};
    if (supplier_name) updateData.supplier_name = supplier_name;
    if (expected_delivery_date) updateData.expected_delivery_date = expected_delivery_date;
    if (status) updateData.status = status;

    const updatedOrder = await airtableHelpers.update(TABLES.ORDERS, orderId, updateData);

    res.json(updatedOrder);
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ message: 'Failed to update order' });
  }
});

// Delete order
router.delete('/:orderId', authorizeRoles(['admin', 'manager', 'boss']), auditLog('DELETE_ORDER'), async (req, res) => {
  try {
    const { orderId } = req.params;

    // Delete order items first
    const orderItems = await airtableHelpers.find(
      TABLES.ORDER_ITEMS,
      `{order_id} = "${orderId}"`
    );

    await Promise.all(
      orderItems.map(item => airtableHelpers.delete(TABLES.ORDER_ITEMS, item.id))
    );

    // Delete order
    await airtableHelpers.delete(TABLES.ORDERS, orderId);

    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ message: 'Failed to delete order' });
  }
});

module.exports = router;
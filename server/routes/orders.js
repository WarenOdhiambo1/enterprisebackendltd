const express = require('express');
const { airtableHelpers, TABLES } = require('../config/airtable');
const { authenticateToken, authorizeRoles, auditLog } = require('../middleware/auth');

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
router.get('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
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
    
    // Get order items from ORDER_ITEMS table with multiple approaches
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        let items = [];
        try {
          // Try primary approach
          items = await airtableHelpers.find(
            TABLES.ORDER_ITEMS,
            `{order_id} = "${order.id}"`
          );
        } catch (error) {
          console.log(`Failed to find items for order ${order.id} with filter, trying alternative`);
          try {
            // Try alternative approach - get all items and filter manually
            const allItems = await airtableHelpers.find(TABLES.ORDER_ITEMS);
            items = allItems.filter(item => 
              item.order_id && (
                (Array.isArray(item.order_id) && item.order_id.includes(order.id)) ||
                item.order_id === order.id
              )
            );
          } catch (altError) {
            console.log(`Alternative approach also failed for order ${order.id}:`, altError.message);
          }
        }
        return { ...order, items };
      })
    );

    res.json(ordersWithItems);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Debug endpoint to check order items
router.get('/debug/:orderId', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Get order
    const order = await airtableHelpers.findById(TABLES.ORDERS, orderId);
    
    // Get all order items
    const allOrderItems = await airtableHelpers.find(TABLES.ORDER_ITEMS);
    
    // Filter items for this order
    const orderItems = allOrderItems.filter(item => 
      item.order_id && (
        (Array.isArray(item.order_id) && item.order_id.includes(orderId)) ||
        item.order_id === orderId
      )
    );
    
    res.json({
      order,
      orderItems,
      totalOrderItems: allOrderItems.length,
      matchingItems: orderItems.length
    });
  } catch (error) {
    console.error('Debug order error:', error);
    res.status(500).json({ message: 'Failed to debug order' });
  }
});

// Create new order
router.post('/', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('CREATE_ORDER'), async (req, res) => {
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

    // Basic validation
    for (const item of items) {
      if (!item.product_name || !item.quantity_ordered || !item.purchase_price_per_unit) {
        return res.status(400).json({ 
          message: 'Each item must have product name, quantity, and purchase price' 
        });
      }
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => {
      return sum + (item.quantity_ordered * item.purchase_price_per_unit);
    }, 0);

    // Create order
    const orderData = {
      supplier_name,
      order_date,
      total_amount: totalAmount,
      amount_paid: 0,
      balance_remaining: totalAmount,
      status: 'ordered'
    };
    
    if (expected_delivery_date) {
      orderData.expected_delivery_date = expected_delivery_date;
    }
    
    const order = await airtableHelpers.create(TABLES.ORDERS, orderData);

    // Create order items in ORDER_ITEMS table
    const orderItems = [];
    for (const item of items) {
      const orderItem = await airtableHelpers.create(TABLES.ORDER_ITEMS, {
        order_id: [order.id],
        product_name: item.product_name,
        quantity_ordered: Number(item.quantity_ordered),
        purchase_price_per_unit: Number(item.purchase_price_per_unit),
        quantity_received: 0,
        branch_destination_id: item.branch_destination_id ? [item.branch_destination_id] : null
      });
      orderItems.push(orderItem);
    }

    res.status(201).json({
      message: 'Order created successfully',
      order: { ...order, items: orderItems }
    });
  } catch (error) {
    console.error('Create order error:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      message: 'Failed to create order', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Record payment for order
router.post('/:orderId/payment', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('RECORD_PAYMENT'), async (req, res) => {
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
router.post('/:orderId/delivery', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('MARK_DELIVERED'), async (req, res) => {
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
              branch_id: [item.branchDestinationId],
              product_id: `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              product_name: item.productName,
              quantity_available: item.quantityReceived,
              reorder_level: 10, // Default reorder level
              unit_price: item.purchasePrice,
              last_updated: new Date().toISOString()
            });
          }

          // Log stock movement
          await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
            to_branch_id: [item.branchDestinationId],
            product_id: item.productId || `PRD_${Date.now()}`,
            product_name: item.productName,
            quantity: item.quantityReceived,
            movement_type: 'purchase',
            reason: 'Stock added from order delivery',
            order_id: [orderId],
            status: 'completed',
            created_by: [req.user.id],
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

// Mark order as complete and add all items to stock
router.post('/:orderId/complete', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('COMPLETE_ORDER'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { completedItems } = req.body;

    console.log('Completing order:', orderId);
    console.log('Completed items:', completedItems);

    // Get the order to validate
    const order = await airtableHelpers.findById(TABLES.ORDERS, orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Get order items - try multiple approaches
    let orderItems = [];
    try {
      orderItems = await airtableHelpers.find(
        TABLES.ORDER_ITEMS,
        `{order_id} = "${orderId}"`
      );
    } catch (error) {
      console.log('Failed to find order items with filter, trying alternative approach');
      // Try to get all order items and filter manually
      const allOrderItems = await airtableHelpers.find(TABLES.ORDER_ITEMS);
      orderItems = allOrderItems.filter(item => 
        item.order_id && (item.order_id.includes(orderId) || item.order_id === orderId)
      );
    }

    console.log('Order items found:', orderItems.length);
    
    // If no order items found but completedItems provided, use completedItems directly
    if (orderItems.length === 0 && completedItems && completedItems.length > 0) {
      console.log('No order items found in database, processing provided completed items');
      
      // Process each completed item directly
      for (const item of completedItems) {
        console.log('Processing item:', item);
        
        // Add to branch stock if destination specified
        if (item.branchDestinationId && item.quantityOrdered > 0) {
          const existingStock = await airtableHelpers.find(TABLES.STOCK);
          const branchStock = existingStock.filter(s => 
            s.branch_id && s.branch_id.includes(item.branchDestinationId) && 
            s.product_name === item.productName
          );

          if (branchStock.length > 0) {
            // Update existing stock
            const stockItem = branchStock[0];
            const newQuantity = stockItem.quantity_available + item.quantityOrdered;
            await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
              quantity_available: newQuantity,
              unit_price: item.purchasePrice,
              last_updated: new Date().toISOString()
            });
          } else {
            // Create new stock entry
            await airtableHelpers.create(TABLES.STOCK, {
              branch_id: [item.branchDestinationId],
              product_id: item.productId || `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              product_name: item.productName,
              quantity_available: item.quantityOrdered,
              reorder_level: 10,
              unit_price: item.purchasePrice,
              last_updated: new Date().toISOString(),
            });
          }

          // Create stock movement record
          await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
            to_branch_id: [item.branchDestinationId],
            product_id: item.productId || `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            product_name: item.productName,
            quantity: item.quantityOrdered,
            movement_type: 'purchase',
            reason: 'Stock added from completed order',
            status: 'completed',
            created_by: [req.user.id],
          });
        }
      }
    } else if (orderItems.length > 0) {
      // Process existing order items
      for (const item of completedItems) {
        console.log('Processing item:', item);
        
        // Find matching order item
        const orderItem = orderItems.find(oi => oi.id === item.orderItemId);
        if (orderItem) {
          // Update order item as received
          await airtableHelpers.update(TABLES.ORDER_ITEMS, item.orderItemId, {
            quantity_received: item.quantityOrdered
          });
        }
        
        // Add to branch stock if destination specified
        if (item.branchDestinationId && item.quantityOrdered > 0) {
          const existingStock = await airtableHelpers.find(TABLES.STOCK);
          const branchStock = existingStock.filter(s => 
            s.branch_id && s.branch_id.includes(item.branchDestinationId) && 
            s.product_name === item.productName
          );

          if (branchStock.length > 0) {
            // Update existing stock
            const stockItem = branchStock[0];
            const newQuantity = stockItem.quantity_available + item.quantityOrdered;
            await airtableHelpers.update(TABLES.STOCK, stockItem.id, {
              quantity_available: newQuantity,
              unit_price: item.purchasePrice,
              last_updated: new Date().toISOString()
            });
          } else {
            // Create new stock entry
            await airtableHelpers.create(TABLES.STOCK, {
              branch_id: [item.branchDestinationId],
              product_id: item.productId || `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              product_name: item.productName,
              quantity_available: item.quantityOrdered,
              reorder_level: 10,
              unit_price: item.purchasePrice,
              last_updated: new Date().toISOString(),
            });
          }

          // Create stock movement record
          await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, {
            to_branch_id: [item.branchDestinationId],
            product_id: item.productId || `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            product_name: item.productName,
            quantity: item.quantityOrdered,
            movement_type: 'purchase',
            reason: 'Stock added from completed order',
            status: 'completed',
            created_by: [req.user.id],
          });
        }
      }
    } else {
      return res.status(400).json({ 
        message: 'No order items found and no completed items provided. Cannot complete order.' 
      });
    }

    // Mark order as completed and update payment status if needed
    const orderUpdate = {
      status: 'completed',
      completed_at: new Date().toISOString()
    };
    
    // If order is not fully paid, mark as paid when completed
    if (order.balance_remaining > 0) {
      orderUpdate.amount_paid = order.total_amount;
      orderUpdate.balance_remaining = 0;
    }
    
    await airtableHelpers.update(TABLES.ORDERS, orderId, orderUpdate);

    res.json({ 
      success: true,
      message: 'Order completed successfully and stock added to branches',
      order_status: 'completed'
    });
  } catch (error) {
    console.error('Complete order error:', error);
    res.status(500).json({ message: 'Failed to complete order' });
  }
});

// Update order
router.put('/:orderId', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('UPDATE_ORDER'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { supplier_name, expected_delivery_date, status } = req.body;

    const updateData = {};
    if (supplier_name) updateData.supplier_name = supplier_name;
    if (expected_delivery_date) updateData.expected_delivery_date = expected_delivery_date;
    if (status) updateData.status = status;
    updateData.updated_at = new Date().toISOString();

    const updatedOrder = await airtableHelpers.update(TABLES.ORDERS, orderId, updateData);

    res.json(updatedOrder);
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ message: 'Failed to update order' });
  }
});

// Delete order
router.delete('/:orderId', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), auditLog('DELETE_ORDER'), async (req, res) => {
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
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

// Order Processing Flow Architecture - Get all orders with complete lifecycle
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
    // Enrich orders with complete lifecycle data
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const [items, receives, bills, payments] = await Promise.all([
          // Order items
          airtableHelpers.find(TABLES.ORDER_ITEMS, `{order_id} = "${order.id}"`).catch(() => []),
          // Purchase receives
          airtableHelpers.find(TABLES.PURCHASE_RECEIVES, `{purchase_order_id} = "${order.id}"`).catch(() => []),
          // Bills
          airtableHelpers.find(TABLES.BILLS, `{purchase_order_id} = "${order.id}"`).catch(() => []),
          // Payments
          airtableHelpers.find(TABLES.PAYMENTS_MADE, `{order_id} = "${order.id}"`).catch(() => [])
        ]);
        
        return { ...order, items, receives, bills, payments };
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

// Create order with complete workflow (Phase 1: Order Creation)
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

    // Create order with complete workflow fields
    const orderData = {
      supplier_name,
      order_date,
      expected_delivery_date,
      total_amount: totalAmount,
      amount_paid: 0,
      balance_remaining: totalAmount,
      status: 'ordered',
      approval_status: 'draft',
      created_by: req.user?.id ? [req.user.id] : [],
      created_at: new Date().toISOString()
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

// Approve order (Phase 1: Approval Workflow)
router.put('/:orderId/approve', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const updatedOrder = await airtableHelpers.update(TABLES.ORDERS, orderId, {
      approval_status: 'approved',
      approved_by: req.user?.id ? [req.user.id] : [],
      approved_at: new Date().toISOString()
    });
    
    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    console.error('Approve order error:', error);
    res.status(500).json({ message: 'Failed to approve order' });
  }
});

// Reject order (Phase 1: Approval Workflow)
router.put('/:orderId/reject', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { rejection_reason } = req.body;
    
    const updatedOrder = await airtableHelpers.update(TABLES.ORDERS, orderId, {
      approval_status: 'rejected',
      approved_by: req.user?.id ? [req.user.id] : [],
      approved_at: new Date().toISOString(),
      rejection_reason: rejection_reason || 'No reason provided'
    });
    
    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    console.error('Reject order error:', error);
    res.status(500).json({ message: 'Failed to reject order' });
  }
});

// Record payment for order (Phase 2: Payment Processing)
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

    // Create payment record in PAYMENTS_MADE table
    try {
      await airtableHelpers.create(TABLES.PAYMENTS_MADE, {
        order_id: [orderId],
        vendor_name: order.supplier_name,
        amount: parseFloat(amount),
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: req.body.payment_method || 'cash',
        reference_number: req.body.reference_number || '',
        status: 'completed',
        created_by: req.user?.id ? [req.user.id] : [],
        created_at: new Date().toISOString()
      });
    } catch (paymentError) {
      console.log('Payment record creation skipped:', paymentError.message);
    }

    res.json(updatedOrder);
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ message: 'Failed to record payment' });
  }
});

// Create purchase receive (Phase 3: Goods Receiving)
router.post('/:orderId/receive', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { receiving_branch_id, received_items, notes } = req.body;
    
    const receiveData = {
      purchase_order_id: [orderId],
      receiving_branch_id: [receiving_branch_id],
      receive_date: new Date().toISOString().split('T')[0],
      received_by: req.user?.fullName || 'System',
      status: 'received',
      total_items: received_items.length,
      total_quantity_received: received_items.reduce((sum, item) => sum + item.quantity_received, 0),
      receive_status: 'complete',
      notes: notes || '',
      created_by: req.user?.id ? [req.user.id] : [],
      created_at: new Date().toISOString()
    };
    
    const purchaseReceive = await airtableHelpers.create(TABLES.PURCHASE_RECEIVES, receiveData);
    
    const receiveItems = [];
    for (const item of received_items) {
      const receiveItem = await airtableHelpers.create(TABLES.RECEIVE_ITEMS, {
        receive_id: [purchaseReceive.id],
        product_name: item.product_name,
        quantity_ordered: item.quantity_ordered,
        quantity_received: item.quantity_received,
        unit_cost: item.unit_cost,
        total_cost: item.quantity_received * item.unit_cost,
        condition: item.condition || 'good'
      });
      receiveItems.push(receiveItem);
    }
    
    await airtableHelpers.update(TABLES.ORDERS, orderId, { status: 'delivered' });
    res.json({ success: true, receive: purchaseReceive, items: receiveItems });
  } catch (error) {
    console.error('Create receive error:', error);
    res.status(500).json({ message: 'Failed to create receive record' });
  }
});

// Mark items as delivered (Legacy)
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
          quantity_received: item.quantityReceived,
          received_at: new Date().toISOString()
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

    console.log('Complete order request:', { orderId, completedItems });

    if (!completedItems || !Array.isArray(completedItems) || completedItems.length === 0) {
      return res.status(400).json({ message: 'Completed items are required' });
    }

    // Get the order to validate
    const order = await airtableHelpers.findById(TABLES.ORDERS, orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Get all existing stock for efficient lookup
    const allStock = await airtableHelpers.find(TABLES.STOCK);
    const transferReceipts = [];
    const processedItems = [];

    // Process each completed item
    for (const item of completedItems) {
      console.log('Processing item:', item);
      
      // Validate required fields
      if (!item.branchDestinationId || !item.quantityOrdered || item.quantityOrdered <= 0) {
        console.log('Skipping item due to missing data:', item);
        continue;
      }
      
      // Ensure numeric values are properly converted
      const quantityOrdered = Number(item.quantityOrdered) || 0;
      const purchasePrice = Number(item.purchasePrice) || 0;
      
      if (quantityOrdered <= 0 || purchasePrice < 0) {
        console.log('Skipping item due to invalid numeric values:', { quantityOrdered, purchasePrice });
        continue;
      }

      // Check if similar product exists in the destination branch
      const existingProduct = allStock.find(stock => 
        stock.branch_id && 
        stock.branch_id.includes(item.branchDestinationId) && 
        stock.product_name && 
        stock.product_name.toLowerCase().trim() === item.productName.toLowerCase().trim()
      );

      let stockResult;
      const transferId = `TRF_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const productId = item.productId || `PRD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (existingProduct) {
        // Update existing product - add quantity
        const newQuantity = (existingProduct.quantity_available || 0) + quantityOrdered;
        const updateData = {
          quantity_available: newQuantity,
          unit_price: purchasePrice,
          last_updated: new Date().toISOString()
        };
        
        stockResult = await airtableHelpers.update(TABLES.STOCK, existingProduct.id, updateData);
        console.log('Updated existing stock:', stockResult.id);
      } else {
        // Create new product entry
        const stockData = {
          branch_id: [item.branchDestinationId],
          product_id: productId,
          product_name: item.productName,
          quantity_available: quantityOrdered,
          reorder_level: 10,
          unit_price: purchasePrice,
          last_updated: new Date().toISOString()
        };
        
        stockResult = await airtableHelpers.create(TABLES.STOCK, stockData);
        console.log('Created new stock:', stockResult.id);
      }

      // Create stock movement record for tracking
      const movementData = {
        transfer_id: transferId,
        to_branch_id: [item.branchDestinationId],
        product_name: item.productName,
        quantity: quantityOrdered,
        movement_type: 'purchase_order',
        reason: `Stock added from completed order #${orderId}`,
        status: 'completed',
        transfer_date: new Date().toISOString(),
        unit_cost: purchasePrice,
        total_cost: quantityOrdered * purchasePrice,
        created_at: new Date().toISOString()
      };
      
      const movementResult = await airtableHelpers.create(TABLES.STOCK_MOVEMENTS, movementData);
      console.log('Created stock movement:', movementResult.id);

      // Generate transfer receipt data
      const receipt = {
        transferId,
        orderId,
        productName: item.productName,
        quantity: quantityOrdered,
        unitPrice: purchasePrice,
        totalValue: quantityOrdered * purchasePrice,
        branchId: item.branchDestinationId,
        timestamp: new Date().toISOString(),
        status: 'completed',
        type: existingProduct ? 'quantity_update' : 'new_product'
      };
      
      transferReceipts.push(receipt);
      processedItems.push({
        ...item,
        transferId,
        stockId: stockResult.id,
        movementId: movementResult.id,
        processed: true
      });

      // Update order item if it exists and is not manual
      if (item.orderItemId && !item.orderItemId.startsWith('manual_')) {
        try {
          await airtableHelpers.update(TABLES.ORDER_ITEMS, item.orderItemId, {
            quantity_received: quantityOrdered,
            transfer_id: transferId,
            completed_at: new Date().toISOString()
          });
          console.log('Updated order item:', item.orderItemId);
        } catch (error) {
          console.log('Could not update order item:', error.message);
        }
      }
    }

    // Mark order as completed
    const orderUpdate = {
      status: 'completed',
      completed_at: new Date().toISOString(),
      total_transfers: transferReceipts.length
    };
    
    // Auto-pay order when completed
    if (order.balance_remaining > 0) {
      orderUpdate.amount_paid = order.total_amount;
      orderUpdate.balance_remaining = 0;
      orderUpdate.payment_status = 'paid';
    }
    
    await airtableHelpers.update(TABLES.ORDERS, orderId, orderUpdate);
    console.log('Order marked as completed:', orderId);

    // Ensure all data is serializable before sending response
    const safeTransferReceipts = transferReceipts.map(receipt => ({
      transferId: receipt.transferId || '',
      orderId: receipt.orderId || orderId,
      productName: receipt.productName || '',
      quantity: Number(receipt.quantity) || 0,
      unitPrice: Number(receipt.unitPrice) || 0,
      totalValue: Number(receipt.totalValue) || 0,
      branchId: receipt.branchId || '',
      timestamp: receipt.timestamp || new Date().toISOString(),
      status: receipt.status || 'completed',
      type: receipt.type || 'new_product'
    }));

    const safeProcessedItems = processedItems.map(item => ({
      productName: item.productName || '',
      quantityOrdered: Number(item.quantityOrdered) || 0,
      branchDestinationId: item.branchDestinationId || '',
      purchasePrice: Number(item.purchasePrice) || 0,
      transferId: item.transferId || '',
      processed: true
    }));

    res.json({ 
      success: true,
      message: `Order completed successfully! ${safeTransferReceipts.length} items transferred to branches.`,
      order_status: 'completed',
      transfers: safeTransferReceipts,
      processedItems: safeProcessedItems,
      summary: {
        totalItems: safeProcessedItems.length,
        newProducts: safeTransferReceipts.filter(r => r.type === 'new_product').length,
        updatedProducts: safeTransferReceipts.filter(r => r.type === 'quantity_update').length,
        totalValue: safeTransferReceipts.reduce((sum, r) => sum + (Number(r.totalValue) || 0), 0)
      }
    });
  } catch (error) {
    console.error('Complete order error:', error);
    console.error('Error stack:', error.stack);
    
    // Check if response was already sent
    if (res.headersSent) {
      console.log('Response already sent, cannot send error response');
      return;
    }
    
    res.status(500).json({ 
      message: 'Failed to complete order',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get transfer receipts for an order
router.get('/:orderId/receipts', authenticateToken, authorizeRoles(['admin', 'manager', 'boss']), async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await airtableHelpers.findById(TABLES.ORDERS, orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Get transfer receipts from order or stock movements
    let receipts = [];
    
    if (order.transfer_receipts) {
      try {
        receipts = JSON.parse(order.transfer_receipts);
      } catch (error) {
        console.log('Could not parse transfer receipts from order');
      }
    }
    
    // If no receipts in order, get from stock movements
    if (receipts.length === 0) {
      const movements = await airtableHelpers.find(
        TABLES.STOCK_MOVEMENTS,
        `{order_id} = "${orderId}"`
      );
      
      receipts = movements.map(movement => ({
        transferId: movement.transfer_id,
        orderId,
        productName: movement.product_name,
        quantity: movement.quantity,
        unitPrice: movement.unit_cost || 0,
        totalValue: movement.total_cost || 0,
        branchId: movement.to_branch_id?.[0],
        timestamp: movement.transfer_date || movement.created_at,
        status: movement.status,
        type: 'transfer'
      }));
    }

    res.json({
      orderId,
      receipts,
      summary: {
        totalTransfers: receipts.length,
        totalValue: receipts.reduce((sum, r) => sum + (r.totalValue || 0), 0),
        completedTransfers: receipts.filter(r => r.status === 'completed').length
      }
    });
  } catch (error) {
    console.error('Get receipts error:', error);
    res.status(500).json({ message: 'Failed to get transfer receipts' });
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
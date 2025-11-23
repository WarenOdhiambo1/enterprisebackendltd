const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const branchRoutes = require('./routes/branches');
const stockRoutes = require('./routes/stock');
const salesRoutes = require('./routes/sales');
const logisticsRoutes = require('./routes/logistics');
const ordersRoutes = require('./routes/orders');
const hrRoutes = require('./routes/hr');
const bossRoutes = require('./routes/boss');
const managerRoutes = require('./routes/manager');
const adminRoutes = require('./routes/admin');
const expensesRoutes = require('./routes/expenses');
const dataRoutes = require('./routes/data');
const purchaseReceivesRoutes = require('./routes/purchase-receives');
const billsRoutes = require('./routes/bills');
const inventoryAdjustmentsRoutes = require('./routes/inventory-adjustments');
const logisticsTransactionsRoutes = require('./routes/logistics-transactions');
const packagesRoutes = require('./routes/packages');
const paymentsRoutes = require('./routes/payments');
const vendorCreditsRoutes = require('./routes/vendor-credits');
const debugRoutes = require('./routes/debug');
const { authenticateToken, authorizeRoles } = require('./middleware/auth');

const app = express();

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (process.env.NODE_ENV === 'production') {
      if (origin.includes('kabisakabisa-enterprise-ltd') && origin.includes('vercel.app')) {
        return callback(null, true);
      }
      const allowedOrigins = [
        'https://kabisakabisa-enterprise-ltd.vercel.app',
        'https://kabisakabisa-enterprise-ltd-j49p.vercel.app',
        'https://kabisakabisa-enterprise-ltd-1osy.vercel.app'
      ];
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    } else {
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BSN Manager Backend API is running',
    timestamp: new Date().toISOString(),
    version: '2.0.0-cleaned',
    routes: {
      stock: 'mounted',
      sales: 'mounted',
      expenses: 'mounted'
    }
  });
});

app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

app.get('/api/stock-test', (req, res) => {
  res.json({ 
    message: 'Stock route is accessible',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

// Test stock route without auth
app.get('/api/stock/test', (req, res) => {
  res.json({ 
    message: 'Stock routes are working',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});



console.log('Mounting routes...');
app.use('/api/auth', authRoutes);
console.log('Auth routes mounted');
app.use('/api/branches', branchRoutes);
console.log('Branches routes mounted');
app.use('/api/expenses', authenticateToken, expensesRoutes);
console.log('Expenses routes mounted');
app.use('/api/stock', authenticateToken, stockRoutes);
console.log('Stock routes mounted');
app.use('/api/sales', authenticateToken, salesRoutes);
console.log('Sales routes mounted');
app.use('/api/logistics', authenticateToken, logisticsRoutes);
console.log('Logistics routes mounted');
// Public order routes (before auth middleware)
app.get('/api/orders/items', async (req, res) => {
  try {
    const { airtableHelpers, TABLES } = require('./config/airtable');
    const orderItems = await airtableHelpers.find(TABLES.ORDER_ITEMS);
    const orders = await airtableHelpers.find(TABLES.ORDERS);
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    
    const branchMap = branches.reduce((acc, branch) => {
      acc[branch.id] = branch.branch_name || branch.name;
      return acc;
    }, {});
    
    const orderMap = orders.reduce((acc, order) => {
      acc[order.id] = order;
      return acc;
    }, {});
    
    const enrichedItems = orderItems.map(item => {
      const orderId = Array.isArray(item.order_id) ? item.order_id[0] : item.order_id;
      const branchId = Array.isArray(item.branch_destination_id) ? item.branch_destination_id[0] : item.branch_destination_id;
      const order = orderMap[orderId];
      
      return {
        ...item,
        order_info: order,
        destination_branch_name: branchMap[branchId] || 'Unknown',
        remaining_quantity: (item.quantity_ordered || 0) - (item.quantity_received || 0),
        progress: item.quantity_ordered > 0 ? Math.round(((item.quantity_received || 0) / item.quantity_ordered) * 100) : 0
      };
    });
    
    res.json(enrichedItems);
  } catch (error) {
    console.error('Get order items error:', error);
    res.status(500).json({ message: 'Failed to fetch order items' });
  }
});

app.get('/api/orders/tracking', async (req, res) => {
  try {
    const { airtableHelpers, TABLES } = require('./config/airtable');
    const orderItems = await airtableHelpers.find(TABLES.ORDER_ITEMS);
    const orders = await airtableHelpers.find(TABLES.ORDERS);
    const branches = await airtableHelpers.find(TABLES.BRANCHES);
    
    const branchMap = branches.reduce((acc, branch) => {
      acc[branch.id] = branch.branch_name || branch.name;
      return acc;
    }, {});
    
    const orderMap = orders.reduce((acc, order) => {
      acc[order.id] = order;
      return acc;
    }, {});
    
    const trackingData = orderItems.map(item => {
      const orderId = Array.isArray(item.order_id) ? item.order_id[0] : item.order_id;
      const branchId = Array.isArray(item.branch_destination_id) ? item.branch_destination_id[0] : item.branch_destination_id;
      const order = orderMap[orderId];
      const ordered = item.quantity_ordered || 0;
      const completed = item.quantity_received || 0;
      const remaining = ordered - completed;
      const progress = ordered > 0 ? Math.round((completed / ordered) * 100) : 0;
      
      return {
        id: item.id,
        order_id: orderId,
        order_number: order?.order_number || orderId,
        supplier_name: order?.supplier_name || 'Unknown',
        product_name: item.product_name,
        quantity_ordered: ordered,
        quantity_completed: completed,
        quantity_remaining: remaining,
        destination_branch: branchMap[branchId] || 'Unknown',
        progress_percentage: progress,
        status: remaining === 0 ? 'Completed' : remaining < ordered ? 'Partial' : 'Pending',
        order_date: order?.order_date,
        expected_delivery: order?.expected_delivery_date
      };
    }).filter(item => item.quantity_ordered > 0);
    
    res.json(trackingData);
  } catch (error) {
    console.error('Get tracking data error:', error);
    res.status(500).json({ message: 'Failed to fetch tracking data' });
  }
});

app.use('/api/orders', authenticateToken, ordersRoutes);
console.log('Orders routes mounted');
app.use('/api/hr', authenticateToken, hrRoutes);
console.log('HR routes mounted');
app.use('/api/boss', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), bossRoutes);
console.log('Boss routes mounted');
app.use('/api/manager', authenticateToken, managerRoutes);
console.log('Manager routes mounted');
app.use('/api/admin', authenticateToken, adminRoutes);
console.log('Admin routes mounted');
app.use('/api/data', authenticateToken, dataRoutes);
console.log('Data routes mounted');
app.use('/api/purchase-receives', authenticateToken, purchaseReceivesRoutes);
console.log('Purchase receives routes mounted');
app.use('/api/bills', authenticateToken, billsRoutes);
console.log('Bills routes mounted');
app.use('/api/inventory-adjustments', authenticateToken, inventoryAdjustmentsRoutes);
console.log('Inventory adjustments routes mounted');
app.use('/api/logistics-transactions', authenticateToken, logisticsTransactionsRoutes);
console.log('Logistics transactions routes mounted');
app.use('/api/packages', authenticateToken, packagesRoutes);
console.log('Packages routes mounted');
app.use('/api/payments', authenticateToken, paymentsRoutes);
console.log('Payments routes mounted');
app.use('/api/vendor-credits', authenticateToken, vendorCreditsRoutes);
console.log('Vendor credits routes mounted');
app.use('/api/debug', debugRoutes);
console.log('Debug routes mounted');
console.log('All routes mounted successfully');

app.use((err, req, res, next) => {
  res.status(500).json({ 
    message: 'Something went wrong!',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

app.use('*', (req, res) => {
  console.log('404 - Route not found:', req.method, req.originalUrl);
  res.status(404).json({ 
    message: 'Route not found',
    method: req.method,
    url: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});// Deployment trigger - 2025-11-15T03:30:00Z

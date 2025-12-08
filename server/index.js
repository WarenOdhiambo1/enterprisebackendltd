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

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

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



console.log('[BACKEND] Mounting routes...');
app.use('/api/auth', authRoutes);
console.log('[BACKEND] ✓ Auth routes mounted at /api/auth');
app.use('/api/branches', branchRoutes);
console.log('[BACKEND] ✓ Branches routes mounted at /api/branches');
app.use('/api/expenses', authenticateToken, expensesRoutes);
console.log('[BACKEND] ✓ Expenses routes mounted at /api/expenses');
app.use('/api/stock', authenticateToken, stockRoutes);
console.log('[BACKEND] ✓ Stock routes mounted at /api/stock');
app.use('/api/sales', authenticateToken, salesRoutes);
console.log('[BACKEND] ✓ Sales routes mounted at /api/sales');
app.use('/api/logistics', authenticateToken, logisticsRoutes);
console.log('[BACKEND] ✓ Logistics routes mounted at /api/logistics');
app.use('/api/orders', authenticateToken, ordersRoutes);
console.log('[BACKEND] ✓ Orders routes mounted at /api/orders');
app.use('/api/hr', authenticateToken, hrRoutes);
console.log('[BACKEND] ✓ HR routes mounted at /api/hr');
app.use('/api/boss', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), bossRoutes);
console.log('[BACKEND] ✓ Boss routes mounted at /api/boss');
app.use('/api/manager', authenticateToken, managerRoutes);
console.log('[BACKEND] ✓ Manager routes mounted at /api/manager');
app.use('/api/admin', authenticateToken, adminRoutes);
console.log('[BACKEND] ✓ Admin routes mounted at /api/admin');
app.use('/api/data', authenticateToken, dataRoutes);
console.log('[BACKEND] ✓ Data routes mounted at /api/data');
app.use('/api/purchase-receives', authenticateToken, purchaseReceivesRoutes);
console.log('[BACKEND] ✓ Purchase receives routes mounted at /api/purchase-receives');
app.use('/api/bills', authenticateToken, billsRoutes);
console.log('[BACKEND] ✓ Bills routes mounted at /api/bills');
app.use('/api/inventory-adjustments', authenticateToken, inventoryAdjustmentsRoutes);
console.log('[BACKEND] ✓ Inventory adjustments routes mounted at /api/inventory-adjustments');
app.use('/api/logistics-transactions', authenticateToken, logisticsTransactionsRoutes);
console.log('[BACKEND] ✓ Logistics transactions routes mounted at /api/logistics-transactions');
app.use('/api/packages', authenticateToken, packagesRoutes);
console.log('[BACKEND] ✓ Packages routes mounted at /api/packages');
app.use('/api/payments', authenticateToken, paymentsRoutes);
console.log('[BACKEND] ✓ Payments routes mounted at /api/payments');
app.use('/api/vendor-credits', authenticateToken, vendorCreditsRoutes);
console.log('[BACKEND] ✓ Vendor credits routes mounted at /api/vendor-credits');
app.use('/api/debug', debugRoutes);
console.log('[BACKEND] ✓ Debug routes mounted at /api/debug');

console.log('[BACKEND] ✓ All routes mounted successfully');

// 404 handler (must be after all routes)
app.use('*', (req, res) => {
  console.error(`[BACKEND ERROR] 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    availableRoutes: ['/api/auth', '/api/branches', '/api/stock', '/api/sales', '/api/logistics', '/api/orders', '/api/hr', '/api/boss', '/api/manager', '/api/admin', '/api/expenses', '/api/data']
  });
});

// Error handler (must have 4 parameters and be last)
app.use((err, req, res, next) => {
  console.error(`[BACKEND ERROR] ${err.name}: ${err.message}`);
  console.error(`[BACKEND ERROR] Path: ${req.method} ${req.path}`);
  console.error(`[BACKEND ERROR] Stack:`, err.stack);
  
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error',
    path: req.path,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});// Deployment trigger - 2025-11-15T03:30:00Z

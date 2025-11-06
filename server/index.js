const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
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
const accountingRoutes = require('./routes/accounting');
const receiptRoutes = require('./routes/receipts');
const reportRoutes = require('./routes/reports');
const documentRoutes = require('./routes/documents');
const diagnosticsRoutes = require('./routes/diagnostics');
const { authenticateToken, authorizeRoles } = require('./middleware/auth');

const app = express();

// Validate required environment variables
const requiredEnvVars = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'AIRTABLE_API_KEY',
  'AIRTABLE_BASE_ID',
  'ENCRYPTION_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  console.error('❌ Server cannot start without these variables');
  process.exit(1);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(compression());
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// CORS configuration
// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (process.env.NODE_ENV === 'production') {
      // Allow all Vercel domains for this project
      if (origin.includes('kabisakabisa-enterprise-ltd') && origin.includes('vercel.app')) {
        return callback(null, true);
      }
      // Explicitly allowed domains
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
      // Development - allow localhost
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check route
app.get('/', (req, res) => {
  try {
    res.json({ 
      status: 'OK', 
      message: 'BSN Manager Backend API is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      env: process.env.NODE_ENV || 'development',
      env_check: {
        jwt_secret: !!process.env.JWT_SECRET,
        airtable_key: !!process.env.AIRTABLE_API_KEY,
        airtable_base: !!process.env.AIRTABLE_BASE_ID,
        encryption_key: !!process.env.ENCRYPTION_KEY
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'ERROR',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Simple test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

// Auth test route
app.post('/api/auth/test', (req, res) => {
  res.json({ 
    message: 'Auth route is working',
    timestamp: new Date().toISOString(),
    body: req.body
  });
});

// Favicon route
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working',
    timestamp: new Date().toISOString(),
    status: 'success'
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/sales', authenticateToken, salesRoutes);
app.use('/api/logistics', authenticateToken, logisticsRoutes);
app.use('/api/orders', authenticateToken, ordersRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/boss', authenticateToken, authorizeRoles(['boss', 'manager', 'admin']), bossRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/reports', reportRoutes);
// app.use('/api/documents', documentRoutes); // Temporarily disabled due to Google credentials issue
app.use('/api/diagnostics', diagnosticsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 BSN Manager Backend running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/`);
});
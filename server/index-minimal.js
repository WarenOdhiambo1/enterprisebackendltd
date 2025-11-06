const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Basic CORS for all origins in production (temporary fix)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'BSN Manager Backend API is running',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working',
    timestamp: new Date().toISOString()
  });
});

// Favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Basic auth routes
app.post('/api/auth/register', (req, res) => {
  res.json({ message: 'Registration endpoint - coming soon' });
});

app.post('/api/auth/login', (req, res) => {
  res.json({ message: 'Login endpoint - coming soon' });
});

// Public branches route
app.get('/api/branches/public', (req, res) => {
  res.json([
    {
      id: 'branch1',
      name: 'Main Branch',
      address: '123 Main Street, Nairobi',
      latitude: -1.2921,
      longitude: 36.8219,
      phone: '+254700000000',
      email: 'main@company.com'
    }
  ]);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Minimal BSN Backend running on port ${PORT}`);
});

module.exports = app;
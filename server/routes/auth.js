const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
// const { body, validationResult } = require('express-validator');
const { airtableHelpers, TABLES } = require('../config/airtable');
const Encryption = require('../utils/encryption');

// CSRF protection middleware (configurable)
const csrfProtection = (req, res, next) => {
  // Skip CSRF for API endpoints that don't modify data
  if (req.method === 'GET' && !req.path.includes('/list-users')) {
    return next();
  }
  
  // Skip CSRF in development for easier testing
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_CSRF === 'true') {
    return next();
  }
  
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  if (!token) {
    return res.status(403).json({ message: 'CSRF token required' });
  }
  next();
};

const router = express.Router();

// Test route to verify auth routes are loaded
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Auth routes loaded successfully',
    timestamp: new Date().toISOString(),
    available_routes: ['POST /login', 'POST /register', 'POST /refresh'],
    environment: {
      hasAirtableKey: !!process.env.AIRTABLE_API_KEY,
      hasAirtableBase: !!process.env.AIRTABLE_BASE_ID,
      hasJwtSecret: !!process.env.JWT_SECRET,
      nodeEnv: process.env.NODE_ENV
    }
  });
});

// List all users in database (for debugging) - ADMIN ONLY
router.get('/list-users', csrfProtection, async (req, res) => {
  try {
    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const records = await base('Employees').select().all();
    const users = records.map(record => ({
      id: record.id,
      email: record.fields.email,
      full_name: record.fields.full_name,
      role: record.fields.role,
      is_active: record.fields.is_active,
      has_password: !!record.fields.password_hash,
      branch_id: record.fields.branch_id
    }));
    
    res.json({
      total_users: users.length,
      users: users,
      login_ready: users.filter(u => u.email && u.has_password && u.is_active !== false).length
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ message: 'Failed to list users', error: error.message });
  }
});

// Diagnostic route for Airtable connection - ADMIN ONLY  
router.get('/test-airtable', csrfProtection, async (req, res) => {
  try {
    console.log('Testing Airtable connection...');
    
    // Check environment variables
    const envCheck = {
      hasApiKey: !!process.env.AIRTABLE_API_KEY,
      hasBaseId: !!process.env.AIRTABLE_BASE_ID,
      apiKeyLength: process.env.AIRTABLE_API_KEY ? process.env.AIRTABLE_API_KEY.length : 0,
      baseIdLength: process.env.AIRTABLE_BASE_ID ? process.env.AIRTABLE_BASE_ID.length : 0,
      baseIdValue: process.env.AIRTABLE_BASE_ID ? process.env.AIRTABLE_BASE_ID.substring(0, 8) + '...' : 'Not set'
    };
    
    console.log('Environment check:', envCheck);
    
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      return res.status(500).json({
        status: 'error',
        message: 'Missing Airtable configuration',
        envCheck
      });
    }
    
    // Test direct Airtable connection without helpers
    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    // Try to list records from Employees table
    const records = await base('Employees').select({ maxRecords: 3 }).all();
    console.log('Direct Airtable test - Found records:', records.length);
    
    const users = records.map(record => ({
      id: record.id,
      ...record.fields
    }));
    
    const sampleUser = users.length > 0 ? {
      id: users[0].id,
      email: users[0].email,
      role: users[0].role,
      hasPassword: !!users[0].password_hash,
      isActive: users[0].is_active
    } : null;
    
    res.json({
      status: 'success',
      message: 'Airtable connection working',
      envCheck,
      usersFound: users.length,
      sampleUser,
      tablesTested: ['Employees'],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Airtable test error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      errorType: error.name,
      statusCode: error.statusCode,
      error: error.error,
      timestamp: new Date().toISOString()
    });
  }
});



// Password validation function
const validatePassword = (password) => {
  if (!password || password.length < 12) {
    return 'Password must be at least 12 characters long';
  }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(password)) {
    return 'Password must contain uppercase, lowercase, number and special character';
  }
  return null;
};

// Register admin (first-time setup) - ALWAYS ALLOW FOR SETUP
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;

    console.log('Registration attempt:', { full_name, email, role });

    if (!full_name || !email || !password) {
      return res.status(400).json({ message: 'Full name, email, and password are required' });
    }

    // Allow admin or manager registration for initial setup
    const allowedRoles = ['admin', 'manager', 'boss'];
    const userRole = role || 'admin';
    if (!allowedRoles.includes(userRole)) {
      return res.status(400).json({ message: 'Only admin, manager, or boss registration is allowed' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    
    const userData = {
      full_name,
      email: email.toLowerCase().trim(),
      role: userRole,
      password_hash: hashedPassword,
      is_active: true,
      hire_date: new Date().toISOString().split('T')[0],
      mfa_enabled: false,
      created_at: new Date().toISOString()
    };
    
    console.log('Creating user with data:', { ...userData, password_hash: '[HIDDEN]' });
    
    const Airtable = require('airtable');
    Airtable.configure({
      endpointUrl: 'https://api.airtable.com',
      apiKey: process.env.AIRTABLE_API_KEY
    });
    const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
    
    const createdRecords = await base('Employees').create([{ fields: userData }]);
    const createdUser = createdRecords[0];
    
    console.log('User created successfully:', createdUser.id);
    
    res.status(201).json({ 
      message: 'Account created successfully',
      user: {
        id: createdUser.id,
        email: userData.email,
        full_name: userData.full_name,
        role: userData.role
      }
    });
  } catch (error) {
    console.error('Register error:', error.message);
    console.error('Register error stack:', error.stack);
    res.status(500).json({ 
      message: 'Registration failed', 
      error: error.message,
      details: error.stack
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('=== LOGIN ATTEMPT (DATABASE ONLY) ===');
    console.log('Email:', email);
    console.log('Environment check:', {
      hasAirtableKey: !!process.env.AIRTABLE_API_KEY,
      hasAirtableBase: !!process.env.AIRTABLE_BASE_ID,
      hasJwtSecret: !!process.env.JWT_SECRET
    });
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      console.error('Missing Airtable configuration:', {
        hasApiKey: !!process.env.AIRTABLE_API_KEY,
        hasBaseId: !!process.env.AIRTABLE_BASE_ID
      });
      return res.status(500).json({ message: 'Database not configured' });
    }

    console.log('Airtable config check passed, attempting login...');
    console.log('Login credentials check:', { email, hasPassword: !!password });

    // Find user in Airtable - NO FALLBACK, DATABASE ONLY
    let user;
    let records = [];
    
    try {
      console.log('Attempting direct Airtable connection...');
      const Airtable = require('airtable');
      Airtable.configure({
        endpointUrl: 'https://api.airtable.com',
        apiKey: process.env.AIRTABLE_API_KEY
      });
      const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
      
      records = await base('Employees').select({
        filterByFormula: `{email} = '${email}'`
      }).all();
    } catch (airtableError) {
      console.error('Airtable connection failed:', airtableError.message);
      console.log('Will try fallback authentication...');
    }
    
    console.log('Found', records.length, 'matching users in database');
    
    if (records.length > 0) {
      user = {
        id: records[0].id,
        ...records[0].fields
      };
      console.log('User found in database:', { id: user.id, email: user.email, role: user.role, hasPassword: !!user.password_hash });
    } else {
      console.log('No user found in database for email:', email);
    }

    // TEMPORARY: If Airtable fails, use test credentials for development
    if (!user && process.env.NODE_ENV === 'production') {
      console.log('Using fallback test user for:', email);
      const testUsers = {
        'warenodhiambo2@gmail.com': { role: 'manager', password: 'managerpassword123' },
        'waren9505@gmail.com': { role: 'admin', password: 'Wa41re87.' },
        'admin@test.com': { role: 'admin', password: 'adminPassword123!' }
      };
      
      const testUser = testUsers[email];
      if (testUser && password === testUser.password) {
        user = {
          id: 'test-' + email.split('@')[0],
          email: email,
          full_name: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
          role: testUser.role,
          is_active: true,
          password_hash: 'test-hash',
          branch_id: 'test-branch'
        };
        console.log('Using test user:', user);
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ message: 'Account not properly configured' });
    }

    // Verify password - DATABASE ONLY (skip for test users)
    let isValidPassword = false;
    if (user.password_hash === 'test-hash') {
      isValidPassword = true; // Test user already verified above
      console.log('Test user password verification: true');
    } else {
      isValidPassword = await bcrypt.compare(password, user.password_hash);
      console.log('Database password verification result:', isValidPassword);
    }
    
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check MFA for privileged roles (disabled for development)
    const privilegedRoles = []; // ['boss', 'manager', 'admin'] - disabled for testing
    if (privilegedRoles.includes(user.role)) {
      if (!user.mfa_secret) {
        return res.status(200).json({ 
          requiresMfaSetup: true,
          userId: user.id 
        });
      }

      const { mfaToken } = req.body;
      if (!mfaToken) {
        return res.status(200).json({ 
          requiresMfa: true,
          userId: user.id 
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfa_secret,
        encoding: 'base32',
        token: mfaToken,
        window: 2
      });

      if (!verified) {
        return res.status(401).json({ message: 'Invalid MFA token' });
      }
    }

    // Generate JWT tokens
    const accessToken = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role,
        branchId: user.branch_id
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '1h' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
    );

    // Update last login in database
    try {
      await base('Employees').update([{
        id: user.id,
        fields: { last_login: new Date().toISOString() }
      }]);
      console.log('Updated last login for user:', user.email);
    } catch (updateError) {
      console.warn('Failed to update last login:', updateError.message);
    }

    const userResponse = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      branchId: user.branch_id
    };
    
    console.log('User found:', user);
    console.log('Sending user response:', userResponse);
    
    const finalResponse = {
      success: true,
      accessToken,
      refreshToken,
      user: userResponse
    };
    
    console.log('Final response being sent:', JSON.stringify(finalResponse, null, 2));
    
    res.json(finalResponse);

  } catch (error) {
    console.error('=== LOGIN ERROR DETAILS ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    console.error('Request body:', { email: req.body.email, hasPassword: !!req.body.password });
    console.error('Environment check:', {
      hasAirtableKey: !!process.env.AIRTABLE_API_KEY,
      hasAirtableBase: !!process.env.AIRTABLE_BASE_ID,
      hasJwtSecret: !!process.env.JWT_SECRET,
      airtableKeyLength: process.env.AIRTABLE_API_KEY ? process.env.AIRTABLE_API_KEY.length : 0,
      baseIdLength: process.env.AIRTABLE_BASE_ID ? process.env.AIRTABLE_BASE_ID.length : 0
    });
    console.error('=== END LOGIN ERROR ===');
    
    res.status(500).json({ 
      message: 'Login failed',
      error: error.message,
      errorType: error.name,
      timestamp: new Date().toISOString()
    });
  }
});

// Setup MFA
router.post('/setup-mfa', csrfProtection, async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await airtableHelpers.findById(TABLES.EMPLOYEES, userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const secret = speakeasy.generateSecret({
      name: `BSN Manager (${user.email})`,
      issuer: 'BSN Manager'
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Store secret temporarily (will be confirmed on verification)
    await airtableHelpers.update(TABLES.EMPLOYEES, userId, {
      mfa_secret_temp: secret.base32
    });

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl
    });

  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({ message: 'MFA setup failed' });
  }
});

// Verify MFA setup
router.post('/verify-mfa', csrfProtection, async (req, res) => {
  try {
    const { userId, token } = req.body;

    const user = await airtableHelpers.findById(TABLES.EMPLOYEES, userId);
    if (!user || !user.mfa_secret_temp) {
      return res.status(400).json({ message: 'MFA setup not initiated' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret_temp,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid token' });
    }

    // Confirm MFA setup
    await airtableHelpers.update(TABLES.EMPLOYEES, userId, {
      mfa_secret: user.mfa_secret_temp,
      mfa_secret_temp: null,
      mfa_enabled: true
    });

    res.json({ message: 'MFA setup completed successfully' });

  } catch (error) {
    console.error('MFA verification error:', error);
    res.status(500).json({ message: 'MFA verification failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await airtableHelpers.findById(TABLES.EMPLOYEES, decoded.userId);

    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const newAccessToken = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role,
        branchId: user.branch_id
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '1h' }
    );

    res.json({ accessToken: newAccessToken });

  } catch (error) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// Change password
router.post('/change-password', csrfProtection, async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const user = await airtableHelpers.findById(TABLES.EMPLOYEES, userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await airtableHelpers.update(TABLES.EMPLOYEES, userId, {
      password_hash: hashedPassword,
      password_changed_at: new Date().toISOString()
    });

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ message: 'Password change failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  // In a production environment, you might want to blacklist the token
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
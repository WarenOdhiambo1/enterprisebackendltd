const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
// const { body, validationResult } = require('express-validator');
const { airtableHelpers, TABLES } = require('../config/airtable');
const Encryption = require('../utils/encryption');

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

// Test route to verify auth routes are loaded
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Auth routes loaded successfully',
    timestamp: new Date().toISOString(),
    available_routes: ['POST /login', 'POST /register', 'POST /refresh']
  });
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

// Register admin (first-time setup)
router.post('/register', async (req, res) => {
  try {
    console.log('Register request received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Content-Type:', req.headers['content-type']);

    const { full_name, email, password, role } = req.body;

    // Validate required fields
    if (!full_name || !email || !password) {
      console.log('Missing required fields:', { full_name: !!full_name, email: !!email, password: !!password });
      return res.status(400).json({ message: 'Full name, email, and password are required' });
    }

    // Ensure only admin role is allowed for registration
    if (role && role !== 'admin') {
      console.log('Invalid role provided:', role);
      return res.status(400).json({ message: 'Only admin registration is allowed' });
    }

    console.log('Checking for existing admins...');
    // Check if any admin already exists
    const existingAdmins = await airtableHelpers.find(
      TABLES.EMPLOYEES,
      '{role} = "admin"'
    );
    console.log('Existing admins found:', existingAdmins.length);

    if (existingAdmins.length > 0) {
      return res.status(400).json({ message: 'Admin already exists. Use login instead.' });
    }

    console.log('Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 12);
    
    console.log('Creating admin record...');
    const adminData = {
      full_name,
      email,
      role: 'admin',
      password_hash: hashedPassword,
      is_active: true,
      hire_date: new Date().toISOString().split('T')[0],
      mfa_enabled: false
    };
    console.log('Admin data to create:', JSON.stringify(adminData, null, 2));
    
    const admin = await airtableHelpers.create(TABLES.EMPLOYEES, adminData);
    console.log('Admin created successfully:', admin.id);

    res.status(201).json({ message: 'Admin account created successfully' });
  } catch (error) {
    console.error('Register error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    console.log('Login attempt started');
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    console.log('Attempting to find users in Airtable');
    const { mfaToken } = req.body;

    // Find user by email
    const allUsers = await airtableHelpers.find(TABLES.EMPLOYEES);
    console.log('Users found:', allUsers.length);
    const user = allUsers.find(u => u.email === email);
    console.log('User found for email:', !!user);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
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

    // Update last login
    await airtableHelpers.update(TABLES.EMPLOYEES, user.id, {
      last_login: new Date().toISOString()
    });

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
    console.error('Login error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: error.message
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
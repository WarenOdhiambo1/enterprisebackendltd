const jwt = require('jsonwebtoken');
const { airtableHelpers, TABLES } = require('../config/airtable');

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
    
    req.user = {
      id: decoded.userId || decoded.id,
      email: decoded.email,
      role: decoded.role || 'admin',
      branch_id: decoded.branch_id || decoded.branchId,
      fullName: decoded.fullName || decoded.name
    };

    next();
  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ message: 'Authentication failed' });
  }
};

// Role-based authorization middleware
const authorizeRoles = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Admin always has access
      if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
        return next();
      }

      return res.status(403).json({ 
        message: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role
      });
    } catch (error) {
      console.error('Authorization error:', error.message);
      return res.status(500).json({ message: 'Authorization failed' });
    }
  };
};

// Branch access control middleware
const authorizeBranch = (req, res, next) => {
  const requestedBranchId = req.params.branchId || req.body.branchId || req.query.branchId;
  
  // Boss, Manager, and Admin can access all branches
  if (['boss', 'manager', 'admin'].includes(req.user.role)) {
    return next();
  }

  // HR can access all branches for employee management
  if (req.user.role === 'hr') {
    return next();
  }

  // Other roles can only access their assigned branch
  if (req.user.branchId && requestedBranchId && req.user.branchId !== requestedBranchId) {
    return res.status(403).json({ 
      message: 'Access denied to this branch',
      userBranch: req.user.branchId,
      requestedBranch: requestedBranchId
    });
  }

  next();
};

// Session timeout middleware
const checkSessionTimeout = (req, res, next) => {
  const sessionTimeout = parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 30;
  const now = Date.now();
  const tokenIssuedAt = req.user.iat * 1000; // Convert to milliseconds
  const timeoutMs = sessionTimeout * 60 * 1000;

  if (now - tokenIssuedAt > timeoutMs) {
    return res.status(401).json({ 
      message: 'Session expired due to inactivity',
      timeout: sessionTimeout
    });
  }

  next();
};

// Audit logging middleware
const auditLog = (action) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log the action after response is sent
      setImmediate(async () => {
        try {
          await airtableHelpers.create('Audit_Logs', {
            user_id: req.user?.id,
            action: action,
            resource: req.originalUrl,
            method: req.method,
            ip_address: req.ip,
            user_agent: req.get('User-Agent'),
            timestamp: new Date().toISOString(),
            success: res.statusCode < 400,
            status_code: res.statusCode
          });
        } catch (error) {
          console.error('Audit log error:', error);
        }
      });
      
      originalSend.call(this, data);
    };

    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  authorizeBranch,
  checkSessionTimeout,
  auditLog
};
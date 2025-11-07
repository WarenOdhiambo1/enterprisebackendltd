const express = require('express');
const axios = require('axios');
const { airtableHelpers, TABLES } = require('../config/airtable');

const router = express.Router();

// Xero OAuth callback handler
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code) {
      return res.status(400).send('Authorization code not provided');
    }

    console.log('Xero OAuth callback received:', { code: code.substring(0, 10) + '...', state });

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    
    if (tokens) {
      // Store tokens securely in Airtable
      await storeXeroTokens(tokens);
      
      // Redirect to frontend with success message
      const frontendUrl = process.env.NODE_ENV === 'production' 
        ? 'https://kabisakabisa-enterprise-ltd.vercel.app'
        : 'http://localhost:3000';
      
      res.redirect(`${frontendUrl}/admin?xero=connected`);
    } else {
      res.status(500).send('Failed to exchange authorization code for tokens');
    }
  } catch (error) {
    console.error('Xero OAuth callback error:', error);
    res.status(500).send('Authorization failed: ' + error.message);
  }
});

// Function to exchange authorization code for access tokens
async function exchangeCodeForTokens(code) {
  try {
    const tokenUrl = 'https://identity.xero.com/connect/token';
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.XERO_CLIENT_ID,
      code: code,
      redirect_uri: `${process.env.NODE_ENV === 'production' 
        ? 'https://enterprisebackendltd.vercel.app' 
        : 'http://localhost:5000'}/auth/callback`
    });

    const response = await axios.post(tokenUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')}`
      }
    });

    console.log('Xero token exchange successful');
    return response.data;
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    throw error;
  }
}

// Function to store Xero tokens in Airtable
async function storeXeroTokens(tokens) {
  try {
    // Check if settings record exists
    const existingSettings = await airtableHelpers.find(TABLES.ERP_SETTINGS);
    
    const tokenData = {
      xero_access_token: tokens.access_token,
      xero_refresh_token: tokens.refresh_token,
      xero_token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
      xero_connected: true,
      xero_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (existingSettings.length > 0) {
      // Update existing record
      await airtableHelpers.update(TABLES.ERP_SETTINGS, existingSettings[0].id, tokenData);
    } else {
      // Create new record
      await airtableHelpers.create(TABLES.ERP_SETTINGS, {
        ...tokenData,
        created_at: new Date().toISOString()
      });
    }

    console.log('Xero tokens stored successfully');
  } catch (error) {
    console.error('Error storing Xero tokens:', error);
    throw error;
  }
}

// Get Xero authorization URL
router.get('/xero/authorize', (req, res) => {
  try {
    const clientId = process.env.XERO_CLIENT_ID;
    const redirectUri = `${process.env.NODE_ENV === 'production' 
      ? 'https://enterprisebackendltd.vercel.app' 
      : 'http://localhost:5000'}/auth/callback`;
    
    const scope = 'accounting.transactions accounting.contacts accounting.settings offline_access';
    const state = Math.random().toString(36).substring(7); // Generate random state
    
    const authUrl = `https://login.xero.com/identity/connect/authorize?` +
      `response_type=code&` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scope)}&` +
      `state=${state}`;

    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating Xero auth URL:', error);
    res.status(500).json({ message: 'Failed to generate authorization URL' });
  }
});

// Check Xero connection status
router.get('/xero/status', async (req, res) => {
  try {
    const settings = await airtableHelpers.find(TABLES.ERP_SETTINGS);
    
    if (settings.length > 0 && settings[0].xero_connected) {
      const expiresAt = new Date(settings[0].xero_token_expires_at);
      const isExpired = expiresAt < new Date();
      
      res.json({
        connected: true,
        expires_at: settings[0].xero_token_expires_at,
        is_expired: isExpired,
        connected_at: settings[0].xero_connected_at
      });
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    console.error('Error checking Xero status:', error);
    res.status(500).json({ message: 'Failed to check connection status' });
  }
});

module.exports = router;
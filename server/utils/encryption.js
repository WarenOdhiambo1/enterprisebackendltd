const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || 'fallback-key-32-chars-for-demo-only', 'utf8');

if (!process.env.ENCRYPTION_KEY) {
  console.warn('⚠️  ENCRYPTION_KEY not set, using fallback (not secure for production)');
}

class Encryption {
  static encrypt(text) {
    if (!text) return null;
    
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipherGCM(ALGORITHM, KEY, iv);
      cipher.setAAD(Buffer.from('additional-data'));
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Encryption error:', error);
      return null;
    }
  }

  static decrypt(encryptedData) {
    if (!encryptedData || typeof encryptedData !== 'object') return null;
    if (!encryptedData.encrypted || typeof encryptedData.encrypted !== 'string') return null;
    if (!encryptedData.authTag || typeof encryptedData.authTag !== 'string') return null;
    if (!encryptedData.iv || typeof encryptedData.iv !== 'string') return null;
    
    try {
      // Validate hex format to prevent injection
      if (!/^[0-9a-fA-F]+$/.test(encryptedData.encrypted) || 
          !/^[0-9a-fA-F]+$/.test(encryptedData.authTag) ||
          !/^[0-9a-fA-F]+$/.test(encryptedData.iv)) {
        return null;
      }
      
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decipher = crypto.createDecipherGCM(ALGORITHM, KEY, iv);
      decipher.setAAD(Buffer.from('additional-data'));
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  }

  // Simple encryption for less sensitive data
  static simpleEncrypt(text) {
    if (!text) return null;
    const cipher = crypto.createCipher('aes192', KEY);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  static simpleDecrypt(encrypted) {
    if (!encrypted) return null;
    try {
      const decipher = crypto.createDecipher('aes192', KEY);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      return null;
    }
  }
}

module.exports = Encryption;
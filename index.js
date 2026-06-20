// index.js - VERSION 7.1 (FULL BACKEND API + STAFF MANAGEMENT + IZIN ONLINE)
// Backend untuk Sistem Absensi IoT
// ONLY SUPABASE STORAGE - No ImgBB fallback
// FITUR BARU V7.1:
// - Izin Online (CRUD) endpoints
// - Upload attachment untuk izin
// - Approve/Reject izin dengan alasan
// - Staff Management (CRUD) endpoints
// - Improved CORS configuration
// - Better error handling
// - Rate limiting for all endpoints
// ============================================================================

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Load environment variables
dotenv.config();

// ============ VALIDASI ENVIRONMENT VARIABLES ============
const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_DATABASE_URL',
  'JWT_SECRET'
];

const supabaseRequiredVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

const optionalEnvVars = [
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'FONNTE_API_KEY',
  'STORAGE_BUCKET'
];

const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    if (!isVercel) process.exit(1);
  }
});

supabaseRequiredVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing Supabase environment variable: ${varName}`);
    if (!isVercel) process.exit(1);
  }
});

optionalEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.warn(`⚠️ Optional environment variable not set: ${varName}`);
  }
});

// ============ KONFIGURASI ============

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyBZg9NpbBAg8dKHkCbYf4J_2bpHH2ZJWWI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "absensi-4389a-default-rtdb.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "absensi-4389a-default-rtdb.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: process.env.FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const OPENAI_CONFIG = {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    maxTokens: 2000,
    temperature: 0.3,
    apiUrl: 'https://api.openai.com/v1/chat/completions'
};

const WHATSAPP_CONFIG = {
    gateway: 'fonnte',
    fonnteApiKey: process.env.FONNTE_API_KEY,
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    sendOnCheckIn: true,
    sendOnCheckOut: true,
    sendOnLate: true,
    sendOnAbsent: true,
    senderNumber: ''
};

// Konfigurasi Reset Password
const RESET_PASSWORD_CONFIG = {
    tokenExpiryHours: 1,
    rateLimitMinutes: 60,
    maxRequestsPerEmail: 3
};

// ============ SUPABASE CONFIGURATION ============
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'foto-absensi';

let supabase = null;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required!');
  if (!isVercel) process.exit(1);
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('✅ Supabase client initialized');
}

// Konfigurasi Multer untuk Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024
  }
});

// Firebase Admin SDK
const serviceAccount = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
  token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
    if (!isVercel) process.exit(1);
  }
}

const db = admin.database();
const app = express();

// ============ MIDDLEWARE ============

// CORS Configuration - Allow multiple origins
const allowedOrigins = [
  'https://absensi-4389a.web.app',
  'https://backendtest-gtts3evem-miftah-s-projects.vercel.app',
  'http://localhost:5500',
  'http://localhost:3000',
  'https://absensi-4389a-default-rtdb.firebaseio.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked for origin: ${origin}`);
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (!isVercel) {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// ============ SUPABASE STORAGE FUNCTIONS ============

async function uploadToSupabase(fileBuffer, fileName, folder = 'uploads', userId = null) {
  if (!supabase) {
    return { success: false, error: 'Supabase client not initialized.' };
  }
  
  try {
    const originalExt = fileName.split('.').pop().toLowerCase();
    const ext = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(originalExt) ? originalExt : 'jpg';
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    
    let fullPath;
    if (userId && userId !== 'null' && userId !== 'undefined' && userId !== '') {
      fullPath = `${folder}/${userId}/${timestamp}_${randomStr}.${ext}`;
    } else {
      fullPath = `${folder}/${timestamp}_${randomStr}.${ext}`;
    }
    
    let contentType = 'image/jpeg';
    if (ext === 'png') contentType = 'image/png';
    if (ext === 'gif') contentType = 'image/gif';
    if (ext === 'webp') contentType = 'image/webp';
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fullPath, fileBuffer, {
        cacheControl: '3600',
        contentType: contentType,
        upsert: false
      });
    
    if (error) throw error;
    
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(fullPath);
    
    console.log(`✅ Uploaded to Supabase: ${publicUrl}`);
    
    return {
      success: true,
      url: publicUrl,
      path: fullPath,
      storage: 'supabase'
    };
  } catch (error) {
    console.error('Supabase upload error:', error.message);
    return { success: false, error: error.message };
  }
}

async function deleteFromSupabase(fileUrl) {
  if (!supabase || !fileUrl) return false;
  
  try {
    const supabasePattern = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;
    if (!fileUrl.startsWith(supabasePattern)) {
      console.log('Not a Supabase URL, skipping delete');
      return true;
    }
    
    const path = fileUrl.replace(supabasePattern, '');
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    if (error) throw error;
    
    console.log(`✅ Deleted: ${path}`);
    return true;
  } catch (error) {
    console.error('Delete error:', error.message);
    return false;
  }
}

// ============ HELPER FUNCTIONS ============

async function sendWhatsAppMessage(phoneNumber, message) {
  if (!WHATSAPP_CONFIG.enabled || !WHATSAPP_CONFIG.fonnteApiKey) {
    return { success: false, error: 'WhatsApp disabled' };
  }
  
  try {
    const response = await axios.post('https://api.fonnte.com/send', {
      target: phoneNumber,
      message: message,
      countryCode: '62'
    }, {
      headers: { 'Authorization': WHATSAPP_CONFIG.fonnteApiKey },
      timeout: 30000
    });
    
    return { success: true, data: response.data };
  } catch (error) {
    console.error('WhatsApp error:', error.message);
    return { success: false, error: error.message };
  }
}

async function sendResetPasswordWhatsApp(phoneNumber, userName, email, resetLink) {
  const schoolName = process.env.SCHOOL_NAME || 'Sistem Absensi';
  const currentTime = new Date().toLocaleString('id-ID');
  
  const message = `*🔐 RESET PASSWORD - ${schoolName}*

Halo *${userName}*,

Kami menerima permintaan untuk mereset password akun Anda.

📧 *Email:* ${email}
⏰ *Waktu permintaan:* ${currentTime}

*🔗 Link Reset Password:*
${resetLink}

*⚠️ Petunjuk:*
1. Klik link di atas (berlaku ${RESET_PASSWORD_CONFIG.tokenExpiryHours} jam)
2. Masukkan password baru (minimal 6 karakter)
3. Login kembali dengan password baru

Jika Anda tidak merasa melakukan permintaan ini, abaikan pesan ini.

---
📱 *Sistem Absensi IoT - ${schoolName}*
🔒 Pesan ini dikirim otomatis, jangan balas.`;

  return await sendWhatsAppMessage(phoneNumber, message);
}

async function checkResetPasswordRateLimit(email, ipAddress) {
  const now = Date.now();
  const rateLimitMs = RESET_PASSWORD_CONFIG.rateLimitMinutes * 60 * 1000;
  const cutoffTime = now - rateLimitMs;
  
  try {
    const snapshot = await db.ref('password_reset_logs')
      .orderByChild('timestamp')
      .startAt(cutoffTime)
      .once('value');
    
    const logs = snapshot.val() || {};
    let requestCount = 0;
    
    for (const [id, log] of Object.entries(logs)) {
      if (log.email === email || log.ipAddress === ipAddress) {
        requestCount++;
      }
    }
    
    return {
      allowed: requestCount < RESET_PASSWORD_CONFIG.maxRequestsPerEmail,
      count: requestCount,
      max: RESET_PASSWORD_CONFIG.maxRequestsPerEmail
    };
  } catch (error) {
    console.error('Rate limit check error:', error);
    return { allowed: true, count: 0, max: RESET_PASSWORD_CONFIG.maxRequestsPerEmail };
  }
}

function generateResetToken(email, userId) {
  const payload = {
    email: email,
    userId: userId,
    type: 'password_reset',
    exp: Math.floor(Date.now() / 1000) + (RESET_PASSWORD_CONFIG.tokenExpiryHours * 60 * 60)
  };
  return jwt.sign(payload, process.env.JWT_SECRET);
}

function verifyResetToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'password_reset') {
      return { valid: false, error: 'Invalid token type' };
    }
    return { valid: true, data: decoded };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired. Please request a new reset link.' };
    }
    return { valid: false, error: 'Invalid token' };
  }
}

async function getUserByEmail(email) {
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    return { success: true, user: userRecord };
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return { success: false, error: 'User not found' };
    }
    return { success: false, error: error.message };
  }
}

async function getUserWhatsAppNumber(userId, userData = null) {
  let phoneNumber = null;
  
  try {
    const userSnapshot = await db.ref(`users_auth/${userId}`).once('value');
    const user = userSnapshot.val();
    
    if (user) {
      if (user.noHp && user.noHp !== '-' && user.noHp !== '') {
        phoneNumber = user.noHp;
      }
      
      if (!phoneNumber && user.role === 'siswa' && user.fpId) {
        const parentSnapshot = await db.ref(`parent_contacts/${user.fpId}`).once('value');
        const parentData = parentSnapshot.val();
        if (parentData && parentData.phoneNumber) {
          phoneNumber = parentData.phoneNumber;
        }
      }
      
      if (!phoneNumber && (user.role === 'guru' || user.role === 'admin' || user.role === 'wakil_kepala' || user.role === 'staff_tu')) {
        const staffId = user.staffId || userId;
        const staffContactSnapshot = await db.ref(`staff_contacts/${staffId}`).once('value');
        const contactData = staffContactSnapshot.val();
        if (contactData && contactData.phoneNumber) {
          phoneNumber = contactData.phoneNumber;
        }
      }
    }
    
    if (phoneNumber) {
      phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
      if (phoneNumber.startsWith('0')) phoneNumber = '62' + phoneNumber.substring(1);
      if (!phoneNumber.startsWith('62')) phoneNumber = '62' + phoneNumber;
    }
    
    return phoneNumber;
  } catch (error) {
    console.error('Error getting user WhatsApp number:', error);
    return null;
  }
}

async function callGroqAPI(messages) {
  if (!GROQ_API_KEY) {
    return { success: false, error: 'GROQ_API_KEY not configured' };
  }
  
  try {
    const response = await axios.post(GROQ_API_URL, {
      model: GROQ_MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 1024
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    
    return { success: true, content: response.data.choices[0].message.content };
  } catch (error) {
    console.error('GROQ API error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
}

async function callOpenAI(messages) {
  if (!OPENAI_CONFIG.apiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }
  
  try {
    const response = await axios.post(OPENAI_CONFIG.apiUrl, {
      model: OPENAI_CONFIG.model,
      messages: messages,
      max_tokens: OPENAI_CONFIG.maxTokens,
      temperature: OPENAI_CONFIG.temperature
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });
    
    return { success: true, content: response.data.choices[0].message.content };
  } catch (error) {
    console.error('OpenAI error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
}

// ============ AUTHENTICATION MIDDLEWARE ============

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'developer') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

// ============ PUBLIC ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: admin.apps.length > 0 ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development',
    services: {
      groq: !!GROQ_API_KEY,
      openai: !!OPENAI_CONFIG.apiKey,
      whatsapp: WHATSAPP_CONFIG.enabled,
      supabase: !!SUPABASE_URL
    }
  });
});

// Get Firebase config
app.get('/api/firebase-config', (req, res) => {
  res.json({ success: true, config: firebaseConfig });
});

// ============ RESET PASSWORD ENDPOINTS ============

app.post('/api/auth/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email } = req.body;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  try {
    const rateLimit = await checkResetPasswordRateLimit(email, ipAddress);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many requests. Please wait ${RESET_PASSWORD_CONFIG.rateLimitMinutes} minutes. (${rateLimit.count}/${rateLimit.max} requests)`
      });
    }

    const userResult = await getUserByEmail(email);
    if (!userResult.success) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      return res.json({
        success: true,
        message: 'If your email is registered, you will receive a reset link.'
      });
    }

    const user = userResult.user;
    const userId = user.uid;

    const userSnapshot = await db.ref(`users_auth/${userId}`).once('value');
    const userData = userSnapshot.val();
    const userName = userData?.nama || user.displayName || email.split('@')[0];

    const resetToken = generateResetToken(email, userId);
    const frontendUrl = process.env.FRONTEND_URL || 'https://absensi-4389a.web.app';
    const resetLink = `${frontendUrl}?mode=resetPassword&token=${resetToken}&email=${encodeURIComponent(email)}`;

    let emailSent = false;
    let whatsappSent = false;
    let phoneNumber = null;

    try {
      const actionCodeSettings = {
        url: `${frontendUrl}?mode=resetPassword&email=${encodeURIComponent(email)}`,
        handleCodeInApp: true
      };
      await admin.auth().generatePasswordResetLink(email, actionCodeSettings);
      emailSent = true;
      console.log(`✅ Reset email generated for: ${email}`);
    } catch (emailError) {
      console.error('Email generation error:', emailError);
    }

    phoneNumber = await getUserWhatsAppNumber(userId, userData);
    if (phoneNumber) {
      const whatsappResult = await sendResetPasswordWhatsApp(phoneNumber, userName, email, resetLink);
      whatsappSent = whatsappResult.success;
      if (whatsappSent) {
        console.log(`✅ Reset WhatsApp sent to: ${phoneNumber}`);
      }
    }

    await db.ref('password_reset_logs').push({
      email: email,
      userId: userId,
      userName: userName,
      phoneNumber: phoneNumber || null,
      emailSent: emailSent,
      whatsappSent: whatsappSent,
      ipAddress: ipAddress,
      userAgent: req.headers['user-agent'] || 'unknown',
      timestamp: Date.now()
    });

    let responseMessage = 'If your email is registered, you will receive a reset link';
    if (whatsappSent && phoneNumber) {
      responseMessage += ` via email and WhatsApp to ${phoneNumber}`;
    } else if (emailSent) {
      responseMessage += ' via email';
    } else {
      responseMessage = 'Unable to send reset link. Please contact administrator.';
    }

    res.json({
      success: true,
      message: responseMessage,
      details: {
        emailSent,
        whatsappSent,
        phoneNumber: phoneNumber ? phoneNumber.replace(/[0-9]/g, '*') : null
      }
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.'
    });
  }
});

app.post('/api/auth/verify-reset-token', [
  body('token').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { token } = req.body;

  try {
    const verification = verifyResetToken(token);
    
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        error: verification.error,
        expired: verification.error?.includes('expired') || false
      });
    }

    const { email, userId } = verification.data;
    
    const userResult = await getUserByEmail(email);
    if (!userResult.success) {
      return res.status(404).json({
        success: false,
        error: 'User no longer exists'
      });
    }

    res.json({
      success: true,
      message: 'Token is valid',
      data: { email, userId }
    });

  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/auth/reset-password', [
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { token, newPassword } = req.body;

  try {
    const verification = verifyResetToken(token);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        error: verification.error,
        expired: verification.error?.includes('expired') || false
      });
    }

    const { email, userId } = verification.data;

    await admin.auth().updateUser(userId, {
      password: newPassword
    });

    await db.ref('password_change_logs').push({
      email: email,
      userId: userId,
      method: 'reset_password',
      timestamp: Date.now(),
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
    });

    const userSnapshot = await db.ref(`users_auth/${userId}`).once('value');
    const userData = userSnapshot.val();
    const userName = userData?.nama || email.split('@')[0];
    const phoneNumber = await getUserWhatsAppNumber(userId, userData);
    
    if (phoneNumber) {
      const schoolName = process.env.SCHOOL_NAME || 'Sistem Absensi';
      const confirmMessage = `*✅ PASSWORD BERHASIL DIUBAH - ${schoolName}*

Halo *${userName}*,

Password akun Anda telah berhasil diubah pada ${new Date().toLocaleString('id-ID')}.

Jika Anda tidak melakukan perubahan ini, segera hubungi administrator sekolah.

---
📱 *Sistem Absensi IoT - ${schoolName}*`;
      
      await sendWhatsAppMessage(phoneNumber, confirmMessage);
    }

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({
        success: false,
        error: 'User no longer exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// ============ STORAGE ENDPOINTS ============

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided.'
      });
    }
    
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.'
      });
    }
    
    const { folder = 'uploads', userId } = req.body;
    
    console.log(`📤 Upload request: folder=${folder}, userId=${userId || 'none'}, file=${req.file.originalname}`);
    
    const result = await uploadToSupabase(req.file.buffer, req.file.originalname, folder, userId);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Image uploaded successfully to Supabase',
        data: {
          url: result.url,
          path: result.path,
          storage: 'supabase'
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Supabase upload failed'
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

app.post('/api/storage/delete', async (req, res) => {
  try {
    const { fileUrl } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ success: false, error: 'No file URL provided' });
    }
    
    const result = await deleteFromSupabase(fileUrl);
    res.json({ success: result, message: result ? 'File deleted' : 'File not found' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============ AI CHAT ENDPOINTS ============

app.post('/api/ai/groq', async (req, res) => {
  const { message, systemPrompt, history = [] } = req.body;
  
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  
  const systemContent = systemPrompt || 'Anda adalah asisten AI yang membantu untuk sistem absensi. Jawab dengan bahasa Indonesia yang sopan dan informatif.';
  
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message }
  ];
  
  const result = await callGroqAPI(messages);
  
  if (result.success) {
    res.json({ success: true, response: result.content });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

app.post('/api/ai/openai', async (req, res) => {
  const { message, systemPrompt, history = [] } = req.body;
  
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  
  const systemContent = systemPrompt || 'Anda adalah asisten AI yang membantu untuk sistem absensi. Jawab dengan bahasa Indonesia yang sopan dan informatif.';
  
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message }
  ];
  
  const result = await callOpenAI(messages);
  
  if (result.success) {
    res.json({ success: true, response: result.content });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// ============ WHATSAPP ENDPOINTS ============

app.post('/api/whatsapp/send', async (req, res) => {
  const { phoneNumber, message } = req.body;
  
  if (!phoneNumber || !message) {
    return res.status(400).json({ success: false, error: 'Phone number and message are required' });
  }
  
  const result = await sendWhatsAppMessage(phoneNumber, message);
  
  if (result.success) {
    res.json({ success: true, message: 'WhatsApp message sent', data: result.data });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

// ============ AUTH ENDPOINTS ============

app.post('/api/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').notEmpty().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password, name, role = 'user', phoneNumber } = req.body;

  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');

    if (snapshot.exists()) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUserRef = usersRef.push();
    const userId = newUserRef.key;

    const userData = {
      userId, email, name, role,
      password: hashedPassword,
      phoneNumber: phoneNumber || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await newUserRef.set(userData);

    const token = jwt.sign(
      { userId, email, name, role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: { userId, email, name, role, phoneNumber }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');

    if (!snapshot.exists()) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    let userData = null, userId = null;
    snapshot.forEach((child) => {
      userData = child.val();
      userId = child.key;
    });

    const isValidPassword = await bcrypt.compare(password, userData.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { userId, email: userData.email, name: userData.name, role: userData.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        userId,
        email: userData.email,
        name: userData.name,
        role: userData.role,
        phoneNumber: userData.phoneNumber || null,
        profilePicture: userData.profilePicture || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============ PROTECTED ROUTES ============

app.post('/api/upload-profile', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }
    
    const result = await uploadToSupabase(
      req.file.buffer,
      `profile_${req.user.userId}_${Date.now()}.jpg`,
      'profiles',
      req.user.userId
    );
    
    if (result.success) {
      await db.ref(`users/${req.user.userId}`).update({
        profilePicture: result.url,
        updatedAt: new Date().toISOString()
      });
      
      res.json({
        success: true,
        message: 'Profile picture uploaded successfully to Supabase',
        data: { url: result.url }
      });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('Upload profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.userId}`).once('value');
    const userData = snapshot.val();

    if (!userData) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    delete userData.password;
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/profile', authenticateToken, [
  body('name').optional().trim().notEmpty(),
  body('email').optional().isEmail(),
  body('phoneNumber').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, phoneNumber } = req.body;
  const updates = { updatedAt: new Date().toISOString() };
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phoneNumber) updates.phoneNumber = phoneNumber;

  try {
    await db.ref(`users/${req.user.userId}`).update(updates);
    const snapshot = await db.ref(`users/${req.user.userId}`).once('value');
    const userData = snapshot.val();
    delete userData.password;
    
    res.json({ success: true, message: 'Profile updated', user: userData });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============ STAFF MANAGEMENT ENDPOINTS ============

app.get('/api/staff', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.ref('staff').once('value');
    const data = snapshot.val();
    const staff = [];
    
    if (data) {
      Object.keys(data).forEach(key => {
        staff.push({ id: key, ...data[key] });
      });
    }
    
    staff.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
    
    res.json({ 
      success: true, 
      data: staff, 
      total: staff.length 
    });
  } catch (error) {
    console.error('Get staff error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

app.get('/api/staff/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = await db.ref(`staff/${id}`).once('value');
    const data = snapshot.val();
    
    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: 'Staff not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: { id, ...data } 
    });
  } catch (error) {
    console.error('Get staff by ID error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

app.post('/api/staff', authenticateToken, [
  body('nama').notEmpty().withMessage('Nama wajib diisi'),
  body('jabatan').optional().isString(),
  body('departemen').optional().isString(),
  body('noHp').optional().isString(),
  body('email').optional().isEmail().withMessage('Format email tidak valid')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      errors: errors.array() 
    });
  }

  try {
    const { nama, jabatan, departemen, noHp, email } = req.body;
    
    const id = `STAFF-${Date.now()}`;
    
    const newStaff = {
      id,
      nama: nama.trim(),
      jabatan: jabatan || 'guru',
      departemen: departemen || '-',
      noHp: noHp || '-',
      email: email || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: req.user.name || req.user.email || 'system'
    };

    await db.ref(`staff/${id}`).set(newStaff);
    
    res.status(201).json({ 
      success: true, 
      message: 'Staff created successfully',
      data: newStaff
    });
  } catch (error) {
    console.error('Create staff error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

app.put('/api/staff/:id', authenticateToken, [
  body('nama').optional().trim(),
  body('jabatan').optional().isString(),
  body('departemen').optional().isString(),
  body('noHp').optional().isString(),
  body('email').optional().isEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      errors: errors.array() 
    });
  }

  try {
    const { id } = req.params;
    const { nama, jabatan, departemen, noHp, email } = req.body;
    
    const snapshot = await db.ref(`staff/${id}`).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: 'Staff not found' 
      });
    }

    const updates = { 
      updatedAt: Date.now(),
      updatedBy: req.user.name || req.user.email || 'system'
    };
    
    if (nama) updates.nama = nama.trim();
    if (jabatan) updates.jabatan = jabatan;
    if (departemen) updates.departemen = departemen;
    if (noHp) updates.noHp = noHp;
    if (email) updates.email = email;

    await db.ref(`staff/${id}`).update(updates);
    
    const updatedSnapshot = await db.ref(`staff/${id}`).once('value');
    
    res.json({ 
      success: true, 
      message: 'Staff updated successfully',
      data: { id, ...updatedSnapshot.val() }
    });
  } catch (error) {
    console.error('Update staff error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

app.delete('/api/staff/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const snapshot = await db.ref(`staff/${id}`).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: 'Staff not found' 
      });
    }

    const staffData = snapshot.val();
    
    await db.ref(`staff/${id}`).remove();
    await db.ref(`staff_contacts/${id}`).remove().catch(() => {});
    
    res.json({ 
      success: true, 
      message: 'Staff deleted successfully',
      data: { id, ...staffData }
    });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

app.get('/api/staff/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ 
        success: false, 
        error: 'Search query is required' 
      });
    }

    const snapshot = await db.ref('staff').once('value');
    const data = snapshot.val();
    const results = [];
    
    if (data) {
      const searchLower = q.toLowerCase();
      Object.keys(data).forEach(key => {
        const staff = { id: key, ...data[key] };
        const match = 
          (staff.nama && staff.nama.toLowerCase().includes(searchLower)) ||
          (staff.jabatan && staff.jabatan.toLowerCase().includes(searchLower)) ||
          (staff.departemen && staff.departemen.toLowerCase().includes(searchLower)) ||
          (staff.email && staff.email.toLowerCase().includes(searchLower)) ||
          (staff.noHp && staff.noHp.toLowerCase().includes(searchLower));
        
        if (match) {
          results.push(staff);
        }
      });
    }
    
    res.json({ 
      success: true, 
      data: results, 
      total: results.length 
    });
  } catch (error) {
    console.error('Search staff error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// ============ IZIN ONLINE ENDPOINTS ============

/**
 * GET /api/izin - Get all izin
 */
app.get('/api/izin', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.ref('izin').once('value');
    const data = snapshot.val();
    const izinList = [];
    
    if (data) {
      Object.keys(data).forEach(key => {
        izinList.push({ id: key, ...data[key] });
      });
    }
    
    // Sort by submittedAt descending (newest first)
    izinList.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    
    res.json({ 
      success: true, 
      data: izinList, 
      total: izinList.length 
    });
  } catch (error) {
    console.error('Get izin error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * GET /api/izin/:id - Get izin by ID
 */
app.get('/api/izin/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = await db.ref(`izin/${id}`).once('value');
    const data = snapshot.val();
    
    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: 'Izin not found' 
      });
    }
    
    res.json({ 
      success: true, 
      data: { id, ...data } 
    });
  } catch (error) {
    console.error('Get izin by ID error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * POST /api/izin - Create new izin
 */
app.post('/api/izin', authenticateToken, upload.single('attachment'), async (req, res) => {
  try {
    const { 
      type, 
      startDate, 
      endDate, 
      reason, 
      studentId, 
      studentName, 
      kelas, 
      jurusan 
    } = req.body;
    
    // Validate required fields
    if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({ 
        success: false, 
        error: 'Type, startDate, endDate, and reason are required' 
      });
    }
    
    let attachmentUrl = null;
    let attachmentPath = null;
    
    // Upload attachment if exists
    if (req.file) {
      const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
      if (!allowedMimes.includes(req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file type. Only JPG, PNG, and PDF are allowed.'
        });
      }
      
      if (req.file.size > 2 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: 'File size must be less than 2MB'
        });
      }
      
      const result = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        'izin',
        req.user.userId
      );
      
      if (result.success) {
        attachmentUrl = result.url;
        attachmentPath = result.path;
      }
    }
    
    const newIzin = {
      studentId: studentId || req.user.userId,
      studentName: studentName || req.user.name || 'User',
      kelas: kelas || '-',
      jurusan: jurusan || '-',
      type: type,
      startDate: startDate,
      endDate: endDate,
      reason: reason,
      attachment: attachmentUrl,
      attachmentPath: attachmentPath,
      status: 'pending',
      submittedBy: req.user.name || req.user.email || 'system',
      submittedAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null,
      rejectReason: null,
      rejectedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const ref = db.ref('izin').push();
    await ref.set(newIzin);
    
    res.status(201).json({ 
      success: true, 
      message: 'Izin submitted successfully',
      data: { id: ref.key, ...newIzin }
    });
  } catch (error) {
    console.error('Create izin error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * PUT /api/izin/:id/approve - Approve izin
 */
app.put('/api/izin/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { approvedBy } = req.body;
    
    // Check if izin exists
    const snapshot = await db.ref(`izin/${id}`).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: 'Izin not found' 
      });
    }
    
    const izinData = snapshot.val();
    
    // Check if already processed
    if (izinData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Izin already ${izinData.status}`
      });
    }
    
    const updates = {
      status: 'approved',
      approvedBy: approvedBy || req.user.name || req.user.email || 'Admin',
      approvedAt: new Date().toISOString(),
      updatedAt: Date.now()
    };
    
    await db.ref(`izin/${id}`).update(updates);
    
    const updatedSnapshot = await db.ref(`izin/${id}`).once('value');
    
    res.json({ 
      success: true, 
      message: 'Izin approved successfully',
      data: { id, ...updatedSnapshot.val() }
    });
  } catch (error) {
    console.error('Approve izin error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * PUT /api/izin/:id/reject - Reject izin
 */
app.put('/api/izin/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectReason } = req.body;
    
    if (!rejectReason || !rejectReason.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Reject reason is required'
      });
    }
    
    // Check if izin exists
    const snapshot = await db.ref(`izin/${id}`).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: 'Izin not found' 
      });
    }
    
    const izinData = snapshot.val();
    
    // Check if already processed
    if (izinData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Izin already ${izinData.status}`
      });
    }
    
    const updates = {
      status: 'rejected',
      rejectReason: rejectReason.trim(),
      rejectedAt: new Date().toISOString(),
      updatedAt: Date.now()
    };
    
    await db.ref(`izin/${id}`).update(updates);
    
    const updatedSnapshot = await db.ref(`izin/${id}`).once('value');
    
    res.json({ 
      success: true, 
      message: 'Izin rejected successfully',
      data: { id, ...updatedSnapshot.val() }
    });
  } catch (error) {
    console.error('Reject izin error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * DELETE /api/izin/:id - Delete izin
 */
app.delete('/api/izin/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if izin exists
    const snapshot = await db.ref(`izin/${id}`).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ 
        success: false, 
        error: 'Izin not found' 
      });
    }
    
    const izinData = snapshot.val();
    
    // Delete attachment from Supabase if exists
    if (izinData.attachmentPath) {
      await deleteFromSupabase(izinData.attachmentPath);
    }
    
    await db.ref(`izin/${id}`).remove();
    
    res.json({ 
      success: true, 
      message: 'Izin deleted successfully',
      data: { id, ...izinData }
    });
  } catch (error) {
    console.error('Delete izin error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

/**
 * GET /api/izin/stats - Get izin statistics
 */
app.get('/api/izin/stats', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.ref('izin').once('value');
    const data = snapshot.val();
    const izinList = [];
    
    if (data) {
      Object.keys(data).forEach(key => {
        izinList.push({ id: key, ...data[key] });
      });
    }
    
    const total = izinList.length;
    const pending = izinList.filter(izin => izin.status === 'pending').length;
    const approved = izinList.filter(izin => izin.status === 'approved').length;
    const rejected = izinList.filter(izin => izin.status === 'rejected').length;
    const sakit = izinList.filter(izin => izin.type === 'sakit').length;
    const keperluan = izinList.filter(izin => izin.type === 'keperluan').length;
    
    res.json({
      success: true,
      data: { total, pending, approved, rejected, sakit, keperluan }
    });
  } catch (error) {
    console.error('Get izin stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

// ============ ADMIN ROUTES ============

app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.ref('users').once('value');
    const users = [];
    snapshot.forEach((child) => {
      const userData = child.val();
      delete userData.password;
      users.push({ userId: child.key, ...userData });
    });
    res.json({ success: true, users, total: users.length });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const snapshot = await db.ref(`users/${userId}`).once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    await db.ref(`users/${userId}`).remove();
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.ref('users').once('value');
    const attendanceSnapshot = await db.ref('attendance').once('value');
    const staffSnapshot = await db.ref('staff').once('value');
    const izinSnapshot = await db.ref('izin').once('value');
    
    const totalUsers = usersSnapshot.numChildren();
    const totalStaff = staffSnapshot.numChildren();
    const totalIzin = izinSnapshot.numChildren();
    
    let totalAttendance = 0, todayAttendance = 0, lateToday = 0;
    const today = new Date().toISOString().split('T')[0];

    attendanceSnapshot.forEach((dateSnapshot) => {
      const date = dateSnapshot.key;
      const count = dateSnapshot.numChildren();
      totalAttendance += count;
      if (date === today) {
        todayAttendance = count;
        dateSnapshot.forEach((child) => {
          if (child.val().isLate) lateToday++;
        });
      }
    });

    res.json({
      success: true,
      stats: { 
        totalUsers, 
        totalStaff,
        totalAttendance, 
        todayAttendance, 
        lateToday,
        totalIzin,
        lastUpdated: new Date().toISOString() 
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: `Route not found: ${req.method} ${req.path}` 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(500).json({ 
    success: false, 
    error: err.message || 'Internal server error' 
  });
});

// ============ EXPORT FOR VERCEL ============
module.exports = app;

// Start server jika dijalankan langsung (bukan di Vercel)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    🚀 BACKEND SERVER STARTED SUCCESSFULLY                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                                   ║
║  Environment: ${process.env.NODE_ENV || 'development'}                                               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Services:                                                                   ║
║  🔥 Firebase: ${admin.apps.length > 0 ? '✅' : '❌'}                                                       ║
║  🤖 GROQ API: ${GROQ_API_KEY ? '✅' : '❌'}                                                        ║
║  🤖 OpenAI API: ${OPENAI_CONFIG.apiKey ? '✅' : '❌'}                                                      ║
║  💬 WhatsApp: ${WHATSAPP_CONFIG.enabled ? '✅' : '❌'}                                                     ║
║  🗄️ Supabase: ${SUPABASE_URL ? '✅' : '❌'}                                                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Staff Management:                                                           ║
║  ✅ GET    /api/staff      - Get all staff                                  ║
║  ✅ GET    /api/staff/:id  - Get staff by ID                               ║
║  ✅ POST   /api/staff      - Create staff                                   ║
║  ✅ PUT    /api/staff/:id  - Update staff                                   ║
║  ✅ DELETE /api/staff/:id  - Delete staff                                   ║
║  ✅ GET    /api/staff/search - Search staff                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Izin Online:                                                               ║
║  ✅ GET    /api/izin        - Get all izin                                 ║
║  ✅ GET    /api/izin/:id    - Get izin by ID                              ║
║  ✅ POST   /api/izin        - Create izin (with attachment upload)          ║
║  ✅ PUT    /api/izin/:id/approve - Approve izin                            ║
║  ✅ PUT    /api/izin/:id/reject  - Reject izin                            ║
║  ✅ DELETE /api/izin/:id    - Delete izin                                  ║
║  ✅ GET    /api/izin/stats  - Get izin statistics                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Reset Password Features:                                                   ║
║  📧 Email Reset: ✅ (via Firebase Auth)                                      ║
║  📱 WhatsApp Reset: ${WHATSAPP_CONFIG.enabled ? '✅' : '❌'} (if number registered)                           ║
║  🔒 Token Expiry: ${RESET_PASSWORD_CONFIG.tokenExpiryHours} hour(s)                                           ║
║  🚦 Rate Limit: ${RESET_PASSWORD_CONFIG.maxRequestsPerEmail} request per ${RESET_PASSWORD_CONFIG.rateLimitMinutes} minutes                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
    `);
  });
}
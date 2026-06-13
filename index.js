// index.js - VERSION 3.0 (BACKEND PROXY - SECURE API KEYS)
// Backend untuk Sistem Absensi IoT
// Semua API Key disimpan di environment variables (AMAN)
// Mendukung: 
// - Groq AI Chat (via backend proxy)
// - Storage (Supabase + ImgBB fallback)
// - WhatsApp Gateway (Fonnte)
// - Firebase Admin SDK
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
const FormData = require('form-data');
const { createClient } = require('@supabase/supabase-js');

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

const optionalEnvVars = [
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'IMGBB_KEY',
  'FONNTE_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

optionalEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.warn(`⚠️ Optional environment variable not set: ${varName}`);
  }
});

// ============ KONFIGURASI ============

// Firebase Config (for frontend reference)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyBZg9NpbBAg8dKHkCbYf4J_2bpHH2ZJWWI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "absensi-4389a-default-rtdb.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "absensi-4389a-default-rtdb.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: process.env.FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

// GROQ API Configuration (dari environment variables)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// OpenAI Configuration (dari environment variables)
const OPENAI_CONFIG = {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    maxTokens: 2000,
    temperature: 0.3,
    apiUrl: 'https://api.openai.com/v1/chat/completions'
};

// IMGBB Configuration (dari environment variables)
const IMGBB_KEY = process.env.IMGBB_KEY;

// WhatsApp Configuration (Fonnte) - dari environment variables
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

// Supabase Configuration (dari environment variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'foto-absensi';

// Initialize Supabase client (jika dikonfigurasi)
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️ Supabase not configured, using ImgBB only');
}

const upload = multer({ storage: multer.memoryStorage() });

// Firebase Admin SDK Configuration
const serviceAccount = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
  token_uri: process.env.FIREBASE_TOKEN_URI || "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL || "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
    process.exit(1);
  }
}

const db = admin.database();
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============ HELPER FUNCTIONS ============

/**
 * Upload image to IMGBB (fallback)
 */
async function uploadToImgbb(fileBuffer, fileName) {
  if (!IMGBB_KEY) {
    return { success: false, error: 'IMGBB_KEY not configured' };
  }
  
  try {
    const formData = new FormData();
    formData.append('image', fileBuffer.toString('base64'));
    formData.append('name', fileName);
    
    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    return {
      success: true,
      url: response.data.data.url,
      thumb: response.data.data.thumb,
      delete_url: response.data.data.delete_url
    };
  } catch (error) {
    console.error('IMGBB upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Upload image to Supabase Storage
 */
async function uploadToSupabaseStorage(fileBuffer, fileName, folder = 'uploads', userId = null) {
  if (!supabase) {
    return { success: false, error: 'Supabase not configured' };
  }
  
  try {
    let fullPath;
    const ext = fileName.split('.').pop();
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    
    if (userId && userId !== 'null') {
      fullPath = `${folder}/${userId}/${timestamp}_${randomStr}.${ext}`;
    } else {
      fullPath = `${folder}/${timestamp}_${randomStr}.${ext}`;
    }
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fullPath, fileBuffer, {
        cacheControl: '3600',
        contentType: 'image/jpeg',
        upsert: false
      });
    
    if (error) throw error;
    
    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(fullPath);
    
    return {
      success: true,
      url: publicUrl,
      path: fullPath,
      storage: 'supabase'
    };
  } catch (error) {
    console.error('Supabase upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main upload handler (try Supabase first, fallback to ImgBB)
 */
async function uploadImage(fileBuffer, fileName, folder = 'uploads', userId = null) {
  // Coba upload ke Supabase dulu jika tersedia
  if (supabase) {
    const result = await uploadToSupabaseStorage(fileBuffer, fileName, folder, userId);
    if (result.success) {
      return { ...result, isFallback: false };
    }
    console.warn('Supabase upload failed, falling back to ImgBB:', result.error);
  }
  
  // Fallback ke ImgBB
  const result = await uploadToImgbb(fileBuffer, fileName);
  if (result.success) {
    return { ...result, isFallback: true, storage: 'imgbb' };
  }
  
  return { success: false, error: result.error };
}

/**
 * Delete file from storage (Supabase only, ImgBB cannot delete via API)
 */
async function deleteFromStorage(fileUrl) {
  if (!supabase || !fileUrl) return false;
  
  try {
    // Extract path from Supabase URL
    const supabasePattern = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;
    if (!fileUrl.startsWith(supabasePattern)) {
      console.log('Not a Supabase URL, skipping delete');
      return true;
    }
    
    const path = fileUrl.replace(supabasePattern, '');
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([path]);
    
    if (error) throw error;
    
    console.log(`✅ Deleted: ${path}`);
    return true;
  } catch (error) {
    console.error('Delete error:', error);
    return false;
  }
}

/**
 * Send WhatsApp message via Fonnte
 */
async function sendWhatsAppMessage(phoneNumber, message) {
  if (!WHATSAPP_CONFIG.enabled || !WHATSAPP_CONFIG.fonnteApiKey) {
    console.log('WhatsApp notifications disabled or not configured');
    return { success: false, message: 'WhatsApp disabled' };
  }
  
  try {
    const response = await axios.post('https://api.fonnte.com/send', {
      target: phoneNumber,
      message: message,
      countryCode: '62'
    }, {
      headers: {
        'Authorization': WHATSAPP_CONFIG.fonnteApiKey
      }
    });
    
    return { success: true, data: response.data };
  } catch (error) {
    console.error('WhatsApp error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Call GROQ API
 */
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
      }
    });
    
    return {
      success: true,
      content: response.data.choices[0].message.content
    };
  } catch (error) {
    console.error('GROQ API error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

/**
 * Call OpenAI API
 */
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
      }
    });
    
    return {
      success: true,
      content: response.data.choices[0].message.content
    };
  } catch (error) {
    console.error('OpenAI error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

/**
 * Check if user is late (after 08:00 AM)
 */
function isLate() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  return (hour > 8) || (hour === 8 && minute > 0);
}

/**
 * Authentication Middleware
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

/**
 * Admin Middleware
 */
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};

// ============ PUBLIC ROUTES (No Auth Required) ============

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
      imgbb: !!IMGBB_KEY,
      whatsapp: WHATSAPP_CONFIG.enabled,
      supabase: !!SUPABASE_URL
    }
  });
});

// Get Firebase config (for frontend)
app.get('/api/firebase-config', (req, res) => {
  res.json({
    success: true,
    config: firebaseConfig
  });
});

// ============ AI CHAT ENDPOINTS ============

/**
 * AI Chat via GROQ (via backend proxy - AMAN)
 * Frontend akan memanggil endpoint ini, bukan Groq langsung
 */
app.post('/api/ai/groq', async (req, res) => {
  const { message, systemPrompt, history = [], temperature = 0.7, maxTokens = 1024 } = req.body;
  
  console.log('🤖 GROQ Request received:', message?.substring(0, 100));
  
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Message is required'
    });
  }
  
  // Gunakan system prompt dari frontend atau default
  const systemContent = systemPrompt || 'Anda adalah asisten AI yang membantu untuk sistem absensi. Jawab dengan bahasa Indonesia yang sopan dan informatif. Berikan jawaban yang lengkap dan bermanfaat.';
  
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message }
  ];
  
  const result = await callGroqAPI(messages);
  
  if (result.success) {
    res.json({
      success: true,
      response: result.content
    });
  } else {
    console.error('GROQ API Error:', result.error);
    res.status(500).json({
      success: false,
      error: result.error || 'GROQ API error'
    });
  }
});

/**
 * AI Chat via OpenAI (via backend proxy)
 */
app.post('/api/ai/openai', async (req, res) => {
  const { message, systemPrompt, history = [] } = req.body;
  
  console.log('🤖 OpenAI Request received:', message?.substring(0, 100));
  
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Message is required'
    });
  }
  
  const systemContent = systemPrompt || 'Anda adalah asisten AI yang membantu untuk sistem absensi. Jawab dengan bahasa Indonesia yang sopan dan informatif.';
  
  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message }
  ];
  
  const result = await callOpenAI(messages);
  
  if (result.success) {
    res.json({
      success: true,
      response: result.content
    });
  } else {
    console.error('OpenAI API Error:', result.error);
    res.status(500).json({
      success: false,
      error: result.error || 'OpenAI API error'
    });
  }
});

// ============ STORAGE ENDPOINTS (via backend proxy - AMAN) ============

/**
 * Upload image (main endpoint)
 * Frontend akan memanggil endpoint ini untuk upload gambar
 */
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }
    
    const { folder = 'uploads', userId } = req.body;
    
    const result = await uploadImage(
      req.file.buffer,
      req.file.originalname,
      folder,
      userId
    );
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        data: {
          url: result.url,
          path: result.path || null,
          thumb: result.thumb || null,
          storage: result.storage || 'supabase',
          isFallback: result.isFallback || false
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Delete file from storage (Supabase only)
 */
app.post('/api/storage/delete', async (req, res) => {
  try {
    const { fileUrl } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        error: 'No file URL provided'
      });
    }
    
    const result = await deleteFromStorage(fileUrl);
    
    res.json({
      success: result,
      message: result ? 'File deleted successfully' : 'File not found or already deleted'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============ WHATSAPP ENDPOINTS ============

/**
 * Send WhatsApp message
 */
app.post('/api/whatsapp/send', async (req, res) => {
  const { phoneNumber, message } = req.body;
  
  if (!phoneNumber || !message) {
    return res.status(400).json({
      success: false,
      error: 'Phone number and message are required'
    });
  }
  
  const result = await sendWhatsAppMessage(phoneNumber, message);
  
  if (result.success) {
    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      data: result.data
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error
    });
  }
});

// ============ AUTH ENDPOINTS ============

/**
 * Register new user
 */
app.post('/api/register', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').notEmpty().withMessage('Name is required').trim(),
  body('role').optional().isIn(['user', 'admin']).withMessage('Invalid role'),
  body('phoneNumber').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const { email, password, name, role = 'user', phoneNumber } = req.body;

  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');

    if (snapshot.exists()) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUserRef = usersRef.push();
    const userId = newUserRef.key;

    const userData = {
      userId,
      email,
      name,
      role,
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

    if (phoneNumber && WHATSAPP_CONFIG.enabled) {
      const welcomeMessage = `Selamat datang ${name} di Aplikasi Absensi!\n\nAnda telah berhasil terdaftar dengan role: ${role}\nEmail: ${email}\n\nTerima kasih telah menggunakan layanan kami.`;
      await sendWhatsAppMessage(phoneNumber, welcomeMessage);
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: { userId, email, name, role, phoneNumber }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Login user
 */
app.post('/api/login', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const { email, password } = req.body;

  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('email').equalTo(email).once('value');

    if (!snapshot.exists()) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    let userData = null;
    let userId = null;

    snapshot.forEach((child) => {
      userData = child.val();
      userId = child.key;
    });

    const isValidPassword = await bcrypt.compare(password, userData.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
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
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============ PROTECTED ROUTES (Auth Required) ============

/**
 * Upload profile picture
 */
app.post('/api/upload-profile', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }
    
    const result = await uploadImage(
      req.file.buffer,
      `profile_${req.user.userId}_${Date.now()}`,
      'profiles',
      req.user.userId
    );
    
    if (result.success) {
      const userRef = db.ref(`users/${req.user.userId}`);
      await userRef.update({
        profilePicture: result.url,
        profilePictureThumb: result.thumb || result.url,
        updatedAt: new Date().toISOString()
      });
      
      res.json({
        success: true,
        message: 'Profile picture uploaded successfully',
        data: {
          url: result.url,
          thumb: result.thumb || result.url
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Upload profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get user profile
 */
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.userId}`).once('value');
    const userData = snapshot.val();

    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    delete userData.password;
    res.json({
      success: true,
      user: userData
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Update user profile
 */
app.put('/api/profile', authenticateToken, [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('phoneNumber').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const { name, email, phoneNumber } = req.body;
  const updates = {};

  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phoneNumber) updates.phoneNumber = phoneNumber;
  updates.updatedAt = new Date().toISOString();

  try {
    const userRef = db.ref(`users/${req.user.userId}`);
    await userRef.update(updates);

    const snapshot = await userRef.once('value');
    const userData = snapshot.val();
    delete userData.password;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: userData
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Check-in / Check-out
 */
app.post('/api/attendance', authenticateToken, [
  body('type').isIn(['check_in', 'check_out']).withMessage('Type must be check_in or check_out'),
  body('location').optional().isString(),
  body('notes').optional().isString(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
  body('photoUrl').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const { type, location, notes, latitude, longitude, photoUrl } = req.body;
  const { userId, name } = req.user;

  try {
    const today = new Date().toISOString().split('T')[0];
    const attendanceRef = db.ref(`attendance/${today}/${userId}`);
    const snapshot = await attendanceRef.once('value');
    
    const userSnapshot = await db.ref(`users/${userId}`).once('value');
    const userData = userSnapshot.val();
    const late = isLate();

    if (type === 'check_in') {
      if (snapshot.exists() && snapshot.val().checkIn) {
        return res.status(400).json({
          success: false,
          error: 'Already checked in today'
        });
      }

      const checkInData = {
        checkIn: new Date().toISOString(),
        checkInLocation: location || null,
        checkInNotes: notes || null,
        checkInLatitude: latitude || null,
        checkInLongitude: longitude || null,
        checkInPhoto: photoUrl || null,
        userId,
        userName: name,
        date: today,
        status: late ? 'late' : 'present',
        isLate: late
      };

      await attendanceRef.set(checkInData);

      if (WHATSAPP_CONFIG.sendOnCheckIn && userData?.phoneNumber) {
        const statusText = late ? '⚠️ TERLAMBAT' : '✅ TEPAT WAKTU';
        const message = `📋 *NOTIFIKASI ABSENSI*\n\nHalo ${name},\n\nAnda telah melakukan Check-in pada:\n📅 Tanggal: ${today}\n🕐 Waktu: ${new Date().toLocaleTimeString()}\n📍 Lokasi: ${location || 'Tidak tersedia'}\n📝 Status: ${statusText}\n\n${late ? 'Harap lebih baik lagi kedepannya!' : 'Terima kasih sudah tepat waktu!'}`;
        await sendWhatsAppMessage(userData.phoneNumber, message);
      }

      res.json({
        success: true,
        message: 'Check-in successful',
        data: checkInData,
        isLate: late
      });
    } else {
      if (!snapshot.exists() || !snapshot.val().checkIn) {
        return res.status(400).json({
          success: false,
          error: 'Must check-in first'
        });
      }

      if (snapshot.val().checkOut) {
        return res.status(400).json({
          success: false,
          error: 'Already checked out today'
        });
      }

      const checkOutData = {
        ...snapshot.val(),
        checkOut: new Date().toISOString(),
        checkOutLocation: location || null,
        checkOutNotes: notes || null,
        checkOutLatitude: latitude || null,
        checkOutLongitude: longitude || null,
        checkOutPhoto: photoUrl || null
      };

      await attendanceRef.set(checkOutData);

      if (WHATSAPP_CONFIG.sendOnCheckOut && userData?.phoneNumber) {
        const checkInTime = new Date(snapshot.val().checkIn);
        const checkOutTime = new Date();
        const duration = Math.round((checkOutTime - checkInTime) / (1000 * 60));
        
        const message = `📋 *NOTIFIKASI ABSENSI*\n\nHalo ${name},\n\nAnda telah melakukan Check-out pada:\n📅 Tanggal: ${today}\n🕐 Waktu: ${checkOutTime.toLocaleTimeString()}\n📍 Lokasi: ${location || 'Tidak tersedia'}\n⏱️ Durasi: ${duration} menit\n\nTerima kasih, hati-hati di jalan!`;
        await sendWhatsAppMessage(userData.phoneNumber, message);
      }

      res.json({
        success: true,
        message: 'Check-out successful',
        data: checkOutData
      });
    }
  } catch (error) {
    console.error('Attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get attendance history
 */
app.get('/api/attendance', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { startDate, endDate, limit = 50 } = req.query;

  try {
    const attendanceRef = db.ref('attendance');
    const snapshot = await attendanceRef.once('value');
    const attendance = [];

    snapshot.forEach((dateSnapshot) => {
      const date = dateSnapshot.key;

      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;

      dateSnapshot.forEach((userSnapshot) => {
        const data = userSnapshot.val();
        if (req.user.role === 'admin' || data.userId === userId) {
          attendance.push({
            date,
            ...data
          });
        }
      });
    });

    attendance.sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      success: true,
      attendance: attendance.slice(0, parseInt(limit)),
      total: attendance.length
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get today's attendance
 */
app.get('/api/attendance/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await db.ref(`attendance/${today}`).once('value');
    const attendance = [];

    snapshot.forEach((child) => {
      const data = child.val();
      if (req.user.role === 'admin' || data.userId === req.user.userId) {
        attendance.push(data);
      }
    });

    res.json({
      success: true,
      date: today,
      attendance
    });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * AI Summary for user (protected)
 */
app.post('/api/ai/summary', authenticateToken, async (req, res) => {
  const { startDate, endDate } = req.body;
  const { userId, name } = req.user;
  
  try {
    const attendanceSnapshot = await db.ref('attendance').once('value');
    let userAttendance = [];
    let totalPresent = 0;
    let totalLate = 0;
    
    attendanceSnapshot.forEach((dateSnapshot) => {
      const date = dateSnapshot.key;
      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;
      
      dateSnapshot.forEach((userSnapshot) => {
        const data = userSnapshot.val();
        if (data.userId === userId) {
          userAttendance.push(data);
          if (data.checkIn) {
            totalPresent++;
            if (data.isLate) totalLate++;
          }
        }
      });
    });
    
    const prompt = `Buatkan ringkasan absensi untuk karyawan bernama ${name} berdasarkan data berikut:
- Total kehadiran: ${totalPresent} hari
- Total keterlambatan: ${totalLate} hari
- Periode: ${startDate || 'awal'} sampai ${endDate || 'sekarang'}

Buatkan dalam bahasa Indonesia yang profesional dan berikan saran perbaikan jika ada keterlambatan.`;
    
    const result = await callGroqAPI([{ role: 'user', content: prompt }]);
    
    if (result.success) {
      res.json({
        success: true,
        summary: result.content,
        stats: {
          totalPresent,
          totalLate,
          totalDays: userAttendance.length
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('AI summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============ ADMIN ONLY ROUTES ============

/**
 * Get all users
 */
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.ref('users').once('value');
    const users = [];

    snapshot.forEach((child) => {
      const userData = child.val();
      delete userData.password;
      users.push(userData);
    });

    res.json({
      success: true,
      users,
      total: users.length
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Delete user
 */
app.delete('/api/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    await db.ref(`users/${userId}`).remove();
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get attendance by date
 */
app.get('/api/attendance/date/:date', authenticateToken, requireAdmin, async (req, res) => {
  const { date } = req.params;

  try {
    const snapshot = await db.ref(`attendance/${date}`).once('value');
    const attendance = [];

    snapshot.forEach((child) => {
      attendance.push(child.val());
    });

    res.json({
      success: true,
      attendance,
      date,
      total: attendance.length
    });
  } catch (error) {
    console.error('Get attendance by date error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get summary statistics
 */
app.get('/api/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.ref('users').once('value');
    const attendanceSnapshot = await db.ref('attendance').once('value');

    const totalUsers = usersSnapshot.numChildren();
    let totalAttendance = 0;
    let todayAttendance = 0;
    let lateToday = 0;
    const today = new Date().toISOString().split('T')[0];

    attendanceSnapshot.forEach((dateSnapshot) => {
      const date = dateSnapshot.key;
      const count = dateSnapshot.numChildren();
      totalAttendance += count;

      if (date === today) {
        todayAttendance = count;
        dateSnapshot.forEach((child) => {
          const data = child.val();
          if (data.isLate) lateToday++;
        });
      }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalAttendance,
        todayAttendance,
        lateToday,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Send broadcast WhatsApp message (admin only)
 */
app.post('/api/whatsapp/broadcast', authenticateToken, requireAdmin, async (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Message is required'
    });
  }
  
  try {
    const usersSnapshot = await db.ref('users').once('value');
    const users = [];
    const results = [];
    
    usersSnapshot.forEach((child) => {
      const userData = child.val();
      if (userData.phoneNumber) {
        users.push(userData);
      }
    });
    
    for (const user of users) {
      const result = await sendWhatsAppMessage(user.phoneNumber, `📢 *PENGUMUMAN*\n\n${message}\n\n- Admin`);
      results.push({
        name: user.name,
        phoneNumber: user.phoneNumber,
        success: result.success
      });
    }
    
    res.json({
      success: true,
      message: `Broadcast sent to ${results.length} users`,
      results
    });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get system logs (admin only)
 */
app.get('/api/admin/logs', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const logsRef = db.ref('system_logs');
    const snapshot = await logsRef.orderByChild('timestamp').limitToLast(100).once('value');
    const logs = [];
    
    snapshot.forEach((child) => {
      logs.push(child.val());
    });
    
    res.json({
      success: true,
      logs: logs.reverse()
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🚀 BACKEND SERVER STARTED SUCCESSFULLY                  ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                                  ║
║  Environment: ${process.env.NODE_ENV || 'development'}                              ║
╠══════════════════════════════════════════════════════════════╣
║  Services:                                                  ║
║  🔥 Firebase: ${admin.apps.length > 0 ? '✅ Connected' : '❌ Failed'}                                        ║
║  🤖 GROQ API: ${GROQ_API_KEY ? '✅ Configured' : '❌ Missing'}                                        ║
║  🤖 OpenAI API: ${OPENAI_CONFIG.apiKey ? '✅ Configured' : '❌ Missing'}                                      ║
║  📸 IMGBB: ${IMGBB_KEY ? '✅ Configured' : '❌ Missing'}                                          ║
║  💬 WhatsApp: ${WHATSAPP_CONFIG.enabled ? '✅ Enabled' : '❌ Disabled'}                                       ║
║  🗄️ Supabase: ${SUPABASE_URL ? '✅ Configured' : '❌ Missing'}                                        ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
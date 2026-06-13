// index.js - VERSION 4.1 (VERCEL OPTIMIZED - FIXED)
// Backend untuk Sistem Absensi IoT
// Semua API Key disimpan di environment variables (AMAN)
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
  'SUPABASE_SERVICE_ROLE_KEY',
  'STORAGE_BUCKET'
];

// Untuk production di Vercel, jangan exit process (tidak bisa)
const isVercel = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    const error = `❌ Missing required environment variable: ${varName}`;
    console.error(error);
    if (!isVercel) process.exit(1);
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

// GROQ API Configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// OpenAI Configuration
const OPENAI_CONFIG = {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    maxTokens: 2000,
    temperature: 0.3,
    apiUrl: 'https://api.openai.com/v1/chat/completions'
};

// IMGBB Configuration
const IMGBB_KEY = process.env.IMGBB_KEY;

// WhatsApp Configuration (Fonnte)
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

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'foto-absensi';

// Initialize Supabase client
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️ Supabase not configured, using ImgBB only');
}

// Konfigurasi Multer untuk Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
    fieldSize: 10 * 1024 * 1024
  }
});

// Firebase Admin SDK Configuration
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

// Initialize Firebase Admin
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

// CORS - allow all origins
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (hanya di development)
if (!isVercel) {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

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
      headers: formData.getHeaders(),
      timeout: 30000
    });
    
    return {
      success: true,
      url: response.data.data.url,
      thumb: response.data.data.thumb,
      delete_url: response.data.data.delete_url
    };
  } catch (error) {
    console.error('IMGBB upload error:', error.message);
    return { success: false, error: error.message };
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

/**
 * Main upload handler
 */
async function uploadImage(fileBuffer, fileName, folder = 'uploads', userId = null) {
  // Try Supabase first
  if (supabase) {
    const result = await uploadToSupabaseStorage(fileBuffer, fileName, folder, userId);
    if (result.success) {
      return { ...result, isFallback: false };
    }
    console.warn('Supabase failed, falling back to ImgBB:', result.error);
  }
  
  // Fallback to ImgBB
  const result = await uploadToImgbb(fileBuffer, fileName);
  if (result.success) {
    return { ...result, isFallback: true, storage: 'imgbb' };
  }
  
  return { success: false, error: result.error || 'All upload methods failed' };
}

/**
 * Delete file from storage
 */
async function deleteFromStorage(fileUrl) {
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

/**
 * Send WhatsApp message
 */
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
      },
      timeout: 60000
    });
    
    return { success: true, content: response.data.choices[0].message.content };
  } catch (error) {
    console.error('GROQ API error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.error?.message || error.message };
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
      },
      timeout: 60000
    });
    
    return { success: true, content: response.data.choices[0].message.content };
  } catch (error) {
    console.error('OpenAI error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
}

/**
 * Authentication Middleware
 */
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

/**
 * Admin Middleware
 */
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
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
      imgbb: !!IMGBB_KEY,
      whatsapp: WHATSAPP_CONFIG.enabled,
      supabase: !!SUPABASE_URL
    }
  });
});

// Get Firebase config
app.get('/api/firebase-config', (req, res) => {
  res.json({ success: true, config: firebaseConfig });
});

// ============ STORAGE ENDPOINTS ============

/**
 * Upload image endpoint
 */
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided. Please upload a file with field name "image".'
      });
    }
    
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.'
      });
    }
    
    const { folder = 'uploads', userId, bucket = STORAGE_BUCKET } = req.body;
    
    console.log(`📤 Upload: folder=${folder}, userId=${userId || 'none'}, file=${req.file.originalname}, size=${req.file.size} bytes`);
    
    const result = await uploadImage(req.file.buffer, req.file.originalname, folder, userId);
    
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
      res.status(500).json({ success: false, error: result.error || 'Upload failed' });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
});

/**
 * Delete file endpoint
 */
app.post('/api/storage/delete', async (req, res) => {
  try {
    const { fileUrl } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ success: false, error: 'No file URL provided' });
    }
    
    // ImgBB files cannot be deleted
    if (fileUrl.includes('imgbb.com') || fileUrl.includes('ibb.co')) {
      return res.json({ success: true, message: 'ImgBB files cannot be deleted via API' });
    }
    
    const result = await deleteFromStorage(fileUrl);
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
    
    const result = await uploadImage(
      req.file.buffer,
      `profile_${req.user.userId}_${Date.now()}.jpg`,
      'profiles',
      req.user.userId
    );
    
    if (result.success) {
      await db.ref(`users/${req.user.userId}`).update({
        profilePicture: result.url,
        profilePictureThumb: result.thumb || result.url,
        updatedAt: new Date().toISOString()
      });
      
      res.json({
        success: true,
        message: 'Profile picture uploaded successfully',
        data: { url: result.url, thumb: result.thumb || result.url }
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

// ============ ADMIN ROUTES ============

app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.ref('users').once('value');
    const users = [];
    snapshot.forEach((child) => {
      const userData = child.val();
      delete userData.password;
      users.push(userData);
    });
    res.json({ success: true, users, total: users.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await db.ref(`users/${req.params.userId}`).remove();
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.ref('users').once('value');
    const attendanceSnapshot = await db.ref('attendance').once('value');
    const totalUsers = usersSnapshot.numChildren();
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
      stats: { totalUsers, totalAttendance, todayAttendance, lateToday, lastUpdated: new Date().toISOString() }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err.stack);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ============ EXPORT FOR VERCEL ============
module.exports = app;

// Start server jika dijalankan langsung (bukan di Vercel)
if (require.main === module) {
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
║  🤖 GROQ API: ${GROQ_API_KEY ? '✅' : '❌'}                                                   ║
║  🤖 OpenAI API: ${OPENAI_CONFIG.apiKey ? '✅' : '❌'}                                                 ║
║  📸 IMGBB: ${IMGBB_KEY ? '✅' : '❌'}                                                       ║
║  💬 WhatsApp: ${WHATSAPP_CONFIG.enabled ? '✅' : '❌'}                                                ║
║  🗄️ Supabase: ${SUPABASE_URL ? '✅' : '❌'}                                                    ║
╚══════════════════════════════════════════════════════════════╝
    `);
  });
}
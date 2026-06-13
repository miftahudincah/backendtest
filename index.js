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

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_DATABASE_URL',
  'JWT_SECRET'
];

requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
});

// IMGBB Configuration
const IMGBB_KEY = "67650d8ee67ebb8bba94f3bb2c72eb4f";
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
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase initialization error:', error);
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

// Authentication Middleware
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

// Admin Middleware
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};

// Helper function to upload image to IMGBB
async function uploadToImgbb(fileBuffer, fileName) {
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

// ============ PUBLIC ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: admin.apps.length > 0 ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Upload image (public - for testing)
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }
    
    const result = await uploadToImgbb(req.file.buffer, req.file.originalname);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Image uploaded successfully',
        data: {
          url: result.url,
          thumb: result.thumb,
          delete_url: result.delete_url
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

// Register new user
app.post('/api/register', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').notEmpty().withMessage('Name is required').trim(),
  body('role').optional().isIn(['user', 'admin']).withMessage('Invalid role')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const { email, password, name, role = 'user' } = req.body;

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
      user: { userId, email, name, role }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Login user
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
        role: userData.role
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

// ============ PROTECTED ROUTES ============

// Upload profile picture
app.post('/api/upload-profile', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }
    
    // Upload to IMGBB
    const result = await uploadToImgbb(req.file.buffer, `profile_${req.user.userId}_${Date.now()}`);
    
    if (result.success) {
      // Save image URL to user profile
      const userRef = db.ref(`users/${req.user.userId}`);
      await userRef.update({
        profilePicture: result.url,
        profilePictureThumb: result.thumb,
        updatedAt: new Date().toISOString()
      });
      
      res.json({
        success: true,
        message: 'Profile picture uploaded successfully',
        data: {
          url: result.url,
          thumb: result.thumb
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

// Upload attendance photo
app.post('/api/upload-attendance', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }
    
    const result = await uploadToImgbb(req.file.buffer, `attendance_${req.user.userId}_${Date.now()}`);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Photo uploaded successfully',
        data: {
          url: result.url,
          thumb: result.thumb,
          delete_url: result.delete_url
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Upload attendance error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user profile
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

// Update user profile
app.put('/api/profile', authenticateToken, [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().withMessage('Valid email is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  const { name, email } = req.body;
  const updates = {};

  if (name) updates.name = name;
  if (email) updates.email = email;
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

// Check-in / Check-out with photo
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
        status: 'present'
      };

      await attendanceRef.set(checkInData);

      res.json({
        success: true,
        message: 'Check-in successful',
        data: checkInData
      });
    } else {
      // Check-out
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

// Get attendance history
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

// Get today's attendance
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

// ============ ADMIN ONLY ROUTES ============

// Get all users
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

// Delete user
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

// Get attendance by date
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

// Get summary statistics
app.get('/api/stats/summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.ref('users').once('value');
    const attendanceSnapshot = await db.ref('attendance').once('value');

    const totalUsers = usersSnapshot.numChildren();
    let totalAttendance = 0;
    let todayAttendance = 0;
    const today = new Date().toISOString().split('T')[0];

    attendanceSnapshot.forEach((dateSnapshot) => {
      const date = dateSnapshot.key;
      const count = dateSnapshot.numChildren();
      totalAttendance += count;

      if (date === today) {
        todayAttendance = count;
      }
    });

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalAttendance,
        todayAttendance,
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
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔥 Firebase Database: ${process.env.FIREBASE_DATABASE_URL}`);
  console.log(`📸 IMGBB API Key: ${IMGBB_KEY ? 'Configured' : 'Missing'}`);
});

module.exports = app;
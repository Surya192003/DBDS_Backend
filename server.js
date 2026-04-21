const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./config/db');
const groupRoutes = require('./routes/groups');

const uploadRoutes = require('./routes/upload');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const app = express();
// ========== CORS Configuration ==========
// Detailed CORS setup with logging
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://frontend-go1a.onrender.com',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:4200',
      'http://localhost:3000',
      'http://localhost:5010'
    ];
    
    // Allow all origins in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`🌐 CORS: Allowing origin: ${origin}`);
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`❌ CORS: Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'X-Access-Token',
    'X-Refresh-Token'
  ],
  exposedHeaders: ['X-Access-Token', 'X-Refresh-Token'],
  optionsSuccessStatus: 200,
  preflightContinue: false,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight OPTIONS requests explicitly
// app.use(cors(corsOptions));
// ========== Middleware ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Request logging middleware with enhanced details
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  console.log(`\n📥 [${timestamp}] ${method} ${url}`);
  console.log(`   IP: ${ip}`);
  console.log(`   User-Agent: ${userAgent}`);
  console.log(`   Content-Type: ${req.get('Content-Type')}`);
  console.log(`   Authorization: ${req.get('Authorization') ? 'Present' : 'Not Present'}`);
  
  // Log body for non-GET requests (excluding sensitive data)
  if (method !== 'GET' && req.body) {
    const logBody = { ...req.body };
    // Mask sensitive fields
    if (logBody.password) logBody.password = '***MASKED***';
    if (logBody.token) logBody.token = '***MASKED***';
    console.log(`   Body:`, JSON.stringify(logBody, null, 2).substring(0, 500));
  }
  
  // Store start time for response logging
  req.startTime = Date.now();
  
  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - req.startTime;
    console.log(`📤 Response (${duration}ms):`, JSON.stringify(data, null, 2).substring(0, 500));
    return originalJson.call(this, data);
  };
  
  next();
});

// ========== Health Check Endpoints ==========
app.get('/', (req, res) => {
  res.json({ 
    message: 'Dance Management API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'PostgreSQL',
    status: 'operational'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    // Check database connection
    const dbHealth = await db.ping();
    
    // Check server resources
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    const healthData = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      database: {
        status: dbHealth ? 'CONNECTED' : 'DISCONNECTED',
        type: 'PostgreSQL'
      },
      server: {
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
          heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
          heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
          external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
        },
        nodeVersion: process.version,
        platform: process.platform
      },
      endpoints: {
        auth: '/api/auth',
        users: '/api/users',
        classes: '/api/classes',
        attendance: '/api/attendance',
        payments: '/api/payments',
        reports: '/api/reports',
        groups: '/api/groups',
        upload: '/api/upload'
      }
    };
    
    res.status(200).json(healthData);
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(500).json({
      status: 'DOWN',
      timestamp: new Date().toISOString(),
      error: error.message,
      database: 'PostgreSQL',
      serverStatus: 'ERROR'
    });
  }
});

app.get('/api/db-health', async (req, res) => {
  try {
    // Perform a more thorough database check
    const startTime = Date.now();
    const result = await db.query(`
      SELECT 
        NOW() as timestamp,
        version() as version,
        (SELECT COUNT(*) FROM users) as user_count,
        (SELECT COUNT(*) FROM students) as student_count,
        (SELECT COUNT(*) FROM instructors) as instructor_count,
        (SELECT COUNT(*) FROM classes) as class_count
    `);
    
    const duration = Date.now() - startTime;
    
    res.json({
      status: 'UP',
      message: 'PostgreSQL database is operational',
      timestamp: result.rows[0].timestamp,
      responseTime: `${duration}ms`,
      databaseInfo: {
        version: result.rows[0].version.split(' ')[1],
        statistics: {
          users: parseInt(result.rows[0].user_count),
          students: parseInt(result.rows[0].student_count),
          instructors: parseInt(result.rows[0].instructor_count),
          classes: parseInt(result.rows[0].class_count)
        }
      }
    });
  } catch (err) {
    console.error('❌ Database health check failed:', err);
    res.status(503).json({
      status: 'DOWN',
      message: 'PostgreSQL database connection failed',
      error: err.message,
      timestamp: new Date().toISOString(),
      suggestion: 'Check DATABASE_URL in .env file and ensure database is running'
    });
  }
});

// ========== Import Routes ==========
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');
const attendanceRoutes = require('./routes/attendance');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');

// ========== Use Routes ==========
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/groups', groupRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/upload', uploadRoutes);

// ========== Static File Serving ==========
app.use('/public', express.static(path.join(__dirname, 'public')));

// ✅ Catch-all 404 handler
app.all(/.*/, (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    method: req.method,
    timestamp: new Date().toISOString(),
    suggestedEndpoints: [
      '/api/auth/login',
      '/api/register',
      '/api/users',
      '/api/classes',
      '/api/health'
    ]
  });
});


// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('❌ ========== UNHANDLED ERROR ==========');
  console.error('Error Timestamp:', new Date().toISOString());
  console.error('Error Message:', err.message);
  console.error('Error Stack:', err.stack);
  console.error('Request Method:', req.method);
  console.error('Request URL:', req.url);
  console.error('Request Body:', req.body);
  console.error('Request Headers:', req.headers);
  console.error('========== END ERROR ==========\n');
  
  // Determine status code
  const statusCode = err.status || err.statusCode || 500;
  
  // Prepare error response
  const errorResponse = {
    success: false,
    message: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
    path: req.url,
    method: req.method
  };
  
  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
    errorResponse.details = err;
  }
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    errorResponse.message = 'Validation Error';
    errorResponse.errors = err.errors;
    return res.status(400).json(errorResponse);
  }
  
  if (err.name === 'JsonWebTokenError') {
    errorResponse.message = 'Invalid Token';
    return res.status(401).json(errorResponse);
  }
  
  if (err.name === 'TokenExpiredError') {
    errorResponse.message = 'Token Expired';
    return res.status(401).json(errorResponse);
  }
  
  // Database errors
  if (err.code && err.code.startsWith('23')) {
    errorResponse.message = 'Database Error';
    errorResponse.databaseErrorCode = err.code;
    
    // Handle specific PostgreSQL errors
    switch(err.code) {
      case '23505': // unique_violation
        errorResponse.message = 'Duplicate entry detected';
        break;
      case '23503': // foreign_key_violation
        errorResponse.message = 'Referenced record does not exist';
        break;
      case '23502': // not_null_violation
        errorResponse.message = 'Required field is missing';
        break;
    }
    
    return res.status(400).json(errorResponse);
  }
  
  res.status(statusCode).json(errorResponse);
});

// ========== Server Startup ==========
const PORT = process.env.PORT || 5010;

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🌐 CORS enabled for ALL origins (*)`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 API Root: http://localhost:${PORT}/`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(50) + '\n');
});

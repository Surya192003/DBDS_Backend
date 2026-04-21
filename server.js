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

// ========== Error Handling Middleware ==========
// 404 Handler
app.use((req, res, next) => {
  console.log(`❌ 404: Route not found: ${req.method} ${req.originalUrl}`);
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

// Global Error Handler
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

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log('\n' + '='.repeat(70));
  console.log(`🚀 Dance Management API Server`);
  console.log('='.repeat(70));
  console.log(`📡 Server URL: http://localhost:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Database: PostgreSQL (Render.com)`);
  console.log(`📁 Uploads: ${uploadsDir}`);
  console.log(`⏰ Started: ${new Date().toISOString()}`);
  console.log('='.repeat(70));
  console.log('\n📋 Available Endpoints:');
  console.log(`   👤 Auth:     http://localhost:${PORT}/api/auth`);
  console.log(`   👥 Users:    http://localhost:${PORT}/api/users`);
  console.log(`   🏫 Classes:  http://localhost:${PORT}/api/classes`);
  console.log(`   📝 Attendance: http://localhost:${PORT}/api/attendance`);
  console.log(`   💰 Payments: http://localhost:${PORT}/api/payments`);
  console.log(`   📈 Reports:  http://localhost:${PORT}/api/reports`);
  console.log(`   👥 Groups:   http://localhost:${PORT}/api/groups`);
  console.log(`   📤 Upload:   http://localhost:${PORT}/api/upload`);
  console.log(`   🩺 Health:   http://localhost:${PORT}/api/health`);
  console.log(`   🗄️  DB Health: http://localhost:${PORT}/api/db-health`);
  console.log('\n🔧 Debug Information:');
  console.log(`   PID: ${process.pid}`);
  console.log(`   Node: ${process.version}`);
  console.log(`   Platform: ${process.platform}/${process.arch}`);
  console.log('='.repeat(70) + '\n');
  
  // Perform initial database health check
  try {
    const dbHealth = await db.ping();
    if (dbHealth) {
      console.log('✅ Database connection verified');
    } else {
      console.log('⚠️  Database connection issue detected');
    }
  } catch (error) {
    console.error('❌ Initial database check failed:', error.message);
  }
});

// ========== Graceful Shutdown ==========
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
  console.log(`\n${signal} received, starting graceful shutdown...`);
  
  server.close(async () => {
    console.log('🔒 HTTP server closed');
    
    try {
      await db.close();
      console.log('🔌 Database connections closed');
    } catch (error) {
      console.error('❌ Error closing database connections:', error);
    }
    
    console.log('👋 Graceful shutdown complete');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit immediately, let the error handler deal with it
});

const bcrypt = require('bcryptjs');

bcrypt.hash('12345678', 10).then(console.log);

module.exports = app; // For testing purposes
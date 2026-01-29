const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connection = require('./config/db');
const groupRoutes = require('./routes/groups');
const uploadRoutes = require('./routes/upload');
const path = require('path');
dotenv.config();

const app = express();
// app.use(cors());
// ✅ CORS Configuration - MOST PERMISSIVE (for development)
// app.use(cors({
//   origin: "", // Allow ALL origins during development
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
//   credentials: true,
//   preflightContinue: false,
//   optionsSuccessStatus: 204
// }));
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4200', '*'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// ✅ Handle preflight OPTIONS requests for ALL routes
app.options('/{*any}', cors());

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  next();
});

// ✅ Test routes (should be BEFORE other routes)
app.get('/', (req, res) => {
  res.json({ 
    message: 'Dance Management API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    cors: 'Enabled for all origins'
  });
});

// ✅ Database connection
connection.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    return;
  }
  console.log('✅ Connected to MySQL database');
});

// ✅ Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const classRoutes = require('./routes/classes');
const attendanceRoutes = require('./routes/attendance');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');


// ✅ Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/groups', groupRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/upload', uploadRoutes);

// Source - https://stackoverflow.com/a
// Posted by Donggi Kim, modified by community. See post 'Timeline' for change history
// Retrieved 2026-01-25, License - CC BY-SA 4.0

// app.all('/{*any}', (req, res, next) => {})

// ✅ Catch-all 404 handler
app.all('/{*any}', (req, res) => { 
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    method: req.method
  });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error Stack:', err.stack);
  console.error('❌ Server Error Details:', err);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

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
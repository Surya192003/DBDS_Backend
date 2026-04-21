const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// ========== Helper Functions ==========
const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const validatePassword = (password) => {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/;
  return re.test(password);
};

// Add this helper function at the top of your auth routes file
function validateRegistration(data) {
  const errors = [];
  
  if (!data.name || data.name.trim().length < 2) {
    errors.push('Name must be at least 2 characters long');
  }
  
  if (!data.email || !data.email.includes('@')) {
    errors.push('Valid email address is required');
  }
  
  if (!data.password || data.password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }
  
  if (data.role && !['STUDENT', 'INSTRUCTOR', 'ADMIN'].includes(data.role)) {
    errors.push('Invalid role selected');
  }
  
  return errors;
}

// // ========== OPTIONS Handler ==========
// router.options('*', (req, res) => {
//   res.header('Access-Control-Allow-Origin', '*');
//   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   res.sendStatus(200);
// });

// router.options('/login', (req, res) => {
//   res.header('Access-Control-Allow-Origin', '*');
//   res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   res.sendStatus(200);
// });

// router.options('/register', (req, res) => {
//   res.header('Access-Control-Allow-Origin', '*');
//   res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   res.sendStatus(200);
// });

// ========== LOGIN ==========
router.post('/login', async (req, res) => {
  try {
    console.log('📥 Login request received');
    console.log('Request IP:', req.ip);
    console.log('Request Headers:', req.headers);
    
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      console.log('❌ Login failed: Missing email or password');
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    if (!validateEmail(email)) {
      console.log(`❌ Login failed: Invalid email format - ${email}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    console.log(`🔍 Looking up user: ${email}`);
    
    // Find user with role-specific details
    const userQuery = `
      SELECT 
        u.*,
        COALESCE(s.id, 0) as student_id,
        COALESCE(i.id, 0) as instructor_id,
        COALESCE(i.pay_per_class, 0) as pay_per_class,
        COALESCE(s.attended_classes, 0) as attended_classes,
        COALESCE(s.total_classes, 0) as total_classes
      FROM users u
      LEFT JOIN students s ON u.id = s.user_id
      LEFT JOIN instructors i ON u.id = i.user_id
      WHERE u.email = $1
    `;
    
    const userResult = await db.query(userQuery, [email]);
    
    if (userResult.rows.length === 0) {
      console.log(`❌ Login failed: User not found - ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    const user = userResult.rows[0];
    console.log(`✅ User found: ${user.email}, Role: ${user.role}, Active: ${user.is_active}`);
    
    // Check if user is active
    if (!user.is_active) {
      console.log(`⛔ Login blocked: Account inactive - ${email}`);
      return res.status(403).json({
        success: false,
        message: 'Account is pending admin approval. Please contact administrator.',
        accountStatus: 'pending'
      });
    }
    
    // Verify password
    console.log('🔐 Verifying password...');
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      console.log(`❌ Login failed: Invalid password for ${email}`);
      
      // Log failed attempt (in production, you might want to track this)
      await db.query(
        'UPDATE users SET last_failed_login = NOW() WHERE email = $1',
        [email]
      );
      
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Update last login
    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );
    
    // Create JWT token
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      student_id: user.student_id || null,
      instructor_id: user.instructor_id || null
    };
    
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'dev-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );
    
    // Prepare user response (excluding password)
    const userResponse = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      created_at: user.created_at,
      last_login: user.last_login,
      profile_complete: user.profile_complete || false
    };
    
    // Add role-specific data
    if (user.role === 'STUDENT') {
      userResponse.student_data = {
        student_id: user.student_id,
        attended_classes: user.attended_classes,
        total_classes: user.total_classes,
        attendance_rate: user.total_classes > 0 
          ? Math.round((user.attended_classes / user.total_classes) * 100) 
          : 0
      };
    } else if (user.role === 'INSTRUCTOR') {
      userResponse.instructor_data = {
        instructor_id: user.instructor_id,
        pay_per_class: user.pay_per_class
      };
    }
    
    console.log(`✅ Login successful: ${email} (${user.role})`);
    console.log(`📊 Token generated, expires in: ${process.env.JWT_EXPIRE || '24h'}`);
    
    // Set token in HTTP-only cookie (optional)
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    // Send response
    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      user: userResponse,
      expires_in: process.env.JWT_EXPIRE || '24h',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    console.error('Error stack:', error.stack);
    
    // Handle specific database errors
    if (error.code && error.code.startsWith('23')) {
      return res.status(500).json({
        success: false,
        message: 'Database error during login',
        error_code: error.code
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== REGISTER ==========
router.post('/register', async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('📥 Registration request received');
    console.log('Request Body:', { 
      ...req.body, 
      password: req.body.password ? '***MASKED***' : 'MISSING' 
    });
    
    const { name, email, password, role, phone, address } = req.body;
    const userRole = role ? role.toUpperCase() : 'STUDENT';
    
    // Validation
    const validationErrors = validateRegistration({ name, email, password, role: userRole });
    
    if (validationErrors.length > 0) {
      console.log('❌ Registration validation failed:', validationErrors);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    // Check if email already exists
    console.log(`🔍 Checking if email exists: ${email}`);
    const emailCheck = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    
    if (emailCheck.rows.length > 0) {
      console.log(`❌ Registration failed: Email already exists - ${email}`);
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
        suggestion: 'Try logging in or use a different email'
      });
    }
    
    // Hash password
    console.log('🔐 Hashing password...');
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Start transaction using the transaction method
    console.log('💾 Starting database transaction...');
    
    const result = await db.transaction(async (client) => {
      // Insert user
      const userInsertQuery = `
        INSERT INTO users (
          name, 
          email, 
          password, 
          role, 
          phone, 
          address, 
          is_active,
          profile_complete
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, email, role, is_active, created_at
      `;
      
      // For students and instructors, is_active is false by default (needs admin approval)
      // For ADMIN (if allowed), set to true immediately
      const isActiveImmediately = userRole === 'ADMIN' ? true : false;
      
      const userValues = [
        name.trim(),
        email.toLowerCase().trim(),
        hashedPassword,
        userRole,
        phone || null,
        address || null,
        isActiveImmediately,
        false // Profile not complete initially
      ];
      
      console.log('📝 Inserting user record...');
      const userResult = await client.query(userInsertQuery, userValues);
      const newUser = userResult.rows[0];
      
      console.log(`✅ User record created - ID: ${newUser.id}, Role: ${newUser.role}`);
      
      // Create role-specific record
      if (userRole === 'INSTRUCTOR') {
        console.log('👨‍🏫 Creating instructor record...');
        const instructorQuery = `
          INSERT INTO instructors (
            user_id, 
            pay_per_class, 
            total_classes_taught, 
            rating
          ) VALUES ($1, $2, $3, $4)
          RETURNING id
        `;
        
        const instructorValues = [
          newUser.id,
          30.00, // Default pay rate
          0,     // Starting classes taught
          0.0    // Starting rating
        ];
        
        const instructorResult = await client.query(instructorQuery, instructorValues);
        console.log(`✅ Instructor record created - ID: ${instructorResult.rows[0].id}`);
        
      } else if (userRole === 'STUDENT') {
        console.log('👨‍🎓 Creating student record...');
        const studentQuery = `
          INSERT INTO students (
            user_id, 
            attended_classes, 
            total_classes, 
            membership_status
          ) VALUES ($1, $2, $3, $4)
          RETURNING id
        `;
        
        const studentValues = [
          newUser.id,
          0,                 // Starting attended classes
          0,                 // Starting total classes
          'active'           // Default membership status
        ];
        
        const studentResult = await client.query(studentQuery, studentValues);
        console.log(`✅ Student record created - ID: ${studentResult.rows[0].id}`);
      }
      
      // If ADMIN role, no additional table needed
      if (userRole === 'ADMIN') {
        console.log('👑 Admin user created');
      }
      
      return {
        user: newUser,
        message: isActiveImmediately 
          ? 'Registration successful. You can login immediately.' 
          : 'Registration successful. Your account is pending admin approval.'
      };
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Registration completed in ${duration}ms`);
    console.log(`📧 User registered: ${email} (${userRole})`);
    
    // Prepare response
    const responseData = {
      success: true,
      message: result.message,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        is_active: result.user.is_active,
        created_at: result.user.created_at,
        requires_approval: !result.user.is_active
      },
      timestamp: new Date().toISOString(),
      processing_time: `${duration}ms`
    };
    
    res.status(201).json(responseData);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('❌ Registration error:', error);
    console.error('Error stack:', error.stack);
    
    // Handle specific PostgreSQL errors
    let errorMessage = 'Registration failed';
    let statusCode = 500;
    
    if (error.code === '23505') { // Unique violation
      errorMessage = 'Email already registered';
      statusCode = 409;
    } else if (error.code === '23502') { // Not null violation
      errorMessage = 'Required fields are missing';
      statusCode = 400;
    } else if (error.code === '23503') { // Foreign key violation
      errorMessage = 'Database consistency error';
      statusCode = 500;
    } else if (error.code === '23514') { // Check violation
      errorMessage = 'Data validation failed';
      statusCode = 400;
    } else if (error.message && error.message.includes('transaction')) {
      errorMessage = 'Database transaction error';
      statusCode = 500;
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      error_code: error.code,
      timestamp: new Date().toISOString(),
      processing_time: `${duration}ms`
    });
  }
});

// ========== LOGOUT ==========
router.post('/logout', async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      
      // In a production system, you might want to:
      // 1. Add token to a blacklist (if using token blacklisting)
      // 2. Update user's last_logout timestamp
      // 3. Clear any session data
      
      console.log(`👋 User logged out via token`);
    }
    
    // Clear the auth cookie if it exists
    res.clearCookie('auth_token');
    
    res.json({
      success: true,
      message: 'Logout successful',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ========== VERIFY TOKEN ==========
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    
    // Check if user still exists and is active
    const userResult = await db.query(
      'SELECT id, email, role, name, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }
    
    const user = userResult.rows[0];
    
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    res.json({
      success: true,
      message: 'Token is valid',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        is_active: user.is_active
      },
      token_valid: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        token_valid: false
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        token_valid: false,
        expired: true
      });
    }
    
    console.error('❌ Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Token verification failed',
      token_valid: false
    });
  }
});

// ========== REFRESH TOKEN ==========
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }
    
    // Verify refresh token (in a real app, you'd have a separate refresh token system)
    // For simplicity, we're using the same JWT secret
    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET || 'dev-secret-key');
    
    // Check if user exists and is active
    const userResult = await db.query(
      'SELECT id, email, role, name, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }
    
    const user = userResult.rows[0];
    
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    // Create new access token
    const newToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      },
      process.env.JWT_SECRET || 'dev-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );
    
    res.json({
      success: true,
      message: 'Token refreshed',
      token: newToken,
      expires_in: process.env.JWT_EXPIRE || '24h',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Refresh token expired'
      });
    }
    
    console.error('❌ Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
});

// ========== FORGOT PASSWORD ==========
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Valid email is required'
      });
    }
    
    // Check if user exists
    const userResult = await db.query(
      'SELECT id, name, email FROM users WHERE email = $1 AND is_active = true',
      [email]
    );
    
    if (userResult.rows.length === 0) {
      // For security, don't reveal if email exists or not
      console.log(`Password reset requested for non-existent/inactive email: ${email}`);
      return res.json({
        success: true,
        message: 'If your email is registered, you will receive a password reset link'
      });
    }
    
    const user = userResult.rows[0];
    
    // Generate reset token (expires in 1 hour)
    const resetToken = jwt.sign(
      { id: user.id, email: user.email, type: 'password_reset' },
      process.env.JWT_SECRET || 'dev-secret-key',
      { expiresIn: '1h' }
    );
    
    // In production, you would:
    // 1. Save reset token to database with expiration
    // 2. Send email with reset link
    // 3. Log the reset request
    
    console.log(`🔐 Password reset token generated for: ${email}`);
    console.log(`Reset token: ${resetToken.substring(0, 20)}...`);
    
    // For development, return the token
    if (process.env.NODE_ENV === 'development') {
      return res.json({
        success: true,
        message: 'Password reset link would be sent via email in production',
        development: {
          reset_token: resetToken,
          reset_link: `http://localhost:5173/reset-password?token=${resetToken}`
        },
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    }
    
    // In production, just acknowledge the request
    res.json({
      success: true,
      message: 'If your email is registered, you will receive a password reset link shortly'
    });
    
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset request failed'
    });
  }
});

// ========== RESET PASSWORD ==========
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password, confirm_password } = req.body;
    
    if (!token || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Token, new password, and confirmation are required'
      });
    }
    
    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }
    
    if (!validatePassword(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters with uppercase, lowercase, and number'
      });
    }
    
    // Verify reset token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }
    
    // Check token type
    if (decoded.type !== 'password_reset') {
      return res.status(401).json({
        success: false,
        message: 'Invalid reset token'
      });
    }
    
    // Check if user exists and is active
    const userResult = await db.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found or account is inactive'
      });
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);
    
    // Update password
    await db.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, decoded.id]
    );
    
    console.log(`✅ Password reset successful for user ID: ${decoded.id}`);
    
    // In production, you might want to:
    // 1. Invalidate all existing sessions
    // 2. Send confirmation email
    // 3. Log the password change
    
    res.json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed'
    });
  }
});

// ========== CHANGE PASSWORD (Authenticated) ==========
router.post('/change-password', async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token and get user
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    
    // Validation
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'All password fields are required'
      });
    }
    
    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: 'New passwords do not match'
      });
    }
    
    if (!validatePassword(new_password)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters with uppercase, lowercase, and number'
      });
    }
    
    // Get user with current password
    const userResult = await db.query(
      'SELECT id, password FROM users WHERE id = $1',
      [decoded.id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = userResult.rows[0];
    
    // Verify current password
    const validCurrentPassword = await bcrypt.compare(current_password, user.password);
    
    if (!validCurrentPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }
    
    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);
    
    // Update password
    await db.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.id]
    );
    
    console.log(`✅ Password changed for user ID: ${user.id}`);
    
    res.json({
      success: true,
      message: 'Password changed successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('❌ Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password change failed'
    });
  }
});

// ========== GET USER PROFILE (Authenticated) ==========
router.get('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    
    // Get user with role-specific details
    const profileQuery = `
      SELECT 
        u.*,
        COALESCE(s.id, 0) as student_id,
        COALESCE(i.id, 0) as instructor_id,
        COALESCE(i.pay_per_class, 0) as pay_per_class,
        COALESCE(s.attended_classes, 0) as attended_classes,
        COALESCE(s.total_classes, 0) as total_classes,
        COALESCE(s.membership_status, 'active') as membership_status,
        COALESCE(i.total_classes_taught, 0) as total_classes_taught,
        COALESCE(i.rating, 0) as rating,
        COALESCE(i.bio, '') as bio
      FROM users u
      LEFT JOIN students s ON u.id = s.user_id
      LEFT JOIN instructors i ON u.id = i.user_id
      WHERE u.id = $1
    `;
    
    const profileResult = await db.query(profileQuery, [decoded.id]);
    
    if (profileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const user = profileResult.rows[0];
    
    // Prepare response (exclude sensitive data)
    const userProfile = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      address: user.address,
      is_active: user.is_active,
      profile_complete: user.profile_complete,
      created_at: user.created_at,
      last_login: user.last_login,
      updated_at: user.updated_at
    };
    
    // Add role-specific data
    if (user.role === 'STUDENT') {
      userProfile.student_data = {
        student_id: user.student_id,
        attended_classes: user.attended_classes,
        total_classes: user.total_classes,
        attendance_rate: user.total_classes > 0 
          ? Math.round((user.attended_classes / user.total_classes) * 100) 
          : 0,
        membership_status: user.membership_status
      };
    } else if (user.role === 'INSTRUCTOR') {
      userProfile.instructor_data = {
        instructor_id: user.instructor_id,
        pay_per_class: user.pay_per_class,
        total_classes_taught: user.total_classes_taught,
        rating: user.rating,
        bio: user.bio
      };
    }
    
    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      profile: userProfile,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('❌ Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile'
    });
  }
});

// ========== UPDATE USER PROFILE (Authenticated) ==========
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    
    const { name, phone, address, bio } = req.body;
    
    // Validation
    if (name && name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters long'
      });
    }
    
    // Start transaction
    await db.transaction(async (client) => {
      // Update user basic info
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;
      
      if (name) {
        updateFields.push(`name = $${paramCount++}`);
        updateValues.push(name.trim());
      }
      
      if (phone !== undefined) {
        updateFields.push(`phone = $${paramCount++}`);
        updateValues.push(phone || null);
      }
      
      if (address !== undefined) {
        updateFields.push(`address = $${paramCount++}`);
        updateValues.push(address || null);
      }
      
      // Mark profile as complete if all required fields are provided
      if (name && (phone !== undefined) && (address !== undefined)) {
        updateFields.push(`profile_complete = $${paramCount++}`);
        updateValues.push(true);
      }
      
      // Always update the updated_at timestamp
      updateFields.push(`updated_at = NOW()`);
      
      if (updateFields.length > 0) {
        updateValues.push(decoded.id);
        
        const updateQuery = `
          UPDATE users 
          SET ${updateFields.join(', ')}
          WHERE id = $${paramCount}
          RETURNING id, name, email, phone, address, profile_complete
        `;
        
        await client.query(updateQuery, updateValues);
      }
      
      // Update instructor bio if provided
      if (bio !== undefined && decoded.role === 'INSTRUCTOR') {
        await client.query(
          'UPDATE instructors SET bio = $1 WHERE user_id = $2',
          [bio || '', decoded.id]
        );
      }
    });
    
    // Get updated profile
    const profileQuery = `
      SELECT 
        u.*,
        COALESCE(i.bio, '') as bio
      FROM users u
      LEFT JOIN instructors i ON u.id = i.user_id
      WHERE u.id = $1
    `;
    
    const profileResult = await db.query(profileQuery, [decoded.id]);
    const updatedUser = profileResult.rows[0];
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        address: updatedUser.address,
        profile_complete: updatedUser.profile_complete,
        bio: updatedUser.bio || null
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('❌ Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// ========== GET STATISTICS (Admin only) ==========
router.get('/statistics', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    
    // Check if user is ADMIN
    if (decoded.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }
    
    // Get statistics
    const statsQuery = `
      SELECT 
        -- User counts
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'STUDENT') as total_students,
        (SELECT COUNT(*) FROM users WHERE role = 'INSTRUCTOR') as total_instructors,
        (SELECT COUNT(*) FROM users WHERE role = 'ADMIN') as total_admins,
        (SELECT COUNT(*) FROM users WHERE is_active = true) as active_users,
        (SELECT COUNT(*) FROM users WHERE is_active = false) as pending_users,
        
        -- Class counts
        (SELECT COUNT(*) FROM classes) as total_classes,
        (SELECT COUNT(*) FROM classes WHERE class_date >= CURRENT_DATE) as upcoming_classes,
        (SELECT COUNT(*) FROM classes WHERE class_date < CURRENT_DATE) as past_classes,
        
        -- Attendance statistics
        (SELECT COUNT(*) FROM attendance) as total_attendance_records,
        (SELECT COUNT(*) FROM attendance WHERE is_present = true) as present_count,
        (SELECT COUNT(*) FROM attendance WHERE is_present = false) as absent_count,
        
        -- Payment statistics
        (SELECT COUNT(*) FROM payments) as total_payments,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'completed') as total_revenue,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'pending') as pending_revenue,
        
        -- Latest registration
        (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') as new_users_7days,
        (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '30 days') as new_users_30days
    `;
    
    const statsResult = await db.query(statsQuery);
    const statistics = statsResult.rows[0];
    
    // Calculate percentages
    const attendanceRate = statistics.total_attendance_records > 0 
      ? Math.round((statistics.present_count / statistics.total_attendance_records) * 100)
      : 0;
    
    const completionRate = statistics.total_payments > 0
      ? Math.round(((statistics.total_revenue) / (statistics.total_revenue + statistics.pending_revenue)) * 100)
      : 0;
    
    const activeRate = statistics.total_users > 0
      ? Math.round((statistics.active_users / statistics.total_users) * 100)
      : 0;
    
    res.json({
      success: true,
      message: 'Statistics retrieved successfully',
      statistics: {
        users: {
          total: parseInt(statistics.total_users),
          students: parseInt(statistics.total_students),
          instructors: parseInt(statistics.total_instructors),
          admins: parseInt(statistics.total_admins),
          active: parseInt(statistics.active_users),
          pending: parseInt(statistics.pending_users),
          active_rate: activeRate,
          growth_7d: parseInt(statistics.new_users_7days),
          growth_30d: parseInt(statistics.new_users_30days)
        },
        classes: {
          total: parseInt(statistics.total_classes),
          upcoming: parseInt(statistics.upcoming_classes),
          past: parseInt(statistics.past_classes)
        },
        attendance: {
          total_records: parseInt(statistics.total_attendance_records),
          present: parseInt(statistics.present_count),
          absent: parseInt(statistics.absent_count),
          attendance_rate: attendanceRate
        },
        payments: {
          total: parseInt(statistics.total_payments),
          revenue: parseFloat(statistics.total_revenue),
          pending: parseFloat(statistics.pending_revenue),
          completion_rate: completionRate
        },
        system: {
          database: 'PostgreSQL',
          timestamp: new Date().toISOString(),
          generated_at: new Date().toLocaleString()
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('❌ Get statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve statistics'
    });
  }
});

// ========== CHECK EMAIL AVAILABILITY ==========
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Valid email is required'
      });
    }
    
    const emailCheck = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    
    res.json({
      success: true,
      available: emailCheck.rows.length === 0,
      message: emailCheck.rows.length === 0 
        ? 'Email is available' 
        : 'Email already registered',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Check email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check email availability'
    });
  }
});

module.exports = router;
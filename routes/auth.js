const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const connection = require('../config/db');

// ✅ Handle OPTIONS preflight for all routes in this router
router.options('/{*any}', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// ✅ LOGIN - Simple working version
router.post('/login', async (req, res) => {
  try {
    console.log('📥 Login request body:', req.body);
    
    const { email, password } = req.body;
    
    // Basic validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find user
    connection.query(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, results) => {
        if (err) {
          console.error('❌ Database error:', err);
          return res.status(500).json({
            success: false,
            message: 'Database error'
          });
        }
        
        if (results.length === 0) {
          return res.status(401).json({
            success: false,
            message: 'Invalid email or password'
          });
        }
        
        const user = results[0];
        
        // Check if active
        if (!user.is_active) {
          return res.status(403).json({
            success: false,
            message: 'Account is pending admin approval'
          });
        }
        
        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          return res.status(401).json({
            success: false,
            message: 'Invalid email or password'
          });
        }
        
        // Create token
        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name
          },
          process.env.JWT_SECRET || 'dev-secret-key',
          { expiresIn: '24h' }
        );
        
        // Send response
        res.json({
          success: true,
          message: 'Login successful',
          token: token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            is_active: user.is_active
          }
        });
        
        console.log('✅ Login successful for:', email);
      }
    );
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// ✅ REGISTER
router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  
  console.log('Registration attempt:', { name, email, role });
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Start a transaction
    connection.beginTransaction(async (err) => {
      if (err) {
        console.error('Transaction error:', err);
        return res.status(500).json({ message: 'Transaction error' });
      }
      
      try {
        // Insert user
        connection.query(
          'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
          [name, email, hashedPassword, role],
          async (err, result) => {
            if (err) {
              return connection.rollback(() => {
                console.error('Registration error:', err);
                if (err.code === 'ER_DUP_ENTRY') {
                  return res.status(400).json({ message: 'Email already exists' });
                }
                return res.status(400).json({ message: 'Registration failed', error: err.message });
              });
            }
            
            const userId = result.insertId;
            
            // Create role-specific record
            if (role === 'INSTRUCTOR') {
              connection.query(
                'INSERT INTO instructors (user_id, pay_per_class) VALUES (?, ?)',
                [userId, 50.00], // Default pay rate
                (err) => {
                  if (err) {
                    return connection.rollback(() => {
                      console.error('Error creating instructor record:', err);
                      return res.status(500).json({ message: 'Error creating instructor profile' });
                    });
                  }
                  
                  // Commit transaction
                  connection.commit((err) => {
                    if (err) {
                      return connection.rollback(() => {
                        console.error('Commit error:', err);
                        return res.status(500).json({ message: 'Commit error' });
                      });
                    }
                    
                    console.log('Instructor registration successful for:', email);
                    res.status(201).json({ 
                      message: 'Registration successful. Awaiting admin approval.' 
                    });
                  });
                }
              );
            } else if (role === 'STUDENT') {
  connection.query(
    'INSERT INTO students (user_id) VALUES (?)',
    [userId],
    (err) => {
      if (err) {
        return connection.rollback(() => {
          console.error('Error creating student record:', err);
          return res.status(500).json({ message: 'Error creating student profile' });
        });
      }
      
      connection.commit((err) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Commit error:', err);
            return res.status(500).json({ message: 'Commit error' });
          });
        }
        
        console.log('Student registration successful for:', email);
        res.status(201).json({ 
          message: 'Registration successful. Awaiting admin approval.' 
        });
      });
    }
  );
} else {
              // For ADMIN or other roles
              connection.commit((err) => {
                if (err) {
                  return connection.rollback(() => {
                    console.error('Commit error:', err);
                    return res.status(500).json({ message: 'Commit error' });
                  });
                }
                
                console.log('Registration successful for:', email);
                res.status(201).json({ 
                  message: 'Registration successful.' 
                });
              });
            }
          }
        );
      } catch (error) {
        connection.rollback(() => {
          console.error('Registration error:', error);
          res.status(500).json({ message: 'Server error' });
        });
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
module.exports = router;
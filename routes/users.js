const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db'); // ← Use PostgreSQL db, not connection

// Get all users (Admin only)
router.get('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        u.*, 
        i.id as instructor_id, 
        i.pay_per_class,
        s.id as student_id
      FROM users u
      LEFT JOIN instructors i ON u.id = i.user_id
      LEFT JOIN students s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `;
    
    const result = await db.query(query);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json([]);
  }
});

// Toggle user active status
router.put('/:id/toggle-active', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const userId = req.params.id;
  
  try {
    const result = await db.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ 
      message: 'User status updated',
      is_active: result.rows[0].is_active
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

// Update instructor pay rate
router.put('/instructor/:id/pay-rate', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { pay_per_class } = req.body;
  const instructorId = req.params.id;
  
  try {
    const result = await db.query(
      'UPDATE instructors SET pay_per_class = $1 WHERE id = $2 RETURNING id, pay_per_class',
      [pay_per_class, instructorId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Instructor not found' });
    }
    
    res.json({ 
      message: 'Pay rate updated',
      pay_per_class: result.rows[0].pay_per_class
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

// Delete user
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const userId = req.params.id;
  const currentAdminId = req.user.id;

  // Prevent admin from deleting themselves
  if (parseInt(userId) === currentAdminId) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  try {
    // Get user info before deletion for logging
    const userResult = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Delete user (cascade will delete instructor/student records)
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    console.log(`User deleted: ${user.name} (${user.email})`);
    res.json({ 
      message: 'User deleted successfully',
      deletedUser: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

// Update user profile (single, correct version)
router.put('/profile', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { name, email, phone, address } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required' });
  }
  
  try {
    // Check email uniqueness excluding current user
    const emailCheck = await db.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Email already in use' });
    }
    
    // Update user
    await db.query(
      `UPDATE users 
       SET name = $1, email = $2, phone = $3, address = $4 
       WHERE id = $5`,
      [name, email, phone || null, address || null, userId]
    );
    
    // Fetch updated user (including role, photo_url, etc.)
    const result = await db.query(
      `SELECT id, name, email, role, phone, address, photo_url, is_active 
       FROM users WHERE id = $1`,
      [userId]
    );
    const updatedUser = result.rows[0];
    
    // Also fetch student_id or instructor_id if needed (for frontend consistency)
    let studentId = null, instructorId = null;
    if (updatedUser.role === 'STUDENT') {
      const s = await db.query('SELECT id FROM students WHERE user_id = $1', [userId]);
      if (s.rows.length) studentId = s.rows[0].id;
    } else if (updatedUser.role === 'INSTRUCTOR') {
      const i = await db.query('SELECT id FROM instructors WHERE user_id = $1', [userId]);
      if (i.rows.length) instructorId = i.rows[0].id;
    }
    
    res.json({ 
      message: 'Profile updated successfully',
      user: {
        ...updatedUser,
        student_id: studentId,
        instructor_id: instructorId
      }
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});


module.exports = router;
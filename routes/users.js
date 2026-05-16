const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// ----------------------------------------------------------------------
// GET /api/users – Admin only: fetch all users with role-specific IDs
// ----------------------------------------------------------------------
router.get('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        u.*, 
        i.id AS instructor_id, 
        i.pay_per_class,
        s.id AS student_id
      FROM users u
      LEFT JOIN instructors i ON u.id = i.user_id
      LEFT JOIN students s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ----------------------------------------------------------------------
// PUT /api/users/:id/toggle-active – Admin only: toggle user active status
// ----------------------------------------------------------------------
router.put('/:id/toggle-active', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const userId = req.params.id;
  try {
    const result = await db.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      message: 'User status updated',
      is_active: result.rows[0].is_active
    });
  } catch (error) {
    console.error('Toggle active error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----------------------------------------------------------------------
// PUT /api/users/instructor/:id/pay-rate – Admin only: update instructor pay rate
// ----------------------------------------------------------------------
router.put('/instructor/:id/pay-rate', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { pay_per_class } = req.body;
  const instructorId = req.params.id;

  if (pay_per_class === undefined || pay_per_class < 0) {
    return res.status(400).json({ error: 'Valid pay_per_class is required' });
  }

  try {
    const result = await db.query(
      'UPDATE instructors SET pay_per_class = $1 WHERE id = $2 RETURNING id, pay_per_class',
      [pay_per_class, instructorId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    res.json({
      message: 'Pay rate updated',
      pay_per_class: result.rows[0].pay_per_class
    });
  } catch (error) {
    console.error('Update pay rate error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----------------------------------------------------------------------
// DELETE /api/users/:id – Admin only: delete a user (prevent self‑deletion)
// ----------------------------------------------------------------------
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const userId = req.params.id;
  const currentAdminId = req.user.id;

  if (parseInt(userId) === currentAdminId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    const userResult = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

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
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----------------------------------------------------------------------
// PUT /api/users/profile – Authenticated user: update own profile
// ----------------------------------------------------------------------
router.put('/profile', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { name, email, phone, address } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    // Check email uniqueness (excluding current user)
    const emailCheck = await db.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Update user record
    await db.query(
      `UPDATE users 
       SET name = $1, email = $2, phone = $3, address = $4 
       WHERE id = $5`,
      [name, email, phone || null, address || null, userId]
    );

    // Fetch updated user data
    const userResult = await db.query(
      `SELECT id, name, email, role, phone, address, photo_url, is_active, profile_complete
       FROM users WHERE id = $1`,
      [userId]
    );
    const updatedUser = userResult.rows[0];

    // Attach student_id or instructor_id for frontend convenience
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
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
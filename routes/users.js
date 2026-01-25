const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const connection = require('../config/db');

// Get all users (Admin only)
router.get('/', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT 
      u.*, 
      i.id as instructor_id, 
      i.pay_per_class,
      s.id as student_id
     FROM users u
     LEFT JOIN instructors i ON u.id = i.user_id
     LEFT JOIN students s ON u.id = s.user_id
     ORDER BY u.created_at DESC`,
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});

// Toggle user active status
router.put('/:id/toggle-active', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const userId = req.params.id;
  
  connection.query(
    'UPDATE users SET is_active = !is_active WHERE id = ?',
    [userId],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json({ message: 'User status updated' });
    }
  );
});

// Update instructor pay rate
router.put('/instructor/:id/pay-rate', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const { pay_per_class } = req.body;
  const instructorId = req.params.id;
  
  connection.query(
    'UPDATE instructors SET pay_per_class = ? WHERE id = ?',
    [pay_per_class, instructorId],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json({ message: 'Pay rate updated' });
    }
  );
});

// Get user profile
router.get('/profile', authMiddleware, (req, res) => {
  const userId = req.user.id;
  
  connection.query(
    `SELECT u.*, 
            i.id as instructor_id, 
            i.pay_per_class,
            s.id as student_id
     FROM users u
     LEFT JOIN instructors i ON u.id = i.user_id
     LEFT JOIN students s ON u.id = s.user_id
     WHERE u.id = ?`,
    [userId],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json(results[0]);
    }
  );
});

module.exports = router;
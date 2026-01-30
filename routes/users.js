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
// router.get('/profile', authMiddleware, (req, res) => {
//   const userId = req.user.id;
  
//   connection.query(
//     `SELECT u.*, 
//             i.id as instructor_id, 
//             i.pay_per_class,
//             s.id as student_id
//      FROM users u
//      LEFT JOIN instructors i ON u.id = i.user_id
//      LEFT JOIN students s ON u.id = s.user_id
//      WHERE u.id = ?`,
//     [userId],
//     (err, results) => {
//       if (err || results.length === 0) {
//         return res.status(404).json({ message: 'User not found' });
//       }
//       res.json(results[0]);
//     }
//   );
// });









router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const userId = req.params.id;
  const currentAdminId = req.user.id;

  // Prevent admin from deleting themselves
  if (parseInt(userId) === currentAdminId) {
    return res.status(400).json({ message: 'You cannot delete your own account' });
  }

  // Get user info before deletion for logging
  connection.query(
    'SELECT * FROM users WHERE id = ?',
    [userId],
    (err, userResults) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }

      if (userResults.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      const user = userResults[0];

      // Delete user (cascade will delete instructor/student records)
      connection.query(
        'DELETE FROM users WHERE id = ?',
        [userId],
        (err, result) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
          }

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
        }
      );
    }
  );
});

// Get user profile with photo
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
        console.error('Database error:', err);
        return res.status(404).json({ message: 'User not found' });
      }
      
      const user = results[0];
      
      // Convert photo_url to full URL if exists
      if (user.photo_url) {
        user.photo_url = `http://localhost:${process.env.PORT || 5000}${user.photo_url}`;
      }
      
      res.json(user);
    }
  );
});

// Update user profile (name, email)
router.put('/profile', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { name, email } = req.body;
  
  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required' });
  }
  
  // Check if email is already taken by another user
  connection.query(
    'SELECT id FROM users WHERE email = ? AND id != ?',
    [email, userId],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      
      if (results.length > 0) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      
      // Update user
      connection.query(
        'UPDATE users SET name = ?, email = ? WHERE id = ?',
        [name, email, userId],
        (err, result) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
          }
          
          res.json({ message: 'Profile updated successfully' });
        }
      );
    }
  );
});

module.exports = router;
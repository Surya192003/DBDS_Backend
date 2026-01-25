const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const connection = require('../config/db');

// Get student statistics (Admin only)
router.get('/student-stats', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT s.*, 
            u.name as student_name,
            u.email,
            COUNT(DISTINCT a.class_id) as total_classes,
            SUM(CASE WHEN a.is_present = TRUE THEN 1 ELSE 0 END) as attended_classes,
            SUM(CASE WHEN a.is_present = FALSE THEN 1 ELSE 0 END) as missed_classes
     FROM students s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN attendance a ON s.id = a.student_id
     GROUP BY s.id, u.name, u.email
     ORDER BY u.name`,
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json(results);
    }
  );
});

// Get instructor statistics (Admin only)
router.get('/instructor-stats', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT i.*, 
            u.name as instructor_name,
            u.email,
            COUNT(DISTINCT c.id) as total_classes_assigned,
            COUNT(DISTINCT CASE WHEN c.class_date < CURDATE() THEN c.id END) as completed_classes,
            SUM(i.pay_per_class) as potential_earnings
     FROM instructors i
     JOIN users u ON i.user_id = u.id
     LEFT JOIN classes c ON i.id = c.instructor_id
     GROUP BY i.id, u.name, u.email
     ORDER BY u.name`,
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json(results);
    }
  );
});

// Get instructor's monthly performance
router.get('/instructor-monthly/:instructorId', authMiddleware, (req, res) => {
  const instructorId = req.params.instructorId;
  
  connection.query(
    `SELECT DATE_FORMAT(c.class_date, '%Y-%m') as month_year,
            COUNT(c.id) as total_classes,
            COUNT(DISTINCT a.student_id) as total_students
     FROM classes c
     LEFT JOIN attendance a ON c.id = a.class_id AND a.is_present = TRUE
     WHERE c.instructor_id = ?
     GROUP BY DATE_FORMAT(c.class_date, '%Y-%m')
     ORDER BY month_year DESC`,
    [instructorId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json(results);
    }
  );
});

module.exports = router;
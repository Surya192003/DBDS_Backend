const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// Get instructor stats
router.get('/instructor-stats', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id,
        u.name as instructor_name,
        COUNT(DISTINCT c.id) as total_classes,
        COUNT(DISTINCT a.student_id) as total_students,
        ROUND(COALESCE(AVG(CASE WHEN a.is_present THEN 100 ELSE 0 END), 0), 2) as attendance_rate
      FROM instructors i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN classes c ON c.instructor_id = i.id
      LEFT JOIN attendance a ON a.class_id = c.id
      WHERE u.is_active = TRUE
      GROUP BY i.id, u.name
      ORDER BY u.name
    `;
    
    const result = await db.query(query);
    
    // Send just the rows array
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error in instructor-stats:', error);
    // Send empty array on error to prevent frontend crashes
    res.status(500).json([]);
  }
});

// Get student stats
router.get('/student-stats', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id,
        u.name as student_name,
        s.attended_classes,
        s.total_classes,
        CASE 
          WHEN s.total_classes > 0 THEN ROUND((s.attended_classes::DECIMAL / s.total_classes::DECIMAL) * 100, 2)
          ELSE 0
        END as attendance_rate,
        s.membership_status
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE u.is_active = TRUE
      ORDER BY u.name
    `;
    
    const result = await db.query(query);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error in student-stats:', error);
    res.status(500).json([]);
  }
});

module.exports = router;
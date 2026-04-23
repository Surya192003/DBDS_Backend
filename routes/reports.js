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

// GET /api/instructor/monthly-performance/:instructorId
router.get('/monthly-performance/:instructorId', authMiddleware, authorizeRoles('INSTRUCTOR', 'ADMIN'), async (req, res) => {
  try {
    const instructorId = req.params.instructorId;
    const query = `
      SELECT 
        TO_CHAR(DATE_TRUNC('month', c.class_date), 'YYYY-MM') as month_year,
        COUNT(DISTINCT c.id) as total_classes,
        COUNT(DISTINCT ce.student_id) as total_students,
        (COUNT(DISTINCT c.id) * i.pay_per_class) as earnings
      FROM classes c
      JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN class_enrollments ce ON c.id = ce.class_id AND ce.status = 'active'
      WHERE i.id = $1
        AND c.status = 'completed'
      GROUP BY month_year, i.pay_per_class
      ORDER BY month_year DESC
    `;
    const result = await db.query(query, [instructorId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

router.get('/instructor-tag-summary', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id as instructor_id,
        u.name as instructor_name,
        u.email,
        i.pay_per_class,
        COUNT(DISTINCT c.id) as total_classes_assigned,
        COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as completed_classes,
        COUNT(DISTINCT ica.class_id) as classes_tagged_in,
        COUNT(DISTINCT CASE WHEN ica.tag_out_time IS NOT NULL THEN ica.class_id END) as classes_tagged_out,
        MAX(ica.tag_in_time) as last_tag_in,
        (COUNT(DISTINCT c.id) * i.pay_per_class) as potential_earnings,
        u.is_active
      FROM instructors i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN classes c ON c.instructor_id = i.id
      LEFT JOIN instructor_class_attendance ica ON ica.instructor_id = i.id
      GROUP BY i.id, u.name, u.email, i.pay_per_class, u.is_active
      ORDER BY u.name
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching instructor tag summary:', err);
    res.status(500).json([]);
  }
});


module.exports = router;
const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// ----------------------------------------------------------------------
// 1. Instructor Statistics (Admin only)
// ----------------------------------------------------------------------
// GET /api/stats/instructor-stats
router.get('/instructor-stats', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id,
        u.name AS instructor_name,
        COUNT(DISTINCT c.id) AS total_classes,
        COUNT(DISTINCT a.student_id) AS total_students,
        ROUND(COALESCE(AVG(CASE WHEN a.is_present THEN 100 ELSE 0 END), 0), 2) AS attendance_rate
      FROM instructors i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN classes c ON c.instructor_id = i.id
      LEFT JOIN attendance a ON a.class_id = c.id
      WHERE u.is_active = TRUE
      GROUP BY i.id, u.name
      ORDER BY u.name
    `;
    const result = await db.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error in instructor-stats:', error);
    res.status(500).json({ error: 'Failed to fetch instructor statistics' });
  }
});

// ----------------------------------------------------------------------
// 2. Student Statistics (Admin only)
// ----------------------------------------------------------------------
// GET /api/stats/student-stats
router.get('/student-stats', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id,
        u.name AS student_name,
        s.attended_classes,
        s.total_classes,
        CASE 
          WHEN s.total_classes > 0 THEN ROUND((s.attended_classes::DECIMAL / s.total_classes::DECIMAL) * 100, 2)
          ELSE 0
        END AS attendance_rate,
        s.membership_status
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE u.is_active = TRUE
      ORDER BY u.name
    `;
    const result = await db.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error in student-stats:', error);
    res.status(500).json({ error: 'Failed to fetch student statistics' });
  }
});

// ----------------------------------------------------------------------
// 3. Instructor Monthly Performance (Instructor/Admin)
// ----------------------------------------------------------------------
// GET /api/stats/monthly-performance/:instructorId
router.get('/monthly-performance/:instructorId', authMiddleware, authorizeRoles('INSTRUCTOR', 'ADMIN'), async (req, res) => {
  try {
    const instructorId = parseInt(req.params.instructorId);
    if (isNaN(instructorId) || instructorId <= 0) {
      return res.status(400).json({ error: 'Invalid instructor ID' });
    }

    const query = `
      SELECT 
        TO_CHAR(DATE_TRUNC('month', c.class_date), 'YYYY-MM') AS month_year,
        COUNT(DISTINCT c.id) AS total_classes,
        COUNT(DISTINCT ce.student_id) AS total_students,
        (COUNT(DISTINCT c.id) * i.pay_per_class) AS earnings
      FROM classes c
      JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN class_enrollments ce ON c.id = ce.class_id AND ce.status = 'active'
      WHERE i.id = $1
        AND c.status = 'completed'
      GROUP BY month_year, i.pay_per_class
      ORDER BY month_year DESC
    `;
    const result = await db.query(query, [instructorId]);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error in monthly-performance:', error);
    res.status(500).json({ error: 'Failed to fetch monthly performance' });
  }
});

// ----------------------------------------------------------------------
// 4. Instructor Tag Summary (Admin only)
// ----------------------------------------------------------------------
// GET /api/stats/instructor-tag-summary
router.get('/instructor-tag-summary', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        i.id AS instructor_id,
        u.name AS instructor_name,
        u.email,
        i.pay_per_class,
        COUNT(DISTINCT c.id) AS total_classes_assigned,
        COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) AS completed_classes,
        COUNT(DISTINCT ica.class_id) AS classes_tagged_in,
        COUNT(DISTINCT CASE WHEN ica.tag_out_time IS NOT NULL THEN ica.class_id END) AS classes_tagged_out,
        MAX(ica.tag_in_time) AS last_tag_in,
        (COUNT(DISTINCT c.id) * i.pay_per_class) AS potential_earnings,
        u.is_active
      FROM instructors i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN classes c ON c.instructor_id = i.id
      LEFT JOIN instructor_class_attendance ica ON ica.instructor_id = i.id
      GROUP BY i.id, u.name, u.email, i.pay_per_class, u.is_active
      ORDER BY u.name
    `;
    const result = await db.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error in instructor-tag-summary:', error);
    res.status(500).json({ error: 'Failed to fetch instructor tag summary' });
  }
});

module.exports = router;
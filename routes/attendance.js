const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db'); // Changed to PostgreSQL db

// Mark attendance (Instructor only)
router.post('/', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  try {
    const { class_id, student_id, is_present } = req.body;
    
    // Check if attendance already exists
    const checkResult = await db.query(
      'SELECT * FROM attendance WHERE class_id = $1 AND student_id = $2',
      [class_id, student_id]
    );
    
    if (checkResult.rows.length > 0) {
      // Update existing attendance
      await db.query(
        `UPDATE attendance 
         SET check_in_time = NOW(), is_present = $1
         WHERE class_id = $2 AND student_id = $3`,
        [is_present, class_id, student_id]
      );
    } else {
      // Insert new attendance
      await db.query(
        `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
         VALUES ($1, $2, NOW(), $3)`,
        [class_id, student_id, is_present]
      );
    }
    
    // Update student stats if present
    if (is_present) {
      await db.query(
        `UPDATE students 
         SET attended_classes = attended_classes + 1,
             total_classes = total_classes + 1
         WHERE id = $1`,
        [student_id]
      );
    }
    
    res.json({ message: 'Attendance marked' });
  } catch (err) {
    console.error('Error marking attendance:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get attendance for a class
router.get('/class/:classId', authMiddleware, async (req, res) => {
  try {
    const classId = req.params.classId;
    
    const result = await db.query(
      `SELECT a.*, u.name as student_name
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE a.class_id = $1`,
      [classId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get student attendance history
router.get('/student/:studentId', authMiddleware, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    
    const result = await db.query(
      `SELECT a.*, c.class_date, c.class_time, u.name as instructor_name, c.song_link
       FROM attendance a
       JOIN classes c ON a.class_id = c.id
       JOIN instructors i ON c.instructor_id = i.id
       JOIN users u ON i.user_id = u.id
       WHERE a.student_id = $1
       ORDER BY c.class_date DESC, c.class_time DESC`,
      [studentId]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching student attendance:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get all active students (for dropdown)
// Get active students (for dropdowns)
// Get active students
router.get('/students/active', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  try {
    const query = `
      SELECT 
        s.id as student_id,
        u.id as user_id,
        u.name,
        u.email,
        s.membership_status
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE u.role = 'STUDENT' AND u.is_active = TRUE
      ORDER BY u.name
    `;
    
    const result = await db.query(query);
    
    // Send just the rows array
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching active students:', error);
    res.status(500).json([]);
  }
});
// Bulk mark attendance
router.post('/bulk', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  try {
    const { class_id, attendance_data } = req.body;
    
    if (!class_id || !attendance_data || !Array.isArray(attendance_data)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }
    
    // Start transaction
    await db.query('BEGIN');
    
    try {
      for (const data of attendance_data) {
        // Check if attendance exists
        const checkResult = await db.query(
          'SELECT * FROM attendance WHERE class_id = $1 AND student_id = $2',
          [class_id, data.student_id]
        );
        
        if (checkResult.rows.length > 0) {
          // Update existing
          await db.query(
            `UPDATE attendance 
             SET check_in_time = NOW(), is_present = $1
             WHERE class_id = $2 AND student_id = $3`,
            [data.is_present, class_id, data.student_id]
          );
        } else {
          // Insert new
          await db.query(
            `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
             VALUES ($1, $2, NOW(), $3)`,
            [class_id, data.student_id, data.is_present]
          );
        }
        
        // Update student stats if present
        if (data.is_present) {
          await db.query(
            `UPDATE students 
             SET attended_classes = attended_classes + 1,
                 total_classes = total_classes + 1
             WHERE id = $1`,
            [data.student_id]
          );
        }
      }
      
      await db.query('COMMIT');
      res.json({ message: 'Attendance marked successfully' });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error marking bulk attendance:', error);
    res.status(500).json({ message: 'Error marking attendance', error: error.message });
  }
});

module.exports = router;
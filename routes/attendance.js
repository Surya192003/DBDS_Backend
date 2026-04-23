const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// ----------------------------------------------------------------------
// Single attendance marking (instructor)
// ----------------------------------------------------------------------
router.post('/', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  try {
    const { class_id, student_id, is_present } = req.body;

    // 1. Check if a present record already exists for this student & class
    const presentExists = await db.query(
      `SELECT 1 FROM attendance 
       WHERE class_id = $1 AND student_id = $2 AND is_present = true`,
      [class_id, student_id]
    );

    // 2. If marking present and no present record exists yet → increment attended_classes
    if (is_present && presentExists.rows.length === 0) {
      await db.query(
        `UPDATE students SET attended_classes = attended_classes + 1 WHERE id = $1`,
        [student_id]
      );
    }

    // 3. Upsert attendance (insert or update)
    const checkResult = await db.query(
      `SELECT id FROM attendance WHERE class_id = $1 AND student_id = $2`,
      [class_id, student_id]
    );

    if (checkResult.rows.length > 0) {
      await db.query(
        `UPDATE attendance 
         SET check_in_time = NOW(), is_present = $1
         WHERE class_id = $2 AND student_id = $3`,
        [is_present, class_id, student_id]
      );
    } else {
      await db.query(
        `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
         VALUES ($1, $2, NOW(), $3)`,
        [class_id, student_id, is_present]
      );
    }

    res.json({ message: 'Attendance marked' });
  } catch (err) {
    console.error('Error marking attendance:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// ----------------------------------------------------------------------
// Bulk attendance marking (instructor)
// ----------------------------------------------------------------------
router.post('/bulk', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  try {
    const { class_id, attendance_data } = req.body;

    if (!class_id || !attendance_data || !Array.isArray(attendance_data)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    // Tag‑in/out check (as you already have)
    const tagCheck = await db.query(
      `SELECT tag_in_time, tag_out_time 
       FROM instructor_class_attendance 
       WHERE class_id = $1 AND instructor_id = (SELECT id FROM instructors WHERE user_id = $2)`,
      [class_id, req.user.id]
    );
    if (tagCheck.rows.length === 0 || tagCheck.rows[0].tag_out_time !== null) {
      return res.status(403).json({ 
        message: 'Attendance can only be marked after instructor tags in and before tagging out.' 
      });
    }

    await db.query('BEGIN');

    for (const data of attendance_data) {
      // 1. Check if present record already exists (ignoring the current update)
      const presentExists = await db.query(
        `SELECT 1 FROM attendance 
         WHERE class_id = $1 AND student_id = $2 AND is_present = true`,
        [class_id, data.student_id]
      );

      // 2. Increment attended_classes only once per class
      if (data.is_present && presentExists.rows.length === 0) {
        await db.query(
          `UPDATE students SET attended_classes = attended_classes + 1 WHERE id = $1`,
          [data.student_id]
        );
      }

      // 3. Upsert attendance row
      const checkResult = await db.query(
        `SELECT id FROM attendance WHERE class_id = $1 AND student_id = $2`,
        [class_id, data.student_id]
      );

      if (checkResult.rows.length > 0) {
        await db.query(
          `UPDATE attendance 
           SET check_in_time = NOW(), is_present = $1
           WHERE class_id = $2 AND student_id = $3`,
          [data.is_present, class_id, data.student_id]
        );
      } else {
        await db.query(
          `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
           VALUES ($1, $2, NOW(), $3)`,
          [class_id, data.student_id, data.is_present]
        );
      }
    }

    await db.query('COMMIT');
    res.json({ message: 'Attendance marked successfully' });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Error marking bulk attendance:', error);
    res.status(500).json({ message: 'Error marking attendance', error: error.message });
  }
});

// ----------------------------------------------------------------------
// Get attendance for a class
// ----------------------------------------------------------------------
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

// ----------------------------------------------------------------------
// Get student attendance history (used by student dashboard)
// ----------------------------------------------------------------------
router.get('/student/:studentId', authMiddleware, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const result = await db.query(
      `SELECT a.*, 
              c.class_name,           
              c.class_date, 
              c.class_time, 
              c.song_link,            
              u.name as instructor_name
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

// ----------------------------------------------------------------------
// Get active students (for dropdowns)
// ----------------------------------------------------------------------
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
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching active students:', error);
    res.status(500).json([]);
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db'); // Change from 'connection' to 'db'

// Get all classes (Admin only - with more details)
router.get('/admin', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT c.*, 
             u.name as instructor_name,
             u.email as instructor_email,
             COUNT(DISTINCT a.student_id) as attendance_count
      FROM classes c
      LEFT JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN attendance a ON c.id = a.class_id AND a.is_present = TRUE
      GROUP BY c.id, u.name, u.email
      ORDER BY c.class_date DESC, c.class_time DESC
    `;
    
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get active instructors for dropdown
router.get('/instructors/list', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT i.id as instructor_id, u.id as user_id, u.name, u.email 
      FROM instructors i
      JOIN users u ON i.user_id = u.id
      WHERE u.role = 'INSTRUCTOR' AND u.is_active = TRUE
      ORDER BY u.name
    `;
    
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Create class (Admin only)
router.post('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { class_name, instructor_id, class_date, class_time, duration_minutes, max_students, location, description } = req.body;

  if (!class_name || !class_date || !class_time) {
    return res.status(400).json({ message: 'Class name, date and time are required' });
  }

  try {
    const query = `
      INSERT INTO classes (class_name, instructor_id, class_date, class_time, duration_minutes, max_students, location, description, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled')
      RETURNING id
    `;
    
    const values = [
      class_name, 
      instructor_id || null, 
      class_date, 
      class_time, 
      duration_minutes || 60, 
      max_students || 20, 
      location || null, 
      description || null
    ];
    
    const result = await db.query(query, values);
    res.status(201).json({ message: 'Class created', classId: result.rows[0].id });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Delete class (Admin only)
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const classId = req.params.id;
  
  if (!classId) {
    return res.status(400).json({ message: 'Class ID is required' });
  }
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // First, delete attendance records for this class
    await client.query('DELETE FROM attendance WHERE class_id = $1', [classId]);
    
    // Then delete the class
    const result = await client.query('DELETE FROM classes WHERE id = $1 RETURNING id', [classId]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Class not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Class deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting class:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  } finally {
    client.release();
  }
});

// Update class song link (Instructor only)
router.put('/:id/song-link', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const classId = req.params.id;
  const { song_link } = req.body;
  
  try {
    const query = 'UPDATE classes SET song_link = $1 WHERE id = $2 RETURNING id';
    const result = await db.query(query, [song_link, classId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    res.json({ message: 'Song link updated' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get all classes (for all authenticated users, role-based filtering)
router.get('/', authMiddleware, async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  
  try {
    let query = `
      SELECT 
        c.*, 
        u.name as instructor_name,
        u.email as instructor_email,
        COUNT(DISTINCT a.student_id) as attendance_count
      FROM classes c
      LEFT JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN attendance a ON c.id = a.class_id AND a.is_present = TRUE
    `;
    
    const params = [];
    
    if (userRole === 'INSTRUCTOR') {
      query += ` WHERE c.instructor_id IN (SELECT id FROM instructors WHERE user_id = $1)`;
      params.push(userId);
    } else if (userRole === 'STUDENT') {
      query += `
        WHERE c.id IN (
          SELECT a.class_id FROM attendance a
          WHERE a.student_id = (
            SELECT id FROM students WHERE user_id = $1
          )
        )
      `;
      params.push(userId);
    }
    
    query += ` GROUP BY c.id, u.name, u.email ORDER BY c.class_date DESC, c.class_time DESC`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get upcoming classes for student
router.get('/upcoming', authMiddleware, authorizeRoles('STUDENT'), async (req, res) => {
  const userId = req.user.id;
  
  try {
    const query = `
      SELECT c.*, u.name as instructor_name, u.email as instructor_email
      FROM classes c
      LEFT JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE c.class_date >= CURRENT_DATE
      AND c.id IN (
        SELECT a.class_id FROM attendance a
        WHERE a.student_id = (
          SELECT id FROM students WHERE user_id = $1
        )
      )
      ORDER BY c.class_date, c.class_time
    `;
    
    const result = await db.query(query, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Assign student to class (Admin only)
router.post('/:classId/assign-student/:studentId', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const classId = req.params.classId;
  const studentId = req.params.studentId;
  
  console.log(`Assigning student ${studentId} to class ${classId}`);
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Check if class exists
    const classResult = await client.query('SELECT * FROM classes WHERE id = $1', [classId]);
    if (classResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Class not found' });
    }
    
    // Check if student exists
    const studentResult = await client.query('SELECT * FROM students WHERE id = $1', [studentId]);
    if (studentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found' });
    }
    
    // Check if already assigned
    const attendanceResult = await client.query(
      'SELECT * FROM attendance WHERE class_id = $1 AND student_id = $2',
      [classId, studentId]
    );
    
    if (attendanceResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Student already assigned to this class' });
    }
    
    // Assign student to class
    await client.query(
      'INSERT INTO attendance (class_id, student_id, is_present) VALUES ($1, $2, FALSE)',
      [classId, studentId]
    );
    
    // Update student's total classes count
    await client.query(
      'UPDATE students SET total_classes = total_classes + 1 WHERE id = $1',
      [studentId]
    );
    
    await client.query('COMMIT');
    res.json({ message: 'Student assigned to class successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  } finally {
    client.release();
  }
});

// Get students for a specific class (only students in that class's group)
router.get('/:classId/students', authMiddleware, authorizeRoles('INSTRUCTOR', 'ADMIN'), async (req, res) => {
  const classId = req.params.classId;
  const userRole = req.user.role;
  const userId = req.user.id;
  
  try {
    if (userRole === 'INSTRUCTOR') {
      // Verify the instructor is assigned to this class
      const classCheck = await db.query(
        `SELECT c.* FROM classes c
         WHERE c.id = $1 AND c.instructor_id = (
           SELECT id FROM instructors WHERE user_id = $2
         )`,
        [classId, userId]
      );
      
      if (classCheck.rows.length === 0) {
        return res.status(403).json({ message: 'You are not assigned to this class' });
      }
    }
    
    // Get students who have attendance records for this class
    const query = `
      SELECT 
        s.id as student_id,
        u.id as user_id,
        u.name,
        u.email,
        a.is_present,
        a.check_in_time
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE a.class_id = $1 AND u.is_active = TRUE
      ORDER BY u.name
    `;
    
    const result = await db.query(query, [classId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Get groups for dropdown (if needed)
router.get('/groups/list', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  try {
    const query = `
      SELECT id, group_name, description 
      FROM groups 
      WHERE status = 'active'
      ORDER BY group_name
    `;
    
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

module.exports = router;
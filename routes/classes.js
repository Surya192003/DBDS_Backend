const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// Get all classes (Admin only - with more details)
// GET /api/classes/admin – admin view with instructor and tag info
router.get('/admin', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const query = `
      SELECT 
        c.*,
        u.name as instructor_name,
        u.email as instructor_email,
        g.group_name,
        ica.tag_in_time,
        ica.tag_out_time,
        EXISTS (SELECT 1 FROM attendance a WHERE a.class_id = c.id) as attendance_marked
      FROM classes c
      LEFT JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN groups g ON c.group_id = g.id
      LEFT JOIN instructor_class_attendance ica ON c.id = ica.class_id AND ica.instructor_id = i.id
      ORDER BY c.class_date DESC, c.class_time DESC
    `;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching admin class list:', err);
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

// Create class (Admin only) – now includes group_id
router.post('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { 
    class_name, 
    instructor_id, 
    class_date, 
    class_time, 
    duration_minutes, 
    max_students, 
    location, 
    description,
    group_id      // ✅ new field
  } = req.body;

  if (!class_name || !class_date || !class_time) {
    return res.status(400).json({ message: 'Class name, date and time are required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    const query = `
      INSERT INTO classes (
        class_name, 
        instructor_id, 
        class_date, 
        class_time, 
        duration_minutes, 
        max_students, 
        location, 
        description, 
        status,
        group_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9)
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
      description || null,
      group_id || null     // ✅ allow null
    ];
    
    const result = await client.query(query, values);
    const classId = result.rows[0].id;
    
    // ✅ If group_id provided, the DB trigger will auto‑enroll existing group members
    // No extra code needed – the trigger fires on INSERT
    
    await client.query('COMMIT');
    res.status(201).json({ message: 'Class created', classId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  } finally {
    client.release();
  }
});

// ✅ NEW: Update class (Admin only) – allows changing group_id, which triggers auto‑enrollment
router.put('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const classId = req.params.id;
  const {
    class_name,
    instructor_id,
    class_date,
    class_time,
    duration_minutes,
    max_students,
    location,
    description,
    status,
    group_id
  } = req.body;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Get current group_id before update to detect change (optional, but trigger handles it)
    const current = await client.query('SELECT group_id FROM classes WHERE id = $1', [classId]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Class not found' });
    }
    
    const query = `
      UPDATE classes 
      SET 
        class_name = COALESCE($1, class_name),
        instructor_id = COALESCE($2, instructor_id),
        class_date = COALESCE($3, class_date),
        class_time = COALESCE($4, class_time),
        duration_minutes = COALESCE($5, duration_minutes),
        max_students = COALESCE($6, max_students),
        location = COALESCE($7, location),
        description = COALESCE($8, description),
        status = COALESCE($9, status),
        group_id = COALESCE($10, group_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING id
    `;
    
    const values = [
      class_name,
      instructor_id,
      class_date,
      class_time,
      duration_minutes,
      max_students,
      location,
      description,
      status,
      group_id,    // can be null or number
      classId
    ];
    
    const result = await client.query(query, values);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Class not found' });
    }
    
    // ✅ If group_id changed, the DB trigger will automatically enroll existing group members
    // No extra code needed – the trigger fires on UPDATE OF group_id
    
    await client.query('COMMIT');
    res.json({ message: 'Class updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating class:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  } finally {
    client.release();
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
    
    // Delete class_enrollments (cascade will happen automatically, but explicit is fine)
    await client.query('DELETE FROM class_enrollments WHERE class_id = $1', [classId]);
    
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
        COUNT(DISTINCT a.student_id) as attendance_count,
        g.group_name
      FROM classes c
      LEFT JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN attendance a ON c.id = a.class_id AND a.is_present = TRUE
      LEFT JOIN groups g ON c.group_id = g.id
    `;
    
    const params = [];
    
    if (userRole === 'INSTRUCTOR') {
      query += ` WHERE c.instructor_id IN (SELECT id FROM instructors WHERE user_id = $1)`;
      params.push(userId);
    } else if (userRole === 'STUDENT') {
      query += `
        WHERE c.id IN (
          SELECT ce.class_id FROM class_enrollments ce
          WHERE ce.student_id = (SELECT id FROM students WHERE user_id = $1)
        )
      `;
      params.push(userId);
    }
    
    query += ` GROUP BY c.id, u.name, u.email, g.group_name ORDER BY c.class_date DESC, c.class_time DESC`;
    
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
        SELECT ce.class_id FROM class_enrollments ce
        WHERE ce.student_id = (SELECT id FROM students WHERE user_id = $1)
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

// Assign student to class (Admin only) – uses class_enrollments
router.post('/:classId/assign-student/:studentId', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const classId = req.params.classId;
  const studentId = req.params.studentId;
  
  console.log(`Enrolling student ${studentId} in class ${classId}`);
  
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
    
    // Check if already enrolled
    const existing = await client.query(
      `SELECT id FROM class_enrollments 
       WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
      [classId, studentId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Student already enrolled in this class' });
    }
    
    // Check class capacity
    const capacityCheck = await client.query(
      `SELECT max_students, current_students FROM classes WHERE id = $1`,
      [classId]
    );
    const { max_students, current_students } = capacityCheck.rows[0];
    if (current_students >= max_students) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Class is full' });
    }
    
    // Insert into class_enrollments (trigger will increment current_students)
    await client.query(
      `INSERT INTO class_enrollments (class_id, student_id, status, enrolled_at)
       VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)`,
      [classId, studentId]
    );
    
    await client.query('COMMIT');
    res.json({ message: 'Student enrolled in class successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  } finally {
    client.release();
  }
});

// Get students enrolled in a class (using class_enrollments)
router.get('/:classId/students', authMiddleware, authorizeRoles('INSTRUCTOR', 'ADMIN'), async (req, res) => {
  const classId = req.params.classId;
  const userRole = req.user.role;
  const userId = req.user.id;
  
  try {
    // Instructors can only see students in their own classes
    if (userRole === 'INSTRUCTOR') {
      const classCheck = await db.query(
        `SELECT c.id FROM classes c
         WHERE c.id = $1 AND c.instructor_id = (
           SELECT id FROM instructors WHERE user_id = $2
         )`,
        [classId, userId]
      );
      if (classCheck.rows.length === 0) {
        return res.status(403).json({ message: 'You are not assigned to this class' });
      }
    }
    
    const query = `
      SELECT 
        s.id as student_id,
        u.id as user_id,
        u.name,
        u.email,
        ce.enrolled_at,
        ce.status as enrollment_status,
        FALSE as is_present
      FROM class_enrollments ce
      JOIN students s ON ce.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE ce.class_id = $1 AND ce.status = 'active'
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
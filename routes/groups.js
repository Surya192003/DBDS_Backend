const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// Get all groups
router.get('/', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  try {
    const query = `
      SELECT 
        g.*,
        u.name as instructor_name,
        COUNT(DISTINCT gm.student_id) as student_count
      FROM groups g
      LEFT JOIN instructors i ON g.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id AND gm.status = 'active'
      GROUP BY g.id, u.name
      ORDER BY g.created_at DESC
    `;

    const result = await db.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// Get group details with students
router.get('/:id', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const groupId = req.params.id;

  try {
    // Get group details
    const groupQuery = `
      SELECT 
        g.*,
        u.name as instructor_name,
        u.email as instructor_email
      FROM groups g
      LEFT JOIN instructors i ON g.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE g.id = $1
    `;

    const groupResult = await db.query(groupQuery, [groupId]);

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Get students in the group
    const studentsQuery = `
      SELECT 
        s.id as student_id,
        u.id as user_id,
        u.name,
        u.email,
        gm.joined_date,
        gm.status as membership_status
      FROM group_members gm
      JOIN students s ON gm.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE gm.group_id = $1 AND gm.status = 'active'
      ORDER BY u.name
    `;

    const studentsResult = await db.query(studentsQuery, [groupId]);

    res.json({
      ...groupResult.rows[0],
      students: studentsResult.rows
    });
  } catch (error) {
    console.error('Error fetching group details:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// Create new group
router.post('/', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const { group_name, description, instructor_id, max_students, schedule, start_date, end_date } = req.body;

  if (!group_name) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  try {
    const query = `
      INSERT INTO groups (
        group_name, 
        description, 
        instructor_id, 
        max_students, 
        schedule, 
        start_date, 
        end_date,
        status,
        current_students
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0)
      RETURNING id, group_name, created_at
    `;

    const values = [
      group_name,
      description || null,
      instructor_id || null,
      max_students || 15,
      schedule || null,
      start_date || null,
      end_date || null
    ];

    const result = await db.query(query, values);

    res.status(201).json({
      message: 'Group created successfully',
      group: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// Add student to group
// Add student to group (and auto‑enroll in linked classes)
// Add student to group (and auto‑enroll in linked classes)
router.post('/:groupId/add-student/:studentId', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const groupId = req.params.groupId;
  const studentId = req.params.studentId;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Group existence & capacity check
    const groupCheck = await client.query(
      'SELECT id, max_students, current_students FROM groups WHERE id = $1',
      [groupId]
    );
    if (groupCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Group not found' });
    }
    const group = groupCheck.rows[0];

    // 2. Student existence
    const studentCheck = await client.query('SELECT id FROM students WHERE id = $1', [studentId]);
    if (studentCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found' });
    }

    // 3. Already in group?
    const existing = await client.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND student_id = $2 AND status = $3',
      [groupId, studentId, 'active']
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Student already in this group' });
    }

    // 4. Group capacity
    if (group.current_students >= group.max_students) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Group is full' });
    }

    // 5. Add to group_members
    await client.query(
      `INSERT INTO group_members (group_id, student_id, status, joined_date)
       VALUES ($1, $2, 'active', CURRENT_DATE)`,
      [groupId, studentId]
    );

    // 6. Update group current_students
    await client.query(
      'UPDATE groups SET current_students = current_students + 1 WHERE id = $1',
      [groupId]
    );

    // 7. ✅ Auto‑enroll into all active classes linked to this group
    const classesQuery = `
      SELECT id FROM classes
      WHERE group_id = $1 AND status IN ('scheduled', 'ongoing')
    `;
    const classesResult = await client.query(classesQuery, [groupId]);

    for (const cls of classesResult.rows) {
      // Check if already enrolled in this class (active enrollment)
      const alreadyEnrolled = await client.query(
        `SELECT id FROM class_enrollments
         WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
        [cls.id, studentId]
      );
      if (alreadyEnrolled.rows.length === 0) {
        await client.query(
          `INSERT INTO class_enrollments (class_id, student_id, status, enrolled_at)
           VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)`,
          [cls.id, studentId]
        );
        // No need to update classes.current_students – your trigger will do it
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Student added to group and enrolled in linked classes' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding student to group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    client.release();
  }
});

// Remove student from group
router.delete('/:groupId/remove-student/:studentId', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const groupId = req.params.groupId;
  const studentId = req.params.studentId;
  const client = await db.getClient();  // ✅ Get client

  try {
    await client.query('BEGIN');

    // Check membership
    const membershipCheck = await client.query(
      'SELECT id FROM group_members WHERE group_id = $1 AND student_id = $2 AND status = $3',
      [groupId, studentId, 'active']
    );
    if (membershipCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found in this group' });
    }

    // Soft delete from group_members
    await client.query(
      'UPDATE group_members SET status = $1 WHERE group_id = $2 AND student_id = $3',
      ['inactive', groupId, studentId]
    );

    // Drop from all linked classes
    const classesResult = await client.query(
      'SELECT id FROM classes WHERE group_id = $1',
      [groupId]
    );
    for (const cls of classesResult.rows) {
      await client.query(
        `UPDATE class_enrollments SET status = 'dropped'
         WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
        [cls.id, studentId]
      );
    }

    // Decrement group current_students
    await client.query(
      'UPDATE groups SET current_students = current_students - 1 WHERE id = $1',
      [groupId]
    );

    await client.query('COMMIT');
    res.json({ message: 'Student removed from group and unenrolled from linked classes' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing student from group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    client.release();
  }
});

// Update group
router.put('/:id', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const groupId = req.params.id;
  const { group_name, description, instructor_id, max_students, schedule, start_date, end_date, status } = req.body;

  try {
    const query = `
      UPDATE groups 
      SET 
        group_name = COALESCE($1, group_name),
        description = COALESCE($2, description),
        instructor_id = COALESCE($3, instructor_id),
        max_students = COALESCE($4, max_students),
        schedule = COALESCE($5, schedule),
        start_date = COALESCE($6, start_date),
        end_date = COALESCE($7, end_date),
        status = COALESCE($8, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING id, group_name, status
    `;

    const values = [
      group_name,
      description,
      instructor_id,
      max_students,
      schedule,
      start_date,
      end_date,
      status,
      groupId
    ];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }

    res.json({
      message: 'Group updated successfully',
      group: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// Delete group
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const groupId = req.params.id;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Drop all active enrollments from classes linked to this group
    await client.query(
      `UPDATE class_enrollments ce
       SET status = 'dropped'
       FROM classes c
       WHERE c.group_id = $1 AND ce.class_id = c.id AND ce.status = 'active'`,
      [groupId]
    );

    // Remove group members
    await client.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);

    // Delete the group
    const result = await client.query('DELETE FROM groups WHERE id = $1 RETURNING id', [groupId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Group not found' });
    }

    await client.query('COMMIT');
    res.json({ message: 'Group deleted and students unenrolled from linked classes' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
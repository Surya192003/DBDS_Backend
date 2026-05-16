const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// ---------- Helper functions (avoid repetition) ----------

// Simple check existence
async function groupExists(client, groupId) {
  const res = await client.query('SELECT id, max_students, current_students FROM groups WHERE id = $1', [groupId]);
  return res.rows[0]; // undefined if not found
}

async function studentExists(client, studentId) {
  const res = await client.query('SELECT id FROM students WHERE id = $1', [studentId]);
  return res.rows.length > 0;
}

async function isMember(client, groupId, studentId, status = 'active') {
  const res = await client.query(
    'SELECT id FROM group_members WHERE group_id = $1 AND student_id = $2 AND status = $3',
    [groupId, studentId, status]
  );
  return res.rows.length > 0;
}

// ---------- Routes ----------

// GET / – list all groups (ADMIN, INSTRUCTOR)
router.get('/', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  try {
    const query = `
      SELECT 
        g.*,
        u.name AS instructor_name,
        COUNT(DISTINCT gm.student_id) AS student_count
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

// GET /:id – group details with students
router.get('/:id', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const { id } = req.params;
  try {
    const groupQuery = `
      SELECT 
        g.*,
        u.name AS instructor_name,
        u.email AS instructor_email
      FROM groups g
      LEFT JOIN instructors i ON g.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE g.id = $1
    `;
    const groupRes = await db.query(groupQuery, [id]);
    if (groupRes.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const studentsQuery = `
      SELECT 
        s.id AS student_id,
        u.id AS user_id,
        u.name,
        u.email,
        gm.joined_date,
        gm.status AS membership_status
      FROM group_members gm
      JOIN students s ON gm.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE gm.group_id = $1 AND gm.status = 'active'
      ORDER BY u.name
    `;
    const studentsRes = await db.query(studentsQuery, [id]);

    res.json({
      ...groupRes.rows[0],
      students: studentsRes.rows
    });
  } catch (error) {
    console.error('Error fetching group details:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// POST / – create group
router.post('/', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const { group_name, description, instructor_id, max_students, schedule, start_date, end_date } = req.body;
  if (!group_name) {
    return res.status(400).json({ message: 'Group name is required' });
  }
  try {
    const query = `
      INSERT INTO groups (group_name, description, instructor_id, max_students, schedule, start_date, end_date, status, current_students)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 0)
      RETURNING id, group_name, created_at
    `;
    const values = [group_name, description || null, instructor_id || null, max_students || 15, schedule || null, start_date || null, end_date || null];
    const result = await db.query(query, values);
    res.status(201).json({ message: 'Group created successfully', group: result.rows[0] });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// POST /:groupId/add-student/:studentId – add student to group (and auto‑enroll in linked classes)
router.post('/:groupId/add-student/:studentId', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const { groupId, studentId } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const group = await groupExists(client, groupId);
    if (!group) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Group not found' });
    }
    if (!(await studentExists(client, studentId))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found' });
    }
    if (await isMember(client, groupId, studentId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Student already in this group' });
    }
    if (group.current_students >= group.max_students) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Group is full' });
    }

    // Add membership
    await client.query(
      'INSERT INTO group_members (group_id, student_id, status, joined_date) VALUES ($1, $2, $3, CURRENT_DATE)',
      [groupId, studentId, 'active']
    );

    // Update group count
    await client.query('UPDATE groups SET current_students = current_students + 1 WHERE id = $1', [groupId]);

    // Enroll in all active classes linked to this group
    const classes = await client.query(
      'SELECT id FROM classes WHERE group_id = $1 AND status IN ($2, $3)',
      [groupId, 'scheduled', 'ongoing']
    );
    for (const cls of classes.rows) {
      const already = await client.query(
        'SELECT id FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = $3',
        [cls.id, studentId, 'active']
      );
      if (already.rows.length === 0) {
        await client.query(
          'INSERT INTO class_enrollments (class_id, student_id, status, enrolled_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
          [cls.id, studentId, 'active']
        );
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

// DELETE /:groupId/remove-student/:studentId
router.delete('/:groupId/remove-student/:studentId', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const { groupId, studentId } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (!(await isMember(client, groupId, studentId))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found in this group' });
    }

    // Soft delete membership
    await client.query(
      'UPDATE group_members SET status = $1 WHERE group_id = $2 AND student_id = $3',
      ['inactive', groupId, studentId]
    );

    // Drop from all linked classes
    const classes = await client.query('SELECT id FROM classes WHERE group_id = $1', [groupId]);
    for (const cls of classes.rows) {
      await client.query(
        'UPDATE class_enrollments SET status = $1 WHERE class_id = $2 AND student_id = $3 AND status = $4',
        ['dropped', cls.id, studentId, 'active']
      );
    }

    // Decrement group count
    await client.query('UPDATE groups SET current_students = current_students - 1 WHERE id = $1', [groupId]);

    await client.query('COMMIT');
    res.json({ message: 'Student removed from group and unenrolled from linked classes' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error removing student:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    client.release();
  }
});

// PUT /:id – update group
router.put('/:id', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), async (req, res) => {
  const { id } = req.params;
  const { group_name, description, instructor_id, max_students, schedule, start_date, end_date, status } = req.body;

  try {
    const query = `
      UPDATE groups SET
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
    const values = [group_name, description, instructor_id, max_students, schedule, start_date, end_date, status, id];
    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }
    res.json({ message: 'Group updated successfully', group: result.rows[0] });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// DELETE /:id – delete group (ADMIN only)
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Drop active enrollments from linked classes
    await client.query(
      'UPDATE class_enrollments ce SET status = $1 FROM classes c WHERE c.group_id = $2 AND ce.class_id = c.id AND ce.status = $3',
      ['dropped', id, 'active']
    );

    // Remove all group members
    await client.query('DELETE FROM group_members WHERE group_id = $1', [id]);

    const result = await client.query('DELETE FROM groups WHERE id = $1 RETURNING id', [id]);
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
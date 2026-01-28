const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const connection = require('../config/db');

// Get all groups
router.get('/', authMiddleware, (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  
  let query = `
    SELECT g.*, 
           u.name as created_by_name,
           COUNT(DISTINCT gs.student_id) as student_count
    FROM student_groups g
    LEFT JOIN instructors i ON g.created_by = i.id
    LEFT JOIN users u ON i.user_id = u.id
    LEFT JOIN group_students gs ON g.id = gs.group_id
  `;
  
  const params = [];
  
  if (userRole === 'INSTRUCTOR') {
    query += ` WHERE g.created_by = ?`;
    params.push(userId);
  }
  
  query += ` GROUP BY g.id ORDER BY g.created_at DESC`;
  
  connection.query(query, params, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(results);
  });
});

// Create group (Admin/Instructor)
router.post('/', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), (req, res) => {
  const { group_name, description } = req.body;
  const createdBy = req.user.role === 'INSTRUCTOR' ? req.user.roleId : null;
  
  if (!group_name) {
    return res.status(400).json({ message: 'Group name is required' });
  }
  
  connection.query(
    'INSERT INTO student_groups (group_name, description, created_by) VALUES (?, ?, ?)',
    [group_name, description, createdBy],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ 
        message: 'Group created successfully', 
        groupId: result.insertId 
      });
    }
  );
});

// Get group details with students
router.get('/:id', authMiddleware, (req, res) => {
  const groupId = req.params.id;
  
  // Get group info
  connection.query(
    `SELECT g.*, u.name as created_by_name
     FROM student_groups g
     LEFT JOIN instructors i ON g.created_by = i.id
     LEFT JOIN users u ON i.user_id = u.id
     WHERE g.id = ?`,
    [groupId],
    (err, groupResults) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      
      if (groupResults.length === 0) {
        return res.status(404).json({ message: 'Group not found' });
      }
      
      // Get group students
      connection.query(
        `SELECT s.id as student_id, u.id as user_id, u.name, u.email
         FROM group_students gs
         JOIN students s ON gs.student_id = s.id
         JOIN users u ON s.user_id = u.id
         WHERE gs.group_id = ? AND u.is_active = TRUE
         ORDER BY u.name`,
        [groupId],
        (err, studentResults) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
          }
          
          res.json({
            ...groupResults[0],
            students: studentResults
          });
        }
      );
    }
  );
});

// Add student to group
router.post('/:groupId/add-student/:studentId', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), (req, res) => {
  const groupId = req.params.groupId;
  const studentId = req.params.studentId;
  
  connection.query(
    'INSERT INTO group_students (group_id, student_id) VALUES (?, ?)',
    [groupId, studentId],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({ message: 'Student added to group successfully' });
    }
  );
});

// Remove student from group
router.delete('/:groupId/remove-student/:studentId', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), (req, res) => {
  const groupId = req.params.groupId;
  const studentId = req.params.studentId;
  
  connection.query(
    'DELETE FROM group_students WHERE group_id = ? AND student_id = ?',
    [groupId, studentId],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({ message: 'Student removed from group successfully' });
    }
  );
});

// Update group
router.put('/:id', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), (req, res) => {
  const groupId = req.params.id;
  const { group_name, description } = req.body;
  
  connection.query(
    'UPDATE student_groups SET group_name = ?, description = ? WHERE id = ?',
    [group_name, description, groupId],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({ message: 'Group updated successfully' });
    }
  );
});

// Delete group
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN', 'INSTRUCTOR'), (req, res) => {
  const groupId = req.params.id;
  
  connection.query('DELETE FROM student_groups WHERE id = ?', [groupId], (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json({ message: 'Group deleted successfully' });
  });
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const connection = require('../config/db');

// Get all classes (Admin only - with more details)
router.get('/admin', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT c.*, 
            u.name as instructor_name,
            u.email as instructor_email,
            COUNT(DISTINCT a.student_id) as attendance_count
     FROM classes c
     LEFT JOIN instructors i ON c.instructor_id = i.id
     LEFT JOIN users u ON i.user_id = u.id
     LEFT JOIN attendance a ON c.id = a.class_id AND a.is_present = TRUE
     GROUP BY c.id
     ORDER BY c.class_date DESC, c.class_time DESC`,
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});

router.get('/admin', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT c.*, 
            u.name as instructor_name,
            u.email as instructor_email,
            COUNT(DISTINCT a.student_id) as attendance_count
     FROM classes c
     LEFT JOIN instructors i ON c.instructor_id = i.id
     LEFT JOIN users u ON i.user_id = u.id
     LEFT JOIN attendance a ON c.id = a.class_id AND a.is_present = TRUE
     GROUP BY c.id
     ORDER BY c.class_date DESC, c.class_time DESC`,
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});

// Get active instructors for dropdown
router.get('/instructors/list', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT i.id as instructor_id, u.id as user_id, u.name, u.email 
     FROM instructors i
     JOIN users u ON i.user_id = u.id
     WHERE u.role = 'INSTRUCTOR' AND u.is_active = TRUE
     ORDER BY u.name`,
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});

// Get active instructors for dropdown
router.get('/instructors/list', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  connection.query(
    `SELECT i.id as instructor_id, u.id as user_id, u.name, u.email 
     FROM instructors i
     JOIN users u ON i.user_id = u.id
     WHERE u.role = 'INSTRUCTOR' AND u.is_active = TRUE
     ORDER BY u.name`,
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});

// Create class (Admin only)
router.post('/', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const { instructor_id, class_date, class_time } = req.body;
  
  if (!class_date || !class_time) {
    return res.status(400).json({ message: 'Date and time are required' });
  }
  
  // Convert empty string to NULL for instructor_id
  const instructorIdValue = (instructor_id && instructor_id.trim() !== '') ? instructor_id : null;
  
  connection.query(
    'INSERT INTO classes (instructor_id, class_date, class_time) VALUES (?, ?, ?)',
    [instructorIdValue, class_date, class_time],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ 
        message: 'Class created successfully', 
        classId: result.insertId 
      });
    }
  );
});

// Delete class (Admin only)
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const classId = req.params.id;
  
  if (!classId) {
    return res.status(400).json({ message: 'Class ID is required' });
  }
  
  // Start transaction to ensure data consistency
  connection.beginTransaction((err) => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ message: 'Transaction error' });
    }
    
    // First, delete attendance records for this class
    connection.query('DELETE FROM attendance WHERE class_id = ?', [classId], (err) => {
      if (err) {
        return connection.rollback(() => {
          console.error('Error deleting attendance:', err);
          res.status(500).json({ message: 'Error deleting class attendance' });
        });
      }
      
      // Then delete the class
      connection.query('DELETE FROM classes WHERE id = ?', [classId], (err, result) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Error deleting class:', err);
            res.status(500).json({ message: 'Error deleting class' });
          });
        }
        
        // Commit transaction
        connection.commit((err) => {
          if (err) {
            return connection.rollback(() => {
              console.error('Commit error:', err);
              res.status(500).json({ message: 'Commit error' });
            });
          }
          
          if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Class not found' });
          }
          
          res.json({ message: 'Class deleted successfully' });
        });
      });
    });
  });
});

// Update class song link (Instructor only)
router.put('/:id/song-link', authMiddleware, authorizeRoles('INSTRUCTOR'), (req, res) => {
  const classId = req.params.id;
  const { song_link } = req.body;
  
  connection.query(
    'UPDATE classes SET song_link = ? WHERE id = ?',
    [song_link, classId],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Class not found' });
      }
      
      res.json({ message: 'Song link updated' });
    }
  );
});

// Get all classes (for all authenticated users, role-based filtering)
router.get('/', authMiddleware, (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  
  let query = `
    SELECT c.*, 
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
    query += ` WHERE c.instructor_id IN (SELECT id FROM instructors WHERE user_id = ?)`;
    params.push(userId);
  } else if (userRole === 'STUDENT') {
    query += ` WHERE c.id IN (
      SELECT class_id FROM attendance WHERE student_id = ?
    ) OR c.class_date >= CURDATE()`;
    params.push(userId);
  }
  
  query += ` GROUP BY c.id ORDER BY c.class_date DESC, c.class_time DESC`;
  
  connection.query(query, params, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(results);
  });
});

// Get upcoming classes for student
router.get('/upcoming', authMiddleware, authorizeRoles('STUDENT'), (req, res) => {
  const userId = req.user.id;
  
  connection.query(
    `SELECT c.*, u.name as instructor_name, u.email as instructor_email
     FROM classes c
     JOIN instructors i ON c.instructor_id = i.id
     JOIN users u ON i.user_id = u.id
     WHERE c.class_date >= CURDATE()
     AND c.id NOT IN (
       SELECT a.class_id FROM attendance a
       JOIN students s ON a.student_id = s.id
       WHERE s.user_id = ?
     )
     ORDER BY c.class_date, c.class_time`,
    [userId],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});
// Get all students for a class (for attendance)
router.get('/:classId/students', authMiddleware, authorizeRoles('INSTRUCTOR', 'ADMIN'), (req, res) => {
  const classId = req.params.classId;
  
  connection.query(
    `SELECT 
      s.id as student_id,
      u.id as user_id,
      u.name,
      u.email,
      a.is_present,
      a.check_in_time
     FROM students s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN attendance a ON s.id = a.student_id AND a.class_id = ?
     WHERE u.is_active = TRUE
     ORDER BY u.name`,
    [classId],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(results);
    }
  );
});

// Assign student to class
router.post('/:classId/assign-student/:studentId', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const classId = req.params.classId;
  const studentId = req.params.studentId;
  
  connection.query(
    `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
     VALUES (?, ?, NULL, FALSE)
     ON DUPLICATE KEY UPDATE student_id = student_id`,
    [classId, studentId],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({ message: 'Student assigned to class' });
    }
  );
});

// Assign student to class (Admin only)
router.post('/:classId/assign-student/:studentId', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const classId = req.params.classId;
  const studentId = req.params.studentId;
  
  console.log(`Assigning student ${studentId} to class ${classId}`);
  
  // First, check if class exists
  connection.query('SELECT * FROM classes WHERE id = ?', [classId], (err, classResults) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    
    if (classResults.length === 0) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    // Check if student exists
    connection.query('SELECT * FROM students WHERE id = ?', [studentId], (err, studentResults) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }
      
      if (studentResults.length === 0) {
        return res.status(404).json({ message: 'Student not found' });
      }
      
      // Check if already assigned
      connection.query(
        'SELECT * FROM attendance WHERE class_id = ? AND student_id = ?',
        [classId, studentId],
        (err, attendanceResults) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
          }
          
          if (attendanceResults.length > 0) {
            return res.status(400).json({ message: 'Student already assigned to this class' });
          }
          
          // Assign student to class
          connection.query(
            'INSERT INTO attendance (class_id, student_id, check_in_time, is_present) VALUES (?, ?, NULL, FALSE)',
            [classId, studentId],
            (err, result) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Database error' });
              }
              
              // Update student's total classes count
              connection.query(
                'UPDATE students SET total_classes = total_classes + 1 WHERE id = ?',
                [studentId],
                (err) => {
                  if (err) {
                    console.error('Error updating student count:', err);
                    // Don't fail the whole request if this update fails
                  }
                  
                  res.json({ 
                    message: 'Student assigned to class successfully',
                    attendanceId: result.insertId
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});


module.exports = router;
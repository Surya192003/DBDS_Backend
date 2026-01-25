const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const connection = require('../config/db');

// Mark attendance (Instructor only)
router.post('/', authMiddleware, authorizeRoles('INSTRUCTOR'), (req, res) => {
  const { class_id, student_id, is_present } = req.body;
  
  connection.query(
    `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
     VALUES (?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE 
     check_in_time = NOW(), is_present = ?`,
    [class_id, student_id, is_present, is_present],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      
      // Update student stats
      if (is_present) {
        connection.query(
          `UPDATE students 
           SET attended_classes = attended_classes + 1,
               total_classes = total_classes + 1
           WHERE id = ?`,
          [student_id]
        );
      }
      
      res.json({ message: 'Attendance marked' });
    }
  );
});

// Get attendance for a class
router.get('/class/:classId', authMiddleware, (req, res) => {
  const classId = req.params.classId;
  
  connection.query(
    `SELECT a.*, u.name as student_name
     FROM attendance a
     JOIN students s ON a.student_id = s.id
     JOIN users u ON s.user_id = u.id
     WHERE a.class_id = ?`,
    [classId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json(results);
    }
  );
});

// Get student attendance history
router.get('/student/:studentId', authMiddleware, (req, res) => {
  const studentId = req.params.studentId;
  
  connection.query(
    `SELECT a.*, c.class_date, c.class_time, u.name as instructor_name, c.song_link
     FROM attendance a
     JOIN classes c ON a.class_id = c.id
     JOIN instructors i ON c.instructor_id = i.id
     JOIN users u ON i.user_id = u.id
     WHERE a.student_id = ?
     ORDER BY c.class_date DESC, c.class_time DESC`,
    [studentId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json(results);
    }
  );
});

// Get all active students (for dropdown)
router.get('/students/active', authMiddleware, (req, res) => {
  connection.query(
    `SELECT 
      s.id as student_id,
      u.id as user_id,
      u.name,
      u.email
     FROM students s
     JOIN users u ON s.user_id = u.id
     WHERE u.role = 'STUDENT' AND u.is_active = TRUE
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

// Bulk mark attendance
router.post('/bulk', authMiddleware, authorizeRoles('INSTRUCTOR'), (req, res) => {
  const { class_id, attendance_data } = req.body;
  
  if (!class_id || !attendance_data || !Array.isArray(attendance_data)) {
    return res.status(400).json({ message: 'Invalid request data' });
  }
  
  // Start transaction
  connection.beginTransaction((err) => {
    if (err) {
      console.error('Transaction error:', err);
      return res.status(500).json({ message: 'Transaction error' });
    }
    
    const queries = attendance_data.map(data => {
      return new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO attendance (class_id, student_id, check_in_time, is_present) 
           VALUES (?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE 
           check_in_time = NOW(), is_present = ?`,
          [class_id, data.student_id, data.is_present, data.is_present],
          (err, result) => {
            if (err) {
              reject(err);
            } else {
              // Update student stats if present
              if (data.is_present) {
                connection.query(
                  `UPDATE students 
                   SET attended_classes = attended_classes + 1,
                       total_classes = total_classes + 1
                   WHERE id = ?`,
                  [data.student_id]
                );
              }
              resolve(result);
            }
          }
        );
      });
    });
    
    Promise.all(queries)
      .then(() => {
        connection.commit((err) => {
          if (err) {
            return connection.rollback(() => {
              console.error('Commit error:', err);
              res.status(500).json({ message: 'Commit error' });
            });
          }
          res.json({ message: 'Attendance marked successfully' });
        });
      })
      .catch(error => {
        connection.rollback(() => {
          console.error('Error marking attendance:', error);
          res.status(500).json({ message: 'Error marking attendance' });
        });
      });
  });
});

module.exports = router;
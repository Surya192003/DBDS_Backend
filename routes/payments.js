const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const connection = require('../config/db');

// Calculate monthly payments (Admin only)
router.post('/calculate-monthly', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const { month_year } = req.body; // Format: YYYY-MM
  
  // Get all classes for the month with instructor details
  connection.query(
    `SELECT c.instructor_id, 
            COUNT(c.id) as class_count,
            i.pay_per_class,
            u.name as instructor_name
     FROM classes c
     JOIN instructors i ON c.instructor_id = i.id
     JOIN users u ON i.user_id = u.id
     WHERE DATE_FORMAT(c.class_date, '%Y-%m') = ?
     GROUP BY c.instructor_id, i.pay_per_class, u.name`,
    [month_year],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      
      const payments = results.map(row => ({
        instructor_id: row.instructor_id,
        month_year: month_year,
        total_classes: row.class_count,
        total_amount: row.class_count * row.pay_per_class,
        instructor_name: row.instructor_name,
        pay_per_class: row.pay_per_class
      }));
      
      // Insert or update payment records
      const insertPromises = payments.map(payment => {
        return new Promise((resolve, reject) => {
          connection.query(
            `INSERT INTO instructor_payments 
             (instructor_id, month_year, total_classes, total_amount) 
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
             total_classes = ?, total_amount = ?`,
            [
              payment.instructor_id,
              payment.month_year,
              payment.total_classes,
              payment.total_amount,
              payment.total_classes,
              payment.total_amount
            ],
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
        });
      });
      
      Promise.all(insertPromises)
        .then(() => res.json({ message: 'Payments calculated successfully', payments }))
        .catch(error => res.status(500).json({ message: 'Database error' }));
    }
  );
});

// Get monthly payments
router.get('/monthly/:month_year', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const month_year = req.params.month_year;
  
  connection.query(
    `SELECT ip.*, u.name as instructor_name
     FROM instructor_payments ip
     JOIN instructors i ON ip.instructor_id = i.id
     JOIN users u ON i.user_id = u.id
     WHERE ip.month_year = ?`,
    [month_year],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json(results);
    }
  );
});

// Mark payment as paid
router.put('/:id/mark-paid', authMiddleware, authorizeRoles('ADMIN'), (req, res) => {
  const paymentId = req.params.id;
  
  connection.query(
    'UPDATE instructor_payments SET is_paid = TRUE WHERE id = ?',
    [paymentId],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Database error' });
      res.json({ message: 'Payment marked as paid' });
    }
  );
});

module.exports = router;
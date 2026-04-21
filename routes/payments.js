const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db'); // ← Use PostgreSQL db

// Calculate monthly payments (Admin only)
router.post('/calculate-monthly', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { month_year } = req.body; // Format: YYYY-MM
  
  if (!month_year) {
    return res.status(400).json({ message: 'Month year is required (YYYY-MM format)' });
  }
  
  try {
    // Get all classes for the month with instructor details
    const classesQuery = `
      SELECT c.instructor_id, 
             COUNT(c.id) as class_count,
             i.pay_per_class,
             u.name as instructor_name
      FROM classes c
      JOIN instructors i ON c.instructor_id = i.id
      JOIN users u ON i.user_id = u.id
      WHERE TO_CHAR(c.class_date, 'YYYY-MM') = $1
      GROUP BY c.instructor_id, i.pay_per_class, u.name
    `;
    
    const result = await db.query(classesQuery, [month_year]);
    
    if (result.rows.length === 0) {
      return res.json({ 
        message: 'No classes found for this month',
        payments: [] 
      });
    }
    
    const payments = result.rows.map(row => ({
      instructor_id: row.instructor_id,
      month_year: month_year,
      total_classes: parseInt(row.class_count),
      total_amount: parseFloat(row.class_count) * parseFloat(row.pay_per_class),
      instructor_name: row.instructor_name,
      pay_per_class: row.pay_per_class
    }));
    
    // Insert or update payment records using PostgreSQL syntax
    for (const payment of payments) {
      await db.query(
        `INSERT INTO instructor_payments (instructor_id, month_year, total_classes, total_amount, status) 
         VALUES ($1, $2, $3, $4, 'pending')
         ON CONFLICT (instructor_id, month_year) 
         DO UPDATE SET 
           total_classes = EXCLUDED.total_classes,
           total_amount = EXCLUDED.total_amount,
           updated_at = CURRENT_TIMESTAMP`,
        [payment.instructor_id, payment.month_year, payment.total_classes, payment.total_amount]
      );
    }
    
    res.json({ 
      message: 'Payments calculated successfully', 
      payments: payments 
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// Get monthly payments
router.get('/monthly/:month_year', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const month_year = req.params.month_year;
  
  try {
    // First check if instructor_payments table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'instructor_payments'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create the table if it doesn't exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS instructor_payments (
          id SERIAL PRIMARY KEY,
          instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
          month_year VARCHAR(7) NOT NULL,
          total_classes INTEGER DEFAULT 0,
          total_amount DECIMAL(10, 2) DEFAULT 0,
          status VARCHAR(20) DEFAULT 'pending',
          paid_date DATE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(instructor_id, month_year)
        )
      `);
      return res.json([]);
    }
    
    const query = `
      SELECT ip.*, u.name as instructor_name
      FROM instructor_payments ip
      JOIN instructors i ON ip.instructor_id = i.id
      JOIN users u ON i.user_id = u.id
      WHERE ip.month_year = $1
      ORDER BY u.name
    `;
    
    const result = await db.query(query, [month_year]);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

// Mark payment as paid
router.put('/:id/mark-paid', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const paymentId = req.params.id;
  
  try {
    const result = await db.query(
      `UPDATE instructor_payments 
       SET status = 'paid', paid_date = CURRENT_DATE 
       WHERE id = $1 
       RETURNING id, status, paid_date`,
      [paymentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payment not found' });
    }
    
    res.json({ 
      message: 'Payment marked as paid',
      payment: result.rows[0]
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'Database error' });
  }
});

module.exports = router;
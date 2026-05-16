const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// Ensure the instructor_payments table exists (idempotent)
const ensureTableExists = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS instructor_payments (
      id SERIAL PRIMARY KEY,
      instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
      month_year VARCHAR(7) NOT NULL,
      total_classes INTEGER DEFAULT 0,
      total_amount DECIMAL(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',
      paid_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(instructor_id, month_year)
    )
  `);
};

// Helper to validate YYYY-MM format
const isValidMonthYear = (monthYear) => /^\d{4}-\d{2}$/.test(monthYear);

/**
 * Calculate monthly payments for all instructors
 * Admin only
 * POST /api/payments/calculate-monthly
 * Body: { month_year: "YYYY-MM" }
 */
router.post('/calculate-monthly', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const { month_year } = req.body;

  if (!month_year || !isValidMonthYear(month_year)) {
    return res.status(400).json({ message: 'Invalid or missing month_year. Use YYYY-MM format.' });
  }

  try {
    await ensureTableExists();

    // Get all classes for the month grouped by instructor
    const classesResult = await db.query(
      `
      SELECT 
        c.instructor_id,
        COUNT(c.id) AS class_count,
        i.pay_per_class,
        u.name AS instructor_name
      FROM classes c
      JOIN instructors i ON c.instructor_id = i.id
      JOIN users u ON i.user_id = u.id
      WHERE TO_CHAR(c.class_date, 'YYYY-MM') = $1
      GROUP BY c.instructor_id, i.pay_per_class, u.name
      `,
      [month_year]
    );

    if (classesResult.rows.length === 0) {
      return res.json({
        message: 'No classes found for this month',
        payments: []
      });
    }

    const payments = classesResult.rows.map(row => ({
      instructor_id: row.instructor_id,
      instructor_name: row.instructor_name,
      month_year: month_year,
      total_classes: parseInt(row.class_count, 10),
      total_amount: parseFloat(row.class_count) * parseFloat(row.pay_per_class),
      pay_per_class: parseFloat(row.pay_per_class)
    }));

    // Insert or update using ON CONFLICT (UPSERT)
    for (const payment of payments) {
      await db.query(
        `
        INSERT INTO instructor_payments (instructor_id, month_year, total_classes, total_amount, status)
        VALUES ($1, $2, $3, $4, 'pending')
        ON CONFLICT (instructor_id, month_year) DO UPDATE SET
          total_classes = EXCLUDED.total_classes,
          total_amount = EXCLUDED.total_amount,
          status = 'pending',
          updated_at = CURRENT_TIMESTAMP
        `,
        [payment.instructor_id, payment.month_year, payment.total_classes, payment.total_amount]
      );
    }

    res.json({
      message: 'Payments calculated successfully',
      payments
    });

  } catch (error) {
    console.error('Error calculating payments:', error);
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});

/**
 * Get monthly payments for a given month (YYYY-MM)
 * Admin only
 * GET /api/payments/monthly/:month_year
 */
router.get('/monthly/:month_year', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const month_year = req.params.month_year;

  if (!isValidMonthYear(month_year)) {
    return res.status(400).json({ message: 'Invalid month_year format. Use YYYY-MM.' });
  }

  try {
    await ensureTableExists();

    const result = await db.query(
      `
      SELECT 
        ip.*,
        u.name AS instructor_name
      FROM instructor_payments ip
      JOIN instructors i ON ip.instructor_id = i.id
      JOIN users u ON i.user_id = u.id
      WHERE ip.month_year = $1
      ORDER BY u.name
      `,
      [month_year]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Mark a payment as paid
 * Admin only
 * PUT /api/payments/:id/mark-paid
 */
router.put('/:id/mark-paid', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);

  if (isNaN(paymentId)) {
    return res.status(400).json({ message: 'Invalid payment ID' });
  }

  try {
    await ensureTableExists();

    const result = await db.query(
      `
      UPDATE instructor_payments
      SET status = 'paid', paid_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, status, paid_date, instructor_id, month_year, total_amount
      `,
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
    console.error('Error marking payment as paid:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
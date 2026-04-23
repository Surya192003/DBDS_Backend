const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// Tag in for a class
router.post('/tag-in', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const { class_id } = req.body;
  const userId = req.user.id;

  try {
    const instructorRes = await db.query(
      'SELECT id FROM instructors WHERE user_id = $1',
      [userId]
    );
    if (instructorRes.rows.length === 0) {
      return res.status(403).json({ message: 'Instructor profile not found' });
    }
    const instructor_id = instructorRes.rows[0].id;

    // Query: return class start as timestamptz in Europe/Dublin, and current time
    const classRes = await db.query(
      `SELECT 
         (class_date + class_time) AT TIME ZONE 'Europe/Dublin' AS class_start_tz,
         NOW() AS now_tz
       FROM classes 
       WHERE id = $1 AND instructor_id = $2`,
      [class_id, instructor_id]
    );

    if (classRes.rows.length === 0) {
      return res.status(404).json({ message: 'Class not found or not assigned to you' });
    }

    const classStart = new Date(classRes.rows[0].class_start_tz);
    const now = new Date(classRes.rows[0].now_tz);
    const diffMinutes = (now - classStart) / (1000 * 60);

    if (diffMinutes < -15 || diffMinutes > 15) {
      return res.status(400).json({
        message: `You can only tag in 15 minutes before or after class start time. Current diff: ${Math.round(diffMinutes)} minutes.`
      });
    }

    // Already tagged in check
    const existing = await db.query(
      `SELECT * FROM instructor_class_attendance 
       WHERE class_id = $1 AND instructor_id = $2 AND tag_out_time IS NULL`,
      [class_id, instructor_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Already tagged in for this class' });
    }

    // Insert using NOW() – PostgreSQL uses its own timezone (which we can set to UTC or keep as server default)
    await db.query(
      `INSERT INTO instructor_class_attendance (instructor_id, class_id, tag_in_time)
       VALUES ($1, $2, NOW())`,
      [instructor_id, class_id]
    );

    res.json({ message: 'Tagged in successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Tag out for a class
router.post('/tag-out', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const { class_id } = req.body;
  const userId = req.user.id;

  try {
    const instructorRes = await db.query(
      'SELECT id FROM instructors WHERE user_id = $1',
      [userId]
    );
    if (instructorRes.rows.length === 0) return res.status(403).json({ message: 'Instructor profile not found' });
    const instructor_id = instructorRes.rows[0].id;

    const record = await db.query(
      'SELECT * FROM instructor_class_attendance WHERE class_id = $1 AND instructor_id = $2 AND tag_out_time IS NULL',
      [class_id, instructor_id]
    );
    if (record.rows.length === 0) {
      return res.status(400).json({ message: 'No active tag-in found for this class' });
    }

    const tagInTime = new Date(record.rows[0].tag_in_time);
    const now = new Date();
    const minutesSinceTagIn = (now - tagInTime) / (1000 * 60);

    // Check if at least 55 minutes have passed (allow early tag-out but warn)
    if (minutesSinceTagIn < 55) {
      return res.status(400).json({ message: `Class duration is 1 hour. You can tag out after 55 minutes. (${Math.floor(55 - minutesSinceTagIn)} minutes remaining)` });
    }

    // Optionally, auto-mark class as completed?
    await db.query(
      'UPDATE instructor_class_attendance SET tag_out_time = $1 WHERE id = $2',
      [now, record.rows[0].id]
    );

    res.json({ message: 'Tagged out successfully', tag_out_time: now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current tag status for a class
router.get('/tag-status/:classId', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const classId = req.params.classId;
  const userId = req.user.id;

  try {
    const instructorRes = await db.query(
      'SELECT id FROM instructors WHERE user_id = $1',
      [userId]
    );
    if (instructorRes.rows.length === 0) return res.status(403).json({ message: 'Instructor profile not found' });
    const instructor_id = instructorRes.rows[0].id;

    const result = await db.query(
      `SELECT tag_in_time, tag_out_time 
       FROM instructor_class_attendance 
       WHERE class_id = $1 AND instructor_id = $2
       ORDER BY id DESC LIMIT 1`,
      [classId, instructor_id]
    );

    if (result.rows.length === 0) {
      return res.json({ tagged_in: false, tagged_out: false });
    }
    const row = result.rows[0];
    res.json({
      tagged_in: true,
      tagged_out: row.tag_out_time !== null,
      tag_in_time: row.tag_in_time,
      tag_out_time: row.tag_out_time
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
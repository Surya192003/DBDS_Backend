const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db'); // assumes a PostgreSQL connection pool

/**
 * Tag In – Instructor starts class
 * POST /api/instructor/tag-in
 * Body: { class_id: number }
 */
router.post('/tag-in', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const { class_id } = req.body;
  const userId = req.user.id;

  // Input validation
  if (!class_id || isNaN(parseInt(class_id))) {
    return res.status(400).json({ message: 'Valid class_id is required' });
  }

  try {
    // 1. Get instructor's internal id
    const instructorRes = await db.query(
      'SELECT id FROM instructors WHERE user_id = $1',
      [userId]
    );
    if (instructorRes.rows.length === 0) {
      return res.status(403).json({ message: 'Instructor profile not found' });
    }
    const instructorId = instructorRes.rows[0].id;

    // 2. Fetch class details and validate ownership + status
    const classRes = await db.query(
      `SELECT id, class_date, class_time, status,
              (class_date + class_time) AT TIME ZONE 'Europe/Dublin' AS class_start
       FROM classes 
       WHERE id = $1 AND instructor_id = $2`,
      [class_id, instructorId]
    );
    if (classRes.rows.length === 0) {
      return res.status(404).json({ message: 'Class not found or not assigned to you' });
    }
    const classData = classRes.rows[0];

    // Optional: prevent tagging in if class is already completed/cancelled
    if (classData.status === 'completed' || classData.status === 'cancelled') {
      return res.status(400).json({ message: `Cannot tag in – class is already ${classData.status}` });
    }

    // 3. Time window check using database current timestamp
    const nowRes = await db.query('SELECT NOW() as now');
    const now = new Date(nowRes.rows[0].now);
    const classStart = new Date(classData.class_start);
    const diffMinutes = (now - classStart) / (1000 * 60);

    if (diffMinutes < -15 || diffMinutes > 15) {
      return res.status(400).json({
        message: `Tag‑in only allowed 15 minutes before or after class start. Difference: ${Math.round(diffMinutes)} minutes.`
      });
    }

    // 4. Check if already tagged in (no tag_out_time)
    const existing = await db.query(
      `SELECT id FROM instructor_class_attendance 
       WHERE class_id = $1 AND instructor_id = $2 AND tag_out_time IS NULL`,
      [class_id, instructorId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'Already tagged in for this class' });
    }

    // 5. Insert tag-in record
    await db.query(
      `INSERT INTO instructor_class_attendance (instructor_id, class_id, tag_in_time)
       VALUES ($1, $2, NOW())`,
      [instructorId, class_id]
    );

    // Optionally update class status to 'ongoing'
    await db.query(
      `UPDATE classes SET status = 'ongoing' WHERE id = $1 AND status = 'scheduled'`,
      [class_id]
    );

    res.json({ message: 'Tagged in successfully', timestamp: nowRes.rows[0].now });
  } catch (err) {
    console.error('Tag-in error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/**
 * Tag Out – Instructor ends class
 * POST /api/instructor/tag-out
 * Body: { class_id: number }
 */
router.post('/tag-out', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const { class_id } = req.body;
  const userId = req.user.id;

  if (!class_id || isNaN(parseInt(class_id))) {
    return res.status(400).json({ message: 'Valid class_id is required' });
  }

  try {
    // 1. Get instructor internal id
    const instructorRes = await db.query(
      'SELECT id FROM instructors WHERE user_id = $1',
      [userId]
    );
    if (instructorRes.rows.length === 0) {
      return res.status(403).json({ message: 'Instructor profile not found' });
    }
    const instructorId = instructorRes.rows[0].id;

    // 2. Find active tag-in record
    const record = await db.query(
      `SELECT id, tag_in_time 
       FROM instructor_class_attendance 
       WHERE class_id = $1 AND instructor_id = $2 AND tag_out_time IS NULL
       ORDER BY id DESC LIMIT 1`,
      [class_id, instructorId]
    );
    if (record.rows.length === 0) {
      return res.status(400).json({ message: 'No active tag-in found for this class' });
    }

    const tagInTime = new Date(record.rows[0].tag_in_time);
    const nowRes = await db.query('SELECT NOW() as now');
    const now = new Date(nowRes.rows[0].now);
    const minutesSinceTagIn = (now - tagInTime) / (1000 * 60);

    // Enforce 1‑hour class duration (allow 55+ minutes)
    if (minutesSinceTagIn < 55) {
      const remaining = Math.ceil(55 - minutesSinceTagIn);
      return res.status(400).json({
        message: `Class duration is 1 hour. You can tag out after 55 minutes. ${remaining} minute(s) remaining.`
      });
    }

    // 3. Update tag-out time
    await db.query(
      `UPDATE instructor_class_attendance 
       SET tag_out_time = NOW() 
       WHERE id = $1`,
      [record.rows[0].id]
    );

    // 4. Mark class as completed (optional)
    await db.query(
      `UPDATE classes SET status = 'completed' WHERE id = $1`,
      [class_id]
    );

    res.json({ message: 'Tagged out successfully', tag_out_time: nowRes.rows[0].now });
  } catch (err) {
    console.error('Tag-out error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

/**
 * Get tag status for a specific class
 * GET /api/instructor/tag-status/:classId
 */
router.get('/tag-status/:classId', authMiddleware, authorizeRoles('INSTRUCTOR'), async (req, res) => {
  const classId = req.params.classId;
  const userId = req.user.id;

  if (!classId || isNaN(parseInt(classId))) {
    return res.status(400).json({ message: 'Valid classId is required' });
  }

  try {
    // Get instructor internal id
    const instructorRes = await db.query(
      'SELECT id FROM instructors WHERE user_id = $1',
      [userId]
    );
    if (instructorRes.rows.length === 0) {
      return res.status(403).json({ message: 'Instructor profile not found' });
    }
    const instructorId = instructorRes.rows[0].id;

    // Find most recent tag-in/out record for this class
    const result = await db.query(
      `SELECT tag_in_time, tag_out_time 
       FROM instructor_class_attendance 
       WHERE class_id = $1 AND instructor_id = $2
       ORDER BY id DESC LIMIT 1`,
      [classId, instructorId]
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
    console.error('Tag status error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
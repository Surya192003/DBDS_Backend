const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Safer month name formatter
function getMonthName(yearMonth) {
  const [year, month] = yearMonth.split('-');
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString('default', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Generate HTML report – with fallback
const generateReportHtml = (instructorName, monthYear, classesData, studentStats) => {
  const monthName = getMonthName(monthYear);
  
  // If no data, show a message
  const classesTableRows = classesData && classesData.length ? classesData.map(c => `
    <tr>
      <td>${escapeHtml(c.class_name)}</td>
      <td>${c.class_date}</td>
      <td>${c.class_time}</td>
      <td>${c.song_link ? `<a href="${escapeHtml(c.song_link)}">Link</a>` : '—'}</td>
      <td>${c.tag_in_time ? new Date(c.tag_in_time).toLocaleString() : '—'}</td>
      <td>${c.tag_out_time ? new Date(c.tag_out_time).toLocaleString() : '—'}</td>
    </tr>
  `).join('') : '<tr><td colspan="6">No classes this month.</td></tr>';

  const studentRows = studentStats && studentStats.length ? studentStats.map(s => `
    <tr>
      <td>${escapeHtml(s.student_name)}</td>
      <td>${s.attended}</td>
      <td>${s.total}</td>
      <td>${s.percentage}%</td>
    </tr>
  `).join('') : '<tr><td colspan="4">No student attendance data.</td></tr>';

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Monthly Report - ${monthName}</title></head>
    <body style="font-family: Arial, sans-serif;">
      <h2>Monthly Performance Report</h2>
      <p><strong>Instructor:</strong> ${escapeHtml(instructorName)}</p>
      <p><strong>Month:</strong> ${monthName}</p>
      
      <h3>Classes Summary</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead style="background: #f0f0f0;">
          <tr><th>Class Name</th><th>Date</th><th>Time</th><th>Song Link</th><th>Tag In</th><th>Tag Out</th></tr>
        </thead>
        <tbody>
          ${classesTableRows}
        </tbody>
      </table>
      
      <h3>Student Attendance (${monthName})</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead style="background: #f0f0f0;">
          <tr><th>Student Name</th><th>Attended</th><th>Total Classes</th><th>Attendance %</th></tr>
        </thead>
        <tbody>
          ${studentRows}
        </tbody>
      </table>
      <p><em>Generated on ${new Date().toLocaleString()}</em></p>
    </body>
    </html>
  `;
};

// Simple HTML escaping to prevent injection
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

router.get('/instructor-monthly', authMiddleware, authorizeRoles('INSTRUCTOR', 'ADMIN'), async (req, res) => {
  try {
    let instructorId;
    if (req.user.role === 'INSTRUCTOR') {
      const instructorRes = await db.query(
        'SELECT id FROM instructors WHERE user_id = $1',
        [req.user.id]
      );
      if (instructorRes.rows.length === 0) {
        return res.status(404).json({ error: 'Instructor profile not found' });
      }
      instructorId = instructorRes.rows[0].id;
    } else {
      instructorId = req.query.instructor_id;
      if (!instructorId) return res.status(400).json({ error: 'instructor_id required for admin' });
    }

    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
    }
    const [year, monthNum] = month.split('-');

    // 1. Get instructor email and name
    const instructorResult = await db.query(
      `SELECT u.name, u.email FROM instructors i JOIN users u ON i.user_id = u.id WHERE i.id = $1`,
      [instructorId]
    );
    if (instructorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Instructor not found' });
    }
    const instructor = instructorResult.rows[0];
    const instructorEmail = instructor.email;

    // 2. Get classes for that month
    const classesQuery = `
      SELECT c.id, c.class_name, c.class_date, c.class_time, c.song_link,
             ica.tag_in_time, ica.tag_out_time
      FROM classes c
      LEFT JOIN instructor_class_attendance ica ON c.id = ica.class_id AND ica.instructor_id = c.instructor_id
      WHERE c.instructor_id = $1
        AND EXTRACT(YEAR FROM c.class_date) = $2
        AND EXTRACT(MONTH FROM c.class_date) = $3
      ORDER BY c.class_date, c.class_time
    `;
    const classesResult = await db.query(classesQuery, [instructorId, year, monthNum]);
    const classes = classesResult.rows;
    if (classes.length === 0) {
      return res.status(400).json({ error: 'No classes found for the selected month' });
    }

    // 3. Student attendance stats
    const studentStatsQuery = `
      WITH student_classes AS (
        SELECT DISTINCT ce.student_id, c.id as class_id
        FROM class_enrollments ce
        JOIN classes c ON ce.class_id = c.id
        WHERE c.instructor_id = $1
          AND EXTRACT(YEAR FROM c.class_date) = $2
          AND EXTRACT(MONTH FROM c.class_date) = $3
          AND ce.status = 'active'
      ),
      attended AS (
        SELECT a.student_id, COUNT(*) as attended_count
        FROM attendance a
        JOIN classes c ON a.class_id = c.id
        WHERE c.instructor_id = $1
          AND EXTRACT(YEAR FROM c.class_date) = $2
          AND EXTRACT(MONTH FROM c.class_date) = $3
          AND a.is_present = true
        GROUP BY a.student_id
      )
      SELECT 
        u.name as student_name,
        COALESCE(att.attended_count, 0) as attended,
        COUNT(sc.class_id) as total_classes
      FROM student_classes sc
      JOIN students s ON sc.student_id = s.id
      JOIN users u ON s.user_id = u.id
      LEFT JOIN attended att ON sc.student_id = att.student_id
      GROUP BY u.name, att.attended_count
      ORDER BY u.name
    `;
    const studentStatsResult = await db.query(studentStatsQuery, [instructorId, year, monthNum]);
    const studentStats = studentStatsResult.rows.map(row => ({
      student_name: row.student_name,
      attended: parseInt(row.attended),
      total: parseInt(row.total_classes),
      percentage: row.total_classes > 0 ? Math.round((row.attended / row.total_classes) * 100) : 0
    }));

    // 4. Generate HTML
    const html = generateReportHtml(instructor.name, month, classes, studentStats);

    // Debug log
    console.log(`HTML length: ${html.length}, first 200 chars: ${html.substring(0, 200)}`);

    // 5. Send email
    const mailOptions = {
      from: `"DBDS System" <${process.env.SMTP_USER}>`,
      to: instructorEmail,
      subject: `Monthly Report - ${month}`,
      html: html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${instructorEmail}, messageId: ${info.messageId}`);

    res.json({ message: `Report sent to ${instructorEmail}` });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate or send report' });
  }
});

module.exports = router;
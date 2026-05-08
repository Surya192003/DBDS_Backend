const router = require('express').Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// Get all settings (admin)
router.get('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT key, value FROM app_settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update settings (admin)
router.put('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
  try {
    const { academic_year_start, academic_year_end } = req.body;
    if (academic_year_start) {
      await db.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['academic_year_start', academic_year_start]
      );
    }
    if (academic_year_end) {
      await db.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['academic_year_end', academic_year_end]
      );
    }
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get academic year – public for frontend filtering
router.get('/academic-year', async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT key, value FROM app_settings WHERE key IN ('academic_year_start', 'academic_year_end')"
    );
    const start = rows.find(r => r.key === 'academic_year_start')?.value || new Date().getFullYear() + '-01-01';
    const end = rows.find(r => r.key === 'academic_year_end')?.value || new Date().getFullYear() + '-12-31';
    res.json({ start, end });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
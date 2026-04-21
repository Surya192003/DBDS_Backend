const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/db');   // your PostgreSQL connection pool

// Configure multer (same as before)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/profile-photos/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `user-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files allowed'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Upload profile photo – PostgreSQL version
router.post('/profile-photo', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
  const userId = req.user.id;

  try {
    // Update user's photo_url (PostgreSQL uses $1, $2)
    await db.query(
      'UPDATE users SET photo_url = $1 WHERE id = $2',
      [photoUrl, userId]
    );

    // Fetch updated user
    const result = await db.query(
      'SELECT id, name, email, role, photo_url, is_active FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      message: 'Profile photo uploaded successfully',
      photoUrl,
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Upload DB error:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// Delete profile photo (PostgreSQL)
router.delete('/profile-photo', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    // Get current photo URL
    const result = await db.query(
      'SELECT photo_url FROM users WHERE id = $1',
      [userId]
    );
    const currentPhotoUrl = result.rows[0]?.photo_url;

    // Delete file if exists
    if (currentPhotoUrl) {
      const filePath = path.join(__dirname, '..', currentPhotoUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // Remove from DB
    await db.query('UPDATE users SET photo_url = NULL WHERE id = $1', [userId]);

    res.json({ message: 'Profile photo removed successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

module.exports = router;
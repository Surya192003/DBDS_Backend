const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const db = require('../config/db');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads', 'profile-photos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `user-${req.user.id}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// ------------------------------
// POST /api/upload/profile-photo
// ------------------------------
router.post('/profile-photo', authMiddleware, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
  const userId = req.user.id;

  try {
    // Check if user exists
    const userCheck = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      // Delete uploaded file because user doesn't exist
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Optionally delete old photo file if you want to replace it
    const oldPhoto = await db.query('SELECT photo_url FROM users WHERE id = $1', [userId]);
    if (oldPhoto.rows[0]?.photo_url) {
      const oldPath = path.join(process.cwd(), oldPhoto.rows[0].photo_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Update database
    await db.query('UPDATE users SET photo_url = $1 WHERE id = $2', [photoUrl, userId]);

    // Fetch updated user
    const result = await db.query(
      'SELECT id, name, email, role, photo_url, is_active FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Profile photo uploaded successfully',
      photoUrl,
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Profile photo upload error:', err);
    // Clean up uploaded file if something went wrong
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'Database error while uploading photo'
    });
  }
});

// ------------------------------
// DELETE /api/upload/profile-photo
// ------------------------------
router.delete('/profile-photo', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    // Get current photo URL
    const result = await db.query('SELECT photo_url FROM users WHERE id = $1', [userId]);
    const currentPhotoUrl = result.rows[0]?.photo_url;

    if (!currentPhotoUrl) {
      return res.status(404).json({
        success: false,
        message: 'No profile photo to delete'
      });
    }

    // Delete file from filesystem
    const filePath = path.join(process.cwd(), currentPhotoUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove reference from database
    await db.query('UPDATE users SET photo_url = NULL WHERE id = $1', [userId]);

    res.json({
      success: true,
      message: 'Profile photo removed successfully'
    });
  } catch (err) {
    console.error('Profile photo delete error:', err);
    res.status(500).json({
      success: false,
      message: 'Database error while deleting photo'
    });
  }
});

module.exports = router;
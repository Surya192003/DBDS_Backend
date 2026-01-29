const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const connection = require('../config/db');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/profile-photos/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'user-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Upload profile photo
router.post('/profile-photo', authMiddleware, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
  const userId = req.user.id;

  connection.query(
    'UPDATE users SET photo_url = ? WHERE id = ?',
    [photoUrl, userId],
    (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }

      // Get updated user info
      connection.query(
        'SELECT * FROM users WHERE id = ?',
        [userId],
        (err, userResults) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
          }

          res.json({
            message: 'Profile photo uploaded successfully',
            photoUrl: photoUrl,
            user: userResults[0]
          });
        }
      );
    }
  );
});

// Delete profile photo
router.delete('/profile-photo', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const fs = require('fs');
  const path = require('path');

  // Get current photo URL
  connection.query(
    'SELECT photo_url FROM users WHERE id = ?',
    [userId],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Database error' });
      }

      const currentPhotoUrl = results[0]?.photo_url;

      // Delete photo file if exists
      if (currentPhotoUrl) {
        const filePath = path.join(__dirname, '..', currentPhotoUrl);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Update database
      connection.query(
        'UPDATE users SET photo_url = NULL WHERE id = ?',
        [userId],
        (err, result) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
          }

          res.json({ message: 'Profile photo removed successfully' });
        }
      );
    }
  );
});

// Serve uploaded files statically
router.use('/profile-photos', express.static(path.join(__dirname, '../uploads/profile-photos')));

module.exports = router;
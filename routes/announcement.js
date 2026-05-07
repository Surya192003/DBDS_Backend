const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/announcements';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB

// ------------------------------
// ADMIN only: CRUD announcements
// ------------------------------

router.get('/admin', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
    try {
        const query = `
      SELECT a.*, u.name as creator_name,
        COUNT(ar.id) as registrations_count
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      LEFT JOIN announcement_registrations ar ON a.id = ar.announcement_id
      GROUP BY a.id, u.name
      ORDER BY a.created_at DESC
    `;
        const result = await db.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Create announcement (with optional image upload)
router.post('/', authMiddleware, authorizeRoles('ADMIN'), upload.single('image'), async (req, res) => {
    try {
        const {
            title, description, category, media_type, media_url,
            registration_enabled, registration_type, price,
            event_date, event_start_time          // ← add
        } = req.body;

        let imageStorage = null;
        if (req.file) {
            imageStorage = `/uploads/announcements/${req.file.filename}`;
        }

        const query = `
    INSERT INTO announcements 
    (title, description, category, media_type, media_url, image_storage,
     registration_enabled, registration_type, price, created_by,
     event_date, event_start_time)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
`;
        const values = [
            title, description, category, media_type,
            media_url || (imageStorage ? imageStorage : null),
            imageStorage,
            registration_enabled === 'true' || registration_enabled === true,
            registration_type || null,
            price || null,
            req.user.id,
            event_date || null,              // ← add
            event_start_time || null         // ← add
        ];
        const result = await db.query(query, values);
        res.status(201).json({ id: result.rows[0].id, message: 'Announcement created' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Update announcement (admin only)
router.put('/:id', authMiddleware, authorizeRoles('ADMIN'), upload.single('image'), async (req, res) => {
    try {
        const id = req.params.id;
        // Fetch existing to check if image should be replaced
        const existing = await db.query('SELECT image_storage FROM announcements WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        let imageStorage = existing.rows[0].image_storage;
        if (req.file) {
            // delete old file if exists
            if (imageStorage && imageStorage.startsWith('/uploads/')) {
                const oldPath = '.' + imageStorage;
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            imageStorage = `/uploads/announcements/${req.file.filename}`;
        }

        const {
            title, description, category, media_type, media_url,
            registration_enabled, registration_type, price
        } = req.body;

        const query = `
    UPDATE announcements SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        category = COALESCE($3, category),
        media_type = COALESCE($4, media_type),
        media_url = COALESCE($5, media_url),
        image_storage = COALESCE($6, image_storage),
        registration_enabled = COALESCE($7, registration_enabled),
        registration_type = COALESCE($8, registration_type),
        price = COALESCE($9, price),
        event_date = COALESCE($10, event_date),         -- new
        event_start_time = COALESCE($11, event_start_time), -- new
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $12
    RETURNING id
`;
        const values = [
            title, description, category, media_type, media_url,
            imageStorage,
            registration_enabled === 'true' || registration_enabled === true,
            registration_type, price,
            event_date,             // add
            event_start_time,       // add
            id
        ];
        await db.query(query, values);
        res.json({ message: 'Updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Delete announcement (admin only) – also deletes registrations (CASCADE)
router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
    try {
        const id = req.params.id;
        // Delete image file if stored locally
        const imgRes = await db.query('SELECT image_storage FROM announcements WHERE id = $1', [id]);
        if (imgRes.rows.length && imgRes.rows[0].image_storage && imgRes.rows[0].image_storage.startsWith('/uploads/')) {
            const filePath = '.' + imgRes.rows[0].image_storage;
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await db.query('DELETE FROM announcements WHERE id = $1', [id]);
        res.json({ message: 'Deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------
// PUBLIC / AUTHENTICATED READ
// ------------------------------

// Get all announcements (filter by category)
// Public read (no auth required)
router.get('/', async (req, res) => {
    try {
        let userId = null;
        let isAdmin = false;
        let isAuthenticated = false;

        // Optional authentication – check token if present
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                userId = decoded.id;
                isAuthenticated = true;
                if (decoded.role === 'ADMIN') isAdmin = true;
            } catch (e) { /* ignore invalid token */ }
        }

        // Build the SELECT clause
        let selectFields = `
      a.*, u.name as creator_name,
      ${isAuthenticated
                ? 'EXISTS (SELECT 1 FROM announcement_registrations ar WHERE ar.announcement_id = a.id AND ar.user_id = $1) as user_registered'
                : 'FALSE as user_registered'}
    `;

        // Admin gets registrations count
        if (isAdmin) {
            selectFields += `,
        (SELECT COUNT(*) FROM announcement_registrations ar WHERE ar.announcement_id = a.id) as registrations_count`;
        }

        let query = `
      SELECT ${selectFields}
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
    `;

        const params = [];
        if (req.query.category) {
            query += ` WHERE a.category = $${params.length + (isAuthenticated ? 2 : 1)}`;
            params.push(req.query.category);
        }

        query += ` ORDER BY a.created_at DESC`;

        // Prepare parameters: first param is userId if authenticated, then category
        let allParams = [];
        if (isAuthenticated) allParams.push(userId);
        allParams.push(...params);

        const result = await db.query(query, allParams);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


// ------------------------------
// REGISTRATION
// ------------------------------

// Register for an announcement (STUDENT or INSTRUCTOR)
router.post('/:id/register', authMiddleware, authorizeRoles('STUDENT', 'INSTRUCTOR'), async (req, res) => {
    try {
        const announcementId = req.params.id;
        const userId = req.user.id;
        const role = req.user.role; // 'STUDENT' or 'INSTRUCTOR'

        // Check announcement exists and registration is enabled
        const ann = await db.query('SELECT registration_enabled, registration_type, price FROM announcements WHERE id = $1', [announcementId]);
        if (ann.rows.length === 0) return res.status(404).json({ error: 'Announcement not found' });
        if (!ann.rows[0].registration_enabled) {
            return res.status(400).json({ error: 'Registration not enabled for this announcement' });
        }

        // Check if already registered
        const existing = await db.query('SELECT id FROM announcement_registrations WHERE announcement_id = $1 AND user_id = $2', [announcementId, userId]);
        if (existing.rows.length) {
            return res.status(400).json({ error: 'Already registered' });
        }

        const amountPaid = ann.rows[0].registration_type === 'PAID' ? ann.rows[0].price : 0;
        // For now, if PAID, we set payment_status = 'PENDING' (future integration)
        const paymentStatus = (ann.rows[0].registration_type === 'PAID' && amountPaid > 0) ? 'PENDING' : 'COMPLETED';

        const insert = await db.query(`
            INSERT INTO announcement_registrations (announcement_id, user_id, role, payment_status, amount_paid)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [announcementId, userId, role, paymentStatus, amountPaid]);

        // TODO: If PAID, trigger payment flow (future)
        res.status(201).json({ message: 'Registered successfully', registrationId: insert.rows[0].id, paymentRequired: paymentStatus === 'PENDING' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get all registrations for an announcement (admin only)
router.get('/:id/registrations', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
    try {
        const id = req.params.id;
        const result = await db.query(`
            SELECT ar.*, u.name, u.email
            FROM announcement_registrations ar
            JOIN users u ON ar.user_id = u.id
            WHERE ar.announcement_id = $1
            ORDER BY ar.registered_at DESC
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/announcements/my-registrations – announcements the logged-in user registered for
// Keep only this block for /my-registrations
router.get('/my-registrations', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const query = `
      SELECT a.*, u.name as creator_name,
        ar.payment_status, ar.amount_paid,
        TRUE as user_registered
      FROM announcements a
      JOIN announcement_registrations ar ON a.id = ar.announcement_id
      LEFT JOIN users u ON a.created_by = u.id
      WHERE ar.user_id = $1
      ORDER BY a.created_at DESC
    `;
        const result = await db.query(query, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user.id;
        // Get user's student/instructor IDs to check role
        const userRole = req.user.role;
        let userEntityId = null;
        if (userRole === 'STUDENT') {
            const s = await db.query('SELECT id FROM students WHERE user_id = $1', [userId]);
            if (s.rows.length) userEntityId = s.rows[0].id;
        } else if (userRole === 'INSTRUCTOR') {
            const i = await db.query('SELECT id FROM instructors WHERE user_id = $1', [userId]);
            if (i.rows.length) userEntityId = i.rows[0].id;
        }

        const query = `
            SELECT a.*, u.name as creator_name,
                EXISTS (SELECT 1 FROM announcement_registrations ar WHERE ar.announcement_id = a.id AND ar.user_id = $2) as user_registered
            FROM announcements a
            LEFT JOIN users u ON a.created_by = u.id
            WHERE a.id = $1
        `;
        const result = await db.query(query, [id, userEntityId || userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
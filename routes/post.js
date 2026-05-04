const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const db = require('../config/db');

// ------------------------------
// ADMIN: CRUD posts
// ------------------------------
router.post('/', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
    try {
        const { title, description, video_url, thumbnail_url } = req.body;
        if (!video_url) return res.status(400).json({ error: 'Video URL required' });
        const result = await db.query(`
            INSERT INTO posts (title, description, video_url, thumbnail_url, created_by)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [title, description, video_url, thumbnail_url, req.user.id]);
        res.status(201).json({ id: result.rows[0].id, message: 'Post created' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
    try {
        const id = req.params.id;
        const { title, description, video_url, thumbnail_url } = req.body;
        await db.query(`
            UPDATE posts SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                video_url = COALESCE($3, video_url),
                thumbnail_url = COALESCE($4, thumbnail_url),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
        `, [title, description, video_url, thumbnail_url, id]);
        res.json({ message: 'Updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', authMiddleware, authorizeRoles('ADMIN'), async (req, res) => {
    try {
        await db.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
        res.json({ message: 'Deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------
// PUBLIC / AUTHENTICATED – get posts feed
// ------------------------------
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT p.*, u.name as author_name
            FROM posts p
            LEFT JOIN users u ON p.created_by = u.id
            ORDER BY p.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
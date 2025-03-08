
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all undefined
router.get('/', async (req, res) => {
    try {
        const undefined = await db.query('SELECT * FROM undefined');
        res.json(undefined);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET undefined by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const undefined = await db.query('SELECT * FROM undefined WHERE id = $1', [id]);
        
        if (undefined.length === 0) {
            return res.status(404).json({ error: 'undefined not found' });
        }
        
        res.json(undefined[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST new undefined
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        
        const result = await db.query('INSERT INTO undefined (name) VALUES ($1) RETURNING *', [req.body.name]);
        
        res.status(201).json(result[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update undefined
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        
        const result = await db.query('UPDATE undefined SET name = $1 WHERE id = $2 RETURNING *', [req.body.name, id]);
        
        if (result.length === 0) {
            return res.status(404).json({ error: 'undefined not found' });
        }
        
        res.json(result[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE undefined
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM undefined WHERE id = $1 RETURNING *', [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ error: 'undefined not found' });
        }
        
        res.json({ message: 'undefined deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

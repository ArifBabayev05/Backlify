const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        message: 'API routes are working',
        timestamp: new Date().toISOString(),
        resources: ['undefined', 'undefined', 'undefined']
    });
});





module.exports = router;

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabaseService = require('../services/supabaseService');

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data: user, error } = await supabaseService.supabase.auth.signUp({
            email,
            password
        });
        
        if (error) throw error;
        
        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                email: user.email
            }
        });
    } catch (error) {
        res.status(400).json({
            error: 'Registration failed',
            details: error.message
        });
    }
});

// Login user
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data: { user, session }, error } = await supabaseService.supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        // Create JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email
            },
            token
        });
    } catch (error) {
        res.status(401).json({
            error: 'Authentication failed',
            details: error.message
        });
    }
});

// Get current user
router.get('/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { data: { user }, error } = await supabaseService.supabase.auth.getUser(token);
        
        if (error) throw error;
        
        res.json({
            user: {
                id: user.id,
                email: user.email
            }
        });
    } catch (error) {
        res.status(401).json({
            error: 'Authentication failed',
            details: error.message
        });
    }
});

// Logout user
router.post('/logout', async (req, res) => {
    try {
        const { error } = await supabaseService.supabase.auth.signOut();
        
        if (error) throw error;
        
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({
            error: 'Logout failed',
            details: error.message
        });
    }
});

// Password reset request
router.post('/reset-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        const { error } = await supabaseService.supabase.auth.resetPasswordForEmail(email);
        
        if (error) throw error;
        
        res.json({
            message: 'Password reset email sent'
        });
    } catch (error) {
        res.status(400).json({
            error: 'Password reset failed',
            details: error.message
        });
    }
});

module.exports = router; 
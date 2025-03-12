const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        message: 'API is running on Netlify',
        timestamp: new Date().toISOString(),
        environment: 'netlify'
    });
});

// Root endpoint with API information
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'API generated by Backlify',
        version: '1.0.0',
        description: 'RESTful API deployed on Netlify',
        documentation: 'See the index.html page for API documentation',
        endpoints: {
            health: '/.netlify/functions/api/health',
            api: '/.netlify/functions/api'
        }
    });
});

// Import routes
const routes = require('../routes');

// Use routes
app.use('/api', routes);

// Export the serverless function
module.exports.handler = serverless(app);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { setupLogging } = require('./utils/logger');
const { swaggerDocs } = require('./utils/swagger');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const deploymentRoutes = require('./routes/deployments');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup logging
const logger = setupLogging();

// Increase the request timeout
app.timeout = 120000; // 2 minutes

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Increase JSON payload limit
app.use((req, res, next) => {
    req.logger = logger;
    
    // Add request timeout handling
    req.setTimeout(60000, () => {
        logger.warn(`Request timeout for ${req.method} ${req.url}`);
        if (!res.headersSent) {
            res.status(408).json({
                error: 'Request Timeout',
                message: 'The request took too long to process'
            });
        }
    });
    
    next();
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Documentation UI
app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/deployments', deploymentRoutes);

// Setup Swagger
swaggerDocs(app);

// Error handling middleware
app.use((err, req, res, next) => {
    // Use req.logger if available, otherwise use the global logger
    const log = req.logger || logger;
    
    // Handle specific error types
    if (err.code === 'ECONNRESET') {
        log.error(`Connection reset error: ${req.method} ${req.url}`);
        return res.status(500).json({
            error: 'Connection Reset',
            message: 'The connection was reset. Please try again.'
        });
    }
    
    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
        log.error(`Timeout error: ${req.method} ${req.url}`);
        return res.status(408).json({
            error: 'Request Timeout',
            message: 'The request took too long to process. Please try again.'
        });
    }
    
    log.error(err.stack || err.message || 'Unknown error');
    
    // Don't send error response if headers already sent
    if (res.headersSent) {
        return next(err);
    }
    
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal Server Error',
            status: err.status || 500
        }
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    // Keep the process running despite the error
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection:', reason);
    // Keep the process running despite the rejection
});

// Start server
const server = app.listen(PORT, () => {
    logger.info(`Backlify server running on port ${PORT}`);
    logger.info(`API Documentation available at http://localhost:${PORT}/docs`);
    logger.info(`Swagger API Documentation available at http://localhost:${PORT}/api-docs`);
});

// Set server timeout
server.timeout = 120000; // 2 minutes

// Handle server errors
server.on('error', (err) => {
    logger.error('Server error:', err);
});

module.exports = app; // Export for testing 
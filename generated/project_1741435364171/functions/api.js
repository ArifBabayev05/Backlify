const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Import routes
const routes = require('../routes');

// Use routes
app.use('/api', routes);

// Export the serverless function
module.exports.handler = serverless(app);

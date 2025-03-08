const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

// Get current deployment settings
router.get('/', async (req, res) => {
    try {
        // Return current environment variables (without sensitive values)
        res.json({
            deploymentPlatform: process.env.DEPLOYMENT_PLATFORM || 'netlify',
            simulateDeployment: process.env.SIMULATE_DEPLOYMENT !== 'false',
            hasNetlifyToken: !!process.env.NETLIFY_TOKEN,
            hasNetlifyTeamId: !!process.env.NETLIFY_TEAM_ID,
            hasVercelToken: !!process.env.VERCEL_TOKEN,
            hasVercelProjectId: !!process.env.PROJECT_ID
        });
    } catch (error) {
        req.logger?.error(`Error getting settings: ${error.message}`);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// Update deployment settings
router.post('/', async (req, res) => {
    try {
        const { deploymentPlatform, simulateDeployment, netlifyToken, netlifyTeamId, vercelToken, vercelProjectId } = req.body;
        
        // Create a .env file with the new settings
        const envPath = path.join(process.cwd(), '.env');
        
        // Read existing .env file if it exists
        let envContent = '';
        try {
            envContent = await fs.readFile(envPath, 'utf8');
        } catch (error) {
            // File doesn't exist, create a new one
        }
        
        // Update or add environment variables
        const envVars = {
            DEPLOYMENT_PLATFORM: deploymentPlatform || 'netlify',
            SIMULATE_DEPLOYMENT: simulateDeployment === false ? 'false' : 'true'
        };
        
        // Only add tokens if they are provided
        if (netlifyToken) {
            envVars.NETLIFY_TOKEN = netlifyToken;
        }
        
        if (netlifyTeamId) {
            envVars.NETLIFY_TEAM_ID = netlifyTeamId;
        }
        
        if (vercelToken) {
            envVars.VERCEL_TOKEN = vercelToken;
        }
        
        if (vercelProjectId) {
            envVars.PROJECT_ID = vercelProjectId;
        }
        
        // Update environment variables in the current process
        Object.entries(envVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
        
        // Create new .env content
        const newEnvContent = Object.entries(envVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        // Write to .env file
        await fs.writeFile(envPath, newEnvContent);
        
        res.json({
            message: 'Settings updated successfully',
            settings: {
                deploymentPlatform: process.env.DEPLOYMENT_PLATFORM,
                simulateDeployment: process.env.SIMULATE_DEPLOYMENT !== 'false',
                hasNetlifyToken: !!process.env.NETLIFY_TOKEN,
                hasNetlifyTeamId: !!process.env.NETLIFY_TEAM_ID,
                hasVercelToken: !!process.env.VERCEL_TOKEN,
                hasVercelProjectId: !!process.env.PROJECT_ID
            }
        });
    } catch (error) {
        req.logger?.error(`Error updating settings: ${error.message}`);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

module.exports = router; 
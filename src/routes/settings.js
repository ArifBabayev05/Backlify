const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const deploymentService = require('../services/deploymentService');

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get current settings
 *     description: Get the current deployment settings
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Current settings
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
    try {
        // Return current settings (without sensitive values)
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

/**
 * @swagger
 * /api/settings:
 *   post:
 *     summary: Update settings
 *     description: Update deployment settings
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deploymentPlatform:
 *                 type: string
 *                 enum: [netlify, vercel]
 *               simulateDeployment:
 *                 type: boolean
 *               netlifyToken:
 *                 type: string
 *               netlifyTeamId:
 *                 type: string
 *               vercelToken:
 *                 type: string
 *               vercelProjectId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Settings updated
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
    try {
        const { 
            deploymentPlatform, 
            simulateDeployment, 
            netlifyToken, 
            netlifyTeamId, 
            vercelToken, 
            vercelProjectId 
        } = req.body;
        
        // Update environment variables
        const envVars = {};
        
        if (deploymentPlatform) {
            envVars.DEPLOYMENT_PLATFORM = deploymentPlatform;
            process.env.DEPLOYMENT_PLATFORM = deploymentPlatform;
        }
        
        if (simulateDeployment !== undefined) {
            envVars.SIMULATE_DEPLOYMENT = simulateDeployment ? 'true' : 'false';
            process.env.SIMULATE_DEPLOYMENT = simulateDeployment ? 'true' : 'false';
        }
        
        if (netlifyToken) {
            envVars.NETLIFY_TOKEN = netlifyToken;
            process.env.NETLIFY_TOKEN = netlifyToken;
        }
        
        if (netlifyTeamId) {
            envVars.NETLIFY_TEAM_ID = netlifyTeamId;
            process.env.NETLIFY_TEAM_ID = netlifyTeamId;
        }
        
        if (vercelToken) {
            envVars.VERCEL_TOKEN = vercelToken;
            process.env.VERCEL_TOKEN = vercelToken;
        }
        
        if (vercelProjectId) {
            envVars.PROJECT_ID = vercelProjectId;
            process.env.PROJECT_ID = vercelProjectId;
        }
        
        // Save to .env file
        await updateEnvFile(envVars);
        
        // Update deployment service with new settings
        deploymentService.netlifyToken = process.env.NETLIFY_TOKEN;
        deploymentService.netlifyTeamId = process.env.NETLIFY_TEAM_ID;
        deploymentService.vercelToken = process.env.VERCEL_TOKEN;
        deploymentService.projectId = process.env.PROJECT_ID;
        deploymentService.deploymentPlatform = process.env.DEPLOYMENT_PLATFORM || 'netlify';
        deploymentService.simulateDeployment = process.env.SIMULATE_DEPLOYMENT !== 'false';
        
        // Check if Netlify token is valid
        let netlifyStatus = { valid: false, message: 'Netlify token not set' };
        if (process.env.NETLIFY_TOKEN) {
            netlifyStatus = await deploymentService.checkNetlifyToken();
        }
        
        res.json({
            message: 'Settings updated successfully',
            settings: {
                deploymentPlatform: process.env.DEPLOYMENT_PLATFORM || 'netlify',
                simulateDeployment: process.env.SIMULATE_DEPLOYMENT !== 'false',
                hasNetlifyToken: !!process.env.NETLIFY_TOKEN,
                hasNetlifyTeamId: !!process.env.NETLIFY_TEAM_ID,
                hasVercelToken: !!process.env.VERCEL_TOKEN,
                hasVercelProjectId: !!process.env.PROJECT_ID
            },
            netlifyStatus
        });
    } catch (error) {
        req.logger?.error(`Error updating settings: ${error.message}`);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

/**
 * @swagger
 * /api/settings/check-netlify:
 *   get:
 *     summary: Check Netlify token
 *     description: Check if the Netlify token is valid
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Netlify token status
 *       500:
 *         description: Server error
 */
router.get('/check-netlify', async (req, res) => {
    try {
        const status = await deploymentService.checkNetlifyToken();
        res.json(status);
    } catch (error) {
        req.logger?.error(`Error checking Netlify token: ${error.message}`);
        res.status(500).json({ error: 'Failed to check Netlify token' });
    }
});

// Helper function to update .env file
async function updateEnvFile(envVars) {
    try {
        const envPath = path.join(process.cwd(), '.env');
        
        // Read existing .env file if it exists
        let envContent = '';
        try {
            envContent = await fs.readFile(envPath, 'utf8');
        } catch (error) {
            // File doesn't exist, create a new one
        }
        
        // Parse existing variables
        const existingVars = {};
        envContent.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                existingVars[match[1]] = match[2];
            }
        });
        
        // Merge with new variables
        const mergedVars = { ...existingVars, ...envVars };
        
        // Create new .env content
        const newEnvContent = Object.entries(mergedVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        
        // Write to .env file
        await fs.writeFile(envPath, newEnvContent);
    } catch (error) {
        console.error('Error updating .env file:', error.message);
        throw error;
    }
}

module.exports = router; 
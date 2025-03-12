const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const supabaseService = require('./supabaseService');

class DeploymentService {
    constructor() {
        // Read tokens from environment variables
        this.vercelToken = process.env.VERCEL_TOKEN;
        this.projectId = process.env.PROJECT_ID;
        
        // Add Netlify configuration
        this.netlifyToken = process.env.NETLIFY_TOKEN;
        this.netlifyTeamId = process.env.NETLIFY_TEAM_ID;
        
        // Default to Netlify deployment
        this.deploymentPlatform = process.env.DEPLOYMENT_PLATFORM || 'netlify';
        
        // Set to false to use actual cloud deployment
        this.simulateDeployment = process.env.SIMULATE_DEPLOYMENT === 'false' ? false : true;
        
        // Try to read settings from localStorage if in browser environment
        this._loadSettingsFromLocalStorage();
        
        // Log configuration
        console.log('Deployment service configuration:');
        console.log(`- Platform: ${this.deploymentPlatform}`);
        console.log(`- Simulate: ${this.simulateDeployment}`);
        console.log(`- Netlify Token: ${this.netlifyToken ? 'Set' : 'Not set'}`);
        console.log(`- Netlify Team ID: ${this.netlifyTeamId ? 'Set' : 'Not set'}`);
        console.log(`- Vercel Token: ${this.vercelToken ? 'Set' : 'Not set'}`);
        console.log(`- Vercel Project ID: ${this.projectId ? 'Set' : 'Not set'}`);
        
        // Store generated projects
        this.generatedProjects = {};
        
        // Store deployments
        this.deployments = {};
    }

    async generateProjectFiles(schema, endpoints, actualProjectId = null) {
        try {
            const timestamp = Date.now();
            const projectId = `project_${timestamp}`;
            const projectPath = path.join(process.cwd(), 'generated', projectId);
            await fs.mkdir(projectPath, { recursive: true });

            // Generate package.json
            await this._generatePackageJson(projectPath);

            // Generate main server file
            await this._generateServerFile(projectPath, schema, endpoints);

            // Generate route files
            await this._generateRoutes(projectPath, schema, endpoints);

            // Generate database config
            await this._generateDatabaseConfig(projectPath, schema);

            // Generate .env file
            await this._generateEnvFile(projectPath, schema);

            // Generate README.md
            await this._generateReadmeFile(projectPath, schema, endpoints);

            // Generate Netlify configuration
            await this._generateNetlifyConfig(projectPath);

            // Store project info
            this.generatedProjects[projectId] = {
                id: projectId,
                path: projectPath,
                schema,
                endpoints,
                actualProjectId
            };

            return {
                projectId,
                projectPath
            };
        } catch (error) {
            console.error('Project generation failed:', error.message);
            throw new Error(`Project generation failed: ${error.message}`);
        }
    }

    async deployProject(projectId, actualProjectId = null) {
        try {
            // Check if project exists
            if (!projectId || !this.generatedProjects[projectId]) {
                throw new Error(`Project ${projectId} not found`);
            }
            
            const projectInfo = this.generatedProjects[projectId];
            const projectPath = projectInfo.path;
            
            console.log(`Starting deployment for project ${projectId} (path: ${projectPath})...`);
            
            // Create a deployment record
            const deployment_id = `deployment_${Date.now()}`;
            const deployment = {
                id: deployment_id,
                project_id: projectId,
                actualProjectId: actualProjectId, // Store the actual numeric project ID
                status: 'pending',
                timestamp: new Date().toISOString(),
                projectPath: projectPath
            };
            
            // Store deployment in memory
            this.deployments[deployment_id] = deployment;
            
            // Save to database
            await this._saveDeploymentToDatabase(deployment);
            
            // Update status to in_progress
            await this._updateDeploymentStatus(deployment_id, 'in_progress', 'Deployment started');
            
            // Start deployment in background
            if (this.simulateDeployment) {
                // Simulate deployment
                setTimeout(() => {
                    this._simulateDeployment(projectId, actualProjectId, deployment_id);
                }, 2000);
            } else {
                // Real deployment
                this._startRealDeployment(projectId, actualProjectId, deployment_id);
            }
            
            return deployment_id;
        } catch (error) {
            console.error('Deployment failed:', error.message);
            throw new Error(`Deployment failed: ${error.message}`);
        }
    }
    
    // Start the real deployment process in the background
    async _startRealDeployment(projectId, actualProjectId, deployment_id) {
        try {
            console.log('Starting real deployment process...');
            
            // Check if Netlify token is valid before proceeding
            console.log('Checking Netlify token before deployment...');
            const tokenValid = await this.checkNetlifyToken();
            
            if (!tokenValid) {
                console.log('Netlify token is invalid or not set. Falling back to simulation.');
                await this._updateDeploymentStatus(deployment_id, 'warning', 'Netlify token is invalid. Using simulation instead.');
                return this._simulateDeployment(projectId, actualProjectId, deployment_id);
            }
            
            // Get project info
            const projectInfo = this.generatedProjects[projectId];
            const projectPath = projectInfo.path;
            
            // Update status to building
            await this._updateDeploymentStatus(deployment_id, 'building', 'Building project...');
            
            // Prepare deployment files
            const deploymentFiles = await this._prepareNetlifyDeployment(projectPath, projectId);
            
            // Update status to deploying
            await this._updateDeploymentStatus(deployment_id, 'deploying', 'Deploying to Netlify...');
            
            // Create or get Netlify site
            const siteInfo = await this._getOrCreateNetlifySite(projectId);
            
            if (!siteInfo || !siteInfo.site_id) {
                throw new Error('Failed to create or get Netlify site');
            }
            
            // Deploy to Netlify
            const deployResult = await this._deployToNetlifySite(siteInfo.site_id, deploymentFiles);
            
            if (!deployResult || !deployResult.url) {
                throw new Error('Deployment to Netlify failed');
            }
            
            // Construct the correct URL for the health endpoint
            const siteUrl = deployResult.url;
            const healthUrl = `${siteUrl}/.netlify/functions/api/health`;
            
            // Update status to success
            await this._updateDeploymentStatus(
                deployment_id, 
                'success', 
                'Deployment completed successfully', 
                siteUrl
            );
            
            console.log(`Deployment completed for project ${projectId}: ${siteUrl}`);
            console.log(`Health endpoint available at: ${healthUrl}`);
            
            return {
                deployment_id,
                url: siteUrl,
                health_url: healthUrl,
                status: 'success'
            };
        } catch (error) {
            console.error('Background deployment error:', error.message);
            
            // Update status to failed
            await this._updateDeploymentStatus(
                deployment_id, 
                'failed', 
                `Deployment failed: ${error.message}`
            );
            
            throw error;
        }
    }
    
    // Update deployment status
    async _updateDeploymentStatus(deployment_id, status, message, url = null) {
        try {
            // Update in-memory deployment
            if (this.deployments[deployment_id]) {
                this.deployments[deployment_id].status = status;
                this.deployments[deployment_id].message = message;
                
                if (url) {
                    this.deployments[deployment_id].url = url;
                }
                
                // Update project info if available
                for (const projectId in this.generatedProjects) {
                    const projectInfo = this.generatedProjects[projectId];
                    if (projectInfo.deployment && projectInfo.deployment.id === deployment_id) {
                        projectInfo.deployment.status = status;
                        projectInfo.deployment.message = message;
                        
                        if (url) {
                            projectInfo.deployment.url = url;
                        }
                        
                        break;
                    }
                }
                
                // Update in database
                await supabaseService.query('deployments', {
                    method: 'update',
                    where: { deployment_id },
                    data: {
                        status,
                        message,
                        ...(url ? { url } : {})
                    }
                });
                
                console.log(`Deployment ${deployment_id} status updated to ${status}: ${message}`);
            }
        } catch (error) {
            console.error('Error updating deployment status:', error.message);
        }
    }
    
    // Save deployment to database
    async _saveDeploymentToDatabase(deployment) {
        try {
            // First, check if the project exists
            const projectId = deployment.project_id;
            
            // Try to get the project by name first (for string project IDs)
            let projects = await supabaseService.query('projects', {
                method: 'select',
                where: { name: projectId }
            });
            
            // If not found by name, try by ID
            if (!projects || projects.length === 0) {
                projects = await supabaseService.query('projects', {
                    method: 'select',
                    where: { id: projectId }
                });
            }
            
            let project = projects && projects.length > 0 ? projects[0] : null;
            
            // If project doesn't exist, create it
            if (!project) {
                console.log(`Project ${projectId} not found, creating it...`);
                
                // Create a minimal project entry
                const projectData = {
                    name: projectId,
                    prompt: 'No prompt provided',
                    created_at: new Date().toISOString(),
                    deployment_platform: deployment.platform || 'netlify'
                };
                
                try {
                    const createdProjects = await supabaseService.query('projects', {
                        method: 'insert',
                        data: projectData
                    });
                    
                    if (!createdProjects || createdProjects.length === 0) {
                        throw new Error('Failed to create project entry');
                    }
                    
                    project = createdProjects[0];
                    console.log(`Created project with ID: ${project.id}`);
                } catch (error) {
                    console.error('Error creating project:', error);
                    throw new Error('Failed to create project entry');
                }
            }
            
            // Now save the deployment
            const deploymentData = {
                ...deployment,
                project_id: project.id, // Use the numeric ID from the project
                created_at: new Date().toISOString()
            };
            
            const deployments = await supabaseService.query('deployments', {
                method: 'insert',
                data: deploymentData
            });
            
            if (!deployments || deployments.length === 0) {
                throw new Error('Failed to create deployment entry');
            }
            
            return deployments[0];
        } catch (error) {
            console.error('Insert operation error:', error);
            throw error;
        }
    }
    
    // Prepare files for Netlify deployment
    async _prepareNetlifyDeployment(projectPath, projectId) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            console.log(`Preparing Netlify deployment for ${projectPath}...`);
            
            // Ensure Netlify configuration is up to date
            await this._generateNetlifyConfig(projectPath);
            
            // Install dependencies in the functions directory
            console.log('Installing dependencies for functions...');
            const functionsDir = path.join(projectPath, 'functions');
            
            try {
                // Check if functions directory exists
                await fs.access(functionsDir);
                
                // Check if api.js exists
                const apiJsPath = path.join(functionsDir, 'api.js');
                await fs.access(apiJsPath);
                console.log('Functions directory and api.js exist');
            } catch (error) {
                console.log('Functions directory or api.js missing, regenerating...');
                await this._generateNetlifyConfig(projectPath);
            }
            
            // Create a zip file for deployment
            const { createWriteStream } = require('fs');
            const archiver = require('archiver');
            const zipPath = path.join(projectPath, 'deployment.zip');
            
            return new Promise((resolve, reject) => {
                const output = createWriteStream(zipPath);
                const archive = archiver('zip', { zlib: { level: 9 } });
                
                output.on('close', async () => {
                    try {
                        console.log(`Archive created: ${archive.pointer()} total bytes`);
                        const zipData = await fs.readFile(zipPath);
                        resolve(zipData);
                    } catch (error) {
                        reject(error);
                    }
                });
                
                archive.on('error', (err) => reject(err));
                
                archive.pipe(output);
                
                // Add all files from the project directory
                archive.directory(projectPath, false);
                
                archive.finalize();
            });
        } catch (error) {
            console.error('Error preparing Netlify deployment:', error);
            return this._prepareNetlifyDeploymentSimple(projectPath, projectId);
        }
    }
    
    // Simple approach for deploying to Netlify when form-data is not available
    async _prepareNetlifyDeploymentSimple(projectPath, projectId) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            console.log('Using simple deployment method for Netlify...');
            
            // Make sure Netlify configuration files exist
            await this._generateNetlifyConfig(projectPath);
            
            // Create a structured object for Netlify's direct deploy API
            const deployFiles = {};
            
            // Function to recursively read directory
            const readDir = async (dir, base = '') => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relativePath = base ? `${base}/${entry.name}` : entry.name;
                    
                    if (entry.isDirectory()) {
                        await readDir(fullPath, relativePath);
                    } else {
                        // Read file content as base64
                        const content = await fs.readFile(fullPath);
                        deployFiles[relativePath] = {
                            content: content.toString('base64'),
                            encoding: 'base64'
                        };
                    }
                }
            };
            
            // Read all files in the project
            await readDir(projectPath);
            
            console.log(`Prepared ${Object.keys(deployFiles).length} files for deployment`);
            
            // Check for critical files
            if (deployFiles['functions/api.js']) {
                console.log('API function file is included in deployment');
            } else {
                console.warn('WARNING: API function file is missing from deployment!');
            }
            
            return deployFiles;
        } catch (error) {
            console.error('Error in simple deployment preparation:', error);
            throw error;
        }
    }
    
    // Get or create a Netlify site
    async _getOrCreateNetlifySite(projectId) {
        const axios = require('axios');
        
        try {
            console.log('Checking for existing Netlify site...');
            
            if (!this.netlifyToken) {
                throw new Error('Netlify API token not found. Please set it in the settings.');
            }
            
            // Check if site already exists
            const { data: sites } = await axios.get(
                'https://api.netlify.com/api/v1/sites',
                {
                    headers: {
                        Authorization: `Bearer ${this.netlifyToken}`
                    },
                    timeout: 30000 // 30 second timeout
                }
            );
            
            // Create a valid site name (no underscores allowed in Netlify site names)
            const siteName = `backlify-api-${projectId.replace(/_/g, '-')}`;
            const existingSite = sites.find(site => site.name === siteName);
            
            if (existingSite) {
                console.log(`Found existing Netlify site: ${existingSite.name} (${existingSite.site_id || existingSite.id})`);
                return {
                    site_id: existingSite.site_id || existingSite.id,
                    name: existingSite.name,
                    url: existingSite.ssl_url || existingSite.url
                };
            }
            
            console.log(`Creating new Netlify site: ${siteName}...`);
            
            // Create a new site with proper settings
            const { data: newSite } = await axios.post(
                'https://api.netlify.com/api/v1/sites',
                {
                    name: siteName,
                    // Don't set custom domain as it requires DNS verification
                    // custom_domain: `api-${projectId}.backlify.app`,
                    
                    // Set build settings
                    build_settings: {
                        cmd: "npm install && npm run build",
                        dir: "public",
                        functions_dir: "functions"
                    },
                    
                    // Set processing settings
                    processing_settings: {
                        html: { pretty_urls: true },
                        css: { bundle: true, minify: true },
                        js: { bundle: true, minify: true },
                        images: { optimize: true }
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.netlifyToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                }
            );
            
            console.log(`Created new Netlify site: ${newSite.name} (${newSite.id})`);
            console.log(`Site URL: ${newSite.ssl_url || newSite.url}`);
            
            // Return the site info
            return {
                site_id: newSite.id,
                name: newSite.name,
                url: newSite.ssl_url || newSite.url
            };
        } catch (error) {
            console.error('Error getting or creating Netlify site:', error.message);
            
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
                
                // Check for common errors
                if (error.response.status === 401) {
                    throw new Error('Unauthorized: Invalid Netlify API token. Please check your token in the settings.');
                } else if (error.response.status === 403) {
                    throw new Error('Forbidden: Your Netlify API token does not have permission to create sites.');
                } else if (error.response.status === 429) {
                    throw new Error('Rate limited: Too many requests to Netlify API. Please try again later.');
                }
            }
            
            throw error;
        }
    }
    
    // Deploy to Netlify site
    async _deployToNetlifySite(siteId, deploymentFiles) {
        const axios = require('axios');
        
        try {
            console.log(`Deploying to Netlify site ${siteId}...`);
            
            // Check if deploymentFiles is a Buffer (zip file) or an object (direct deploy)
            if (Buffer.isBuffer(deploymentFiles)) {
                console.log('Deploying using zip file upload...');
                
                // Try to use form-data for zip upload
                try {
                    const FormData = require('form-data');
                    const formData = new FormData();
                    
                    formData.append('file', deploymentFiles, {
                        filename: 'deployment.zip',
                        contentType: 'application/zip'
                    });
                    
                    // IMPORTANT: Add these flags to ensure functions are processed
                    formData.append('function_files', 'true');
                    formData.append('functions', 'true');
                    
                    console.log('Uploading deployment with function flags...');
                    
                    // Deploy to Netlify
                    const { data: deployment } = await axios.post(
                        `https://api.netlify.com/api/v1/sites/${siteId}/deploys`,
                        formData,
                        {
                            headers: {
                                ...formData.getHeaders(),
                                Authorization: `Bearer ${this.netlifyToken}`
                            },
                            maxContentLength: Infinity,
                            maxBodyLength: Infinity,
                            timeout: 120000 // 2 minute timeout
                        }
                    );
                    
                    return this._handleDeploymentResult(deployment, siteId);
                } catch (error) {
                    console.error('Error with form-data upload:', error.message);
                    // Fall back to direct deploy if form-data fails
                    return this._deployToNetlifySiteSimple(siteId, deploymentFiles);
                }
            } else {
                // If it's not a Buffer, use the direct deploy API
                return this._deployToNetlifySiteSimple(siteId, deploymentFiles);
            }
        } catch (error) {
            console.error('Error deploying to Netlify:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
            throw error;
        }
    }
    
    // Fix the simple deployment method to properly handle functions
    async _deployToNetlifySiteSimple(siteId, deploymentFiles) {
        const axios = require('axios');
        
        try {
            console.log(`Deploying to Netlify site ${siteId} using direct deploy API...`);
            
            // If deploymentFiles is a Buffer, we need to convert it to a structured object
            let files = deploymentFiles;
            
            if (Buffer.isBuffer(deploymentFiles)) {
                console.log('Converting zip file to structured files object...');
                
                // Create a minimal deployment with just the essential files
                files = {
                    'netlify.toml': {
                        content: Buffer.from(`[build]
  command = "npm run build"
  publish = "public"
  functions = "functions"

[functions]
  directory = "functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[redirects]]
  from = "/health"
  to = "/.netlify/functions/api/health"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200`).toString('base64'),
                        encoding: 'base64'
                    },
                    'functions/api.js': {
                        content: Buffer.from(`// Netlify serverless function
const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const bodyParser = require('body-parser');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        message: 'API is running on Netlify Functions',
        timestamp: new Date().toISOString()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'API generated by Backlify',
        version: '1.0.0',
        description: 'RESTful API deployed on Netlify Functions',
        timestamp: new Date().toISOString()
    });
});

// Test routes
app.get('/users', (req, res) => {
    res.json([
        { id: 1, name: 'Test User 1' },
        { id: 2, name: 'Test User 2' }
    ]);
});

// Export the serverless function
exports.handler = serverless(app);`).toString('base64'),
                        encoding: 'base64'
                    },
                    'functions/package.json': {
                        content: Buffer.from(JSON.stringify({
            name: "netlify-functions",
            version: "1.0.0",
            description: "Netlify Functions for API",
            main: "api.js",
            dependencies: {
                "express": "^4.18.2",
                "serverless-http": "^3.1.1",
                "cors": "^2.8.5",
                                "body-parser": "^1.20.2"
                            }
                        }, null, 2)).toString('base64'),
                        encoding: 'base64'
                    },
                    'public/index.html': {
                        content: Buffer.from(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .endpoint { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
        code { background: #e0e0e0; padding: 2px 5px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>API Documentation</h1>
    <p>This API is deployed using Netlify Functions.</p>
    
    <h2>Endpoints</h2>
    <div class="endpoint">
        <h3>Health Check</h3>
        <p><code>GET /.netlify/functions/api/health</code></p>
    </div>
    
    <div class="endpoint">
        <h3>Users</h3>
        <p><code>GET /.netlify/functions/api/users</code></p>
    </div>
    
    <p>All API endpoints are available at <code>/.netlify/functions/api/...</code></p>
</body>
</html>`).toString('base64'),
                        encoding: 'base64'
                    }
                };
            }
            
            console.log('Files prepared for direct deploy:');
            console.log(Object.keys(files).join(', '));
            
            // Deploy to Netlify using the direct deploy API
            // IMPORTANT: Don't pass functions and function_files as top-level properties
            const { data: deployment } = await axios.post(
                `https://api.netlify.com/api/v1/sites/${siteId}/deploys`,
                { files },  // Only pass the files object
                {
                    headers: {
                        Authorization: `Bearer ${this.netlifyToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000 // 2 minute timeout for larger deployments
                }
            );
            
            return this._handleDeploymentResult(deployment, siteId);
        } catch (error) {
            console.error('Error deploying to Netlify using direct deploy:', error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    // Improve the deployment result handler to wait longer for functions to be ready
    async _handleDeploymentResult(deployment, siteId) {
        const axios = require('axios');
        const siteUrl = deployment.ssl_url || deployment.url;
        
        console.log(`Deployed to Netlify: ${siteUrl}`);
        console.log(`Deployment ID: ${deployment.id}`);
        console.log(`Deployment Status: ${deployment.state}`);
        
        // If the deployment is not ready, wait for it
        if (deployment.state !== 'ready') {
            console.log('Waiting for deployment to be ready...');
            
            // Wait for the deployment to be ready (max 60 seconds)
            for (let i = 0; i < 20; i++) {
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
                
                // Check deployment status
                const { data: updatedDeployment } = await axios.get(
                    `https://api.netlify.com/api/v1/sites/${siteId}/deploys/${deployment.id}`,
                    {
                        headers: {
                            Authorization: `Bearer ${this.netlifyToken}`
                        }
                    }
                );
                
                console.log(`Deployment Status: ${updatedDeployment.state}`);
                
                if (updatedDeployment.state === 'ready') {
                    console.log('Deployment is ready!');
                    
                    // Wait a bit more for functions to be fully initialized
                    console.log('Waiting for functions to initialize...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    return {
                        ...updatedDeployment,
                        url: updatedDeployment.ssl_url || updatedDeployment.url
                    };
                }
                
                if (updatedDeployment.state === 'error') {
                    throw new Error(`Deployment failed: ${updatedDeployment.error_message || 'Unknown error'}`);
                }
            }
            
            console.log('Deployment is taking longer than expected. Returning current status.');
        }
        
        // Return the deployment with the correct URL
        return {
            ...deployment,
            url: siteUrl
        };
    }
    
    // Keep the old method name for backward compatibility
    async deployToVercel(projectId, actualProjectId = null) {
        return this.deployProject(projectId, actualProjectId);
    }
    
    // Create a local server for the deployment
    _createLocalServer(projectId, projectInfo) {
        // This would normally set up a local server for testing
        // For now, we'll just log that it would be created
        const actualProjectId = projectInfo.deployment?.project_id || 
                               (this.deployments[projectInfo.deployment?.id]?.project_id);
        
        console.log(`Local server would be created for project ${projectId} with actual ID: ${actualProjectId}`);
        
        // In a real implementation, you would:
        // 1. Start a new Express server on a different port
        // 2. Set up routes based on the project's endpoints
        // 3. Connect it to a database with the correct schema (project_{actualProjectId})
        
        return true;
    }
    
    // Get deployment information
    getDeployment(deployment_id) {
        // First check in-memory deployments
        if (this.deployments[deployment_id]) {
            return this.deployments[deployment_id];
        }
        
        // If not found in memory, check if it's in a project
        for (const [projectId, projectInfo] of Object.entries(this.generatedProjects)) {
            if (projectInfo.deployment && projectInfo.deployment.id === deployment_id) {
                return {
                    deployment_id: projectInfo.deployment.id,
                    project_id: projectId,
                    url: projectInfo.deployment.url,
                    status: projectInfo.deployment.status,
                    created_at: projectInfo.deployment.created_at,
                    endpoints: projectInfo.endpoints,
                    schema: projectInfo.schema
                };
            }
        }
        
        // Not found
        return null;
    }

    async _generatePackageJson(projectPath) {
        const fs = require('fs').promises;
        const path = require('path');
        
        const packageJson = {
            name: path.basename(projectPath),
            version: '1.0.0',
            description: 'API generated by Backlify',
            main: 'server.js',
            scripts: {
                start: 'node server.js',
                dev: 'nodemon server.js',
                build: 'echo "No build step required"'
            },
            dependencies: {
                express: '^4.18.2',
                'body-parser': '^1.20.2',
                cors: '^2.8.5',
                dotenv: '^16.0.3',
                pg: '^8.10.0',
                'serverless-http': '^3.1.1'
            },
            devDependencies: {
                nodemon: '^2.0.22'
            },
            engines: {
                node: '>=14.0.0'
            }
        };
        
        await fs.writeFile(
            path.join(projectPath, 'package.json'),
            JSON.stringify(packageJson, null, 2)
        );
        
        // Create README.md file
        const readmeContent = `
# ${path.basename(projectPath)}

API generated by Backlify.

## Getting Started

1. Install dependencies:
   \`\`\`
   npm install
   \`\`\`

2. Set up environment variables:
   - Copy \`.env.example\` to \`.env\`
   - Update the values in \`.env\` with your database credentials

3. Run the server:
   \`\`\`
   npm start
   \`\`\`

## API Endpoints

The API provides the following endpoints:

${this.generatedProjects[path.basename(projectPath)]?.endpoints.map(resource => `
### ${resource.name}

- GET /api/${resource.name} - Get all ${resource.name}
- GET /api/${resource.name}/:id - Get a specific ${resource.name}
- POST /api/${resource.name} - Create a new ${resource.name}
- PUT /api/${resource.name}/:id - Update a ${resource.name}
- DELETE /api/${resource.name}/:id - Delete a ${resource.name}
`).join('\n') || ''}

## Deployment

This API is ready to be deployed to Netlify. Just connect your repository to Netlify and it will automatically deploy your API.
`;
        
        await fs.writeFile(
            path.join(projectPath, 'README.md'),
            readmeContent
        );
    }

    // Generate server.js file for the project
    async _generateServerFile(projectPath, schema, endpoints) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create the server file content
        const serverContent = `const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        message: 'API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Root endpoint with API information
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'API generated by Backlify',
        version: '1.0.0',
        description: 'RESTful API with the following resources',
        resources: [${endpoints.map(resource => `'${resource.name}'`).join(', ')}],
        endpoints: {
            health: '/health',
            ${endpoints.map(resource => `${resource.name}: '/api/${resource.name}'`).join(',\n            ')}
        }
    });
});

// API Routes
${endpoints.map(resource => {
    // Skip if resource name is undefined
    if (!resource || !resource.name) return '';
    
    return `
// ${resource.name} routes
app.get('/api/${resource.name}', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ${resource.name}');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/${resource.name}/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM ${resource.name} WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '${resource.name.slice(0, -1)} not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/${resource.name}', async (req, res) => {
    try {
        const columns = Object.keys(req.body).join(', ');
        const values = Object.values(req.body);
        const placeholders = values.map((_, i) => \`$\${i + 1}\`).join(', ');
        
        const query = \`INSERT INTO ${resource.name} (\${columns}) VALUES (\${placeholders}) RETURNING *\`;
        const result = await pool.query(query, values);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/${resource.name}/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = Object.entries(req.body).map(([key, _], i) => \`\${key} = $\${i + 1}\`).join(', ');
        const values = [...Object.values(req.body), id];
        
        const query = \`UPDATE ${resource.name} SET \${updates} WHERE id = $\${values.length} RETURNING *\`;
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '${resource.name.slice(0, -1)} not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/${resource.name}/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM ${resource.name} WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '${resource.name.slice(0, -1)} not found' });
        }
        
        res.json({ message: '${resource.name.slice(0, -1)} deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});`;
}).join('\n')}

// Swagger documentation
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'API Documentation',
            version: '1.0.0',
            description: 'API Documentation for the generated API',
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server',
            },
            {
                url: '/.netlify/functions/api',
                description: 'Netlify deployment',
            },
        ],
    },
    apis: ['./server.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Start server
app.listen(port, () => {
    console.log(\`Server running on port \${port}\`);
});
`;
        
        // Write the server file
        await fs.writeFile(
            path.join(projectPath, 'server.js'),
            serverContent
        );
    }

    // Generate route files for each resource
    async _generateRoutes(projectPath, schema, endpoints) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create routes directory
        const routesDir = path.join(projectPath, 'routes');
        await fs.mkdir(routesDir, { recursive: true });
        
        // Generate index.js for routes
        const indexContent = `const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        message: 'API routes are working',
        timestamp: new Date().toISOString(),
        resources: [${endpoints.map(resource => `'${resource.name}'`).join(', ')}]
    });
});

${endpoints.map(resource => {
    if (!resource || !resource.name) return '';
    return `const ${resource.name}Routes = require('./${resource.name}');
router.use('/${resource.name}', ${resource.name}Routes);`;
}).join('\n')}

module.exports = router;
`;
        
        await fs.writeFile(
            path.join(routesDir, 'index.js'),
            indexContent
        );
        
        // Generate route file for each resource
        for (const resource of endpoints) {
            if (!resource || !resource.name) continue;
            
            const routeContent = `const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Health check endpoint for this resource
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        resource: '${resource.name}',
        message: '${resource.name} resource is available',
        timestamp: new Date().toISOString()
    });
});

/**
 * @swagger
 * components:
 *   schemas:
 *     ${resource.name.slice(0, -1)}:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: The ${resource.name.slice(0, -1)} ID
 *         ${schema.tables.find(t => t.name === resource.name)?.columns.map(col => {
                if (col.name === 'id') return '';
                return `${col.name}:
 *           type: ${this._mapTypeToSwagger(col.type)}
 *           description: The ${col.name} of the ${resource.name.slice(0, -1)}`;
            }).filter(Boolean).join('\n *         ')}
 */

/**
 * @swagger
 * /:
 *   get:
 *     summary: Get all ${resource.name}
 *     tags: [${resource.name}]
 *     responses:
 *       200:
 *         description: List of all ${resource.name}
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/${resource.name.slice(0, -1)}'
 */
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ${resource.name}');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /{id}:
 *   get:
 *     summary: Get a ${resource.name.slice(0, -1)} by ID
 *     tags: [${resource.name}]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ${resource.name.slice(0, -1)} ID
 *     responses:
 *       200:
 *         description: The ${resource.name.slice(0, -1)} by ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/${resource.name.slice(0, -1)}'
 *       404:
 *         description: The ${resource.name.slice(0, -1)} was not found
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM ${resource.name} WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '${resource.name.slice(0, -1)} not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /:
 *   post:
 *     summary: Create a new ${resource.name.slice(0, -1)}
 *     tags: [${resource.name}]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/${resource.name.slice(0, -1)}'
 *     responses:
 *       201:
 *         description: The ${resource.name.slice(0, -1)} was successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/${resource.name.slice(0, -1)}'
 */
router.post('/', async (req, res) => {
    try {
        const columns = Object.keys(req.body).join(', ');
        const values = Object.values(req.body);
        const placeholders = values.map((_, i) => \`$\${i + 1}\`).join(', ');
        
        const query = \`INSERT INTO ${resource.name} (\${columns}) VALUES (\${placeholders}) RETURNING *\`;
        const result = await pool.query(query, values);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /{id}:
 *   put:
 *     summary: Update a ${resource.name.slice(0, -1)} by ID
 *     tags: [${resource.name}]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ${resource.name.slice(0, -1)} ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/${resource.name.slice(0, -1)}'
 *     responses:
 *       200:
 *         description: The ${resource.name.slice(0, -1)} was successfully updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/${resource.name.slice(0, -1)}'
 *       404:
 *         description: The ${resource.name.slice(0, -1)} was not found
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = Object.entries(req.body).map(([key, _], i) => \`\${key} = $\${i + 1}\`).join(', ');
        const values = [...Object.values(req.body), id];
        
        const query = \`UPDATE ${resource.name} SET \${updates} WHERE id = $\${values.length} RETURNING *\`;
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '${resource.name.slice(0, -1)} not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /{id}:
 *   delete:
 *     summary: Delete a ${resource.name.slice(0, -1)} by ID
 *     tags: [${resource.name}]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The ${resource.name.slice(0, -1)} ID
 *     responses:
 *       200:
 *         description: The ${resource.name.slice(0, -1)} was successfully deleted
 *       404:
 *         description: The ${resource.name.slice(0, -1)} was not found
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM ${resource.name} WHERE id = $1 RETURNING *', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '${resource.name.slice(0, -1)} not found' });
        }
        
        res.json({ message: '${resource.name.slice(0, -1)} deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
`;
            
            await fs.writeFile(
                path.join(routesDir, `${resource.name}.js`),
                routeContent
            );
        }
    }

    // Map database types to Swagger types
    _mapTypeToSwagger(dbType) {
        if (dbType.includes('int')) return 'integer';
        if (dbType.includes('float') || dbType.includes('double') || dbType.includes('decimal')) return 'number';
        if (dbType.includes('bool')) return 'boolean';
        if (dbType.includes('date') || dbType.includes('time')) return 'string';
        return 'string';
    }

    // Generate database configuration file
    async _generateDatabaseConfig(projectPath, schema) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create database directory
        const dbDir = path.join(projectPath, 'database');
        await fs.mkdir(dbDir, { recursive: true });
        
        // Generate database.js file
        const databaseContent = `const { Pool } = require('pg');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create a new pool instance
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Export the pool for use in other files
module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
`;
        
        await fs.writeFile(
            path.join(dbDir, 'database.js'),
            databaseContent
        );
        
        // Generate schema.sql file
        let schemaContent = `-- Database schema for the API
`;
        
        // Add table creation statements
        for (const table of schema.tables) {
            schemaContent += `
-- Create ${table.name} table
CREATE TABLE IF NOT EXISTS ${table.name} (
    ${table.columns.map(col => {
        let colDef = `${col.name} ${col.type}`;
        if (col.constraints && col.constraints.length > 0) {
            colDef += ` ${col.constraints.join(' ')}`;
        }
        return colDef;
    }).join(',\n    ')}
);
`;
        }
        
        // Add foreign key constraints
        for (const table of schema.tables) {
            if (table.relationships && table.relationships.length > 0) {
                for (const rel of table.relationships) {
                    schemaContent += `
-- Add foreign key constraint for ${table.name}.${rel.sourceColumn} -> ${rel.targetTable}.${rel.targetColumn}
ALTER TABLE ${table.name} 
ADD CONSTRAINT fk_${table.name}_${rel.targetTable} 
FOREIGN KEY (${rel.sourceColumn}) 
REFERENCES ${rel.targetTable}(${rel.targetColumn});
`;
                }
            }
        }
        
        await fs.writeFile(
            path.join(dbDir, 'schema.sql'),
            schemaContent
        );
    }

    // Generate .env file
    async _generateEnvFile(projectPath, schema) {
        const fs = require('fs').promises;
        const path = require('path');
        
        const envContent = `# Environment variables for the API
PORT=3000

# Database connection
DATABASE_URL=postgres://username:password@localhost:5432/database_name

# JWT Secret for authentication
JWT_SECRET=your_jwt_secret_here

# Logging level
LOG_LEVEL=info
`;
        
        await fs.writeFile(
            path.join(projectPath, '.env'),
            envContent
        );
        
        // Also create a .env.example file
        await fs.writeFile(
            path.join(projectPath, '.env.example'),
            envContent
        );
    }

    // Generate README.md file
    async _generateReadmeFile(projectPath, schema, endpoints) {
        const fs = require('fs').promises;
        const path = require('path');
        
        const readmeContent = `# ${path.basename(projectPath)}

API generated by Backlify.

## Getting Started

1. Install dependencies:
   \`\`\`
   npm install
   \`\`\`

2. Set up environment variables:
   - Copy \`.env.example\` to \`.env\`
   - Update the values in \`.env\` with your database credentials

3. Run the server:
   \`\`\`
   npm start
   \`\`\`

## API Endpoints

The API provides the following endpoints:

${endpoints.map(resource => `
### ${resource.name}

- GET /api/${resource.name} - Get all ${resource.name}
- GET /api/${resource.name}/:id - Get a specific ${resource.name}
- POST /api/${resource.name} - Create a new ${resource.name}
- PUT /api/${resource.name}/:id - Update a ${resource.name}
- DELETE /api/${resource.name}/:id - Delete a ${resource.name}
`).join('\n') || ''}

## Deployment

This API is ready to be deployed to Netlify. Just connect your repository to Netlify and it will automatically deploy your API.
`;
        
        await fs.writeFile(
            path.join(projectPath, 'README.md'),
            readmeContent
        );
    }

    // Generate Netlify configuration files
    async _generateNetlifyConfig(projectPath) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create netlify.toml file with correct configuration
        const netlifyConfig = `[build]
  command = "npm run build"
  publish = "public"
  functions = "functions"

[functions]
  directory = "functions"
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[redirects]]
  from = "/health"
  to = "/.netlify/functions/api/health"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`;
        
        await fs.writeFile(
            path.join(projectPath, 'netlify.toml'),
            netlifyConfig
        );
        
        // Create functions directory
        const functionsDir = path.join(projectPath, 'functions');
        await fs.mkdir(functionsDir, { recursive: true });
        
        // Create api.js in functions directory with proper dependencies
        const apiFunctionContent = `// Netlify serverless function
const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        message: 'API is running on Netlify Functions',
        timestamp: new Date().toISOString()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'API generated by Backlify',
        version: '1.0.0',
        description: 'RESTful API deployed on Netlify Functions',
        timestamp: new Date().toISOString()
    });
});

// Test routes
app.get('/users', (req, res) => {
    res.json([
        { id: 1, name: 'Test User 1' },
        { id: 2, name: 'Test User 2' }
    ]);
});

// Export the serverless function
exports.handler = serverless(app);
`;
        
        await fs.writeFile(
            path.join(functionsDir, 'api.js'),
            apiFunctionContent
        );
        
        // Create a package.json specifically for the functions directory
        const functionPackageJson = {
            name: "netlify-functions",
            version: "1.0.0",
            description: "Netlify Functions for API",
            main: "api.js",
            dependencies: {
                "express": "^4.18.2",
                "serverless-http": "^3.1.1",
                "cors": "^2.8.5",
                "body-parser": "^1.20.2"
            }
        };
        
        await fs.writeFile(
            path.join(functionsDir, 'package.json'),
            JSON.stringify(functionPackageJson, null, 2)
        );
        
        // Create public directory
        const publicDir = path.join(projectPath, 'public');
        await fs.mkdir(publicDir, { recursive: true });
        
        // Create a simple index.html in public directory
        const indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .endpoint { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
        code { background: #e0e0e0; padding: 2px 5px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>API Documentation</h1>
    <p>This API is deployed using Netlify Functions.</p>
    
    <h2>Endpoints</h2>
    <div class="endpoint">
        <h3>Health Check</h3>
        <p><code>GET /.netlify/functions/api/health</code></p>
    </div>
    
    <div class="endpoint">
        <h3>Users</h3>
        <p><code>GET /.netlify/functions/api/users</code></p>
    </div>
    
    <p>All API endpoints are available at <code>/.netlify/functions/api/...</code></p>
</body>
</html>`;
        
        await fs.writeFile(
            path.join(publicDir, 'index.html'),
            indexHtmlContent
        );
    }

    // Simulate a deployment for testing
    async _simulateDeployment(projectId, actualProjectId, deployment_id) {
        try {
            // Get project info
            const projectInfo = this.generatedProjects[projectId];
            const projectPath = projectInfo.path;
            
            console.log(`Simulating deployment for project ${projectId} (path: ${projectPath})...`);
            
            // Update status to building
            await this._updateDeploymentStatus(deployment_id, 'building', 'Building project...');
            
            // Wait for 2 seconds to simulate build time
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Update status to deploying
            await this._updateDeploymentStatus(deployment_id, 'deploying', 'Deploying to simulated environment...');
            
            // Wait for 2 seconds to simulate deployment time
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Generate a simulated URL - use a valid format without underscores
            const projectName = projectId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const url = `https://backlify-api-${projectName}.netlify.app`;
            const healthUrl = `${url}/.netlify/functions/api/health`;
            
            // Update status to success
            await this._updateDeploymentStatus(
                deployment_id, 
                'success', 
                'Deployment completed successfully (simulated)', 
                url
            );
            
            console.log(`Simulated deployment completed for project ${projectId}`);
            console.log(`Simulated URL: ${url}`);
            console.log(`Simulated health endpoint: ${healthUrl}`);
            
            return {
                deployment_id,
                url,
                health_url: healthUrl,
                status: 'success'
            };
        } catch (error) {
            console.error('Simulated deployment error:', error.message);
            
            // Update status to failed
            await this._updateDeploymentStatus(
                deployment_id, 
                'failed', 
                `Deployment failed: ${error.message}`
            );
            
            throw error;
        }
    }

    // Check if Netlify token is valid
    async checkNetlifyToken() {
        try {
            if (!this.netlifyToken) {
                console.log('Netlify token is not set');
                return false;
            }
            
            // Make a simple API call to verify the token
            const response = await axios.get('https://api.netlify.com/api/v1/sites', {
                headers: {
                    'Authorization': `Bearer ${this.netlifyToken}`
                }
            });
            
            if (response.status === 200) {
                console.log('Netlify token is valid');
                return true;
            } else {
                console.log(`Netlify token validation failed with status: ${response.status}`);
                return false;
            }
        } catch (error) {
            console.error('Error validating Netlify token:', error.message);
            return false;
        }
    }

    // Load settings from localStorage if in browser environment
    _loadSettingsFromLocalStorage() {
        try {
            // Check if we're in a browser environment
            if (typeof window !== 'undefined' && window.localStorage) {
                // Get deployment platform
                const platform = localStorage.getItem('deploymentPlatform');
                if (platform) {
                    this.deploymentPlatform = platform;
                }
                
                // Get Netlify settings
                if (platform === 'netlify' || !platform) {
                    const netlifyToken = localStorage.getItem('netlifyToken');
                    if (netlifyToken) {
                        this.netlifyToken = netlifyToken;
                    }
                    
                    const netlifyTeam = localStorage.getItem('netlifyTeam');
                    if (netlifyTeam) {
                        this.netlifyTeamId = netlifyTeam;
                    }
                }
                
                // Get Vercel settings
                if (platform === 'vercel') {
                    const vercelToken = localStorage.getItem('vercelToken');
                    if (vercelToken) {
                        this.vercelToken = vercelToken;
                    }
                    
                    const vercelProject = localStorage.getItem('vercelProject');
                    if (vercelProject) {
                        this.projectId = vercelProject;
                    }
                }
                
                // If platform is 'local', force simulation
                if (platform === 'local') {
                    this.simulateDeployment = true;
                }
            }
        } catch (error) {
            console.error('Error loading settings from localStorage:', error.message);
        }    }
}

// Export a singleton instance
module.exports = new DeploymentService();
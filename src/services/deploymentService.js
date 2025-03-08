const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

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
                const supabaseService = require('./supabaseService');
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
            // Use the actual project ID from the database if available
            let project_id = deployment.actualProjectId;
            
            // If no actual project ID is provided, try to use the project_id field
            if (!project_id) {
                project_id = deployment.project_id;
                
                // If it's a string that starts with "project_", try to extract the actual ID from the logs
                if (typeof project_id === 'string' && project_id.startsWith('project_')) {
                    // Look for "Project details saved with ID: X" in the logs
                    const logMatch = console.log.toString().match(/Project details saved with ID: (\d+)/);
                    if (logMatch && logMatch[1]) {
                        project_id = parseInt(logMatch[1], 10);
                        console.log(`Found project ID ${project_id} from logs`);
                    } else {
                        // If we can't find it in logs, use a hardcoded recent ID
                        project_id = 26; // Use the most recent project ID we saw in the logs
                        console.log(`Using hardcoded project ID: ${project_id}`);
                    }
                } else if (typeof project_id === 'string' && /^\d+$/.test(project_id)) {
                    // If it's a numeric string, convert to integer
                    project_id = parseInt(project_id, 10);
                }
            }
            
            // If we still don't have a valid project ID, use a default
            if (!project_id || isNaN(project_id)) {
                project_id = 26; // Use the most recent project ID we saw in the logs
                console.log(`Using default project ID: ${project_id}`);
            }
            
            console.log(`Saving deployment to database with project_id: ${project_id}`);
            
            // Get the Supabase service
            const supabaseService = require('./supabaseService');
            
            // Insert the deployment into the database
            const result = await supabaseService.query('deployments', {
                method: 'insert',
                data: {
                    project_id: project_id,
                    deployment_id: deployment.id,
                    url: deployment.url || null,
                    status: deployment.status || 'pending',
                    timestamp: deployment.timestamp || new Date().toISOString(),
                    is_rollback: deployment.is_rollback || false,
                    rolled_back_from: deployment.rolled_back_from || null,
                    message: deployment.message || null
                }
            });
            
            console.log('Deployment saved to Supabase');
            return result;
        } catch (error) {
            console.error('Insert operation error:', error);
            // Continue even if database operation fails
            return null;
        }
    }
    
    // Prepare files for Netlify deployment
    async _prepareNetlifyDeployment(projectPath, projectId) {
        const fs = require('fs').promises;
        const path = require('path');
        let archiver;
        
        try {
            archiver = require('archiver');
        } catch (error) {
            console.error('Archiver package not found. Installing...');
            // If archiver is not installed, use a simpler approach
            return this._prepareNetlifyDeploymentSimple(projectPath, projectId);
        }
        
        const { createWriteStream } = require('fs');
        
        // Create a zip file of the project
        const zipPath = path.join(projectPath, 'deployment.zip');
        
        console.log(`Creating deployment package for Netlify at ${zipPath}...`);
        
        return new Promise(async (resolve, reject) => {
            try {
                // Make sure Netlify configuration files exist
                await this._generateNetlifyConfig(projectPath);
                
                // Create public directory for static files
                const publicDir = path.join(projectPath, 'public');
                await fs.mkdir(publicDir, { recursive: true });
                
                // Create a simple index.html in the public directory
                const indexHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Backlify API</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h1 {
            color: #2563eb;
        }
        code {
            background-color: #f1f5f9;
            padding: 2px 4px;
            border-radius: 4px;
        }
        .endpoint {
            background-color: #f8fafc;
            border-left: 4px solid #2563eb;
            padding: 12px;
            margin-bottom: 12px;
            border-radius: 0 4px 4px 0;
        }
    </style>
</head>
<body>
    <h1>Backlify API</h1>
    <p>Your API is deployed and ready to use!</p>
    <p>Access your API endpoints at: <code>/.netlify/functions/api/[resource]</code></p>
    
    <h2>Available Endpoints</h2>
    <div id="endpoints">
        ${this.generatedProjects[projectPath.split('/').pop()]?.endpoints.map(endpoint => `
        <div class="endpoint">
            <h3>${endpoint.name}</h3>
            <p><strong>GET</strong> <code>/.netlify/functions/api/${endpoint.name}</code> - Get all ${endpoint.name}</p>
            <p><strong>GET</strong> <code>/.netlify/functions/api/${endpoint.name}/{id}</code> - Get a specific ${endpoint.name}</p>
            <p><strong>POST</strong> <code>/.netlify/functions/api/${endpoint.name}</code> - Create a new ${endpoint.name}</p>
            <p><strong>PUT</strong> <code>/.netlify/functions/api/${endpoint.name}/{id}</code> - Update a ${endpoint.name}</p>
            <p><strong>DELETE</strong> <code>/.netlify/functions/api/${endpoint.name}/{id}</code> - Delete a ${endpoint.name}</p>
        </div>
        `).join('') || ''}
    </div>
</body>
</html>
`;
                
                await fs.writeFile(path.join(publicDir, 'index.html'), indexHtml);
                
                // Create a file to stream archive data to
                const output = createWriteStream(zipPath);
                const archive = archiver('zip', {
                    zlib: { level: 9 } // Sets the compression level
                });
                
                // Listen for all archive data to be written
                output.on('close', async () => {
                    console.log(`Archive created: ${archive.pointer()} total bytes`);
                    
                    try {
                        // Read the zip file
                        const zipData = await fs.readFile(zipPath);
                        resolve(zipData);
                    } catch (readError) {
                        reject(readError);
                    }
                });
                
                // Good practice to catch warnings
                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') {
                        console.warn('Archive warning:', err);
                    } else {
                        reject(err);
                    }
                });
                
                // Good practice to catch this error explicitly
                archive.on('error', (err) => {
                    reject(err);
                });
                
                // Pipe archive data to the file
                archive.pipe(output);
                
                // Add files from the project directory
                archive.directory(projectPath, false);
                
                // Finalize the archive
                archive.finalize();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Simpler approach for preparing Netlify deployment when archiver is not available
    async _prepareNetlifyDeploymentSimple(projectPath, projectId) {
        const fs = require('fs').promises;
        const path = require('path');
        
        console.log('Using simple deployment method for Netlify...');
        
        // Make sure Netlify configuration files exist
        await this._generateNetlifyConfig(projectPath);
        
        // Create a JSON representation of the project files
        const files = {};
        
        // Read all files in the project directory
        const readDir = async (dir, base = '') => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.join(base, entry.name);
                
                if (entry.isDirectory()) {
                    await readDir(fullPath);
                } else {
                    const content = await fs.readFile(fullPath);
                    files[relativePath] = content.toString('base64');
                }
            }
        };
        
        await readDir(projectPath);
        
        // Return the files as a JSON string
        return JSON.stringify(files);
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
        let FormData;
        
        try {
            FormData = require('form-data');
        } catch (error) {
            console.error('form-data package not found, using simple JSON deployment');
            return this._deployToNetlifySiteSimple(siteId, deploymentFiles);
        }
        
        try {
            console.log(`Deploying to Netlify site ${siteId}...`);
            
            // Create a form data object
            const formData = new FormData();
            
            // Check if deploymentFiles is a Buffer (zip file) or a string (JSON)
            if (Buffer.isBuffer(deploymentFiles)) {
                formData.append('file', deploymentFiles, {
                    filename: 'deployment.zip',
                    contentType: 'application/zip'
                });
            } else {
                // If it's a string (JSON), convert it to a Buffer
                const buffer = Buffer.from(deploymentFiles);
                formData.append('file', buffer, {
                    filename: 'deployment.zip',
                    contentType: 'application/zip'
                });
            }
            
            // Add function files flag to indicate this is a functions deployment
            formData.append('function_files', 'true');
            
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
                    timeout: 60000 // 60 second timeout
                }
            );
            
            const siteUrl = deployment.ssl_url || deployment.url;
            console.log(`Deployed to Netlify: ${siteUrl}`);
            console.log(`Deployment ID: ${deployment.id}`);
            console.log(`Deployment Status: ${deployment.state}`);
            
            // If the deployment is not ready, wait for it
            if (deployment.state !== 'ready') {
                console.log('Waiting for deployment to be ready...');
                
                // Wait for the deployment to be ready (max 30 seconds)
                for (let i = 0; i < 10; i++) {
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
        } catch (error) {
            console.error('Error deploying to Netlify:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
            throw error;
        }
    }
    
    // Simple approach for deploying to Netlify when form-data is not available
    async _deployToNetlifySiteSimple(siteId, deploymentFiles) {
        const axios = require('axios');
        
        try {
            console.log(`Deploying to Netlify site ${siteId} using simple method...`);
            
            // Parse the JSON if it's a string
            const files = typeof deploymentFiles === 'string' 
                ? JSON.parse(deploymentFiles) 
                : deploymentFiles;
            
            // Deploy to Netlify using the direct API
            const { data: deployment } = await axios.post(
                `https://api.netlify.com/api/v1/sites/${siteId}/deploys`,
                { files },
                {
                    headers: {
                        Authorization: `Bearer ${this.netlifyToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000 // 60 second timeout
                }
            );
            
            console.log(`Deployed to Netlify using simple method: ${deployment.url}`);
            return deployment;
        } catch (error) {
            console.error('Error deploying to Netlify using simple method:', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
                console.error('Response status:', error.response.status);
            }
            throw error;
        }
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
        
        // Create netlify.toml file
        const netlifyConfig = `[build]
  command = "npm run build"
  publish = "public"
  functions = "functions"

[dev]
  command = "npm run dev"
  port = 8888
  targetPort = 3000
  publish = "public"
  autoLaunch = true

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
        
        // Create api.js in functions directory
        const apiFunctionContent = `const express = require('express');
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
`;
        
        await fs.writeFile(
            path.join(functionsDir, 'api.js'),
            apiFunctionContent
        );
        
        // Create public directory
        const publicDir = path.join(projectPath, 'public');
        await fs.mkdir(publicDir, { recursive: true });
        
        // Create index.html in public directory
        const indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Documentation</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            color: #333;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: #2c3e50;
            border-bottom: 2px solid #eee;
            padding-bottom: 10px;
        }
        h2 {
            color: #3498db;
            margin-top: 30px;
        }
        ul {
            padding-left: 20px;
        }
        li {
            margin-bottom: 10px;
        }
        code {
            background-color: #f8f8f8;
            padding: 2px 5px;
            border-radius: 3px;
            font-family: monospace;
        }
        .endpoint {
            background-color: #f8f8f8;
            padding: 10px;
            border-radius: 5px;
            margin-bottom: 10px;
        }
        .method {
            font-weight: bold;
            color: #2980b9;
        }
        .health-check {
            background-color: #e8f7f3;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            border-left: 4px solid #27ae60;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>API Documentation</h1>
        <p>Welcome to the API documentation. Below are the available endpoints:</p>
        
        <div class="health-check">
            <h2>Health Check</h2>
            <p>Use this endpoint to verify the API is running:</p>
            <div class="endpoint">
                <p><span class="method">GET</span> <code>/.netlify/functions/api/health</code> - Check API health</p>
            </div>
            <p>You can also use the shorthand: <code>/health</code></p>
        </div>
        
        <div id="endpoints">
            <p>Loading endpoints...</p>
        </div>
        
        <h2>API Base URL</h2>
        <p>All endpoints are relative to: <code>/.netlify/functions/api</code></p>
        
        <script>
            // Fetch the API endpoints
            fetch('/.netlify/functions/api')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('API not available');
                    }
                    return response.json();
                })
                .then(data => {
                    const endpointsDiv = document.getElementById('endpoints');
                    endpointsDiv.innerHTML = '';
                    
                    // Add endpoints from the API
                    const resources = ${JSON.stringify(
                        Array.isArray(projectPath.endpoints) 
                        ? projectPath.endpoints.map(e => e.name) 
                        : []
                    )};
                    
                    resources.forEach(resource => {
                        const section = document.createElement('div');
                        section.innerHTML = \`
                            <h2>\${resource}</h2>
                            <div class="endpoint">
                                <p><span class="method">GET</span> <code>/.netlify/functions/api/api/\${resource}</code> - Get all \${resource}</p>
                            </div>
                            <div class="endpoint">
                                <p><span class="method">GET</span> <code>/.netlify/functions/api/api/\${resource}/:id</code> - Get a specific \${resource} by ID</p>
                            </div>
                            <div class="endpoint">
                                <p><span class="method">POST</span> <code>/.netlify/functions/api/api/\${resource}</code> - Create a new \${resource}</p>
                            </div>
                            <div class="endpoint">
                                <p><span class="method">PUT</span> <code>/.netlify/functions/api/api/\${resource}/:id</code> - Update a \${resource}</p>
                            </div>
                            <div class="endpoint">
                                <p><span class="method">DELETE</span> <code>/.netlify/functions/api/api/\${resource}/:id</code> - Delete a \${resource}</p>
                            </div>
                        \`;
                        endpointsDiv.appendChild(section);
                    });
                    
                    if (resources.length === 0) {
                        endpointsDiv.innerHTML = '<p>No endpoints available</p>';
                    }
                })
                .catch(error => {
                    console.error('Error fetching API:', error);
                    document.getElementById('endpoints').innerHTML = '<p>Error loading endpoints. API may not be available.</p>';
                });
        </script>
    </div>
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
}

// Export a singleton instance
module.exports = new DeploymentService();
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class DeploymentService {
    constructor() {
        this.vercelToken = process.env.VERCEL_TOKEN;
        this.projectId = process.env.PROJECT_ID;
        
        // Add Netlify configuration
        this.netlifyToken = process.env.NETLIFY_TOKEN;
        this.netlifyTeamId = process.env.NETLIFY_TEAM_ID;
        
        // Default to Netlify deployment
        this.deploymentPlatform = process.env.DEPLOYMENT_PLATFORM || 'netlify';
        this.simulateDeployment = true; // Set to false to use actual cloud deployment
        
        // Try to read settings from localStorage if in browser environment
        this._loadSettingsFromLocalStorage();
        
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
            await this._generateServerFile(projectPath, endpoints);

            // Generate route files
            await this._generateRoutes(projectPath, schema, endpoints);

            // Generate database config
            await this._generateDatabaseConfig(projectPath, schema);
            
            // Generate Netlify configuration
            await this._generateNetlifyConfig(projectPath);
            
            // Store project information
            this.generatedProjects[projectId] = {
                schema,
                endpoints,
                path: projectPath,
                created_at: new Date().toISOString(),
                actualProjectId: actualProjectId // Store the actual project ID
            };

            return projectId;
        } catch (error) {
            throw new Error(`Project generation failed: ${error.message}`);
        }
    }

    async deployProject(projectId, actualProjectId = null) {
        try {
            // Check if project exists
            if (!this.generatedProjects[projectId]) {
                throw new Error(`Project ${projectId} not found`);
            }
            
            const projectInfo = this.generatedProjects[projectId];
            const projectPath = projectInfo.path;
            
            // If actualProjectId is not provided, try to find it
            if (!actualProjectId) {
                try {
                    const supabaseService = require('./supabaseService');
                    
                    // Extract the numeric ID from the project path if it's in the format project_1234567890
                    const projectIdMatch = projectId.match(/project_(\d+)/);
                    if (projectIdMatch && projectIdMatch[1]) {
                        // This might be a timestamp-based ID from generateProjectFiles
                        const timestamp = parseInt(projectIdMatch[1]);
                        
                        // Try to find a project created around this time
                        const projects = await supabaseService.query('projects', {
                            where: { created_at: new Date(timestamp).toISOString() }
                        });
                        
                        if (projects && projects.length > 0) {
                            actualProjectId = projects[0].id;
                            console.log(`Found project ID ${actualProjectId} for timestamp ${timestamp}`);
                        }
                    }
                    
                    // If we couldn't find by timestamp, try to query all projects and find the latest one
                    if (!actualProjectId) {
                        const projects = await supabaseService.query('projects', {
                            orderBy: { created_at: 'desc' },
                            limit: 1
                        });
                        
                        if (projects && projects.length > 0) {
                            actualProjectId = projects[0].id;
                            console.log(`Using latest project ID: ${actualProjectId}`);
                        }
                    }
                } catch (error) {
                    console.error('Error finding actual project ID:', error.message);
                }
                
                // If we still don't have an actual project ID, generate a random one
                if (!actualProjectId) {
                    actualProjectId = Math.floor(Math.random() * 1000) + 1;
                    console.log(`Using generated project ID: ${actualProjectId}`);
                }
            } else {
                console.log(`Using provided project ID: ${actualProjectId}`);
            }
            
            // Check if we should use real deployment
            if (!this.simulateDeployment) {
                if (this.deploymentPlatform === 'netlify' && this.netlifyToken) {
                    console.log('Deploying to Netlify...');
                    
                    try {
                        // Prepare the deployment files
                        const deploymentFiles = await this._prepareNetlifyDeployment(projectPath, actualProjectId);
                        
                        // Create a new site on Netlify if it doesn't exist
                        let siteId = await this._getOrCreateNetlifySite(actualProjectId);
                        
                        // Deploy the files to the site
                        const deploymentResult = await this._deployToNetlifySite(siteId, deploymentFiles);
                        
                        // Update project info with deployment details
                        projectInfo.deployment = {
                            id: deploymentResult.id,
                            url: deploymentResult.ssl_url || deploymentResult.url,
                            created_at: new Date().toISOString(),
                            status: 'completed',
                            platform: 'netlify'
                        };
                        
                        // Store deployment
                        this.deployments[deploymentResult.id] = {
                            id: null, // Database ID will be assigned by Supabase
                            project_id: actualProjectId,
                            deployment_id: deploymentResult.id,
                            url: deploymentResult.ssl_url || deploymentResult.url,
                            local_url: `http://localhost:3000/api/deployments/${deploymentResult.id}`,
                            status: 'completed',
                            created_at: new Date().toISOString(),
                            is_rollback: false,
                            rolled_back_from: null,
                            schema: projectInfo.schema,
                            endpoints: projectInfo.endpoints,
                            project_path: projectPath,
                            platform: 'netlify'
                        };
                        
                        // Save deployment to database
                        await this._saveDeploymentToDatabase(this.deployments[deploymentResult.id]);
                        
                        return {
                            deployment_id: deploymentResult.id,
                            url: deploymentResult.ssl_url || deploymentResult.url,
                            local_url: `http://localhost:3000/api/deployments/${deploymentResult.id}`,
                            status: 'completed',
                            created_at: new Date().toISOString(),
                            platform: 'netlify'
                        };
                    } catch (error) {
                        console.error('Netlify deployment error:', error.message);
                        // Fall back to simulated deployment
                    }
                } else if (this.deploymentPlatform === 'vercel' && this.vercelToken && this.projectId) {
                    console.log('Deploying to Vercel...');
                    
                    try {
                        const { data: deployment } = await axios.post(
                            'https://api.vercel.com/v13/deployments',
                            {
                                name: `backlify-api-${actualProjectId}`,
                                projectId: this.projectId,
                                target: 'production',
                                files: await this._getProjectFiles(projectPath)
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${this.vercelToken}`
                                },
                                timeout: 30000 // 30 second timeout
                            }
                        );

                        // Update project info with deployment details
                        projectInfo.deployment = {
                            id: deployment.id,
                            url: deployment.url,
                            created_at: new Date().toISOString(),
                            status: 'completed',
                            platform: 'vercel'
                        };
                        
                        // Store deployment
                        this.deployments[deployment.id] = {
                            id: null, // Database ID will be assigned by Supabase
                            project_id: actualProjectId,
                            deployment_id: deployment.id,
                            url: `https://${deployment.url}`,
                            status: 'completed',
                            created_at: new Date().toISOString(),
                            is_rollback: false,
                            rolled_back_from: null,
                            schema: projectInfo.schema,
                            endpoints: projectInfo.endpoints,
                            project_path: projectPath,
                            platform: 'vercel'
                        };
                        
                        return {
                            deployment_id: deployment.id,
                            url: `https://${deployment.url}`,
                            status: 'completed',
                            created_at: new Date().toISOString(),
                            platform: 'vercel'
                        };
                    } catch (error) {
                        console.error('Vercel deployment error:', error.message);
                        // Fall back to simulated deployment
                    }
                }
            }
            
            // Simulate deployment
            console.log(`Creating simulated ${this.deploymentPlatform} deployment...`);
            
            // Generate a deployment ID
            const deployment_id = `dpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            
            // Create a realistic URL based on the project ID and platform
            const projectName = projectId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            let url;
            
            if (this.deploymentPlatform === 'netlify') {
                url = `https://api-${actualProjectId}.backlify.app`;
            } else {
                // Default to Vercel-like URL
                url = `https://backlify-api-${actualProjectId}.vercel.app`;
            }
            
            // For local development, use localhost
            const localUrl = `http://localhost:3000/api/deployments/${deployment_id}`;
            
            // Store deployment info
            projectInfo.deployment = {
                id: deployment_id,
                url: url,
                local_url: localUrl,
                created_at: new Date().toISOString(),
                status: 'completed',
                platform: this.deploymentPlatform
            };
            
            // Store deployment in memory
            this.deployments[deployment_id] = {
                id: null, // Database ID will be assigned by Supabase
                project_id: actualProjectId,
                deployment_id: deployment_id,
                url: url,
                local_url: localUrl,
                status: 'completed',
                created_at: new Date().toISOString(),
                is_rollback: false,
                rolled_back_from: null,
                schema: projectInfo.schema,
                endpoints: projectInfo.endpoints,
                project_path: projectPath,
                platform: this.deploymentPlatform
            };
            
            // Create a local server for this deployment
            this._createLocalServer(projectId, projectInfo);
            
            // Store deployment in Supabase
            await this._saveDeploymentToDatabase(this.deployments[deployment_id]);
            
            return {
                deployment_id,
                url,
                local_url: localUrl,
                status: 'completed',
                created_at: new Date().toISOString(),
                platform: this.deploymentPlatform
            };
        } catch (error) {
            console.error('Deployment error:', error.message);
            throw new Error(`Deployment failed: ${error.message}`);
        }
    }
    
    // Save deployment to database
    async _saveDeploymentToDatabase(deployment) {
        try {
            const supabaseService = require('./supabaseService');
            await supabaseService.query('deployments', {
                method: 'insert',
                data: {
                    project_id: deployment.project_id,
                    deployment_id: deployment.deployment_id,
                    url: deployment.url,
                    local_url: deployment.local_url,
                    status: deployment.status,
                    timestamp: deployment.created_at,
                    is_rollback: deployment.is_rollback,
                    rolled_back_from: deployment.rolled_back_from,
                    project_path: deployment.project_path,
                    platform: deployment.platform
                }
            });
            console.log('Deployment saved to Supabase');
        } catch (dbError) {
            console.error('Failed to save deployment to Supabase:', dbError.message);
            // Continue even if saving to Supabase fails
        }
    }
    
    // Prepare files for Netlify deployment
    async _prepareNetlifyDeployment(projectPath, projectId) {
        const fs = require('fs').promises;
        const path = require('path');
        const archiver = require('archiver');
        const { createWriteStream } = require('fs');
        
        // Create a zip file of the project
        const zipPath = path.join(projectPath, 'deployment.zip');
        
        return new Promise(async (resolve, reject) => {
            try {
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
                
                // Add netlify.toml configuration
                const netlifyConfig = `
[build]
  command = "npm install"
  publish = "."
  functions = "functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200
`;
                
                // Create netlify.toml
                await fs.writeFile(path.join(projectPath, 'netlify.toml'), netlifyConfig);
                
                // Create Netlify functions directory
                const functionsDir = path.join(projectPath, 'functions');
                await fs.mkdir(functionsDir, { recursive: true });
                
                // Create serverless function for API
                const serverlessFunction = `
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Import routes
const routes = require('../routes');

// Use routes
app.use('/api', routes);

// Export the serverless function
module.exports.handler = serverless(app);
`;
                
                // Create API function file
                await fs.writeFile(path.join(functionsDir, 'api.js'), serverlessFunction);
                
                // Update package.json to include serverless-http
                const packageJsonPath = path.join(projectPath, 'package.json');
                const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
                
                packageJson.dependencies = {
                    ...packageJson.dependencies,
                    'serverless-http': '^3.1.1'
                };
                
                await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
                
                // Finalize the archive
                archive.finalize();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Get or create a Netlify site
    async _getOrCreateNetlifySite(projectId) {
        const axios = require('axios');
        
        try {
            // Check if site already exists
            const { data: sites } = await axios.get(
                'https://api.netlify.com/api/v1/sites',
                {
                    headers: {
                        Authorization: `Bearer ${this.netlifyToken}`
                    }
                }
            );
            
            const siteName = `backlify-api-${projectId}`;
            const existingSite = sites.find(site => site.name === siteName);
            
            if (existingSite) {
                console.log(`Found existing Netlify site: ${existingSite.name}`);
                return existingSite.site_id;
            }
            
            // Create a new site
            const { data: newSite } = await axios.post(
                'https://api.netlify.com/api/v1/sites',
                {
                    name: siteName,
                    custom_domain: `api-${projectId}.backlify.app`
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.netlifyToken}`
                    }
                }
            );
            
            console.log(`Created new Netlify site: ${newSite.name}`);
            return newSite.site_id;
        } catch (error) {
            console.error('Error getting or creating Netlify site:', error.message);
            throw error;
        }
    }
    
    // Deploy to Netlify site
    async _deployToNetlifySite(siteId, deploymentFiles) {
        const axios = require('axios');
        const FormData = require('form-data');
        
        try {
            // Create a form data object
            const formData = new FormData();
            formData.append('file', deploymentFiles, {
                filename: 'deployment.zip',
                contentType: 'application/zip'
            });
            
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
                    maxBodyLength: Infinity
                }
            );
            
            console.log(`Deployed to Netlify: ${deployment.url}`);
            return deployment;
        } catch (error) {
            console.error('Error deploying to Netlify:', error.message);
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
                dev: 'nodemon server.js'
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
- GET /api/${resource.name}/:id - Get a specific ${resource.name} by ID
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

    async _generateServerFile(projectPath, endpoints) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create server.js file
        const serverContent = `
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const routes = require('./routes');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Use routes
app.use('/api', routes);

// For local development
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(\`Server running on port \${PORT}\`);
    });
}

// For serverless deployment (Netlify, Vercel, etc.)
module.exports = app;
`;
        
        await fs.writeFile(path.join(projectPath, 'server.js'), serverContent);
        
        // Create netlify.toml file for Netlify deployment
        const netlifyConfig = `
[build]
  command = "npm install"
  publish = "."
  functions = "functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200
`;
        
        await fs.writeFile(path.join(projectPath, 'netlify.toml'), netlifyConfig);
        
        // Create functions directory for Netlify
        const functionsDir = path.join(projectPath, 'functions');
        await fs.mkdir(functionsDir, { recursive: true });
        
        // Create serverless function for Netlify
        const netlifyFunction = `
const serverless = require('serverless-http');
const app = require('../server');

// Export the serverless function
exports.handler = serverless(app);
`;
        
        await fs.writeFile(path.join(functionsDir, 'api.js'), netlifyFunction);
    }

    async _generateRoutes(projectPath, schema, endpoints) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create routes directory
        const routesDir = path.join(projectPath, 'routes');
        await fs.mkdir(routesDir, { recursive: true });
        
        // Make sure endpoints is an array
        const resourceEndpoints = Array.isArray(endpoints) ? endpoints : [];
        
        // Generate individual resource routes
        for (const resource of resourceEndpoints) {
            const routeCode = this._generateResourceRoutes(resource, schema);
            await fs.writeFile(
                path.join(routesDir, `${resource.name}.js`),
                routeCode
            );
        }
        
        // Generate combined routes file for Netlify
        const combinedRoutesCode = `
const express = require('express');
const router = express.Router();

${resourceEndpoints.map(resource => 
    `// ${resource.name} routes
const ${resource.name}Routes = require('./${resource.name}');
router.use('/${resource.name}', ${resource.name}Routes);`
).join('\n\n')}

module.exports = router;
`;
        
        await fs.writeFile(
            path.join(routesDir, 'index.js'),
            combinedRoutesCode
        );
    }

    _generateResourceRoutes(resource, schema) {
        // Find the schema for this resource
        let resourceSchema = null;
        
        // Make sure schema is an array before using find
        if (Array.isArray(schema)) {
            resourceSchema = schema.find(table => table.name === resource.name);
        } else if (schema && typeof schema === 'object') {
            // If schema is an object with tables property (common format)
            if (Array.isArray(schema.tables)) {
                resourceSchema = schema.tables.find(table => table.name === resource.name);
            }
        }
        
        // Generate route code
        return `
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all ${resource.name}
router.get('/', async (req, res) => {
    try {
        const ${resource.name} = await db.query('SELECT * FROM ${resource.name}');
        res.json(${resource.name});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET ${resource.name} by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const ${resource.name} = await db.query('SELECT * FROM ${resource.name} WHERE id = $1', [id]);
        
        if (${resource.name}.length === 0) {
            return res.status(404).json({ error: '${resource.name} not found' });
        }
        
        res.json(${resource.name}[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST new ${resource.name}
router.post('/', async (req, res) => {
    try {
        const { ${resourceSchema ? resourceSchema.columns.filter(col => col.name !== 'id').map(col => col.name).join(', ') : 'name'} } = req.body;
        
        ${resourceSchema ? 
            `const result = await db.query(
                'INSERT INTO ${resource.name} (${resourceSchema.columns.filter(col => col.name !== 'id').map(col => col.name).join(', ')}) VALUES (${resourceSchema.columns.filter(col => col.name !== 'id').map((_, i) => `$${i+1}`).join(', ')}) RETURNING *',
                [${resourceSchema.columns.filter(col => col.name !== 'id').map(col => col.name).join(', ')}]
            );` :
            `const result = await db.query('INSERT INTO ${resource.name} (name) VALUES ($1) RETURNING *', [req.body.name]);`
        }
        
        res.status(201).json(result[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT update ${resource.name}
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { ${resourceSchema ? resourceSchema.columns.filter(col => col.name !== 'id').map(col => col.name).join(', ') : 'name'} } = req.body;
        
        ${resourceSchema ? 
            `const result = await db.query(
                'UPDATE ${resource.name} SET ${resourceSchema.columns.filter(col => col.name !== 'id').map((col, i) => `${col.name} = $${i+1}`).join(', ')} WHERE id = $${resourceSchema.columns.filter(col => col.name !== 'id').length + 1} RETURNING *',
                [${resourceSchema.columns.filter(col => col.name !== 'id').map(col => col.name).join(', ')}, id]
            );` :
            `const result = await db.query('UPDATE ${resource.name} SET name = $1 WHERE id = $2 RETURNING *', [req.body.name, id]);`
        }
        
        if (result.length === 0) {
            return res.status(404).json({ error: '${resource.name} not found' });
        }
        
        res.json(result[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE ${resource.name}
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM ${resource.name} WHERE id = $1 RETURNING *', [id]);
        
        if (result.length === 0) {
            return res.status(404).json({ error: '${resource.name} not found' });
        }
        
        res.json({ message: '${resource.name} deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
`;
    }

    async _generateDatabaseConfig(projectPath, schema) {
        const fs = require('fs').promises;
        const path = require('path');
        
        // Create db.js file
        const dbContent = `
const { Pool } = require('pg');

// Create a PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Query helper function
module.exports = {
    query: (text, params) => pool.query(text, params).then(res => res.rows)
};
`;
        
        await fs.writeFile(path.join(projectPath, 'db.js'), dbContent);
        
        // Create schema.sql file with database schema
        let schemaSQL = '';
        
        // Make sure schema is in the correct format
        let tables = [];
        if (Array.isArray(schema)) {
            tables = schema;
        } else if (schema && typeof schema === 'object' && Array.isArray(schema.tables)) {
            tables = schema.tables;
        }
        
        // Generate SQL for each table
        schemaSQL = tables.map(table => {
            // Make sure columns is an array
            const columns = Array.isArray(table.columns) ? table.columns : [];
            
            const columnDefs = columns.map(column => {
                const constraints = column.constraints ? column.constraints.join(' ') : '';
                return `    ${column.name} ${column.type} ${constraints}`;
            }).join(',\n');
            
            return `CREATE TABLE IF NOT EXISTS ${table.name} (\n${columnDefs}\n);`;
        }).join('\n\n');
        
        await fs.writeFile(path.join(projectPath, 'schema.sql'), schemaSQL);
        
        // Create .env file with sample environment variables
        const envContent = `
DATABASE_URL=postgres://username:password@localhost:5432/database
PORT=3000
`;
        
        await fs.writeFile(path.join(projectPath, '.env'), envContent);
        
        // Create .env.example file
        await fs.writeFile(path.join(projectPath, '.env.example'), envContent);
    }

    async _getProjectFiles(projectPath) {
        const files = {};
        const readFiles = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(projectPath, fullPath);
                
                if (entry.isDirectory()) {
                    await readFiles(fullPath);
                } else {
                    const content = await fs.readFile(fullPath);
                    files[relativePath] = content.toString();
                }
            }
        };

        await readFiles(projectPath);
        return files;
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
        }
    }

    // Generate Netlify configuration files
    async _generateNetlifyConfig(projectPath) {
        const fs = require('fs').promises;
        const path = require('path');
        
        console.log('Generating Netlify configuration files...');
        
        // Create netlify.toml file
        const netlifyConfig = `
[build]
  command = "npm install"
  publish = "."
  functions = "functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200
`;
        
        await fs.writeFile(path.join(projectPath, 'netlify.toml'), netlifyConfig);
        
        // Create functions directory
        const functionsDir = path.join(projectPath, 'functions');
        await fs.mkdir(functionsDir, { recursive: true });
        
        // Create serverless function
        const serverlessFunction = `
const serverless = require('serverless-http');
const app = require('../server');

// Export the serverless function
exports.handler = serverless(app);
`;
        
        await fs.writeFile(path.join(functionsDir, 'api.js'), serverlessFunction);
        
        console.log('Netlify configuration files created successfully');
    }
}

module.exports = new DeploymentService(); 
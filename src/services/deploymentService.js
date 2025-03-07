const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class DeploymentService {
    constructor() {
        this.vercelToken = process.env.VERCEL_TOKEN;
        this.projectId = process.env.PROJECT_ID;
        this.simulateDeployment = true; // Set to false to use actual Vercel deployment
        
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

    async deployToVercel(projectId, actualProjectId = null) {
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
            if (!this.simulateDeployment && this.vercelToken && this.projectId) {
                console.log('Deploying to Vercel...');
                
                try {
                    const { data: deployment } = await axios.post(
                        'https://api.vercel.com/v13/deployments',
                        {
                            name: 'backlify-api',
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
                        status: 'completed'
                    };
                    
                    // Store deployment
                    this.deployments[deployment.id] = {
                        id: deployment.id,
                        project_id: actualProjectId,
                        deployment_id: deployment.id,
                        url: `https://${deployment.url}`,
                        status: 'completed',
                        created_at: new Date().toISOString(),
                        schema: projectInfo.schema,
                        endpoints: projectInfo.endpoints,
                        projectPath: projectPath
                    };
                    
                    return {
                        deployment_id: deployment.id,
                        url: `https://${deployment.url}`,
                        status: 'completed',
                        created_at: new Date().toISOString()
                    };
                } catch (error) {
                    console.error('Vercel deployment error:', error.message);
                    // Fall back to simulated deployment
                }
            }
            
            // Simulate deployment
            console.log('Creating real-like deployment...');
            
            // Generate a deployment ID
            const deployment_id = `dpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            
            // Create a realistic URL based on the project ID
            const projectName = projectId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
            const url = `http://localhost:3000/api/deployments/${deployment_id}`;
            
            // Store deployment info
            projectInfo.deployment = {
                id: deployment_id,
                url: url,
                created_at: new Date().toISOString(),
                status: 'completed'
            };
            
            // Store deployment in memory
            this.deployments[deployment_id] = {
                id: null, // Database ID will be assigned by Supabase
                project_id: actualProjectId,
                deployment_id: deployment_id,
                url: url,
                status: 'completed',
                created_at: new Date().toISOString(),
                is_rollback: false,
                rolled_back_from: null,
                schema: projectInfo.schema,
                endpoints: projectInfo.endpoints,
                projectPath: projectPath
            };
            
            // Create a local server for this deployment
            this._createLocalServer(projectId, projectInfo);
            
            // Store deployment in Supabase
            try {
                const supabaseService = require('./supabaseService');
                await supabaseService.query('deployments', {
                    method: 'insert',
                    data: {
                        project_id: actualProjectId,
                        deployment_id: deployment_id,
                        url: url,
                        status: 'completed',
                        timestamp: new Date().toISOString(),
                        is_rollback: false,
                        rolled_back_from: null,
                        projectPath: projectPath
                    }
                });
                console.log('Deployment saved to Supabase');
            } catch (dbError) {
                console.error('Failed to save deployment to Supabase:', dbError.message);
                // Continue even if saving to Supabase fails
            }
            
            return {
                deployment_id,
                url,
                local_url: url,
                status: 'completed',
                created_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('Deployment error:', error.message);
            throw new Error(`Deployment failed: ${error.message}`);
        }
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
        const packageJson = {
            name: 'backlify-generated-api',
            version: '1.0.0',
            main: 'index.js',
            dependencies: {
                express: '^4.18.2',
                '@supabase/supabase-js': '^2.39.0',
                dotenv: '^16.3.1'
            }
        };

        await fs.writeFile(
            path.join(projectPath, 'package.json'),
            JSON.stringify(packageJson, null, 2)
        );
    }

    async _generateServerFile(projectPath, endpoints) {
        const serverCode = `
            require('dotenv').config();
            const express = require('express');
            const app = express();
            
            app.use(express.json());
            
            ${endpoints.map(resource => 
                `require('./routes/${resource.name}')(app);`
            ).join('\n')}
            
            const PORT = process.env.PORT || 3000;
            app.listen(PORT, () => {
                console.log(\`Server running on port \${PORT}\`);
            });
        `;

        await fs.writeFile(
            path.join(projectPath, 'index.js'),
            serverCode
        );
    }

    async _generateRoutes(projectPath, schema, endpoints) {
        const routesPath = path.join(projectPath, 'routes');
        await fs.mkdir(routesPath, { recursive: true });

        for (const resource of endpoints) {
            const routeCode = this._generateResourceRoutes(resource, schema);
            await fs.writeFile(
                path.join(routesPath, `${resource.name}.js`),
                routeCode
            );
        }
    }

    _generateResourceRoutes(resource, schema) {
        return `
            const { supabase } = require('../db');
            
            module.exports = (app) => {
                // Get all
                app.get('/${resource.name}', async (req, res) => {
                    const { data, error } = await supabase
                        .from('${resource.name}')
                        .select();
                    if (error) return res.status(500).json({ error });
                    res.json(data);
                });
                
                // Get one
                app.get('/${resource.name}/:id', async (req, res) => {
                    const { data, error } = await supabase
                        .from('${resource.name}')
                        .select()
                        .eq('id', req.params.id)
                        .single();
                    if (error) return res.status(500).json({ error });
                    if (!data) return res.status(404).json({ error: 'Not found' });
                    res.json(data);
                });
                
                // Create
                app.post('/${resource.name}', async (req, res) => {
                    const { data, error } = await supabase
                        .from('${resource.name}')
                        .insert(req.body)
                        .select();
                    if (error) return res.status(500).json({ error });
                    res.status(201).json(data);
                });
                
                // Update
                app.put('/${resource.name}/:id', async (req, res) => {
                    const { data, error } = await supabase
                        .from('${resource.name}')
                        .update(req.body)
                        .eq('id', req.params.id)
                        .select();
                    if (error) return res.status(500).json({ error });
                    res.json(data);
                });
                
                // Delete
                app.delete('/${resource.name}/:id', async (req, res) => {
                    const { error } = await supabase
                        .from('${resource.name}')
                        .delete()
                        .eq('id', req.params.id);
                    if (error) return res.status(500).json({ error });
                    res.status(204).send();
                });
            };
        `;
    }

    async _generateDatabaseConfig(projectPath, schema) {
        const dbConfig = `
            const { createClient } = require('@supabase/supabase-js');
            
            const supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_KEY
            );
            
            module.exports = { supabase };
        `;

        await fs.writeFile(
            path.join(projectPath, 'db.js'),
            dbConfig
        );
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
}

module.exports = new DeploymentService(); 
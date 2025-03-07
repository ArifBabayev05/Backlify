const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const supabaseService = require('../services/supabaseService');
const deploymentService = require('../services/deploymentService');

/**
 * @swagger
 * /api/projects:
 *   post:
 *     summary: Create a new project
 *     description: Create a new backend project from a natural language prompt
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: Natural language description of the backend
 *                 example: Create a blog API with posts and comments. Posts should have a title, content, and author. Comments should have content and be linked to posts.
 *               ai_provider:
 *                 type: string
 *                 description: AI provider to use (openai or mistral)
 *                 enum: [openai, mistral]
 *                 example: mistral
 *     responses:
 *       201:
 *         description: Project created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Project created successfully
 *                 project_id:
 *                   type: integer
 *                   example: 1
 *                 processing_time:
 *                   type: string
 *                   example: 5482ms
 *                 ai_provider:
 *                   type: string
 *                   example: mistral
 *                 schema:
 *                   type: object
 *                 endpoints:
 *                   type: array
 *                 table_results:
 *                   type: array
 *                 relationship_results:
 *                   type: array
 *                 deployment:
 *                   type: object
 *                 project_path:
 *                   type: string
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();
    try {
        const { prompt, ai_provider } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        req.logger?.info(`Creating project with prompt: ${prompt.substring(0, 50)}...`);
        
        // Set the AI provider if specified
        if (ai_provider) {
            req.logger?.info(`Using AI provider: ${ai_provider}`);
            aiService.setProvider(ai_provider);
        } else {
            req.logger?.info(`Using default AI provider: ${aiService.provider}`);
        }
        
        // Interpret the prompt with AI
        req.logger?.info('Interpreting prompt with AI...');
        const schema = await aiService.interpretPrompt(prompt);
        req.logger?.info('AI interpretation complete');
        
        // Generate database schema
        req.logger?.info('Generating database schema...');
        const tables = schema.tables || [];
        req.logger?.info(`Schema generated with ${tables.length} tables`);
        
        // Generate API endpoints
        req.logger?.info('Generating API endpoints...');
        const endpoints = [];
        
        // Generate endpoints for each table
        for (const table of tables) {
            const resource = {
                resource: table.name,
                endpoints: [
                    {
                        method: 'GET',
                        path: `/${table.name}`,
                        description: `Get all ${table.name}`
                    },
                    {
                        method: 'GET',
                        path: `/${table.name}/:id`,
                        description: `Get a single ${table.name} by ID`
                    },
                    {
                        method: 'POST',
                        path: `/${table.name}`,
                        description: `Create a new ${table.name}`
                    },
                    {
                        method: 'PUT',
                        path: `/${table.name}/:id`,
                        description: `Update a ${table.name} by ID`
                    },
                    {
                        method: 'DELETE',
                        path: `/${table.name}/:id`,
                        description: `Delete a ${table.name} by ID`
                    }
                ]
            };
            
            endpoints.push(resource);
        }
        
        req.logger?.info('API endpoints generated');
        
        // Save the project details to Supabase first to get a project ID
        let projectId = null;
        try {
            req.logger?.info('Saving project details...');
            const projectData = {
                name: `Project from prompt: ${prompt.substring(0, 30)}...`,
                prompt,
                schema: JSON.stringify(schema),
                endpoints: JSON.stringify(endpoints),
                ai_provider: aiService.provider,
                created_at: new Date().toISOString()
            };
            
            const savedProjects = await supabaseService.query('projects', {
                method: 'insert',
                data: projectData
            });
            
            if (savedProjects && savedProjects.length > 0) {
                projectId = savedProjects[0].id;
                req.logger?.info(`Project details saved with ID: ${projectId}`);
            } else {
                req.logger?.warn('Project saved but no ID returned');
                // Generate a fake ID for now
                projectId = Date.now();
            }
        } catch (saveError) {
            req.logger?.error(`Project save error: ${saveError.message}`);
            // Generate a fake ID for now
            projectId = Date.now();
        }
        
        // Create database tables
        req.logger?.info('Creating database tables...');
        const tableResults = [];
        const relationshipResults = [];
        
        for (const table of tables) {
            try {
                const result = await supabaseService.createTable(table.name, table.columns, projectId);
                tableResults.push({ table: table.name, result });
                
                // Create relationships if any
                if (table.relationships && table.relationships.length > 0) {
                    for (const relationship of table.relationships) {
                        try {
                            const relResult = await supabaseService.createRelationship(
                                table.name,
                                relationship.targetTable,
                                relationship.type,
                                relationship.sourceColumn,
                                relationship.targetColumn,
                                projectId
                            );
                            relationshipResults.push({
                                source: table.name,
                                target: relationship.targetTable,
                                result: relResult
                            });
                        } catch (relError) {
                            req.logger?.error(`Relationship creation error: ${relError.message}`);
                            relationshipResults.push({
                                source: table.name,
                                target: relationship.targetTable,
                                error: relError.message
                            });
                        }
                    }
                }
            } catch (tableError) {
                req.logger?.error(`Table creation error: ${tableError.message}`);
                tableResults.push({ table: table.name, error: tableError.message });
            }
        }
        
        // Generate project files
        let projectPath = null;
        try {
            req.logger?.info('Generating project files...');
            projectPath = await deploymentService.generateProjectFiles(schema, endpoints, projectId);
            req.logger?.info('Project files generated');
        } catch (genError) {
            req.logger?.error(`Project file generation error: ${genError.message}`);
            // Continue with the response even if file generation fails
        }
        
        const processingTime = Date.now() - startTime;
        req.logger?.info(`Project creation completed in ${processingTime}ms`);
        
        // Start deployment in the background
        req.logger?.info('Starting deployment in background...');
        let deployment = null;
        
        try {
            // Pass the project ID to the deployment service
            deployment = await deploymentService.deployToVercel(projectPath, projectId);
            req.logger?.info(`Deployment completed: ${JSON.stringify(deployment)}`);
            
            // Update project with deployment info
            if (projectId) {
                try {
                    await supabaseService.query('projects', {
                        method: 'update',
                        where: { id: projectId },
                        data: {
                            deployment_id: deployment.deployment_id,
                            deployment_url: deployment.url,
                            deployment_status: deployment.status,
                            updated_at: new Date().toISOString()
                        }
                    });
                    req.logger?.info('Project updated with deployment info');
                } catch (updateError) {
                    req.logger?.error(`Failed to update project with deployment info: ${updateError.message}`);
                }
            }
        } catch (deployError) {
            req.logger?.error(`Deployment error: ${deployError.message}`);
        }
        
        res.status(201).json({
            message: 'Project created successfully',
            project_id: projectId,
            processing_time: `${processingTime}ms`,
            ai_provider: aiService.provider,
            schema,
            endpoints,
            table_results: tableResults,
            relationship_results: relationshipResults,
            deployment,
            project_path: projectPath
        });
    } catch (error) {
        const processingTime = Date.now() - startTime;
        req.logger?.error(`Project creation failed: ${error.message}`);
        res.status(500).json({
            error: 'Project creation failed',
            details: error.message,
            processing_time: `${processingTime}ms`
        });
    }
});

/**
 * @swagger
 * /api/projects/{id}:
 *   get:
 *     summary: Get project details
 *     description: Get details of a specific project by ID
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Project'
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const projects = await supabaseService.query('projects', {
            where: { id: parseInt(id) }
        });
        
        if (!projects || projects.length === 0) {
            req.logger?.warn(`Project not found: ${id}`);
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const project = projects[0];
        
        // Parse the schema and endpoints
        try {
            project.schema = typeof project.schema === 'string' ? JSON.parse(project.schema) : project.schema;
            project.endpoints = typeof project.endpoints === 'string' ? JSON.parse(project.endpoints) : project.endpoints;
        } catch (parseError) {
            req.logger?.error(`Failed to parse project data: ${parseError.message}`);
        }
        
        res.json(project);
    } catch (error) {
        req.logger?.error(`Failed to fetch project: ${error.message}`);
        res.status(500).json({
            error: 'Failed to fetch project',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/projects/{id}/api:
 *   get:
 *     summary: Get project API documentation
 *     description: Get API documentation for a specific project
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     responses:
 *       200:
 *         description: API documentation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project_id:
 *                   type: integer
 *                 project_name:
 *                   type: string
 *                 base_url:
 *                   type: string
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 *                 deployment_status:
 *                   type: string
 *                 schema:
 *                   type: object
 *                 endpoints:
 *                   type: array
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id/api', async (req, res) => {
    try {
        const { id } = req.params;
        req.logger?.info(`Fetching API documentation for project ID: ${id}`);
        
        const projects = await supabaseService.query('projects', {
            where: { id: parseInt(id) }
        });
        
        if (!projects || projects.length === 0) {
            req.logger?.warn(`Project not found: ${id}`);
            return res.status(404).json({ error: 'Project not found' });
        }
        
        const project = projects[0];
        
        // Parse the schema and endpoints from the project
        let schema = {};
        let endpoints = [];
        
        try {
            schema = typeof project.schema === 'string' ? JSON.parse(project.schema) : project.schema;
            endpoints = typeof project.endpoints === 'string' ? JSON.parse(project.endpoints) : project.endpoints;
        } catch (parseError) {
            req.logger?.error(`Failed to parse project schema/endpoints: ${parseError.message}`);
            return res.status(500).json({
                error: 'Failed to parse project data',
                details: parseError.message
            });
        }
        
        // Get the deployment URL
        let baseUrl = null;
        
        // First check if we have a deployment_url in the project
        if (project.deployment_url) {
            baseUrl = project.deployment_url;
        } 
        // Then check if we have a deployment_id
        else if (project.deployment_id) {
            baseUrl = `http://localhost:3000/api/deployments/${project.deployment_id}`;
            
            // Try to get more details from the deployment
            try {
                const deployments = await supabaseService.query('deployments', {
                    where: { deployment_id: project.deployment_id }
                });
                
                if (deployments && deployments.length > 0 && deployments[0].url) {
                    baseUrl = deployments[0].url;
                }
            } catch (deploymentError) {
                req.logger?.error(`Failed to fetch deployment details: ${deploymentError.message}`);
            }
        } 
        // Fallback to a default URL
        else {
            baseUrl = `http://localhost:3000/api/deployments/${id}`;
        }
        
        req.logger?.info(`Using base URL: ${baseUrl}`);
        
        // Generate API documentation
        const apiDocs = {
            project_id: project.id,
            project_name: project.name || `Project ${project.id}`,
            base_url: baseUrl,
            created_at: project.created_at,
            updated_at: project.updated_at,
            deployment_status: project.deployment_status || 'completed',
            schema: {
                tables: schema.tables || []
            },
            endpoints: endpoints.map(resource => ({
                resource: resource.resource,
                base_url: `${baseUrl}/${resource.resource}`,
                endpoints: resource.endpoints.map(endpoint => ({
                    method: endpoint.method,
                    path: endpoint.path,
                    full_url: `${baseUrl}${endpoint.path}`,
                    description: endpoint.description,
                    request_body: router._generateRequestBodyExample(resource.resource, schema),
                    response_example: router._generateResponseExample(resource.resource, schema)
                }))
            }))
        };
        
        req.logger?.info(`API documentation generated for project: ${id}`);
        res.json(apiDocs);
    } catch (error) {
        req.logger?.error(`Failed to fetch API documentation: ${error.message}`);
        res.status(500).json({
            error: 'Failed to fetch API documentation',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/projects/{id}:
 *   put:
 *     summary: Update project
 *     description: Update an existing project
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: Natural language description of the backend
 *               ai_provider:
 *                 type: string
 *                 description: AI provider to use (openai or mistral)
 *                 enum: [openai, mistral]
 *     responses:
 *       200:
 *         description: Project updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Project updated successfully
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:id', async (req, res) => {
    const startTime = Date.now();
    try {
        const { id } = req.params;
        const { prompt, ai_provider } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        // Check if project exists
        const projects = await supabaseService.query('projects', {
            where: { id: parseInt(id) }
        });
        
        if (!projects || projects.length === 0) {
            req.logger?.warn(`Project not found: ${id}`);
            return res.status(404).json({ error: 'Project not found' });
        }
        
        // Set the AI provider if specified
        if (ai_provider) {
            req.logger?.info(`Using AI provider: ${ai_provider}`);
            aiService.setProvider(ai_provider);
        }
        
        // Interpret the prompt with AI
        req.logger?.info('Interpreting prompt with AI...');
        const schema = await aiService.interpretPrompt(prompt);
        req.logger?.info('AI interpretation complete');
        
        // Generate database schema
        req.logger?.info('Generating database schema...');
        const tables = schema.tables || [];
        req.logger?.info(`Schema generated with ${tables.length} tables`);
        
        // Generate API endpoints
        req.logger?.info('Generating API endpoints...');
        const endpoints = [];
        
        // Generate endpoints for each table
        for (const table of tables) {
            const resource = {
                resource: table.name,
                endpoints: [
                    {
                        method: 'GET',
                        path: `/${table.name}`,
                        description: `Get all ${table.name}`
                    },
                    {
                        method: 'GET',
                        path: `/${table.name}/:id`,
                        description: `Get a single ${table.name} by ID`
                    },
                    {
                        method: 'POST',
                        path: `/${table.name}`,
                        description: `Create a new ${table.name}`
                    },
                    {
                        method: 'PUT',
                        path: `/${table.name}/:id`,
                        description: `Update a ${table.name} by ID`
                    },
                    {
                        method: 'DELETE',
                        path: `/${table.name}/:id`,
                        description: `Delete a ${table.name} by ID`
                    }
                ]
            };
            
            endpoints.push(resource);
        }
        
        req.logger?.info('API endpoints generated');
        
        // Generate project files
        let projectPath = null;
        try {
            req.logger?.info('Generating project files...');
            projectPath = await deploymentService.generateProjectFiles(schema, endpoints);
            req.logger?.info('Project files generated');
        } catch (genError) {
            req.logger?.error(`Project file generation error: ${genError.message}`);
            // Continue with the response even if file generation fails
        }
        
        // Deploy the project
        let deployment = null;
        try {
            req.logger?.info('Deploying project...');
            deployment = await deploymentService.deployToVercel(projectPath);
            req.logger?.info('Project deployed successfully');
        } catch (deployError) {
            req.logger?.error(`Deployment error: ${deployError.message}`);
            // Continue with the response even if deployment fails
        }
        
        // Update the project details in Supabase
        try {
            req.logger?.info('Updating project details...');
            await supabaseService.query('projects', {
                method: 'update',
                where: { id },
                data: {
                    prompt,
                    schema: JSON.stringify(schema),
                    endpoints: JSON.stringify(endpoints),
                    ai_provider: aiService.provider,
                    updated_at: new Date().toISOString()
                }
            });
            req.logger?.info('Project details updated');
        } catch (saveError) {
            req.logger?.error(`Project update error: ${saveError.message}`);
            // Continue with the response even if saving fails
        }
        
        const processingTime = Date.now() - startTime;
        req.logger?.info(`Project update completed in ${processingTime}ms`);
        
        res.json({
            message: 'Project updated successfully',
            processing_time: `${processingTime}ms`,
            ai_provider: aiService.provider,
            schema,
            endpoints,
            deployment,
            project_path: projectPath
        });
    } catch (error) {
        const processingTime = Date.now() - startTime;
        req.logger?.error(`Project update failed: ${error.message}`);
        res.status(500).json({
            error: 'Project update failed',
            details: error.message,
            processing_time: `${processingTime}ms`
        });
    }
});

/**
 * @swagger
 * /api/projects/{id}:
 *   delete:
 *     summary: Delete project
 *     description: Delete a project by ID
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Project deleted successfully
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if project exists
        const projects = await supabaseService.query('projects', {
            where: { id: parseInt(id) }
        });
        
        if (!projects || projects.length === 0) {
            req.logger?.warn(`Project not found: ${id}`);
            return res.status(404).json({ error: 'Project not found' });
        }
        
        // Delete the project
        await supabaseService.query('projects', {
            method: 'delete',
            where: { id }
        });
        
        res.json({
            message: 'Project deleted successfully'
        });
    } catch (error) {
        req.logger?.error(`Failed to delete project: ${error.message}`);
        res.status(500).json({
            error: 'Failed to delete project',
            details: error.message
        });
    }
});

// Helper methods for generating examples
router._generateRequestBodyExample = (resource, schema) => {
    // Find the table for this resource
    const table = schema.tables.find(t => t.name === resource);
    if (!table) return {};
    
    // Generate example data for each column
    const example = {};
    for (const column of table.columns) {
        // Skip id column for request examples
        if (column.name === 'id') continue;
        
        // Generate appropriate example values based on column type
        if (column.type.includes('varchar') || column.type.includes('text')) {
            example[column.name] = `Example ${column.name}`;
        } else if (column.type.includes('int')) {
            example[column.name] = 1;
        } else if (column.type.includes('bool')) {
            example[column.name] = true;
        } else if (column.type.includes('date')) {
            example[column.name] = new Date().toISOString();
        } else {
            example[column.name] = `Example ${column.name}`;
        }
    }
    
    return example;
};

router._generateResponseExample = (resource, schema) => {
    // Find the table for this resource
    const table = schema.tables.find(t => t.name === resource);
    if (!table) return {};
    
    // Generate example data for each column
    const example = {};
    for (const column of table.columns) {
        // Generate appropriate example values based on column type
        if (column.name === 'id') {
            example[column.name] = 1;
        } else if (column.type.includes('varchar') || column.type.includes('text')) {
            example[column.name] = `Example ${column.name}`;
        } else if (column.type.includes('int')) {
            example[column.name] = 1;
        } else if (column.type.includes('bool')) {
            example[column.name] = true;
        } else if (column.type.includes('date')) {
            example[column.name] = new Date().toISOString();
        } else {
            example[column.name] = `Example ${column.name}`;
        }
    }
    
    // Add timestamps
    example.created_at = new Date().toISOString();
    example.updated_at = new Date().toISOString();
    
    return example;
};

module.exports = router; 
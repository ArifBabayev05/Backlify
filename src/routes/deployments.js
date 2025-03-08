const express = require('express');
const router = express.Router();
const deploymentService = require('../services/deploymentService');
const supabaseService = require('../services/supabaseService');

/**
 * @swagger
 * /api/deployments/{id}:
 *   get:
 *     summary: Get deployment status
 *     description: Get the status of a deployment by ID
 *     tags: [Deployments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deployment ID
 *     responses:
 *       200:
 *         description: Deployment details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Deployment'
 *       404:
 *         description: Deployment not found
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
        req.logger?.info(`Fetching deployment with ID: ${id}`);
        
        // First try to get from deploymentService
        const deployment = deploymentService.getDeployment(id);
        
        if (deployment) {
            req.logger?.info(`Deployment found in memory: ${id}`);
            return res.json(deployment);
        }
        
        // If not found in memory, try the database
        const deployments = await supabaseService.query('deployments', {
            where: { deployment_id: id }
        });
        
        if (!deployments || deployments.length === 0) {
            req.logger?.warn(`Deployment not found: ${id}`);
            return res.status(404).json({ error: 'Deployment not found' });
        }
        
        req.logger?.info(`Deployment found in database: ${id}`);
        
        // Get the project details to include schema and endpoints
        let projectDetails = {};
        try {
            const projects = await supabaseService.query('projects', {
                where: { id: deployments[0].project_id }
            });
            
            if (projects && projects.length > 0) {
                projectDetails = {
                    schema: typeof projects[0].schema === 'string' 
                        ? JSON.parse(projects[0].schema) 
                        : projects[0].schema,
                    endpoints: typeof projects[0].endpoints === 'string' 
                        ? JSON.parse(projects[0].endpoints) 
                        : projects[0].endpoints
                };
            }
        } catch (projectError) {
            req.logger?.error(`Error fetching project details: ${projectError.message}`);
        }
        
        // Combine deployment and project details
        const fullDeployment = {
            ...deployments[0],
            ...projectDetails
        };
        
        res.json(fullDeployment);
    } catch (error) {
        req.logger?.error(`Failed to fetch deployment status: ${error.message}`);
        res.status(500).json({
            error: 'Failed to fetch deployment status',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/deployments/{id}/{path}:
 *   get:
 *     summary: Access deployed API endpoint (GET)
 *     description: Access a GET endpoint of a deployed API
 *     tags: [Deployed APIs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deployment ID
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: API path (e.g., 'posts' or 'posts/1')
 *     responses:
 *       200:
 *         description: Successful response
 *       404:
 *         description: Resource not found
 *       500:
 *         description: Server error
 *   post:
 *     summary: Access deployed API endpoint (POST)
 *     description: Access a POST endpoint of a deployed API
 *     tags: [Deployed APIs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deployment ID
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: API path (e.g., 'posts')
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Resource created
 *       400:
 *         description: Bad request
 *       404:
 *         description: Deployment not found
 *       500:
 *         description: Server error
 *   put:
 *     summary: Access deployed API endpoint (PUT)
 *     description: Access a PUT endpoint of a deployed API
 *     tags: [Deployed APIs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deployment ID
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: API path (e.g., 'posts/1')
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Resource updated
 *       400:
 *         description: Bad request
 *       404:
 *         description: Resource not found
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Access deployed API endpoint (DELETE)
 *     description: Access a DELETE endpoint of a deployed API
 *     tags: [Deployed APIs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deployment ID
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: API path (e.g., 'posts/1')
 *     responses:
 *       204:
 *         description: Resource deleted
 *       400:
 *         description: Bad request
 *       404:
 *         description: Resource not found
 *       500:
 *         description: Server error
 */
router.all('/:id/*', async (req, res) => {
    try {
        const { id } = req.params;
        const path = req.params[0] || '';
        const method = req.method.toLowerCase();
        
        req.logger?.info(`API request: ${method.toUpperCase()} /${id}/${path}`);
        
        // Get deployment info
        let deployment = deploymentService.getDeployment(id);
        
        // If not found in memory, try the database
        if (!deployment) {
            const deployments = await supabaseService.query('deployments', {
                where: { deployment_id: id }
            });
            
            if (!deployments || deployments.length === 0) {
                req.logger?.warn(`Deployment not found: ${id}`);
                return res.status(404).json({ error: 'Deployment not found' });
            }
            
            // Get the project details to include schema and endpoints
            const projects = await supabaseService.query('projects', {
                where: { id: deployments[0].project_id }
            });
            
            if (!projects || projects.length === 0) {
                req.logger?.warn(`Project not found for deployment: ${id}`);
                return res.status(404).json({ error: 'Project not found for deployment' });
            }
            
            deployment = {
                ...deployments[0],
                schema: typeof projects[0].schema === 'string' 
                    ? JSON.parse(projects[0].schema) 
                    : projects[0].schema,
                endpoints: typeof projects[0].endpoints === 'string' 
                    ? JSON.parse(projects[0].endpoints) 
                    : projects[0].endpoints,
                project_id: projects[0].id
            };
            
            // Store in memory for future requests
            deploymentService.deployments[id] = deployment;
        }
        
        // Parse the path to determine the resource and ID
        const pathParts = path.split('/').filter(Boolean);
        if (pathParts.length === 0) {
            return res.json({
                message: 'Backlify API',
                deployment: {
                    id: deployment.deployment_id,
                    status: deployment.status,
                    timestamp: deployment.timestamp
                },
                endpoints: (deployment.endpoints || []).map(e => ({
                    resource: e.resource,
                    basePath: `/${id}/${e.resource}`
                }))
            });
        }
        
        const resourceName = pathParts[0];
        const resourceId = pathParts[1];
        
        // Find the resource in the deployment
        const resource = (deployment.endpoints || []).find(e => e.resource === resourceName);
        if (!resource) {
            req.logger?.warn(`Resource not found: ${resourceName}`);
            return res.status(404).json({ error: `Resource '${resourceName}' not found` });
        }
        
        // Find the table in the schema
        const table = (deployment.schema?.tables || []).find(t => t.name === resourceName);
        if (!table) {
            req.logger?.warn(`Table not found: ${resourceName}`);
            return res.status(404).json({ error: `Table '${resourceName}' not found` });
        }
        
        // Get the project ID for this deployment
        const projectId = deployment.project_id;
        
        // Handle the request based on method and path
        switch (method) {
            case 'get':
                if (resourceId) {
                    // Get single resource
                    const records = await supabaseService.query(resourceName, {
                        where: { id: parseInt(resourceId) }
                    }, projectId);
                    
                    if (!records || records.length === 0) {
                        return res.status(404).json({ error: `${resourceName} with ID ${resourceId} not found` });
                    }
                    
                    return res.json(records[0]);
                } else {
                    // Get all resources
                    const records = await supabaseService.query(resourceName, {}, projectId);
                    return res.json(records);
                }
            
            case 'post':
                // Create new resource
                if (resourceId) {
                    return res.status(400).json({ error: 'POST requests should not include an ID in the URL' });
                }
                
                // Validate required fields
                const requiredColumns = table.columns.filter(c => 
                    c.constraints && c.constraints.includes('not null') && c.name !== 'id'
                );
                
                for (const column of requiredColumns) {
                    if (req.body[column.name] === undefined) {
                        return res.status(400).json({ 
                            error: `Missing required field: ${column.name}` 
                        });
                    }
                }
                
                // Create new record
                const newRecords = await supabaseService.query(resourceName, {
                    method: 'insert',
                    data: req.body
                }, projectId);
                
                if (!newRecords || newRecords.length === 0) {
                    return res.status(500).json({ error: 'Failed to create record' });
                }
                
                return res.status(201).json(newRecords[0]);
            
            case 'put':
                // Update resource
                if (!resourceId) {
                    return res.status(400).json({ error: 'PUT requests require an ID in the URL' });
                }
                
                // Check if record exists
                const existingRecords = await supabaseService.query(resourceName, {
                    where: { id: parseInt(resourceId) }
                }, projectId);
                
                if (!existingRecords || existingRecords.length === 0) {
                    return res.status(404).json({ error: `${resourceName} with ID ${resourceId} not found` });
                }
                
                // Update the record
                const updatedRecords = await supabaseService.query(resourceName, {
                    method: 'update',
                    where: { id: parseInt(resourceId) },
                    data: {
                        ...req.body,
                        updated_at: new Date().toISOString()
                    }
                }, projectId);
                
                if (!updatedRecords || updatedRecords.length === 0) {
                    return res.status(500).json({ error: 'Failed to update record' });
                }
                
                return res.json(updatedRecords[0]);
            
            case 'delete':
                // Delete resource
                if (!resourceId) {
                    return res.status(400).json({ error: 'DELETE requests require an ID in the URL' });
                }
                
                // Check if record exists
                const recordsToDelete = await supabaseService.query(resourceName, {
                    where: { id: parseInt(resourceId) }
                }, projectId);
                
                if (!recordsToDelete || recordsToDelete.length === 0) {
                    return res.status(404).json({ error: `${resourceName} with ID ${resourceId} not found` });
                }
                
                // Delete the record
                await supabaseService.query(resourceName, {
                    method: 'delete',
                    where: { id: parseInt(resourceId) }
                }, projectId);
                
                return res.status(204).send();
            
            default:
                return res.status(405).json({ error: `Method ${method.toUpperCase()} not allowed` });
        }
    } catch (error) {
        req.logger?.error(`API request error: ${error.message}`);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/deployments:
 *   post:
 *     summary: Trigger new deployment
 *     description: Trigger a new deployment for a project
 *     tags: [Deployments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project_id
 *               - schema
 *               - endpoints
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *               schema:
 *                 type: object
 *                 description: Database schema
 *               endpoints:
 *                 type: array
 *                 description: API endpoints
 *     responses:
 *       201:
 *         description: Deployment triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Deployment triggered successfully
 *                 deployment:
 *                   $ref: '#/components/schemas/Deployment'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', async (req, res) => {
    try {
        const { project_id, schema, endpoints } = req.body;
        
        // Generate project files
        const projectPath = await deploymentService.generateProjectFiles(schema, endpoints);
        
        // Deploy to Vercel
        const deployment = await deploymentService.deployToVercel(projectPath);
        
        // Save deployment details
        await supabaseService.query('deployments', {
            method: 'insert',
            data: {
                project_id,
                deployment_id: deployment.deployment_id,
                url: deployment.url,
                status: 'completed',
                timestamp: new Date().toISOString(),
                is_rollback: false,
                rolled_back_from: null
            }
        });
        
        res.status(201).json({
            message: 'Deployment triggered successfully',
            deployment
        });
    } catch (error) {
        res.status(500).json({
            error: 'Deployment failed',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/deployments/project/{projectId}:
 *   get:
 *     summary: List deployments for a project
 *     description: Get a list of all deployments for a specific project
 *     tags: [Deployments]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     responses:
 *       200:
 *         description: List of deployments
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Deployment'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/project/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const deployments = await supabaseService.query('deployments', {
            where: { project_id: parseInt(projectId) },
            orderBy: { timestamp: 'desc' }
        });
        
        res.json(deployments);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch deployments',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/deployments/{id}/rollback:
 *   post:
 *     summary: Rollback deployment
 *     description: Rollback to a previous deployment
 *     tags: [Deployments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Deployment ID to rollback from
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project_id
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: Project ID
 *     responses:
 *       200:
 *         description: Rollback successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Rollback successful
 *                 deployment:
 *                   $ref: '#/components/schemas/Deployment'
 *       400:
 *         description: No previous deployment available
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
router.post('/:id/rollback', async (req, res) => {
    try {
        const { id } = req.params;
        const { project_id } = req.body;
        
        // Get previous successful deployment
        const previousDeployments = await supabaseService.query('deployments', {
            where: { 
                project_id,
                status: 'completed'
            },
            orderBy: { timestamp: 'desc' },
            limit: 2
        });
        
        if (previousDeployments.length < 2) {
            return res.status(400).json({
                error: 'No previous deployment available for rollback'
            });
        }
        
        const previousDeployment = previousDeployments[1];
        
        // Redeploy the previous version
        const deployment = await deploymentService.deployProject(previousDeployment.project_path, project_id);
        
        // Save rollback deployment
        await supabaseService.query('deployments', {
            method: 'insert',
            data: {
                project_id,
                deployment_id: deployment.deployment_id,
                url: deployment.url,
                local_url: deployment.local_url,
                status: 'completed',
                timestamp: new Date().toISOString(),
                is_rollback: true,
                rolled_back_from: id,
                platform: deployment.platform
            }
        });
        
        res.json({
            message: 'Rollback successful',
            deployment
        });
    } catch (error) {
        res.status(500).json({
            error: 'Rollback failed',
            details: error.message
        });
    }
});

module.exports = router; 
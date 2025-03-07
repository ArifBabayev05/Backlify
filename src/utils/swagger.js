const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Swagger definition
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Backlify API',
      version: '1.0.0',
      description: 'API documentation for Backlify - AI-powered backend generator',
      contact: {
        name: 'Backlify Support',
        url: 'https://backlify.com',
        email: 'support@backlify.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        Project: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Project ID'
            },
            name: {
              type: 'string',
              description: 'Project name'
            },
            prompt: {
              type: 'string',
              description: 'The prompt used to generate the project'
            },
            schema: {
              type: 'object',
              description: 'Database schema'
            },
            endpoints: {
              type: 'array',
              description: 'API endpoints'
            },
            ai_provider: {
              type: 'string',
              description: 'AI provider used (openai or mistral)'
            },
            deployment_id: {
              type: 'string',
              description: 'Deployment ID'
            },
            deployment_url: {
              type: 'string',
              description: 'Deployment URL'
            },
            deployment_status: {
              type: 'string',
              description: 'Deployment status'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            updated_at: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp'
            }
          }
        },
        Deployment: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Database ID'
            },
            project_id: {
              type: 'integer',
              description: 'Project ID'
            },
            deployment_id: {
              type: 'string',
              description: 'Deployment ID'
            },
            url: {
              type: 'string',
              description: 'Deployment URL'
            },
            status: {
              type: 'string',
              description: 'Deployment status'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Deployment timestamp'
            },
            is_rollback: {
              type: 'boolean',
              description: 'Whether this is a rollback deployment'
            },
            rolled_back_from: {
              type: 'string',
              description: 'ID of the deployment this was rolled back from'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            details: {
              type: 'string',
              description: 'Detailed error information'
            }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.js'], // Path to the API routes
};

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Function to setup our docs
const swaggerDocs = (app) => {
  // Route for swagger docs
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  
  // Route to get swagger.json
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
  
  console.log(`Swagger docs available at http://localhost:3000/api-docs`);
};

module.exports = { swaggerDocs }; 
const OpenAI = require('openai');
const mistralService = require('./mistralService');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Helper function to add timeout to promises
const withTimeout = (promise, timeoutMs = 30000) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => {
        clearTimeout(timeoutId);
    });
};

class AIService {
    constructor() {
        this.provider = process.env.AI_PROVIDER || 'mistral'; // Default to OpenAI if not specified
        this.timeout = 30000; // 30 seconds timeout
    }

    async interpretPrompt(prompt) {
        try {
            // Use the appropriate AI provider
            if (this.provider === 'mistral') {
                try {
                    return await withTimeout(
                        mistralService.interpretPrompt(prompt),
                        this.timeout
                    );
                } catch (mistralError) {
                    console.error('Mistral AI error:', mistralError);
                    // If Mistral fails, use the fallback schema
                    console.log('Mistral AI failed. Using fallback schema.');
                    return this._getFallbackSchema(prompt);
                }
            } else {
                // Default to OpenAI
                try {
                    const completion = await withTimeout(
                        openai.chat.completions.create({
                            model: "gpt-4",
                            messages: [
                                {
                                    role: "system",
                                    content: "You are a backend architect that converts natural language descriptions into database schemas and API endpoints. Output should be in JSON format."
                                },
                                {
                                    role: "user",
                                    content: `Generate a database schema and API endpoints for: ${prompt}`
                                }
                            ],
                            response_format: { type: "json_object" }
                        }),
                        this.timeout
                    );

                    return JSON.parse(completion.choices[0].message.content);
                } catch (openaiError) {
                    console.error('OpenAI error:', openaiError);
                    // If OpenAI fails, use the fallback schema
                    console.log('OpenAI failed. Using fallback schema.');
                    return this._getFallbackSchema(prompt);
                }
            }
        } catch (error) {
            console.error('AI interpretation error:', error);
            
            // Provide a fallback response for demo purposes
            if (error.message.includes('timed out') || error.message.includes('parse')) {
                console.log('AI request failed. Using fallback schema.');
                return this._getFallbackSchema(prompt);
            }
            
            throw new Error(`AI interpretation failed: ${error.message}`);
        }
    }

    // Set the AI provider dynamically
    setProvider(provider) {
        if (provider !== 'openai' && provider !== 'mistral') {
            throw new Error(`Unsupported AI provider: ${provider}`);
        }
        this.provider = provider;
    }

    // Set timeout value
    setTimeout(timeoutMs) {
        this.timeout = timeoutMs;
    }

    generateDatabaseSchema(aiResponse) {
        try {
            // Convert AI response into Supabase schema
            const schema = {
                tables: aiResponse.tables.map(table => ({
                    name: table.name,
                    columns: table.columns.map(column => ({
                        name: column.name,
                        type: this._mapDataType(column.type),
                        constraints: column.constraints || []
                    })),
                    relationships: table.relationships || []
                }))
            };

            return schema;
        } catch (error) {
            console.error('Schema generation error:', error);
            throw new Error(`Schema generation failed: ${error.message}`);
        }
    }

    generateAPIEndpoints(aiResponse) {
        try {
            // Generate REST API endpoints based on schema
            return aiResponse.tables.map(table => ({
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
                        description: `Get single ${table.name} by ID`
                    },
                    {
                        method: 'POST',
                        path: `/${table.name}`,
                        description: `Create new ${table.name}`
                    },
                    {
                        method: 'PUT',
                        path: `/${table.name}/:id`,
                        description: `Update ${table.name} by ID`
                    },
                    {
                        method: 'DELETE',
                        path: `/${table.name}/:id`,
                        description: `Delete ${table.name} by ID`
                    }
                ]
            }));
        } catch (error) {
            console.error('API endpoint generation error:', error);
            throw new Error(`API endpoint generation failed: ${error.message}`);
        }
    }

    _mapDataType(type) {
        // Map common data types to Supabase supported types
        const typeMap = {
            'string': 'text',
            'number': 'numeric',
            'integer': 'integer',
            'boolean': 'boolean',
            'date': 'timestamp',
            'datetime': 'timestamp with time zone',
            'json': 'jsonb',
            'varchar': 'text',
            'varchar(255)': 'text',
            'text': 'text',
            'timestamp': 'text'
        };

        return typeMap[type.toLowerCase()] || 'text';
    }

    // Fallback schema for when AI services fail
    _getFallbackSchema(prompt) {
        console.log('Using fallback schema for prompt:', prompt);
        
        // Extract potential entity names from the prompt
        const words = prompt.toLowerCase().split(/\s+/);
        const commonWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'create', 'make', 'build', 'api', 'app', 'application', 'backend', 'database', 'system']);
        
        // Find potential entity names (nouns that aren't common words)
        const potentialEntities = words
            .filter(word => word.length > 3 && !commonWords.has(word))
            .map(word => word.replace(/[^a-z]/g, ''))
            .filter(word => word.length > 3);
        
        // Use the first two unique entities or default to generic ones
        const uniqueEntities = [...new Set(potentialEntities)];
        const entityNames = uniqueEntities.length >= 2 
            ? [uniqueEntities[0], uniqueEntities[1]] 
            : ['items', 'categories'];
        
        // Create a simple two-table schema
        return {
            tables: [
                {
                    name: entityNames[0],
                    columns: [
                        { name: 'id', type: 'integer', constraints: ['primary key', 'auto_increment'] },
                        { name: 'name', type: 'string', constraints: ['not null'] },
                        { name: 'description', type: 'string', constraints: [] },
                        { name: 'created_at', type: 'datetime', constraints: ['default current_timestamp'] }
                    ],
                    relationships: [
                        {
                            targetTable: entityNames[1],
                            type: 'one-to-many',
                            sourceColumn: 'id',
                            targetColumn: `${entityNames[0].slice(0, -1)}_id`
                        }
                    ]
                },
                {
                    name: entityNames[1],
                    columns: [
                        { name: 'id', type: 'integer', constraints: ['primary key', 'auto_increment'] },
                        { name: `${entityNames[0].slice(0, -1)}_id`, type: 'integer', constraints: ['not null'] },
                        { name: 'name', type: 'string', constraints: ['not null'] },
                        { name: 'created_at', type: 'datetime', constraints: ['default current_timestamp'] }
                    ],
                    relationships: []
                }
            ]
        };
    }
}

module.exports = new AIService(); 
const axios = require('axios');

class MistralService {
    constructor() {
        this.apiKey = process.env.MISTRAL_API_KEY;
        this.model = process.env.MISTRAL_MODEL || 'mistral-small-latest';
        this.apiUrl = 'https://api.mistral.ai/v1/chat/completions';
        this.timeout = 30000; // 30 seconds timeout
    }

    async generateCompletion(systemPrompt, userPrompt) {
        try {
            const response = await axios.post(
                this.apiUrl,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ]
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.timeout // Set axios timeout
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('Mistral AI API error:', error.response?.data || error.message);
            
            // Handle timeout errors
            if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                throw new Error('Mistral AI request timed out');
            }
            
            throw new Error(`Mistral AI completion failed: ${error.message}`);
        }
    }

    async interpretPrompt(prompt) {
        try {
            // Update the system prompt to explicitly request raw JSON without markdown
            // Also specify the supported relationship types
            const systemPrompt = `You are a backend architect that converts natural language descriptions into database schemas and API endpoints. 
            
Output should be in JSON format with the following structure: 
{
  "tables": [
    {
      "name": "table_name",
      "columns": [
        {
          "name": "column_name",
          "type": "data_type",
          "constraints": ["constraint1", "constraint2"]
        }
      ],
      "relationships": [
        {
          "targetTable": "target_table",
          "type": "one-to-many",
          "sourceColumn": "source_column",
          "targetColumn": "target_column"
        }
      ]
    }
  ]
}

IMPORTANT NOTES:
1. Return ONLY the raw JSON without any markdown formatting, code blocks, or additional text.
2. For relationship types, use ONLY: "one-to-one", "one-to-many", "many-to-one", or "many-to-many".
3. Make sure each table has an "id" column with "primary key" constraint.
4. For foreign keys, make sure the referenced column exists in the target table.`;
            
            const userPrompt = `Generate a database schema and API endpoints for: ${prompt}`;
            
            const jsonResponse = await this.generateCompletion(systemPrompt, userPrompt);
            console.log('Raw Mistral response:', jsonResponse);
            
            // Clean the response to remove markdown code blocks if present
            const cleanedResponse = this._cleanMarkdownCodeBlocks(jsonResponse);
            
            // Parse the JSON response
            try {
                const parsedResponse = JSON.parse(cleanedResponse);
                
                // Normalize the response to ensure it has the expected structure
                return this._normalizeResponse(parsedResponse);
            } catch (parseError) {
                console.error('Failed to parse Mistral response as JSON:', parseError);
                
                // If the response isn't valid JSON, try to extract JSON from the text
                const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const extractedJson = JSON.parse(jsonMatch[0]);
                        return this._normalizeResponse(extractedJson);
                    } catch (extractError) {
                        console.error('Failed to extract JSON from response:', extractError);
                        throw new Error('Failed to parse Mistral AI response as JSON');
                    }
                }
                throw new Error('Failed to parse Mistral AI response as JSON');
            }
        } catch (error) {
            console.error('Mistral interpretation error:', error);
            throw new Error(`AI interpretation failed: ${error.message}`);
        }
    }
    
    // Normalize the response to ensure it has the expected structure
    _normalizeResponse(response) {
        if (!response.tables || !Array.isArray(response.tables)) {
            throw new Error('Invalid response structure: missing tables array');
        }
        
        // Process each table
        response.tables = response.tables.map(table => {
            // Ensure columns exist
            if (!table.columns || !Array.isArray(table.columns)) {
                table.columns = [];
            }
            
            // Ensure relationships exist
            if (!table.relationships) {
                table.relationships = [];
            } else if (!Array.isArray(table.relationships)) {
                table.relationships = [table.relationships];
            }
            
            // Normalize relationship types
            table.relationships = table.relationships.map(rel => {
                // Convert relationship type to supported format if needed
                if (rel.type) {
                    rel.type = rel.type.toLowerCase();
                    
                    // Map any non-standard relationship types to standard ones
                    const typeMap = {
                        'belongs_to': 'many-to-one',
                        'has_many': 'one-to-many',
                        'has_one': 'one-to-one',
                        'belongs_to_many': 'many-to-many'
                    };
                    
                    if (typeMap[rel.type]) {
                        rel.type = typeMap[rel.type];
                    }
                }
                
                return rel;
            });
            
            return table;
        });
        
        return response;
    }
    
    // Clean markdown code blocks from the response
    _cleanMarkdownCodeBlocks(text) {
        // Remove markdown code block markers
        let cleaned = text.replace(/```json\s*/g, '');
        cleaned = cleaned.replace(/```\s*$/g, '');
        cleaned = cleaned.replace(/```/g, '');
        
        // Trim whitespace
        cleaned = cleaned.trim();
        
        return cleaned;
    }
    
    // Set timeout value
    setTimeout(timeoutMs) {
        this.timeout = timeoutMs;
    }
}

module.exports = new MistralService(); 
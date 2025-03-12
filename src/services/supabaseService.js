const { createClient } = require('@supabase/supabase-js');

class SupabaseService {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_KEY
        );
        
        // In-memory storage as fallback
        this.inMemoryDb = {
            projects: [],
            deployments: [],
            tables: {}
        };
        
        // Counter for generating IDs
        this.idCounters = {
            projects: 1,
            deployments: 1
        };
        
        // Ensure required columns exist
        this._ensureRequiredColumns();
    }

    async createSchema(projectId) {
        try {
            const schemaName = `project_${projectId}`;
            const createSchemaSQL = `CREATE SCHEMA IF NOT EXISTS ${schemaName}`;
            
            console.log(`Creating schema: ${schemaName}`);
            
            // Execute the SQL using Supabase's SQL API
            const { data, error } = await this.supabase.rpc('execute_sql', {
                sql: createSchemaSQL
            });
            
            if (error) {
                console.error(`Error creating schema: ${error.message}`);
                return { 
                    success: false, 
                    message: `Failed to create schema: ${error.message}`,
                    schema: schemaName
                };
            }
            
            console.log(`Schema ${schemaName} created successfully`);
            return { 
                success: true, 
                message: `Schema ${schemaName} created successfully`,
                schema: schemaName
            };
        } catch (error) {
            console.error(`Error in createSchema:`, error);
            return { 
                success: false, 
                message: `Failed to create schema: ${error.message}`,
                schema: `project_${projectId}`
            };
        }
    }

    async createTable(tableName, columns, projectId) {
        try {
            // Create schema for this project if it doesn't exist
            const schemaResult = await this.createSchema(projectId);
            const schemaName = schemaResult.schema;
            
            // Convert our schema to SQL
            const createTableSQL = this._generateCreateTableSQL(`${schemaName}.${tableName}`, columns);
            console.log(`SQL to execute: ${createTableSQL}`);
            
            // Execute the SQL using Supabase's SQL API
            const { data, error } = await this.supabase.rpc('execute_sql', {
                sql: createTableSQL
            });
            
            if (error) {
                console.error(`Error executing SQL: ${error.message}`);
                console.log('Falling back to in-memory storage');
                
                // Store table in memory as fallback
                if (!this.inMemoryDb.tables[schemaName]) {
                    this.inMemoryDb.tables[schemaName] = {};
                }
                
                this.inMemoryDb.tables[schemaName][tableName] = {
                    columns,
                    records: []
                };
                
                return { 
                    success: true, 
                    message: `Table ${tableName} created in memory (Supabase operation failed)`,
                    inMemory: true,
                    schema: schemaName
                };
            }
            
            console.log(`Table ${tableName} created successfully in Supabase schema ${schemaName}`);
            return { 
                success: true, 
                message: `Table ${tableName} created successfully in Supabase schema ${schemaName}`,
                inMemory: false,
                schema: schemaName
            };
        } catch (error) {
            console.error(`Error in createTable:`, error);
            
            // Fallback to in-memory
            const schemaName = `project_${projectId}`;
            
            if (!this.inMemoryDb.tables[schemaName]) {
                this.inMemoryDb.tables[schemaName] = {};
            }
            
            this.inMemoryDb.tables[schemaName][tableName] = {
                columns,
                records: []
            };
            
            return { 
                success: true, 
                message: `Table ${tableName} created in memory (Supabase operation failed)`,
                inMemory: true,
                error: error.message,
                schema: schemaName
            };
        }
    }

    async _addColumn(tableName, column, projectId) {
        try {
            const schemaName = `project_${projectId}`;
            
            // Generate SQL for adding column
            const alterTableSQL = `ALTER TABLE ${schemaName}.${tableName} ADD COLUMN ${column.name} ${column.type}`;
            console.log(`SQL to execute: ${alterTableSQL}`);
            
            // Execute the SQL
            const { data, error } = await this.supabase.rpc('execute_sql', {
                sql: alterTableSQL
            });
            
            if (error) {
                console.error(`Error adding column: ${error.message}`);
                
                // Add column to in-memory table as fallback
                if (this.inMemoryDb.tables[schemaName] && this.inMemoryDb.tables[schemaName][tableName]) {
                    if (!this.inMemoryDb.tables[schemaName][tableName].columns.find(c => c.name === column.name)) {
                        this.inMemoryDb.tables[schemaName][tableName].columns.push(column);
                    }
                }
                
                return { 
                    success: true,
                    message: `Column ${column.name} added to ${tableName} in memory`,
                    inMemory: true,
                    schema: schemaName
                };
            }
            
            return { 
                success: true,
                message: `Column ${column.name} added to ${tableName} in Supabase schema ${schemaName}`,
                inMemory: false,
                schema: schemaName
            };
        } catch (error) {
            console.error(`Error adding column:`, error);
            
            const schemaName = `project_${projectId}`;
            
            // Add column to in-memory table as fallback
            if (this.inMemoryDb.tables[schemaName] && this.inMemoryDb.tables[schemaName][tableName]) {
                if (!this.inMemoryDb.tables[schemaName][tableName].columns.find(c => c.name === column.name)) {
                    this.inMemoryDb.tables[schemaName][tableName].columns.push(column);
                }
            }
            
            return { 
                success: true,
                message: `Column ${column.name} added to ${tableName} in memory`,
                inMemory: true,
                error: error.message,
                schema: schemaName
            };
        }
    }

    async createRelationship(schemaName, sourceTable, targetTable, type, sourceColumn, targetColumn) {
        try {
            console.log(`Creating relationship: ${sourceTable}.${sourceColumn} -> ${targetTable}.${targetColumn} (${type})`);
            
            const sql = this._generateRelationshipSQL(
                `${schemaName}.${sourceTable}`,
                `${schemaName}.${targetTable}`,
                sourceColumn,
                targetColumn,
                type
            );
            
            console.log(`SQL to execute: ${sql}`);
            await this.supabase.rpc('execute_sql', { sql });
            
            return true;
        } catch (error) {
            console.error('Error in createRelationship:', error);
            throw error;
        }
    }

    _generateCreateTableSQL(tableName, columns) {
        const columnDefinitions = columns.map(column => {
            let sql = `${column.name} ${column.type}`;
            
            if (column.constraints) {
                if (column.constraints.includes('primary')) {
                    sql += ' PRIMARY KEY';
                }
                if (column.constraints.includes('unique')) {
                    sql += ' UNIQUE';
                }
                if (column.constraints.includes('required')) {
                    sql += ' NOT NULL';
                }
            }
            
            return sql;
        }).join(', ');

        return `CREATE TABLE IF NOT EXISTS ${tableName} (${columnDefinitions});`;
    }

    _generateRelationshipSQL(sourceTable, targetTable, sourceColumn, targetColumn, type) {
        // Clean up the relationship type by removing any extra characters
        const cleanType = type.replace(/[^a-zA-Z0-9\-]/g, '').trim();
        
        console.log(`Generating relationship SQL: ${sourceTable}.${sourceColumn} -> ${targetTable}.${targetColumn} (${cleanType})`);
        
        let sql = '';
        switch (cleanType) {
            case 'one-to-one':
                sql = `ALTER TABLE ${sourceTable} ADD CONSTRAINT fk_${sourceTable.replace(/\./g, '_')}_${targetTable.replace(/\./g, '_')} FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable}(${targetColumn});`;
                break;
            case 'many-to-one':
                sql = `ALTER TABLE ${sourceTable} ADD CONSTRAINT fk_${sourceTable.replace(/\./g, '_')}_${targetTable.replace(/\./g, '_')} FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable}(${targetColumn});`;
                break;
            case 'many-to-many':
                // Create junction table
                const junctionTable = `${sourceTable.replace(/\./g, '_')}_${targetTable.replace(/\./g, '_')}`;
                sql = `
                    CREATE TABLE ${junctionTable} (
                        ${sourceTable.split('.').pop()}_id INTEGER REFERENCES ${sourceTable}(id),
                        ${targetTable.split('.').pop()}_id INTEGER REFERENCES ${targetTable}(id),
                        PRIMARY KEY (${sourceTable.split('.').pop()}_id, ${targetTable.split('.').pop()}_id)
                    );
                `;
                break;
            default:
                throw new Error(`Unsupported relationship type: ${type}`);
        }

        return sql;
    }

    async query(table, query = {}, projectId = null) {
        try {
            const { method = 'select', where = {}, limit, orderBy, offset } = query;
            // Create a copy of data instead of destructuring it directly from query
            let data = query.data ? { ...query.data } : {};
            
            // Special case for project creation
            if (table === 'projects' && method === 'insert') {
                return await this.createProject(data);
            }
            
            // Add platform field to deployments table if it doesn't exist
            if (table === 'deployments' && method === 'insert' && !data.platform) {
                data.platform = 'netlify'; // Default to Netlify
            }
            
            // Special handling for projects table
            if (table === 'projects') {
                // For insert operations
                if (method === 'insert') {
                    // Handle project_id field - store it as name and use numeric id
                    if (data.project_id) {
                        data.name = data.project_id;
                        delete data.project_id;
                    }
                    
                    // If id is a string that looks like a project_id
                    if (data.id && typeof data.id === 'string' && data.id.startsWith('project_')) {
                        data.name = data.id;
                        data.id = Date.now(); // Use timestamp as numeric ID
                    }
                    
                    // Ensure prompt has a value
                    if (!data.prompt) {
                        data.prompt = 'No prompt provided';
                    }
                }
            }
            
            // If using Supabase
            if (this.supabase) {
                try {
                    // Handle different query methods
                    switch (method) {
                        case 'select':
                            try {
                                // Start with a basic query
                                let selectQuery = this.supabase
                                    .from(table)
                                    .select();
                                
                                // Apply where conditions using match
                                if (Object.keys(where).length > 0) {
                                    // Handle project_id in where conditions
                                    const cleanedWhere = { ...where };
                                    if (table === 'projects' && cleanedWhere.project_id) {
                                        cleanedWhere.name = cleanedWhere.project_id;
                                        delete cleanedWhere.project_id;
                                    }
                                    
                                    selectQuery = selectQuery.match(cleanedWhere);
                                }
                                
                                // Apply limit if provided
                                if (limit) {
                                    selectQuery = selectQuery.limit(limit);
                                }
                                
                                // Apply order by if provided
                                if (orderBy) {
                                    const [column, direction] = Object.entries(orderBy)[0];
                                    selectQuery = selectQuery.order(column, { ascending: direction === 'asc' });
                                }
                                
                                // Apply offset if provided
                                if (offset) {
                                    selectQuery = selectQuery.range(offset, offset + (limit || 10) - 1);
                                }
                                
                                const { data: selectData, error: selectError } = await selectQuery;
                                
                                if (selectError) {
                                    throw selectError;
                                }
                                
                                return selectData;
                            } catch (error) {
                                console.error('Select operation error:', error);
                                // Fall back to in-memory database
                                return this._queryInMemory(table, { method, where, limit, orderBy, offset });
                            }
                            
                        case 'insert':
                            try {
                                // For projects table, try a more robust approach
                                if (table === 'projects') {
                                    try {
                                        // First, check if we need to create the project with a specific ID
                                        let insertData;
                                        
                                        // Try to insert with all fields
                                        const { data: result, error } = await this.supabase
                                            .from(table)
                                            .insert(data)
                                            .select();
                                        
                                        if (error) {
                                            // If there's an error, try a simplified approach
                                            console.error('Initial insert error:', error);
                                            
                                            // Create a minimal project entry with just the essential fields
                                            const minimalProject = {
                                                name: data.name || data.id || `Project ${Date.now()}`,
                                                prompt: data.prompt || 'No prompt provided',
                                                created_at: new Date().toISOString()
                                            };
                                            
                                            const { data: fallbackResult, error: fallbackError } = await this.supabase
                                                .from(table)
                                                .insert(minimalProject)
                                                .select();
                                            
                                            if (fallbackError) {
                                                throw fallbackError;
                                            }
                                            
                                            insertData = fallbackResult;
                                        } else {
                                            insertData = result;
                                        }
                                        
                                        return insertData;
                                    } catch (projectError) {
                                        console.error('Project creation error:', projectError);
                                        // Fall back to in-memory
                                        return this._queryInMemory(table, { method, data });
                                    }
                                }
                                
                                // For other tables, use the standard approach
                                const { data: insertData, error: insertError } = await this.supabase
                                    .from(table)
                                    .insert(data)
                                    .select();
                                
                                if (insertError) {
                                    // If there's an error about missing columns, try to remove those columns and retry
                                    if (insertError.code === 'PGRST204' && insertError.message.includes('Could not find')) {
                                        console.error('Supabase query error:', insertError);
                                        
                                        // Extract the column name from the error message
                                        const columnMatch = insertError.message.match(/Could not find the '(.+?)' column/);
                                        if (columnMatch && columnMatch[1]) {
                                            const columnName = columnMatch[1];
                                            console.log(`Removing problematic column: ${columnName}`);
                                            
                                            // Create a new data object without the problematic column
                                            const newData = { ...data };
                                            delete newData[columnName];
                                            
                                            // Try again with the modified data
                                            const { data: retryData, error: retryError } = await this.supabase
                                                .from(table)
                                                .insert(newData)
                                                .select();
                                            
                                            if (retryError) {
                                                throw retryError;
                                            }
                                            
                                            return retryData;
                                        }
                                    }
                                    
                                    // If there's a type error for integer, try to convert the value
                                    if (insertError.code === '22P02' && insertError.message.includes('invalid input syntax for type integer')) {
                                        console.error('Type conversion error:', insertError);
                                        
                                        // Create a new data object with converted ID
                                        const newData = { ...data };
                                        if (newData.id && typeof newData.id === 'string') {
                                            // Store original ID as name if not already set
                                            if (!newData.name) {
                                                newData.name = newData.id;
                                            }
                                            // Generate a numeric ID
                                            newData.id = Date.now();
                                            
                                            // Try again with the modified data
                                            const { data: retryData, error: retryError } = await this.supabase
                                                .from(table)
                                                .insert(newData)
                                                .select();
                                            
                                            if (retryError) {
                                                throw retryError;
                                            }
                                            
                                            return retryData;
                                        }
                                    }
                                    
                                    throw insertError;
                                }
                                
                                return insertData;
                            } catch (error) {
                                console.error('Insert operation error:', error);
                                // Fall back to in-memory database
                                return this._queryInMemory(table, { method, data });
                            }
                            
                        case 'update':
                            try {
                                // For update operations, we need to use a different approach
                                // First, build the filter conditions
                                let filterConditions = {};
                                if (Object.keys(where).length > 0) {
                                    filterConditions = { ...where };
                                    
                                    // Handle project_id in where conditions
                                    if (table === 'projects' && filterConditions.project_id) {
                                        filterConditions.name = filterConditions.project_id;
                                        delete filterConditions.project_id;
                                    }
                                }
                                
                                // Handle projects table specifically
                                if (table === 'projects') {
                                    // If trying to update with project_id, store it as name
                                    if (data.project_id) {
                                        data.name = data.project_id;
                                        delete data.project_id;
                                    }
                                    
                                    // Convert string IDs to integers if needed
                                    if (filterConditions.id && typeof filterConditions.id === 'string') {
                                        // If it's a project_id format, search by name instead
                                        if (filterConditions.id.startsWith('project_')) {
                                            filterConditions.name = filterConditions.id;
                                            delete filterConditions.id;
                                        }
                                        // Otherwise check if it's a numeric string
                                        else if (!isNaN(filterConditions.id)) {
                                            filterConditions.id = parseInt(filterConditions.id, 10);
                                        }
                                    }
                                }
                                
                                // Then perform the update
                                const { data: updateData, error: updateError } = await this.supabase
                                    .from(table)
                                    .update(data)
                                    .match(filterConditions)
                                    .select();
                                
                                if (updateError) {
                                    // If there's an error about missing columns, try to remove those columns and retry
                                    if (updateError.code === 'PGRST204' && updateError.message.includes('Could not find')) {
                                        console.error('Supabase query error:', updateError);
                                        
                                        // Extract the column name from the error message
                                        const columnMatch = updateError.message.match(/Could not find the '(.+?)' column/);
                                        if (columnMatch && columnMatch[1]) {
                                            const columnName = columnMatch[1];
                                            console.log(`Removing problematic column: ${columnName}`);
                                            
                                            // Create a new data object without the problematic column
                                            const newData = { ...data };
                                            delete newData[columnName];
                                            
                                            // Try again with the modified data
                                            const { data: retryData, error: retryError } = await this.supabase
                                                .from(table)
                                                .update(newData)
                                                .match(filterConditions)
                                                .select();
                                            
                                            if (retryError) {
                                                throw retryError;
                                            }
                                            
                                            return retryData;
                                        }
                                    }
                                    
                                    // If there's a type error for integer, try to convert the value
                                    if (updateError.code === '22P02' && updateError.message.includes('invalid input syntax for type integer')) {
                                        console.error('Type conversion error:', updateError);
                                        
                                        // If we're trying to update by project_id string, try to find by name instead
                                        if (filterConditions.id && typeof filterConditions.id === 'string' && filterConditions.id.startsWith('project_')) {
                                            const newFilterConditions = { ...filterConditions };
                                            newFilterConditions.name = newFilterConditions.id;
                                            delete newFilterConditions.id;
                                            
                                            // Try again with the modified filter
                                            const { data: retryData, error: retryError } = await this.supabase
                                                .from(table)
                                                .update(data)
                                                .match(newFilterConditions)
                                                .select();
                                            
                                            if (retryError) {
                                                throw retryError;
                                            }
                                            
                                            return retryData;
                                        }
                                    }
                                    
                                    throw updateError;
                                }
                                
                                return updateData;
                            } catch (error) {
                                console.error('Update operation error:', error);
                                // Fall back to in-memory database
                                return this._queryInMemory(table, { method, where, data, limit, orderBy });
                            }
                            
                        case 'delete':
                            try {
                                // For delete operations, we need to use a similar approach as update
                                // First, build the filter conditions
                                let filterConditions = {};
                                if (Object.keys(where).length > 0) {
                                    filterConditions = where;
                                }
                                
                                // Then perform the delete
                                const { data: deleteData, error: deleteError } = await this.supabase
                                    .from(table)
                                    .delete()
                                    .match(filterConditions)
                                    .select();
                                
                                if (deleteError) {
                                    throw deleteError;
                                }
                                
                                return deleteData;
                            } catch (error) {
                                console.error('Delete operation error:', error);
                                // Fall back to in-memory database
                                return this._queryInMemory(table, { method, where, limit, orderBy });
                            }
                            
                        default:
                            throw new Error(`Unsupported query method: ${method}`);
                    }
                } catch (error) {
                    console.error('Supabase query error:', error);
                    
                    // Fall back to in-memory database
                    console.log('Falling back to in-memory database');
                    
                    // Use in-memory database as fallback
                    return this._queryInMemory(table, query);
                }
            } else {
                // Use in-memory database
                return this._queryInMemory(table, query);
            }
        } catch (error) {
            console.error(`Error in query (${table}):`, error.message);
            throw error;
        }
    }
    
    // Helper method to convert camelCase keys to quoted keys for Supabase
    _convertKeysForSupabase(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            // If the key is camelCase, quote it
            if (key !== key.toLowerCase() && key !== key.toUpperCase()) {
                result[`"${key}"`] = value;
            } else {
                result[key] = value;
            }
        }
        
        return result;
    }

    // Ensure required columns exist in the database
    async _ensureRequiredColumns() {
        try {
            // Add local_url column to deployments table if it doesn't exist
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS local_url TEXT"
            });
            
            // Add platform column to deployments table if it doesn't exist
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'netlify'"
            });
            
            // Add project_path column to deployments table if it doesn't exist
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS project_path TEXT"
            });
            
            // Add message column to deployments table if it doesn't exist
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE deployments ADD COLUMN IF NOT EXISTS message TEXT"
            });
            
            // Add deployment_platform column to projects table if it doesn't exist
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE projects ADD COLUMN IF NOT EXISTS deployment_platform TEXT DEFAULT 'netlify'"
            });
            
            // Add prompt column to projects table if it doesn't exist with a default value
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE projects ADD COLUMN IF NOT EXISTS prompt TEXT DEFAULT 'No prompt provided' NOT NULL"
            });
            
            // Add name column to projects table if it doesn't exist
            await this.supabase.rpc('execute_sql', {
                sql: "ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT"
            });
            
            console.log('Required columns ensured in database');
        } catch (error) {
            console.error('Error ensuring required columns:', error.message);
            // Continue even if this fails, as we'll fall back to in-memory storage
        }
    }

    // Query in-memory database
    _queryInMemory(table, query = {}) {
        const { method = 'select', where = {}, data = {}, limit, orderBy, projectId = null } = query;
        
        // If projectId is provided and it's not a system table (projects or deployments)
        const useSchema = projectId && !['projects', 'deployments'].includes(table);
        const schemaName = useSchema ? `project_${projectId}` : 'public';
        const fullTableName = useSchema ? `${schemaName}.${table}` : table;
        
        switch (method.toLowerCase()) {
            case 'select':
                // Query in-memory database
                let results = [];
                
                if (useSchema && this.inMemoryDb.tables[schemaName] && this.inMemoryDb.tables[schemaName][table]) {
                    results = this.inMemoryDb.tables[schemaName][table].records || [];
                } else if (!useSchema) {
                    results = this.inMemoryDb[table] || [];
                }
                
                // Apply where conditions
                if (Object.keys(where).length > 0) {
                    results = results.filter(item => {
                        return Object.entries(where).every(([key, value]) => item[key] == value);
                    });
                }
                
                // Apply order by
                if (orderBy) {
                    const [column, direction] = Object.entries(orderBy)[0];
                    results.sort((a, b) => {
                        if (direction === 'asc') {
                            return a[column] > b[column] ? 1 : -1;
                        } else {
                            return a[column] < b[column] ? 1 : -1;
                        }
                    });
                }
                
                // Apply limit
                if (limit && results.length > limit) {
                    results = results.slice(0, limit);
                }
                
                return results;
                
            case 'insert':
                // Insert into in-memory database
                if (useSchema) {
                    if (!this.inMemoryDb.tables[schemaName]) {
                        this.inMemoryDb.tables[schemaName] = {};
                    }
                    
                    if (!this.inMemoryDb.tables[schemaName][table]) {
                        this.inMemoryDb.tables[schemaName][table] = { records: [] };
                    }
                    
                    // Generate ID if not provided
                    const newItem = { ...data };
                    if (!newItem.id) {
                        const records = this.inMemoryDb.tables[schemaName][table].records;
                        newItem.id = records.length > 0 ? Math.max(...records.map(r => r.id)) + 1 : 1;
                    }
                    
                    this.inMemoryDb.tables[schemaName][table].records.push(newItem);
                    return [newItem];
                } else {
                    if (!this.inMemoryDb[table]) {
                        this.inMemoryDb[table] = [];
                    }
                    
                    // Generate ID if not provided
                    const newItem = { ...data };
                    if (!newItem.id) {
                        newItem.id = this.idCounters[table] || 1;
                        this.idCounters[table] = newItem.id + 1;
                    }
                    
                    this.inMemoryDb[table].push(newItem);
                    return [newItem];
                }
                
            case 'update':
                // Update in-memory database
                if (useSchema) {
                    if (!this.inMemoryDb.tables[schemaName] || !this.inMemoryDb.tables[schemaName][table]) {
                        return [];
                    }
                    
                    const updatedItems = [];
                    this.inMemoryDb.tables[schemaName][table].records = this.inMemoryDb.tables[schemaName][table].records.map(item => {
                        let shouldUpdate = true;
                        
                        // Check where conditions
                        if (Object.keys(where).length > 0) {
                            shouldUpdate = Object.entries(where).every(([key, value]) => item[key] == value);
                        }
                        
                        if (shouldUpdate) {
                            const updatedItem = { ...item, ...data };
                            updatedItems.push(updatedItem);
                            return updatedItem;
                        }
                        
                        return item;
                    });
                    
                    return updatedItems;
                } else {
                    if (!this.inMemoryDb[table]) {
                        return [];
                    }
                    
                    const updatedItems = [];
                    this.inMemoryDb[table] = this.inMemoryDb[table].map(item => {
                        let shouldUpdate = true;
                        
                        // Check where conditions
                        if (Object.keys(where).length > 0) {
                            shouldUpdate = Object.entries(where).every(([key, value]) => item[key] == value);
                        }
                        
                        if (shouldUpdate) {
                            const updatedItem = { ...item, ...data };
                            updatedItems.push(updatedItem);
                            return updatedItem;
                        }
                        
                        return item;
                    });
                    
                    return updatedItems;
                }
            
            case 'delete':
                // Delete from in-memory database
                if (useSchema) {
                    if (!this.inMemoryDb.tables[schemaName] || !this.inMemoryDb.tables[schemaName][table]) {
                        return [];
                    }
                    
                    const deletedItems = [];
                    const records = this.inMemoryDb.tables[schemaName][table].records;
                    
                    this.inMemoryDb.tables[schemaName][table].records = records.filter(item => {
                        // Check where conditions
                        if (Object.keys(where).length > 0) {
                            const shouldDelete = Object.entries(where).every(([key, value]) => item[key] == value);
                            if (shouldDelete) {
                                deletedItems.push(item);
                                return false;
                            }
                        }
                        
                        return true;
                    });
                    
                    return deletedItems;
                } else {
                    if (!this.inMemoryDb[table]) {
                        return [];
                    }
                    
                    const deletedItems = [];
                    
                    this.inMemoryDb[table] = this.inMemoryDb[table].filter(item => {
                        // Check where conditions
                        if (Object.keys(where).length > 0) {
                            const shouldDelete = Object.entries(where).every(([key, value]) => item[key] == value);
                            if (shouldDelete) {
                                deletedItems.push(item);
                                return false;
                            }
                        }
                        
                        return true;
                    });
                    
                    return deletedItems;
                }
                
            default:
                throw new Error(`Unsupported query method: ${method}`);
        }
    }

    // Add this helper method to the SupabaseService class
    async createProject(projectData) {
        try {
            // Ensure we have the required fields
            const data = {
                name: projectData.name || projectData.id || `Project ${Date.now()}`,
                prompt: projectData.prompt || 'No prompt provided',
                created_at: projectData.created_at || new Date().toISOString(),
                deployment_platform: projectData.deployment_platform || 'netlify'
            };
            
            // If the ID is a string that looks like a project ID, use it as name
            if (projectData.id && typeof projectData.id === 'string' && projectData.id.startsWith('project_')) {
                data.name = projectData.id;
                // Generate a numeric ID
                data.id = Date.now();
            }
            
            // Try to insert the project
            const { data: result, error } = await this.supabase
                .from('projects')
                .insert(data)
                .select();
            
            if (error) {
                console.error('Project creation error:', error);
                
                // Try a more minimal approach
                const minimalData = {
                    name: data.name,
                    prompt: data.prompt,
                    created_at: data.created_at
                };
                
                const { data: fallbackResult, error: fallbackError } = await this.supabase
                    .from('projects')
                    .insert(minimalData)
                    .select();
                
                if (fallbackError) {
                    // Fall back to in-memory storage
                    console.log('Falling back to in-memory storage for project creation');
                    return this._queryInMemory('projects', { 
                        method: 'insert', 
                        data: minimalData 
                    });
                }
                
                return fallbackResult;
            }
            
            return result;
        } catch (error) {
            console.error('Error in createProject:', error);
            // Fall back to in-memory
            return this._queryInMemory('projects', { 
                method: 'insert', 
                data: projectData 
            });
        }
    }
}

module.exports = new SupabaseService(); 
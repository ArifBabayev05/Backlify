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

    async createRelationship(sourceTable, targetTable, type, sourceColumn, targetColumn, projectId) {
        try {
            const schemaName = `project_${projectId}`;
            
            const alterTableSQL = this._generateRelationshipSQL(
                `${schemaName}.${sourceTable}`,
                `${schemaName}.${targetTable}`,
                type,
                sourceColumn,
                targetColumn
            );

            console.log(`SQL to execute: ${alterTableSQL}`);
            
            // Execute the SQL
            const { data, error } = await this.supabase.rpc('execute_sql', {
                sql: alterTableSQL
            });
            
            if (error) {
                console.error(`Error creating relationship: ${error.message}`);
                return { 
                    success: true,
                    message: `Relationship between ${sourceTable} and ${targetTable} simulated (Supabase operation failed)`,
                    inMemory: true,
                    schema: schemaName
                };
            }
            
            return { 
                success: true,
                message: `Relationship created between ${sourceTable} and ${targetTable} in Supabase schema ${schemaName}`,
                inMemory: false,
                schema: schemaName
            };
        } catch (error) {
            console.error(`Error in createRelationship:`, error);
            return { 
                success: true,
                message: `Relationship between ${sourceTable} and ${targetTable} simulated (Supabase operation failed)`,
                inMemory: true,
                error: error.message,
                schema: `project_${projectId}`
            };
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

    _generateRelationshipSQL(sourceTable, targetTable, type, sourceColumn, targetColumn) {
        let sql = `ALTER TABLE ${sourceTable} `;

        switch (type.toLowerCase()) {
            case 'one-to-one':
                sql += `ADD CONSTRAINT fk_${sourceTable}_${targetTable} `;
                sql += `FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable}(${targetColumn}) `;
                sql += `ON DELETE CASCADE;`;
                break;
            case 'one-to-many':
                sql += `ADD CONSTRAINT fk_${sourceTable}_${targetTable} `;
                sql += `FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable}(${targetColumn});`;
                break;
            case 'many-to-one':
                // Many-to-one is essentially the same as one-to-many but from the perspective of the "many" side
                sql += `ADD CONSTRAINT fk_${sourceTable}_${targetTable} `;
                sql += `FOREIGN KEY (${sourceColumn}) REFERENCES ${targetTable}(${targetColumn});`;
                break;
            case 'many-to-many':
                // Create junction table
                const junctionTable = `${sourceTable}_${targetTable}`;
                sql = `
                    CREATE TABLE ${junctionTable} (
                        ${sourceTable}_id INTEGER REFERENCES ${sourceTable}(id),
                        ${targetTable}_id INTEGER REFERENCES ${targetTable}(id),
                        PRIMARY KEY (${sourceTable}_id, ${targetTable}_id)
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
            const { method = 'select', where = {}, data = {}, limit, orderBy } = query;
            
            // If projectId is provided and it's not a system table (projects or deployments)
            const useSchema = projectId && !['projects', 'deployments'].includes(table);
            const schemaName = useSchema ? `project_${projectId}` : 'public';
            const fullTableName = useSchema ? `${schemaName}.${table}` : table;
            
            // Try to use Supabase first
            try {
                switch (method.toLowerCase()) {
                    case 'select':
                        let selectBuilder = this.supabase.from(fullTableName).select();
                        
                        // Apply where conditions
                        Object.entries(where).forEach(([column, value]) => {
                            selectBuilder = selectBuilder.eq(column, value);
                        });
                        
                        // Apply limit
                        if (limit) {
                            selectBuilder = selectBuilder.limit(limit);
                        }
                        
                        // Apply order by
                        if (orderBy) {
                            const [column, direction] = Object.entries(orderBy)[0];
                            selectBuilder = selectBuilder.order(column, { ascending: direction === 'asc' });
                        }
                        
                        const { data: selectData, error: selectError } = await selectBuilder;
                        if (selectError) {
                            throw selectError;
                        }
                        return selectData;
                    
                    case 'insert':
                        const { data: insertData, error: insertError } = await this.supabase
                            .from(fullTableName)
                            .insert(data)
                            .select();
                        
                        if (insertError) {
                            throw insertError;
                        }
                        return insertData;
                    
                    case 'update':
                        let updateBuilder = this.supabase.from(fullTableName).update(data);
                        
                        // Apply where conditions
                        Object.entries(where).forEach(([column, value]) => {
                            updateBuilder = updateBuilder.eq(column, value);
                        });
                        
                        const { data: updateData, error: updateError } = await updateBuilder.select();
                        if (updateError) {
                            throw updateError;
                        }
                        return updateData;
                    
                    case 'delete':
                        let deleteBuilder = this.supabase.from(fullTableName).delete();
                        
                        // Apply where conditions
                        Object.entries(where).forEach(([column, value]) => {
                            deleteBuilder = deleteBuilder.eq(column, value);
                        });
                        
                        const { data: deleteData, error: deleteError } = await deleteBuilder;
                        if (deleteError) {
                            throw deleteError;
                        }
                        return deleteData;
                    
                    default:
                        throw new Error(`Unsupported query method: ${method}`);
                }
            } catch (supabaseError) {
                console.error(`Supabase query error:`, supabaseError);
                console.log('Falling back to in-memory database');
                
                // Fall back to in-memory database
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
        } catch (error) {
            console.error(`Query error:`, error);
            throw new Error(`Query failed: ${error.message || 'Unknown error'}`);
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
}

module.exports = new SupabaseService(); 
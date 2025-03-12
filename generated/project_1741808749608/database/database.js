const { Pool } = require('pg');
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


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

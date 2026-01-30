// config/db.js
const mysql = require('mysql2');

// Create a pool instead of a single connection
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'sql8.freesqldatabase.com',
  user: process.env.DB_USER || 'sql8815725',
  password: process.env.DB_PASSWORD || 'PLCzyAddl5',
  database: process.env.DB_NAME || 'sql8815725',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Use promise-based queries
const db = pool.promise();

module.exports = db;

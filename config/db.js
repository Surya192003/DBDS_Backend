const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

connection.on('connect', () => {
  console.log('✅ MySQL connected successfully');
});

connection.on('error', (err) => {
  console.error('❌ MySQL error:', err.message);
});

module.exports = connection;

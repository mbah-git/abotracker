const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: true,
  charset: 'utf8mb4',
});

module.exports = pool;

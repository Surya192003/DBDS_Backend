const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

class Database {
  constructor() {
    this.pool = null;
    this.init();
  }

  init() {
  try {
    const poolConfig = {
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '12345678',
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'dance_management',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    this.pool = new Pool(poolConfig);

    this.pool.on('connect', () => {
      console.log('✅ Connected to PostgreSQL database');
    });

    this.pool.on('error', (err) => {
      console.error('❌ PostgreSQL error', err);
    });

    this.testConnection();

  } catch (error) {
    console.error('❌ DB init failed:', error);
    process.exit(1);
  }
}

  async testConnection() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      console.log(`✅ PostgreSQL connection test successful: ${result.rows[0].now}`);
      client.release();
    } catch (error) {
      console.error('❌ PostgreSQL connection test failed:', error.message);
      process.exit(1);
    }
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      console.log(`📊 Executed query: ${text} - ${duration}ms`);
      return result;
    } catch (error) {
      console.error(`❌ Query error: ${text}`, error);
      throw error;
    }
  }

  async getClient() {
    const client = await this.pool.connect();
    const query = client.query;
    const release = client.release;
    
    // Set a timeout of 5 seconds
    const timeout = setTimeout(() => {
      console.error('❌ A client has been checked out for more than 5 seconds!');
    }, 5000);
    
    // Monkey patch the query method to log the calls
    client.query = (...args) => {
      console.log('📊 Query called with:', args[0]);
      return query.apply(client, args);
    };
    
    client.release = () => {
      clearTimeout(timeout);
      client.query = query;
      client.release = release;
      return release.apply(client);
    };
    
    return client;
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping() {
    try {
      const result = await this.query('SELECT 1 as ping');
      return result.rows[0].ping === 1;
    } catch (error) {
      console.error('❌ Database ping failed:', error);
      return false;
    }
  }

  async close() {
    await this.pool.end();
    console.log('🔌 PostgreSQL pool closed');
  }
}

// Create singleton instance
const database = new Database();

// Export methods
module.exports = {
  query: (text, params) => database.query(text, params),
  getClient: () => database.getClient(),
  transaction: (callback) => database.transaction(callback),
  ping: () => database.ping(),
  close: () => database.close(),
  pool: database.pool
};
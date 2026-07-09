// backend/src/db.js
import pkg from 'pg';
const { Pool } = pkg;

// Utiliser DATABASE_URL pour Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Nécessaire pour Neon
  }
});

export { pool };

export async function q(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

export default { pool, q };
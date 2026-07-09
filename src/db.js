// backend/src/db.js
import pkg from 'pg';
const { Pool } = pkg;

// ✅ Configuration optimisée pour Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Nécessaire pour Neon
    require: true
  },
  // ✅ Ajouter ces options pour éviter les timeouts
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
  keepAlive: true,
  family: 4 // Forcer IPv4
});

// ✅ Logs de connexion
pool.on('connect', () => {
  console.log('✅ Connexion à Neon établie');
});

pool.on('error', (err) => {
  console.error('❌ Erreur de connexion à Neon:', err.message);
});

export { pool };

export async function q(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result;
  } catch (error) {
    console.error('❌ Erreur SQL:', error.message);
    console.error('📝 Requête:', sql.substring(0, 200));
    throw error;
  }
}

export default { pool, q };
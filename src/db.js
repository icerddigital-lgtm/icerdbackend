// backend/src/db.js
import pkg from 'pg';
const { Pool } = pkg;

// ✅ Configuration adaptative
const isProduction = process.env.NODE_ENV === 'production';

const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
  connectionTimeoutMillis: isProduction ? 10000 : 30000, // Plus long en local
  idleTimeoutMillis: 30000,
  max: isProduction ? 10 : 5, // Moins de connexions en local
  keepAlive: true,
  family: 4, // Forcer IPv4
};

// ✅ En développement, ajouter plus de temps
if (!isProduction) {
  poolConfig.connectionTimeoutMillis = 60000; // 60 secondes
  poolConfig.idleTimeoutMillis = 60000;
  poolConfig.max = 3;
}

const pool = new Pool(poolConfig);

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
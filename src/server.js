// ============================================================================
// ICERD — Serveur API (Express)
// ============================================================================
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { appliquerSecurite, gestionnaire404, gestionnaireErreurs, arretPropre } from './middleware/securite.js';
import { pool } from './db.js';

// Routes principales
import authRoutes from './routes/auth.js';
import clientsRoutes from './routes/clients.js';
import demandesRoutes from './routes/demandes.js';
import echantillonsRoutes from './routes/echantillons.js';
import analysesRoutes from './routes/analyses.js';
import resultatsRoutes from './routes/resultats.js';
import stocksRoutes from './routes/stocks.js';
import facturesRoutes from './routes/factures.js';
import equipementsRoutes from './routes/equipements.js';
import dashboardRoutes from './routes/dashboard.js';

// Routes laboratoires et rapports
import laboratoiresRoutes from './routes/laboratoires.js';
import rapportsRoutes from './routes/rapports.js';
import exportsRoutes from './routes/exports.js';
import portailClientRoutes from './routes/portail-client.js';

// Routes pour les pages publiques
import publicationsRoutes from './routes/publications.js';
import projetsRoutes from './routes/projets.js';
import evenementsRoutes from './routes/evenements.js';
import carrieresRoutes from './routes/carrieres.js';
import partenairesRoutes from './routes/partenaires.js';
import actualitesRoutes from './routes/actualites.js';
import galerieRoutes from './routes/galerie.js';
import equipeRoutes from './routes/equipe.js';
import faqRoutes from './routes/faq.js';

// Route upload Cloudinary
import uploadRoutes from './routes/upload.js';

// Route banque de données
import banqueRoutes from './routes/banque.js';

const app = express();

// ============================================================
// CONFIGURATION CORS (Optimisée pour Render + Local)
// ============================================================
const isProduction = process.env.NODE_ENV === 'production';

// Origines autorisées
const allowedOrigins = [
  // Production (Render)
  'https://icerdbackend.onrender.com',
  'https://icerd-backend.onrender.com',
  'https://icerd.netlify.app',
  'https://icerd-platform.netlify.app',
  // Développement (local)
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4000',
  // Variable d'environnement
  process.env.CORS_ORIGIN
].filter(Boolean);

console.log(`📋 CORS - Origines autorisées: ${allowedOrigins.join(', ')}`);

app.use(cors({
  origin: function (origin, callback) {
    // Permettre les requêtes sans origin (Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // En développement, tout est permis
    if (!isProduction) {
      return callback(null, true);
    }
    
    // En production, vérifier les origines autorisées
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 CORS bloqué: ${origin}`);
      callback(new Error(`CORS: ${origin} non autorisé`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Disposition', 'X-New-Token'],
  maxAge: 86400 // 24 heures
}));

// ============================================================
// MIDDLEWARES
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Appliquer la sécurité (helmet, rate limiting, etc.)
appliquerSecurite(app);

// Logging des requêtes (adapté à l'environnement)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const emoji = res.statusCode >= 400 ? '🔴' : res.statusCode >= 300 ? '🟠' : '🟢';
    const env = isProduction ? '' : ` (${duration} ms)`;
    console.log(`${emoji} ${req.method} ${req.originalUrl} → ${res.statusCode}${env}`);
  });
  next();
});

// ============================================================
// ROUTES
// ============================================================

// ✅ Route racine (pour le health check de Render)
app.get('/', (_req, res) => {
  res.json({
    statut: 'ok',
    service: 'ICERD API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Route santé (publique)
app.get('/api/sante', (_req, res) =>
  res.json({ 
    statut: 'ok', 
    service: 'ICERD LIMS API', 
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    date: new Date().toISOString() 
  })
);

// ============================================================
// ROUTES AVEC /api (standard)
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/demandes', demandesRoutes);
app.use('/api/echantillons', echantillonsRoutes);
app.use('/api/analyses', analysesRoutes);
app.use('/api/resultats', resultatsRoutes);
app.use('/api/stocks', stocksRoutes);
app.use('/api/factures', facturesRoutes);
app.use('/api/equipements', equipementsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/laboratoires', laboratoiresRoutes);
app.use('/api/rapports', rapportsRoutes);
app.use('/api/exports', exportsRoutes);
app.use('/api/portail-client', portailClientRoutes);
app.use('/api/publications', publicationsRoutes);
app.use('/api/projets', projetsRoutes);
app.use('/api/evenements', evenementsRoutes);
app.use('/api/carrieres', carrieresRoutes);
app.use('/api/partenaires', partenairesRoutes);
app.use('/api/actualites', actualitesRoutes);
app.use('/api/galerie', galerieRoutes);
app.use('/api/equipe', equipeRoutes);
app.use('/api/faq', faqRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/banque', banqueRoutes);

// ============================================================
// ROUTES SANS /api (pour compatibilité avec les anciennes URL)
// ============================================================
app.use('/auth', authRoutes);
app.use('/clients', clientsRoutes);
app.use('/demandes', demandesRoutes);
app.use('/echantillons', echantillonsRoutes);
app.use('/analyses', analysesRoutes);
app.use('/resultats', resultatsRoutes);
app.use('/stocks', stocksRoutes);
app.use('/factures', facturesRoutes);
app.use('/equipements', equipementsRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/laboratoires', laboratoiresRoutes);
app.use('/rapports', rapportsRoutes);
app.use('/exports', exportsRoutes);
app.use('/portail-client', portailClientRoutes);
app.use('/publications', publicationsRoutes);
app.use('/projets', projetsRoutes);
app.use('/evenements', evenementsRoutes);
app.use('/carrieres', carrieresRoutes);
app.use('/partenaires', partenairesRoutes);
app.use('/actualites', actualitesRoutes);
app.use('/galerie', galerieRoutes);
app.use('/equipe', equipeRoutes);
app.use('/faq', faqRoutes);
app.use('/upload', uploadRoutes);
app.use('/banque', banqueRoutes);

// ============================================================
// GESTION DES ERREURS
// ============================================================

// 404 - Route non trouvée
app.use(gestionnaire404);

// Gestionnaire d'erreurs global
app.use(gestionnaireErreurs);

// ============================================================
// DÉMARRAGE DU SERVEUR
// ============================================================
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const serveur = app.listen(PORT, HOST, () => {
  console.log(`\n🚀 API ICERD démarrée sur le port ${PORT}`);
  console.log(`📊 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🌐 CORS: ${isProduction ? '🔒 Production (restreint)' : '🔓 Développement (ouvert)'}`);
  console.log(`📅 ${new Date().toLocaleString('fr-FR')}\n`);
});

// Gestion de l'arrêt propre
arretPropre(serveur, pool);

export default app;
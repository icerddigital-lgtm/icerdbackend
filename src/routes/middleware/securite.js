// ============================================================================
// ICERD — Middlewares de sécurité (à importer dans server.js)
// Ajoute : en-têtes HTTP sécurisés, limitation du débit (anti force brute),
//          CORS strict en production, compression, journalisation.
//
// INSTALLATION :
//   cd backend && npm install helmet express-rate-limit compression
//
// UTILISATION dans src/server.js — remplacer les 2 lignes actuelles :
//     app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
//     app.use(express.json({ limit: '5mb' }));
//   par :
//     import { appliquerSecurite, limiteurConnexion, gestionnaire404, gestionnaireErreurs } from './middleware/securite.js';
//     appliquerSecurite(app);
//   puis, AVANT la route auth :
//     app.use('/api/auth/connexion', limiteurConnexion);
//   et TOUT À LA FIN (après toutes les routes) :
//     app.use(gestionnaire404);
//     app.use(gestionnaireErreurs);
// ============================================================================
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

const enProduction = () => process.env.NODE_ENV === 'production';

/* ---------------------------------------------------------------------------
 * CORS : en développement on autorise localhost ; en production, uniquement
 * les domaines listés dans CORS_ORIGIN (séparés par des virgules).
 * Le joker '*' est REFUSÉ en production : il exposerait l'API à tout site web.
 * ------------------------------------------------------------------------- */
function optionsCors() {
  const brut = process.env.CORS_ORIGIN || '';
  const autorises = brut.split(',').map(s => s.trim()).filter(Boolean);

  if (enProduction()) {
    if (autorises.length === 0 || autorises.includes('*')) {
      console.error("⛔ CORS_ORIGIN doit lister vos domaines en production (jamais '*'). Arrêt.");
      process.exit(1);
    }
    return { origin: autorises, credentials: true };
  }
  // Développement : localhost sur tous les ports + outils type Postman (origin absent)
  return {
    origin: (origine, ok) =>
      (!origine || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine) || autorises.includes(origine))
        ? ok(null, true)
        : ok(new Error(`Origine non autorisée : ${origine}`)),
    credentials: true,
  };
}

/* ---------------------------------------------------------------------------
 * Limiteurs de débit
 * ------------------------------------------------------------------------- */

// Connexion : 10 tentatives par quart d'heure et par IP (anti force brute)
export const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,   // seules les tentatives ratées comptent
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
});

// API générale : 300 requêtes par quart d'heure et par IP
const limiteurGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de requêtes. Patientez quelques minutes.' },
  skip: () => !enProduction(),     // désactivé en développement
});

// Envoi de fichiers : 30 par heure et par IP
export const limiteurUpload = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { erreur: "Trop d'envois de fichiers. Réessayez dans une heure." },
});

/* ---------------------------------------------------------------------------
 * Vérifications au démarrage : refuse de démarrer avec une configuration
 * dangereuse en production (secret par défaut, secret trop court…).
 * ------------------------------------------------------------------------- */
function verifierConfiguration() {
  const secret = process.env.JWT_SECRET || '';
  if (!process.env.DATABASE_URL) {
    console.error('⛔ DATABASE_URL manquant dans .env. Arrêt.');
    process.exit(1);
  }
  if (!secret) {
    console.error('⛔ JWT_SECRET manquant dans .env. Générez-en un : openssl rand -base64 48');
    process.exit(1);
  }
  if (enProduction()) {
    if (secret.length < 32 || /REMPLACER|changer|test|secret/i.test(secret)) {
      console.error('⛔ JWT_SECRET faible ou par défaut. Impossible de démarrer en production.');
      process.exit(1);
    }
  } else if (secret.length < 32) {
    console.warn('⚠️  JWT_SECRET court : acceptable en développement, à changer avant la production.');
  }
}

/* ---------------------------------------------------------------------------
 * Application de toute la pile de sécurité
 * ------------------------------------------------------------------------- */
export function appliquerSecurite(app) {
  verifierConfiguration();

  app.disable('x-powered-by');            // ne pas annoncer « Express »
  app.set('trust proxy', 1);              // derrière Nginx : vraie IP client pour le rate-limit

  app.use(helmet({
    // Le frontend est servi séparément par Nginx : pas de CSP imposée ici
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(compression());
  app.use(cors(optionsCors()));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use('/api', limiteurGeneral);

  // Journalisation légère (méthode, chemin, statut, durée)
  app.use((req, res, suite) => {
    const debut = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/sante') return;
      const duree = Date.now() - debut;
      const marque = res.statusCode >= 500 ? '🔴' : res.statusCode >= 400 ? '🟠' : '🟢';
      console.log(`${marque} ${req.method} ${req.path} → ${res.statusCode} (${duree} ms)`);
    });
    suite();
  });
}

/* ---------------------------------------------------------------------------
 * 404 : chemin d'API inexistant
 * ------------------------------------------------------------------------- */
export function gestionnaire404(req, res) {
  res.status(404).json({ erreur: `Route introuvable : ${req.method} ${req.path}` });
}

/* ---------------------------------------------------------------------------
 * Gestionnaire d'erreurs — version durcie
 * En production, on ne renvoie JAMAIS le message interne d'une erreur 500
 * (il peut révéler la structure de la base ou des chemins de fichiers).
 * ------------------------------------------------------------------------- */
export function gestionnaireErreurs(err, _req, res, _suite) {
  const statut = err.status || err.statusCode || 500;

  if (statut >= 500) console.error('🔴 Erreur serveur :', err);
  else console.warn('🟠', err.message);

  if (err.name === 'ValidationError')
    return res.status(400).json({ erreur: err.message, details: err.details });

  // Codes PostgreSQL
  if (err.code === '23505') return res.status(409).json({ erreur: 'Cette valeur existe déjà.' });
  if (err.code === '23503') return res.status(409).json({ erreur: 'Opération impossible : des données y sont liées.' });
  if (err.code === '23502') return res.status(400).json({ erreur: 'Un champ obligatoire est manquant.' });
  if (err.code === '22P02') return res.status(400).json({ erreur: 'Identifiant ou format de donnée invalide.' });
  if (typeof err.code === 'string' && err.code.startsWith('22'))
    return res.status(400).json({ erreur: 'Données invalides.' });
  if (err.code === 'ECONNREFUSED')
    return res.status(503).json({ erreur: 'Base de données injoignable. Contactez l\'administrateur.' });

  if (statut < 500) return res.status(statut).json({ erreur: err.message });

  return res.status(500).json({
    erreur: enProduction()
      ? 'Erreur interne du serveur. L\'incident a été enregistré.'
      : err.message,
  });
}

/* ---------------------------------------------------------------------------
 * Arrêt propre : ferme le pool PostgreSQL avant de quitter (évite les
 * connexions fantômes lors des redémarrages pm2).
 * ------------------------------------------------------------------------- */
export function arretPropre(serveur, pool) {
  const fermer = async (signal) => {
    console.log(`\n${signal} reçu — arrêt propre…`);
    serveur.close(async () => {
      try { await pool?.end(); } catch { /* déjà fermé */ }
      console.log('Serveur et base fermés proprement.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();   // filet de sécurité
  };
  process.on('SIGTERM', () => fermer('SIGTERM'));
  process.on('SIGINT', () => fermer('SIGINT'));
}

// ============================================================================
// MIDDLEWARE D'AUTHENTIFICATION JWT
// ============================================================================
import jwt from 'jsonwebtoken';

// Liste des rôles valides (correspond à la table roles)
export const ROLES = {
  ADMIN: 'ADMIN',
  COMMERCIAL: 'COMMERCIAL',
  CHEF_LABO: 'CHEF_LABO',
  TECHNICIEN: 'TECHNICIEN',
  QUALITE: 'QUALITE',
  COMPTABLE: 'COMPTABLE',
  DIRECTION: 'DIRECTION',
  CLIENT: 'CLIENT',
};

// Configuration JWT
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES || '8h',
  algorithm: 'HS256'
};

// ============================================================
// GÉNÉRATION DE TOKEN
// ============================================================
export function genererToken(utilisateur) {
  const payload = {
    id: utilisateur.id,
    email: utilisateur.email,
    role: utilisateur.role,
    nom: utilisateur.nom,
    prenom: utilisateur.prenom || '',
    laboratoire_id: utilisateur.laboratoire_id || null
  };
  
  return jwt.sign(payload, JWT_CONFIG.secret, {
    expiresIn: JWT_CONFIG.expiresIn,
    algorithm: JWT_CONFIG.algorithm
  });
}

// ============================================================
// VÉRIFICATION DE TOKEN
// ============================================================
export function verifierToken(token) {
  try {
    return jwt.verify(token, JWT_CONFIG.secret);
  } catch (error) {
    return null;
  }
}

// ============================================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================================
export function authRequis(req, res, next) {
  const entete = req.headers.authorization || '';
  const token = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ 
      erreur: 'Authentification requise',
      code: 'NO_TOKEN'
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_CONFIG.secret);
    req.utilisateur = decoded;
    
    // Vérifier l'expiration (double vérification)
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      return res.status(401).json({
        erreur: 'Session expirée, reconnectez-vous',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        erreur: 'Session expirée, reconnectez-vous',
        code: 'TOKEN_EXPIRED'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        erreur: 'Token invalide',
        code: 'INVALID_TOKEN'
      });
    }
    return res.status(401).json({
      erreur: 'Authentification échouée',
      code: 'AUTH_FAILED'
    });
  }
}

// ============================================================
// MIDDLEWARE DE CONTRÔLE DES RÔLES
// ============================================================
export const roles = (...autorises) => (req, res, next) => {
  if (!req.utilisateur) {
    return res.status(401).json({ 
      erreur: 'Authentification requise',
      code: 'NO_TOKEN'
    });
  }
  
  // Vérifier si le rôle de l'utilisateur est dans la liste autorisée
  const roleUtilisateur = req.utilisateur.role;
  const estAutorise = autorises.includes(roleUtilisateur);
  
  // L'ADMIN a tous les droits
  if (roleUtilisateur === ROLES.ADMIN && autorises.length > 0) {
    return next();
  }
  
  if (!estAutorise) {
    return res.status(403).json({
      erreur: `Accès refusé pour le rôle "${roleUtilisateur}". Rôles autorisés: ${autorises.join(', ')}`,
      code: 'INSUFFICIENT_ROLE'
    });
  }
  
  next();
};

// ============================================================
// MIDDLEWARE POUR VÉRIFIER QUE L'UTILISATEUR EST LE PROPRIÉTAIRE
// ============================================================
export const proprietaire = (getUserId) => (req, res, next) => {
  if (!req.utilisateur) {
    return res.status(401).json({ 
      erreur: 'Authentification requise',
      code: 'NO_TOKEN'
    });
  }
  
  // L'ADMIN a tous les droits
  if (req.utilisateur.role === ROLES.ADMIN) {
    return next();
  }
  
  const proprietaireId = getUserId(req);
  if (req.utilisateur.id !== proprietaireId) {
    return res.status(403).json({
      erreur: 'Vous n\'êtes pas autorisé à accéder à cette ressource',
      code: 'NOT_OWNER'
    });
  }
  
  next();
};

// ============================================================
// MIDDLEWARE POUR LES ROUTES PUBLIQUES (VÉRIFICATION OPTIONNELLE)
// ============================================================
export const authOptionnel = (req, res, next) => {
  const entete = req.headers.authorization || '';
  const token = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  
  if (token) {
    try {
      req.utilisateur = jwt.verify(token, JWT_CONFIG.secret);
    } catch {
      req.utilisateur = null;
    }
  }
  next();
};

// ============================================================
// MIDDLEWARE POUR RAFRAÎCHIR LE TOKEN
// ============================================================
export function rafraichirToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return next();
  }
  
  try {
    const decoded = jwt.verify(token, JWT_CONFIG.secret);
    // Rafraîchir si le token a plus de 4 heures
    const now = Math.floor(Date.now() / 1000);
    if (decoded.iat && (now - decoded.iat) > 14400) { // 4 heures
      const nouveauToken = genererToken(decoded);
      res.setHeader('X-New-Token', nouveauToken);
    }
  } catch (error) {
    // Ignorer les erreurs
  }
  next();
}

// ============================================================
// EXPORT PAR DÉFAUT
// ============================================================
export default {
  authRequis,
  roles,
  proprietaire,
  authOptionnel,
  rafraichirToken,
  genererToken,
  verifierToken,
  ROLES,
  JWT_CONFIG
};
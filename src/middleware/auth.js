// ============================================================================
// MIDDLEWARE D'AUTHENTIFICATION JWT
// ============================================================================
import jwt from 'jsonwebtoken';

// Liste des rôles valides
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

// Middleware d'authentification
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.utilisateur = decoded;
    
    // Vérifier l'expiration
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

// Middleware de contrôle des rôles
export const roles = (...autorises) => (req, res, next) => {
  if (!req.utilisateur) {
    return res.status(401).json({ erreur: 'Authentification requise' });
  }
  
  if (!autorises.includes(req.utilisateur.role)) {
    return res.status(403).json({
      erreur: `Accès refusé pour le rôle "${req.utilisateur.role}". Rôles autorisés: ${autorises.join(', ')}`,
      code: 'INSUFFICIENT_ROLE'
    });
  }
  next();
};

// Middleware pour vérifier que l'utilisateur est le propriétaire
export const proprietaire = (getUserId) => (req, res, next) => {
  if (!req.utilisateur) {
    return res.status(401).json({ erreur: 'Authentification requise' });
  }
  
  const proprietaireId = getUserId(req);
  if (req.utilisateur.id !== proprietaireId && req.utilisateur.role !== ROLES.ADMIN) {
    return res.status(403).json({
      erreur: 'Vous n\'êtes pas autorisé à accéder à cette ressource',
      code: 'NOT_OWNER'
    });
  }
  next();
};

// Middleware pour les routes publiques (vérification optionnelle)
export const authOptionnel = (req, res, next) => {
  const entete = req.headers.authorization || '';
  const token = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  
  if (token) {
    try {
      req.utilisateur = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      // Ignorer les tokens invalides
      req.utilisateur = null;
    }
  }
  next();
};

export default {
  authRequis,
  roles,
  proprietaire,
  authOptionnel,
  ROLES,
};
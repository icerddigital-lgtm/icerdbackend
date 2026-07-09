// backend/src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from '../db.js';
import { authRequis, roles, ROLES } from '../middleware/auth.js';
import { limiteurConnexion } from '../middleware/securite.js';

const r = Router();

// ============================================================
// POST /api/auth/connexion - Connexion utilisateur
// ============================================================
r.post('/connexion', limiteurConnexion, async (req, res, next) => {
  try {
    const { email, mot_de_passe } = req.body;
    
    // Validation des champs requis
    if (!email || !mot_de_passe) {
      return res.status(400).json({ 
        erreur: 'Email et mot de passe requis' 
      });
    }

    const { rows } = await q(
      `SELECT u.*, r.code AS role FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1 AND u.actif = true`, 
      [email.toLowerCase().trim()]
    );
    
    const u = rows[0];
    if (!u) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    // Vérifier le mot de passe
    const motDePasseValide = await bcrypt.compare(mot_de_passe, u.mot_de_passe);
    if (!motDePasseValide) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    // Mettre à jour la dernière connexion
    await q(`UPDATE utilisateurs SET derniere_conn = NOW() WHERE id = $1`, [u.id]);
    
    // Journaliser la connexion (optionnel - si la table existe)
    try {
      await q(
        `INSERT INTO audit_log (utilisateur_id, action, table_cible) 
         VALUES ($1, 'LOGIN', 'utilisateurs')`, 
        [u.id]
      );
    } catch (e) {
      // Ignorer si la table audit_log n'existe pas
      console.log('ℹ️ Audit log non disponible');
    }

    // Générer le token JWT
    const token = jwt.sign(
      { 
        id: u.id, 
        role: u.role, 
        nom: u.nom,
        prenom: u.prenom || '',
        email: u.email,
        labo: u.laboratoire_id || null
      },
      process.env.JWT_SECRET, 
      { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );

    res.json({ 
      token, 
      utilisateur: { 
        id: u.id, 
        nom: u.nom, 
        prenom: u.prenom, 
        email: u.email, 
        role: u.role,
        telephone: u.telephone || null
      } 
    });
  } catch (e) { 
    console.error('❌ Erreur connexion:', e);
    next(e); 
  }
});

// ============================================================
// GET /api/auth/moi - Profil de l'utilisateur connecté
// ============================================================
r.get('/moi', authRequis, (req, res) => {
  res.json({
    id: req.utilisateur.id,
    nom: req.utilisateur.nom,
    prenom: req.utilisateur.prenom || '',
    email: req.utilisateur.email,
    role: req.utilisateur.role,
    labo: req.utilisateur.labo || null
  });
});

// ============================================================
// POST /api/auth/utilisateurs - Création de compte (admin uniquement)
// ============================================================
r.post('/utilisateurs', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { nom, prenom, email, telephone, mot_de_passe, role_code, laboratoire_id } = req.body;
    
    // Validation
    if (!nom || !email || !mot_de_passe || !role_code) {
      return res.status(400).json({ 
        erreur: 'Nom, email, mot de passe et rôle sont requis' 
      });
    }

    // Vérifier si l'email existe déjà
    const existant = await q(`SELECT id FROM utilisateurs WHERE email = $1`, [email.toLowerCase().trim()]);
    if (existant.rows.length > 0) {
      return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    }

    const hash = await bcrypt.hash(mot_de_passe, 12);
    const { rows } = await q(
      `INSERT INTO utilisateurs (nom, prenom, email, telephone, mot_de_passe, role_id, laboratoire_id, actif)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM roles WHERE code = $6), $7, true)
       RETURNING id, nom, prenom, email, telephone`,
      [
        nom.trim(), 
        prenom?.trim() || '', 
        email.toLowerCase().trim(), 
        telephone || null, 
        hash, 
        role_code.toUpperCase(), 
        laboratoire_id || null
      ]
    );
    
    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      utilisateur: rows[0]
    });
  } catch (e) { 
    console.error('❌ Erreur création utilisateur:', e);
    next(e); 
  }
});

// ============================================================
// GET /api/auth/utilisateurs - Liste des utilisateurs (admin uniquement)
// ============================================================
r.get('/utilisateurs', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT 
         u.id, 
         u.nom, 
         u.prenom, 
         u.email, 
         u.telephone, 
         u.actif, 
         u.cree_le, 
         u.derniere_conn,
         r.code AS role_code, 
         r.id AS role_id, 
         l.code AS laboratoire_code,
         l.nom AS laboratoire_nom
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN laboratoires l ON l.id = u.laboratoire_id
       ORDER BY u.cree_le DESC`
    );
    res.json(rows);
  } catch (e) { 
    console.error('❌ Erreur liste utilisateurs:', e);
    next(e); 
  }
});

// ============================================================
// GET /api/auth/utilisateurs/:id - Détail d'un utilisateur (admin uniquement)
// ============================================================
r.get('/utilisateurs/:id', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT 
         u.id, u.nom, u.prenom, u.email, u.telephone, u.actif, u.cree_le, u.derniere_conn,
         r.code AS role_code, r.id AS role_id,
         l.code AS laboratoire_code, l.nom AS laboratoire_nom
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN laboratoires l ON l.id = u.laboratoire_id
       WHERE u.id = $1`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }
    
    res.json(rows[0]);
  } catch (e) { 
    console.error('❌ Erreur détail utilisateur:', e);
    next(e); 
  }
});

// ============================================================
// PATCH /api/auth/utilisateurs/:id - Modifier un utilisateur (admin uniquement)
// ============================================================
r.patch('/utilisateurs/:id', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { nom, prenom, email, telephone, role_code, actif, mot_de_passe } = req.body;
    
    // Vérifier que l'utilisateur existe
    const existant = await q(`SELECT id, email FROM utilisateurs WHERE id = $1`, [req.params.id]);
    if (existant.rows.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }

    // Si email modifié, vérifier qu'il n'est pas déjà pris
    if (email) {
      const doublon = await q(
        `SELECT id FROM utilisateurs WHERE email = $1 AND id != $2`,
        [email.toLowerCase().trim(), req.params.id]
      );
      if (doublon.rows.length > 0) {
        return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
      }
    }

    let query = `UPDATE utilisateurs SET
       nom = COALESCE($1, nom),
       prenom = COALESCE($2, prenom),
       email = COALESCE($3, email),
       telephone = COALESCE($4, telephone),
       role_id = COALESCE((SELECT id FROM roles WHERE code = $5), role_id),
       actif = COALESCE($6, actif)`;
    let params = [
      nom?.trim() || null, 
      prenom?.trim() || null, 
      email?.toLowerCase().trim() || null, 
      telephone || null, 
      role_code?.toUpperCase() || null, 
      actif !== undefined ? actif : null, 
      req.params.id
    ];
    
    // Si un nouveau mot de passe est fourni, le hacher
    if (mot_de_passe && mot_de_passe.length > 0) {
      const hash = await bcrypt.hash(mot_de_passe, 12);
      query += `, mot_de_passe = $8`;
      params.push(hash);
    }
    
    query += ` WHERE id = $7 RETURNING id, nom, prenom, email, telephone, actif`;
    
    const { rows } = await q(query, params);
    res.json({
      message: 'Utilisateur modifié avec succès',
      utilisateur: rows[0]
    });
  } catch (e) { 
    console.error('❌ Erreur modification utilisateur:', e);
    next(e); 
  }
});

// ============================================================
// DELETE /api/auth/utilisateurs/:id - Supprimer un utilisateur (admin uniquement)
// ============================================================
r.delete('/utilisateurs/:id', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
    // Vérifier que l'utilisateur existe
    const existant = await q(`SELECT id, email FROM utilisateurs WHERE id = $1`, [req.params.id]);
    if (existant.rows.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }

    // Ne pas supprimer l'admin principal
    const email = existant.rows[0].email;
    if (email === 'admin@icerd.cm') {
      return res.status(403).json({ 
        erreur: 'Impossible de supprimer l\'administrateur principal' 
      });
    }
    
    // Ne pas permettre à un admin de se supprimer lui-même
    if (req.utilisateur.id === req.params.id) {
      return res.status(403).json({ 
        erreur: 'Vous ne pouvez pas supprimer votre propre compte' 
      });
    }

    await q(`DELETE FROM utilisateurs WHERE id = $1`, [req.params.id]);
    
    res.json({ 
      message: 'Utilisateur supprimé avec succès' 
    });
  } catch (e) { 
    console.error('❌ Erreur suppression utilisateur:', e);
    next(e); 
  }
});

// ============================================================
// POST /api/auth/deconnexion - Déconnexion (frontend uniquement)
// ============================================================
r.post('/deconnexion', authRequis, async (req, res) => {
  try {
    // Journaliser la déconnexion (optionnel)
    try {
      await q(
        `INSERT INTO audit_log (utilisateur_id, action, table_cible) 
         VALUES ($1, 'LOGOUT', 'utilisateurs')`, 
        [req.utilisateur.id]
      );
    } catch (e) {
      // Ignorer si la table audit_log n'existe pas
    }
    
    res.json({ message: 'Déconnexion réussie' });
  } catch (e) {
    res.json({ message: 'Déconnexion réussie' });
  }
});

export default r;
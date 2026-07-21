// backend/src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q, pool } from '../db.js';
import { authRequis, roles, ROLES } from '../middleware/auth.js';
import { limiteurConnexion } from '../middleware/securite.js';

const r = Router();

// ============================================================
// POST /api/auth/connexion - Connexion utilisateur
// ============================================================
r.post('/connexion', limiteurConnexion, async (req, res, next) => {
  try {
    const { email, mot_de_passe } = req.body;
    
    if (!email || !mot_de_passe) {
      return res.status(400).json({ 
        erreur: 'Email et mot de passe requis' 
      });
    }

    const { rows } = await q(
      `SELECT u.*, r.code AS role, c.id AS client_id, c.raison_sociale
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN clients c ON c.id = u.client_id
       WHERE u.email = $1 AND u.actif = true`, 
      [email.toLowerCase().trim()]
    );
    
    const u = rows[0];
    if (!u) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    const motDePasseValide = await bcrypt.compare(mot_de_passe, u.mot_de_passe);
    if (!motDePasseValide) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    await q(`UPDATE utilisateurs SET derniere_conn = NOW() WHERE id = $1`, [u.id]);
    
    // Journaliser la connexion
    try {
      await q(
        `INSERT INTO audit_log (utilisateur_id, action, table_cible) 
         VALUES ($1, 'LOGIN', 'utilisateurs')`, 
        [u.id]
      );
    } catch (e) {
      // Ignorer si la table n'existe pas
    }

    const token = jwt.sign(
      { 
        id: u.id, 
        role: u.role, 
        nom: u.nom,
        prenom: u.prenom || '',
        email: u.email,
        labo: u.laboratoire_id || null,
        client_id: u.client_id || null
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
        telephone: u.telephone || null,
        client_id: u.client_id || null,
        client_raison_sociale: u.raison_sociale || null
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
r.get('/moi', authRequis, async (req, res) => {
  try {
    const { rows } = await q(
      `SELECT u.*, r.code AS role, c.id AS client_id, c.raison_sociale
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN clients c ON c.id = u.client_id
       WHERE u.id = $1`,
      [req.utilisateur.id]
    );
    
    const u = rows[0];
    res.json({
      id: u.id,
      nom: u.nom,
      prenom: u.prenom || '',
      email: u.email,
      role: u.role,
      labo: u.laboratoire_id || null,
      client_id: u.client_id || null,
      client_raison_sociale: u.raison_sociale || null
    });
  } catch (e) {
    console.error('❌ Erreur profil:', e);
    res.status(500).json({ erreur: 'Erreur lors du chargement du profil' });
  }
});

// ============================================================
// POST /api/auth/utilisateurs - Création de compte (admin)
// ============================================================
r.post('/utilisateurs', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const { nom, prenom, email, telephone, mot_de_passe, role_code, laboratoire_id } = req.body;
    
    if (!nom || !email || !mot_de_passe || !role_code) {
      return res.status(400).json({ 
        erreur: 'Nom, email, mot de passe et rôle sont requis' 
      });
    }

    // Vérifier si l'email existe déjà
    const existant = await cx.query(`SELECT id FROM utilisateurs WHERE email = $1`, [email.toLowerCase().trim()]);
    if (existant.rows.length > 0) {
      return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    }

    await cx.query('BEGIN');
    
    const hash = await bcrypt.hash(mot_de_passe, 12);
    
    // 1. Créer l'utilisateur
    const userResult = await cx.query(
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
    
    const user = userResult.rows[0];
    let clientId = null;
    let client = null;
    
    // 2. Si le rôle est CLIENT, créer automatiquement le client associé
    if (role_code.toUpperCase() === 'CLIENT') {
      const clientResult = await cx.query(
        `INSERT INTO clients (code, raison_sociale, contact_nom, email, telephone, type, utilisateur_id)
         VALUES (
           genere_numero('CLI','seq_client'),
           COALESCE($1, $2 || ' ' || $3),
           $2 || ' ' || $3,
           $4,
           $5,
           'PARTICULIER',
           $6
         )
         RETURNING id, code, raison_sociale`,
        [nom.trim(), prenom?.trim() || '', nom.trim(), email.toLowerCase().trim(), telephone || null, user.id]
      );
      clientId = clientResult.rows[0].id;
      client = clientResult.rows[0];
      
      // Mettre à jour l'utilisateur avec le client_id
      await cx.query(
        `UPDATE utilisateurs SET client_id = $1 WHERE id = $2`,
        [clientId, user.id]
      );
    }
    
    await cx.query('COMMIT');
    
    res.status(201).json({
      message: '✅ Utilisateur créé avec succès',
      utilisateur: { 
        ...user, 
        client_id: clientId || null 
      },
      client: client || null
    });
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('❌ Erreur création utilisateur:', e);
    next(e);
  } finally {
    cx.release();
  }
});

// ============================================================
// GET /api/auth/utilisateurs - Liste des utilisateurs
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
         u.client_id,
         r.code AS role_code, 
         r.id AS role_id, 
         l.code AS laboratoire_code,
         l.nom AS laboratoire_nom,
         c.raison_sociale AS client_raison_sociale
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN laboratoires l ON l.id = u.laboratoire_id
       LEFT JOIN clients c ON c.id = u.client_id
       ORDER BY u.cree_le DESC`
    );
    res.json(rows);
  } catch (e) { 
    console.error('❌ Erreur liste utilisateurs:', e);
    next(e); 
  }
});

// ============================================================
// GET /api/auth/utilisateurs/:id - Détail d'un utilisateur
// ============================================================
r.get('/utilisateurs/:id', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT 
         u.id, u.nom, u.prenom, u.email, u.telephone, u.actif, u.cree_le, u.derniere_conn,
         u.client_id,
         r.code AS role_code, r.id AS role_id,
         l.code AS laboratoire_code, l.nom AS laboratoire_nom,
         c.raison_sociale AS client_raison_sociale
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN laboratoires l ON l.id = u.laboratoire_id
       LEFT JOIN clients c ON c.id = u.client_id
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
// PATCH /api/auth/utilisateurs/:id - Modifier un utilisateur
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
// PATCH /api/auth/utilisateurs/:id/lier-client - Lier un client à un utilisateur
// ============================================================
r.patch('/utilisateurs/:id/lier-client', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const { client_id } = req.body;
    const userId = req.params.id;
    
    if (!client_id) {
      return res.status(400).json({ erreur: 'client_id est requis' });
    }
    
    // Vérifier que l'utilisateur existe
    const user = await cx.query(`SELECT id, role_id FROM utilisateurs WHERE id = $1`, [userId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }
    
    // Vérifier le rôle
    const role = await cx.query(`SELECT code FROM roles WHERE id = $1`, [user.rows[0].role_id]);
    if (role.rows[0].code !== 'CLIENT') {
      return res.status(400).json({ erreur: 'Seul un utilisateur de rôle CLIENT peut être lié à un client' });
    }
    
    // Vérifier que le client existe
    const client = await cx.query(`SELECT id FROM clients WHERE id = $1`, [client_id]);
    if (client.rows.length === 0) {
      return res.status(404).json({ erreur: 'Client non trouvé' });
    }
    
    // Vérifier que le client n'est pas déjà lié
    const existing = await cx.query(`SELECT id FROM clients WHERE utilisateur_id = $1`, [userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ erreur: 'Cet utilisateur est déjà lié à un client' });
    }
    
    await cx.query('BEGIN');
    
    // Mettre à jour le client
    await cx.query(`UPDATE clients SET utilisateur_id = $1 WHERE id = $2`, [userId, client_id]);
    
    // Mettre à jour l'utilisateur
    await cx.query(`UPDATE utilisateurs SET client_id = $1 WHERE id = $2`, [client_id, userId]);
    
    // Journaliser
    await cx.query(
      `INSERT INTO audit_log (utilisateur_id, action, table_cible, nouvelle_valeur)
       VALUES ($1, 'LINK_CLIENT', 'utilisateurs', $2)`,
      [req.utilisateur.id, JSON.stringify({ utilisateur_id: userId, client_id })]
    );
    
    await cx.query('COMMIT');
    
    res.json({ 
      message: 'Client lié avec succès à l\'utilisateur',
      utilisateur_id: userId,
      client_id: client_id
    });
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('❌ Erreur liaison client-utilisateur:', e);
    next(e);
  } finally {
    cx.release();
  }
});

// ============================================================
// DELETE /api/auth/utilisateurs/:id - Supprimer un utilisateur
// ============================================================
r.delete('/utilisateurs/:id', authRequis, roles(ROLES.ADMIN), async (req, res, next) => {
  try {
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
// POST /api/auth/deconnexion - Déconnexion
// ============================================================
r.post('/deconnexion', authRequis, async (req, res) => {
  try {
    try {
      await q(
        `INSERT INTO audit_log (utilisateur_id, action, table_cible) 
         VALUES ($1, 'LOGOUT', 'utilisateurs')`, 
        [req.utilisateur.id]
      );
    } catch (e) {
      // Ignorer
    }
    res.json({ message: 'Déconnexion réussie' });
  } catch (e) {
    res.json({ message: 'Déconnexion réussie' });
  }
});

export default r;
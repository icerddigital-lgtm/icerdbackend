// backend/src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { q } from '../db.js';
import { authRequis } from '../middleware/auth.js';
import { limiteurConnexion } from '../middleware/securite.js';

const r = Router();

// POST /api/auth/connexion
r.post('/connexion', limiteurConnexion, async (req, res, next) => {
  try {
    const { email, mot_de_passe } = req.body;
    const { rows } = await q(
      `SELECT u.*, r.code AS role FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1 AND u.actif`, 
      [email]
    );
    const u = rows[0];
    if (!u || !(await bcrypt.compare(mot_de_passe || '', u.mot_de_passe))) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
    }

    await q(`UPDATE utilisateurs SET derniere_conn = now() WHERE id = $1`, [u.id]);
    await q(`INSERT INTO audit_log (utilisateur_id, action, table_cible) VALUES ($1,'LOGIN','utilisateurs')`, [u.id]);

    const token = jwt.sign(
      { id: u.id, role: u.role, nom: `${u.prenom} ${u.nom}`, labo: u.laboratoire_id },
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
        role: u.role 
      } 
    });
  } catch (e) { next(e); }
});

// GET /api/auth/moi — profil de l'utilisateur connecté
r.get('/moi', authRequis, (req, res) => res.json(req.utilisateur));

// POST /api/auth/utilisateurs — création de compte (admin)
r.post('/utilisateurs', authRequis, async (req, res, next) => {
  try {
    if (req.utilisateur.role !== 'ADMIN') {
      return res.status(403).json({ erreur: 'Réservé à l\'administrateur' });
    }
    const { nom, prenom, email, telephone, mot_de_passe, role_code, laboratoire_id } = req.body;
    const hash = await bcrypt.hash(mot_de_passe, 12);
    const { rows } = await q(
      `INSERT INTO utilisateurs (nom, prenom, email, telephone, mot_de_passe, role_id, laboratoire_id)
       VALUES ($1,$2,$3,$4,$5,(SELECT id FROM roles WHERE code=$6),$7)
       RETURNING id, nom, prenom, email`,
      [nom, prenom, email, telephone, hash, role_code, laboratoire_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ GET /api/auth/utilisateurs - Liste des utilisateurs (admin uniquement)
r.get('/utilisateurs', authRequis, async (req, res, next) => {
  try {
    if (req.utilisateur.role !== 'ADMIN') {
      return res.status(403).json({ erreur: 'Réservé à l\'administrateur' });
    }
    const { rows } = await q(
      `SELECT u.id, u.nom, u.prenom, u.email, u.telephone, u.actif, u.cree_le, u.derniere_conn,
              r.code AS role_code, r.id AS role_id, l.code AS laboratoire_code
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN laboratoires l ON l.id = u.laboratoire_id
       ORDER BY u.cree_le DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ✅ PATCH /api/auth/utilisateurs/:id - Modifier un utilisateur (admin uniquement)
r.patch('/utilisateurs/:id', authRequis, async (req, res, next) => {
  try {
    if (req.utilisateur.role !== 'ADMIN') {
      return res.status(403).json({ erreur: 'Réservé à l\'administrateur' });
    }
    const { nom, prenom, email, telephone, role_code, actif, mot_de_passe } = req.body;
    
    let query = `UPDATE utilisateurs SET
       nom = COALESCE($1, nom),
       prenom = COALESCE($2, prenom),
       email = COALESCE($3, email),
       telephone = COALESCE($4, telephone),
       role_id = COALESCE((SELECT id FROM roles WHERE code = $5), role_id),
       actif = COALESCE($6, actif)`;
    let params = [nom, prenom, email, telephone, role_code, actif, req.params.id];
    
    // Si un nouveau mot de passe est fourni, le hacher
    if (mot_de_passe && mot_de_passe.length > 0) {
      const hash = await bcrypt.hash(mot_de_passe, 12);
      query += `, mot_de_passe = $8`;
      params.push(hash);
    }
    
    query += ` WHERE id = $7 RETURNING id, nom, prenom, email, telephone, actif`;
    
    const { rows } = await q(query, params);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ DELETE /api/auth/utilisateurs/:id - Supprimer un utilisateur (admin uniquement)
r.delete('/utilisateurs/:id', authRequis, async (req, res, next) => {
  try {
    if (req.utilisateur.role !== 'ADMIN') {
      return res.status(403).json({ erreur: 'Réservé à l\'administrateur' });
    }
    // Ne pas supprimer l'admin principal
    const adminCheck = await q(`SELECT email FROM utilisateurs WHERE id = $1`, [req.params.id]);
    if (adminCheck.rows[0]?.email === 'admin@icerd.cm') {
      return res.status(403).json({ erreur: 'Impossible de supprimer l\'administrateur principal' });
    }
    const { rows } = await q(`DELETE FROM utilisateurs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Utilisateur non trouvé' });
    }
    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (e) { next(e); }
});

export default r;
// backend/src/routes/clients.js
import { Router } from 'express';
import { q, pool } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';

const r = Router();
r.use(authRequis);

// GET /api/clients - Liste des clients
r.get('/', async (req, res, next) => {
  try {
    const { recherche } = req.query;
    const { rows } = await q(
      `SELECT c.*, u.id AS utilisateur_id, u.email AS utilisateur_email
       FROM clients c
       LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
       WHERE ($1::text IS NULL OR c.raison_sociale ILIKE '%'||$1||'%' OR c.code ILIKE '%'||$1||'%')
       ORDER BY c.cree_le DESC LIMIT 200`, 
      [recherche || null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/clients/avec-comptes - Clients avec leurs comptes utilisateur
r.get('/avec-comptes', roles('ADMIN','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  try {
    const { recherche } = req.query;
    const { rows } = await q(
      `SELECT 
         c.*,
         u.id AS utilisateur_id,
         u.email AS utilisateur_email,
         u.actif AS utilisateur_actif,
         u.derniere_conn AS derniere_connexion,
         u.cree_le AS compte_cree_le
       FROM clients c
       LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
       WHERE ($1::text IS NULL OR c.raison_sociale ILIKE '%'||$1||'%' OR c.code ILIKE '%'||$1||'%')
       ORDER BY c.cree_le DESC LIMIT 200`,
      [recherche || null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/clients - Créer un client (sans compte utilisateur)
r.post('/', roles('ADMIN','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  try {
    const c = req.body;
    const { rows } = await q(
      `INSERT INTO clients (code, type, raison_sociale, contact_nom, email, telephone, adresse, ville, nui, notes)
       VALUES (genere_numero('CLI','seq_client'),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c.type || 'PARTICULIER', c.raison_sociale, c.contact_nom, c.email, c.telephone, c.adresse, c.ville, c.nui, c.notes]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// POST /api/clients/avec-compte - Créer un client avec son compte utilisateur
r.post('/avec-compte', roles('ADMIN','DIRECTION'), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const { 
      raison_sociale, contact_nom, email, telephone, adresse, ville, 
      type, mot_de_passe, nui, notes 
    } = req.body;
    
    if (!raison_sociale || !email || !mot_de_passe) {
      return res.status(400).json({ 
        erreur: 'La raison sociale, l\'email et le mot de passe sont requis' 
      });
    }

    // Vérifier si l'email existe déjà
    const existant = await cx.query(`SELECT id FROM utilisateurs WHERE email = $1`, [email.toLowerCase().trim()]);
    if (existant.rows.length > 0) {
      return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    }

    await cx.query('BEGIN');
    
    // 1. Créer le client
    const clientResult = await cx.query(
      `INSERT INTO clients (code, raison_sociale, contact_nom, email, telephone, adresse, ville, type, nui, notes)
       VALUES (genere_numero('CLI','seq_client'), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [raison_sociale, contact_nom || raison_sociale, email, telephone, adresse, ville, type || 'PARTICULIER', nui, notes]
    );
    
    const client = clientResult.rows[0];
    
    // 2. Créer l'utilisateur associé
    const hash = await bcrypt.hash(mot_de_passe, 12);
    const userResult = await cx.query(
      `INSERT INTO utilisateurs (nom, prenom, email, telephone, mot_de_passe, role_id, client_id, actif)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM roles WHERE code = 'CLIENT'), $6, true)
       RETURNING id, nom, prenom, email, telephone`,
      [raison_sociale.slice(0, 80), '', email.toLowerCase().trim(), telephone || null, hash, client.id]
    );
    
    const user = userResult.rows[0];
    
    // 3. Mettre à jour le client avec l'utilisateur_id
    await cx.query(
      `UPDATE clients SET utilisateur_id = $1 WHERE id = $2`,
      [user.id, client.id]
    );
    
    await cx.query('COMMIT');
    
    res.status(201).json({
      message: '✅ Client et compte utilisateur créés avec succès',
      client: { ...client, utilisateur_id: user.id },
      utilisateur: { ...user, client_id: client.id }
    });
  } catch (e) {
    await cx.query('ROLLBACK');
    console.error('❌ Erreur création client avec compte:', e);
    next(e);
  } finally {
    cx.release();
  }
});

// GET /api/clients/:id - Détail d'un client
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT c.*, u.id AS utilisateur_id, u.email AS utilisateur_email, u.actif AS utilisateur_actif
       FROM clients c
       LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Client introuvable' });
    
    const demandes = await q(
      `SELECT numero, statut, date_reception FROM demandes WHERE client_id = $1 ORDER BY date_reception DESC`, 
      [req.params.id]
    );
    res.json({ ...rows[0], demandes: demandes.rows });
  } catch (e) { next(e); }
});

// PATCH /api/clients/:id - Modifier un client
r.patch('/:id', roles('ADMIN','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  try {
    const c = req.body;
    const { rows } = await q(
      `UPDATE clients SET
         type = COALESCE($1, type),
         raison_sociale = COALESCE($2, raison_sociale),
         contact_nom = COALESCE($3, contact_nom),
         email = COALESCE($4, email),
         telephone = COALESCE($5, telephone),
         adresse = COALESCE($6, adresse),
         ville = COALESCE($7, ville),
         nui = COALESCE($8, nui),
         notes = COALESCE($9, notes)
       WHERE id = $10
       RETURNING *`,
      [c.type, c.raison_sociale, c.contact_nom, c.email, c.telephone, 
       c.adresse, c.ville, c.nui, c.notes, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Client non trouvé' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// DELETE /api/clients/:id - Supprimer un client
r.delete('/:id', roles('ADMIN','DIRECTION'), async (req, res, next) => {
  try {
    // Vérifier si le client a des demandes
    const check = await q(`SELECT COUNT(*) FROM demandes WHERE client_id = $1`, [req.params.id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ 
        erreur: 'Impossible de supprimer ce client car il a des demandes associées' 
      });
    }
    const { rows } = await q(`DELETE FROM clients WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Client non trouvé' });
    }
    res.json({ message: 'Client supprimé avec succès' });
  } catch (e) { next(e); }
});

export default r;
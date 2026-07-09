// backend/src/routes/partenaires.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// ============================================================
// ROUTES PUBLIQUES
// ============================================================

// GET /api/partenaires - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { type } = req.query;
    let query = `
      SELECT p.*, u.nom AS contact_nom, u.prenom AS contact_prenom
      FROM partenaires p
      LEFT JOIN utilisateurs u ON u.id = p.contact_id
      WHERE p.publie = true
    `;
    const params = [];

    if (type && type !== 'TOUS') {
      query += ` AND p.type = $1`;
      params.push(type);
    }

    query += ` ORDER BY p.nom ASC`;
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/partenaires/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.*, u.nom AS contact_nom, u.prenom AS contact_prenom
       FROM partenaires p
       LEFT JOIN utilisateurs u ON u.id = p.contact_id
       WHERE p.id = $1 AND p.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Partenaire non trouvé' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ============================================================
// ROUTES PROTÉGÉES (ADMIN)
// ============================================================

r.use(authRequis);

// GET /api/partenaires/admin - Liste complète (admin)
r.get('/admin', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { type } = req.query;
    let query = `
      SELECT p.*, u.nom AS contact_nom, u.prenom AS contact_prenom
      FROM partenaires p
      LEFT JOIN utilisateurs u ON u.id = p.contact_id
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'TOUS') {
      query += ` AND p.type = $1`;
      params.push(type);
    }

    query += ` ORDER BY p.nom ASC`;
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// POST /api/partenaires - Créer un partenaire
r.post('/', roles('ADMIN', 'DIRECTION', 'COMMERCIAL'), async (req, res, next) => {
  try {
    const { nom, type, description, site, email, telephone, logo_url, adresse } = req.body;
    
    if (!nom) {
      return res.status(400).json({ erreur: 'Le nom est obligatoire' });
    }

    const { rows } = await q(
      `INSERT INTO partenaires (nom, type, description, site, email, telephone, logo_url, adresse, contact_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [nom, type, description || null, site || null, email || null, telephone || null, logo_url || null, adresse || null, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    // Gestion des erreurs de duplication
    if (e.code === '23505') {
      return res.status(409).json({ erreur: 'Un partenaire avec ce nom existe déjà' });
    }
    next(e);
  }
});

// PATCH /api/partenaires/:id - Modifier un partenaire
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { nom, type, description, site, email, telephone, logo_url, adresse, publie } = req.body;
    const { rows } = await q(
      `UPDATE partenaires SET
         nom = COALESCE($1, nom),
         type = COALESCE($2, type),
         description = COALESCE($3, description),
         site = COALESCE($4, site),
         email = COALESCE($5, email),
         telephone = COALESCE($6, telephone),
         logo_url = COALESCE($7, logo_url),
         adresse = COALESCE($8, adresse),
         publie = COALESCE($9, publie),
         date_modification = NOW()
       WHERE id = $10
       RETURNING *`,
      [nom, type, description, site, email, telephone, logo_url, adresse, publie, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Partenaire non trouvé' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/partenaires/:id - Supprimer un partenaire
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM partenaires WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Partenaire non trouvé' });
    }
    res.json({ message: 'Partenaire supprimé avec succès' });
  } catch (e) { next(e); }
});

export default r;
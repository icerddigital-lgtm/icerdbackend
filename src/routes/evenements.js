// backend/src/routes/evenements.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// GET /api/evenements - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { type, date_debut, date_fin } = req.query;
    let query = `
      SELECT e.*, u.nom AS organisateur_nom, u.prenom AS organisateur_prenom
      FROM evenements e
      LEFT JOIN utilisateurs u ON u.id = e.organisateur_id
      WHERE e.publie = true
    `;
    const params = [];
    let paramIndex = 1;

    if (type && type !== 'TOUS') {
      query += ` AND e.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (date_debut) {
      query += ` AND e.date >= $${paramIndex}`;
      params.push(date_debut);
      paramIndex++;
    }

    if (date_fin) {
      query += ` AND e.date <= $${paramIndex}`;
      params.push(date_fin);
      paramIndex++;
    }

    query += ` ORDER BY e.date ASC`;
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/evenements/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT e.*, u.nom AS organisateur_nom, u.prenom AS organisateur_prenom
       FROM evenements e
       LEFT JOIN utilisateurs u ON u.id = e.organisateur_id
       WHERE e.id = $1 AND e.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Événement non trouvé' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/evenements - Créer (admin)
r.post('/', roles('ADMIN', 'DIRECTION', 'COMMERCIAL'), async (req, res, next) => {
  try {
    const { titre, type, date, date_fin, lieu, description, image_url, lien_inscription } = req.body;
    const { rows } = await q(
      `INSERT INTO evenements (titre, type, date, date_fin, lieu, description, image_url, lien_inscription, organisateur_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [titre, type, date, date_fin || null, lieu, description, image_url || null, lien_inscription || null, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/evenements/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, type, date, date_fin, lieu, description, image_url, lien_inscription, publie } = req.body;
    const { rows } = await q(
      `UPDATE evenements SET
         titre = COALESCE($1, titre),
         type = COALESCE($2, type),
         date = COALESCE($3, date),
         date_fin = COALESCE($4, date_fin),
         lieu = COALESCE($5, lieu),
         description = COALESCE($6, description),
         image_url = COALESCE($7, image_url),
         lien_inscription = COALESCE($8, lien_inscription),
         publie = COALESCE($9, publie)
       WHERE id = $10
       RETURNING *`,
      [titre, type, date, date_fin, lieu, description, image_url, lien_inscription, publie, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Événement non trouvé' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/evenements/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM evenements WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Événement non trouvé' });
    }
    res.json({ message: 'Événement supprimé' });
  } catch (e) { next(e); }
});

export default r;
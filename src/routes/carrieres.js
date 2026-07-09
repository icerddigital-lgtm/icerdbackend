// backend/src/routes/carrieres.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// GET /api/carrieres - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { type, actif } = req.query;
    let query = `
      SELECT c.*, u.nom AS recruteur_nom, u.prenom AS recruteur_prenom
      FROM carrieres c
      LEFT JOIN utilisateurs u ON u.id = c.recruteur_id
      WHERE c.publie = true
    `;
    const params = [];
    let paramIndex = 1;

    if (type && type !== 'TOUS') {
      query += ` AND c.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (actif === 'true') {
      query += ` AND (c.date_limite IS NULL OR c.date_limite >= CURRENT_DATE)`;
    }

    query += ` ORDER BY c.date_publication DESC`;
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/carrieres/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT c.*, u.nom AS recruteur_nom, u.prenom AS recruteur_prenom
       FROM carrieres c
       LEFT JOIN utilisateurs u ON u.id = c.recruteur_id
       WHERE c.id = $1 AND c.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Offre non trouvée' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/carrieres - Créer (admin)
r.post('/', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, type, lieu, date_publication, date_limite, description, contact, image_url } = req.body;
    const { rows } = await q(
      `INSERT INTO carrieres (titre, type, lieu, date_publication, date_limite, description, contact, image_url, recruteur_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [titre, type, lieu, date_publication || new Date(), date_limite || null, description, contact, image_url || null, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/carrieres/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, type, lieu, date_publication, date_limite, description, contact, image_url, publie } = req.body;
    const { rows } = await q(
      `UPDATE carrieres SET
         titre = COALESCE($1, titre),
         type = COALESCE($2, type),
         lieu = COALESCE($3, lieu),
         date_publication = COALESCE($4, date_publication),
         date_limite = COALESCE($5, date_limite),
         description = COALESCE($6, description),
         contact = COALESCE($7, contact),
         image_url = COALESCE($8, image_url),
         publie = COALESCE($9, publie)
       WHERE id = $10
       RETURNING *`,
      [titre, type, lieu, date_publication, date_limite, description, contact, image_url, publie, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Offre non trouvée' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/carrieres/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM carrieres WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Offre non trouvée' });
    }
    res.json({ message: 'Offre supprimée' });
  } catch (e) { next(e); }
});

export default r;
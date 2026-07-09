// backend/src/routes/projets.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();

// GET /api/projets - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.*, u.nom AS responsable_nom, u.prenom AS responsable_prenom
       FROM projets p
       LEFT JOIN utilisateurs u ON u.id = p.responsable_id
       WHERE p.publie = true
       ORDER BY p.date_debut DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/projets/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.*, u.nom AS responsable_nom, u.prenom AS responsable_prenom
       FROM projets p
       LEFT JOIN utilisateurs u ON u.id = p.responsable_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erreur: 'Projet non trouvé' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/projets - Créer (admin)
r.post('/', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, statut, financement, description, image_url, date_debut, date_fin } = req.body;
    const { rows } = await q(
      `INSERT INTO projets (titre, statut, financement, description, image_url, date_debut, date_fin, responsable_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING *`,
      [titre, statut, financement, description, image_url, date_debut, date_fin, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/projets/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, statut, financement, description, image_url, date_debut, date_fin, publie } = req.body;
    const { rows } = await q(
      `UPDATE projets SET
         titre = COALESCE($1, titre),
         statut = COALESCE($2, statut),
         financement = COALESCE($3, financement),
         description = COALESCE($4, description),
         image_url = COALESCE($5, image_url),
         date_debut = COALESCE($6, date_debut),
         date_fin = COALESCE($7, date_fin),
         publie = COALESCE($8, publie)
       WHERE id = $9
       RETURNING *`,
      [titre, statut, financement, description, image_url, date_debut, date_fin, publie, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erreur: 'Projet non trouvé' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// DELETE /api/projets/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM projets WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ erreur: 'Projet non trouvé' });
    res.json({ message: 'Projet supprimé' });
  } catch (e) { next(e); }
});

export default r;
// backend/src/routes/publications.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// GET /api/publications - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
       FROM publications p
       LEFT JOIN utilisateurs u ON u.id = p.auteur_id
       WHERE p.publie = true
       ORDER BY p.date_publication DESC`
    );
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/publications/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT p.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
       FROM publications p
       LEFT JOIN utilisateurs u ON u.id = p.auteur_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erreur: 'Publication non trouvée' });
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/publications - Créer (admin)
r.post('/', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, auteurs, categorie, date_publication, resume, doi, image_url } = req.body;
    const { rows } = await q(
      `INSERT INTO publications (titre, auteurs, categorie, date_publication, resume, doi, image_url, auteur_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING *`,
      [titre, auteurs, categorie, date_publication, resume, doi, image_url, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/publications/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, auteurs, categorie, date_publication, resume, doi, image_url, publie } = req.body;
    const { rows } = await q(
      `UPDATE publications SET
         titre = COALESCE($1, titre),
         auteurs = COALESCE($2, auteurs),
         categorie = COALESCE($3, categorie),
         date_publication = COALESCE($4, date_publication),
         resume = COALESCE($5, resume),
         doi = COALESCE($6, doi),
         image_url = COALESCE($7, image_url),
         publie = COALESCE($8, publie)
       WHERE id = $9
       RETURNING *`,
      [titre, auteurs, categorie, date_publication, resume, doi, image_url, publie, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ erreur: 'Publication non trouvée' });
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/publications/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM publications WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ erreur: 'Publication non trouvée' });
    res.json({ message: 'Publication supprimée' });
  } catch (e) { next(e); }
});

export default r;
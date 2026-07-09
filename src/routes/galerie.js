// backend/src/routes/galerie.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();

// GET /api/galerie - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { categorie } = req.query;
    let query = `
      SELECT g.*, u.nom AS upload_par_nom, u.prenom AS upload_par_prenom
      FROM galerie g
      LEFT JOIN utilisateurs u ON u.id = g.upload_par
      WHERE g.publie = true
    `;
    const params = [];
    
    if (categorie && categorie !== 'TOUTES') {
      query += ` AND g.categorie = $1`;
      params.push(categorie);
    }
    
    query += ` ORDER BY g.date_upload DESC`;
    
    const { rows } = await q(query, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/galerie/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT g.*, u.nom AS upload_par_nom, u.prenom AS upload_par_prenom
       FROM galerie g
       LEFT JOIN utilisateurs u ON u.id = g.upload_par
       WHERE g.id = $1 AND g.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Photo non trouvée' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/galerie - Ajouter une photo (admin)
r.post('/', roles('ADMIN', 'DIRECTION', 'COMMERCIAL'), async (req, res, next) => {
  try {
    const { titre, description, categorie, image_url } = req.body;
    const { rows } = await q(
      `INSERT INTO galerie (titre, description, categorie, image_url, upload_par, publie)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [titre, description, categorie, image_url, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/galerie/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, description, categorie, image_url, publie } = req.body;
    const { rows } = await q(
      `UPDATE galerie SET
         titre = COALESCE($1, titre),
         description = COALESCE($2, description),
         categorie = COALESCE($3, categorie),
         image_url = COALESCE($4, image_url),
         publie = COALESCE($5, publie)
       WHERE id = $6
       RETURNING *`,
      [titre, description, categorie, image_url, publie, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Photo non trouvée' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// DELETE /api/galerie/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    // Récupérer l'URL de l'image pour éventuellement la supprimer de Cloudinary
    const photo = await q(`SELECT image_url FROM galerie WHERE id = $1`, [req.params.id]);
    
    const { rows } = await q(`DELETE FROM galerie WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Photo non trouvée' });
    }
    res.json({ message: 'Photo supprimée' });
  } catch (e) { next(e); }
});

export default r;
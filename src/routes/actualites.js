// backend/src/routes/actualites.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// GET /api/actualites - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { categorie, limit } = req.query;
    let query = `
      SELECT a.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
      FROM actualites a
      LEFT JOIN utilisateurs u ON u.id = a.auteur_id
      WHERE a.publie = true
    `;
    const params = [];
    let paramIndex = 1;

    if (categorie && categorie !== 'TOUTES') {
      query += ` AND a.categorie = $${paramIndex}`;
      params.push(categorie);
      paramIndex++;
    }

    query += ` ORDER BY a.date_publication DESC`;
    
    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
    }
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/actualites/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT a.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
       FROM actualites a
       LEFT JOIN utilisateurs u ON u.id = a.auteur_id
       WHERE a.id = $1 AND a.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Actualité non trouvée' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/actualites - Créer (admin)
r.post('/', roles('ADMIN', 'DIRECTION', 'COMMERCIAL'), async (req, res, next) => {
  try {
    const { titre, categorie, date_publication, resume, contenu, image_url, lien, auteur } = req.body;
    const { rows } = await q(
      `INSERT INTO actualites (titre, categorie, date_publication, resume, contenu, image_url, lien, auteur, auteur_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [titre, categorie, date_publication || new Date(), resume, contenu || resume, image_url || null, lien || null, auteur || null, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/actualites/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { titre, categorie, date_publication, resume, contenu, image_url, lien, auteur, publie } = req.body;
    const { rows } = await q(
      `UPDATE actualites SET
         titre = COALESCE($1, titre),
         categorie = COALESCE($2, categorie),
         date_publication = COALESCE($3, date_publication),
         resume = COALESCE($4, resume),
         contenu = COALESCE($5, contenu),
         image_url = COALESCE($6, image_url),
         lien = COALESCE($7, lien),
         auteur = COALESCE($8, auteur),
         publie = COALESCE($9, publie)
       WHERE id = $10
       RETURNING *`,
      [titre, categorie, date_publication, resume, contenu, image_url, lien, auteur, publie, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Actualité non trouvée' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/actualites/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM actualites WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Actualité non trouvée' });
    }
    res.json({ message: 'Actualité supprimée' });
  } catch (e) { next(e); }
});

export default r;
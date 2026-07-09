// backend/src/routes/equipe.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// GET /api/equipe - Liste publique
r.get('/', async (req, res, next) => {
  try {
    const { categorie } = req.query;
    let query = `
      SELECT e.*, 
             u.nom AS superieur_nom, u.prenom AS superieur_prenom
      FROM equipe e
      LEFT JOIN utilisateurs u ON u.id = e.superieur_id
      WHERE e.publie = true
    `;
    const params = [];

    if (categorie && categorie !== 'TOUS') {
      query += ` AND e.categorie = $1`;
      params.push(categorie);
    }

    query += ` ORDER BY e.ordre_affichage ASC, e.nom ASC`;
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/equipe/:id - Détail
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT e.*, u.nom AS superieur_nom, u.prenom AS superieur_prenom
       FROM equipe e
       LEFT JOIN utilisateurs u ON u.id = e.superieur_id
       WHERE e.id = $1 AND e.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Membre non trouvé' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// POST /api/equipe - Ajouter un membre (admin)
r.post('/', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { 
      nom, prenom, poste, domaine, email, telephone, 
      bio, photo_url, categorie, ordre_affichage, superieur_id 
    } = req.body;
    
    const { rows } = await q(
      `INSERT INTO equipe (nom, prenom, poste, domaine, email, telephone, bio, 
                           photo_url, categorie, ordre_affichage, superieur_id, publie)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       RETURNING *`,
      [nom, prenom, poste, domaine, email || null, telephone || null, bio || null, 
       photo_url || null, categorie || 'Chercheurs', ordre_affichage || 0, superieur_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/equipe/:id - Modifier (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { 
      nom, prenom, poste, domaine, email, telephone, 
      bio, photo_url, categorie, ordre_affichage, superieur_id, publie 
    } = req.body;
    
    const { rows } = await q(
      `UPDATE equipe SET
         nom = COALESCE($1, nom),
         prenom = COALESCE($2, prenom),
         poste = COALESCE($3, poste),
         domaine = COALESCE($4, domaine),
         email = COALESCE($5, email),
         telephone = COALESCE($6, telephone),
         bio = COALESCE($7, bio),
         photo_url = COALESCE($8, photo_url),
         categorie = COALESCE($9, categorie),
         ordre_affichage = COALESCE($10, ordre_affichage),
         superieur_id = COALESCE($11, superieur_id),
         publie = COALESCE($12, publie)
       WHERE id = $13
       RETURNING *`,
      [nom, prenom, poste, domaine, email, telephone, bio, photo_url, 
       categorie, ordre_affichage, superieur_id, publie, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Membre non trouvé' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/equipe/:id - Supprimer (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(`DELETE FROM equipe WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Membre non trouvé' });
    }
    res.json({ message: 'Membre supprimé' });
  } catch (e) { next(e); }
});

export default r;
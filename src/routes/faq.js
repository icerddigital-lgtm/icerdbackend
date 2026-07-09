// backend/src/routes/faq.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import { langueDe, appliquerLangue, appliquerLangueListe } from '../utils/langue.js';

const r = Router();

// ============================================================
// ROUTES PUBLIQUES
// ============================================================

// GET /api/faq - Liste publique des questions/réponses
r.get('/', async (req, res, next) => {
  try {
    const { categorie } = req.query;
    let query = `
      SELECT f.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
      FROM faq f
      LEFT JOIN utilisateurs u ON u.id = f.auteur_id
      WHERE f.publie = true
    `;
    const params = [];

    if (categorie && categorie !== 'TOUS') {
      query += ` AND f.categorie = $1`;
      params.push(categorie);
    }

    query += ` ORDER BY f.ordre_affichage ASC, f.id ASC`;
    
    const { rows } = await q(query, params);
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// ✅ CORRECTION : Route GET /api/faq/categories - AVANT la route /:id
r.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT categorie, COUNT(*) AS total
       FROM faq
       WHERE publie = true
       GROUP BY categorie
       ORDER BY categorie`
    );
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { next(e); }
});

// GET /api/faq/:id - Détail d'une question
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT f.*, u.nom AS auteur_nom, u.prenom AS auteur_prenom
       FROM faq f
       LEFT JOIN utilisateurs u ON u.id = f.auteur_id
       WHERE f.id = $1 AND f.publie = true`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Question non trouvée' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// ============================================================
// ROUTES PROTÉGÉES (ADMIN)
// ============================================================

r.use(authRequis);

// POST /api/faq - Créer une question (admin)
r.post('/', roles('ADMIN', 'DIRECTION', 'COMMERCIAL'), async (req, res, next) => {
  try {
    const { question, reponse, categorie, ordre_affichage, question_en, reponse_en } = req.body;
    
    if (!question || !reponse) {
      return res.status(400).json({ erreur: 'La question et la réponse sont obligatoires' });
    }

    const { rows } = await q(
      `INSERT INTO faq (question, reponse, question_en, reponse_en, categorie, ordre_affichage, auteur_id, publie)
       VALUES ($1, $2, NULLIF($3,''), NULLIF($4,''), $5, $6, $7, true)
       RETURNING *`,
      [question, reponse, question_en || '', reponse_en || '',
       categorie || 'Général', ordre_affichage || 0, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// PATCH /api/faq/:id - Modifier une question (admin)
r.patch('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { question, reponse, categorie, ordre_affichage, publie,
            question_en, reponse_en } = req.body;
    
    // NULLIF : une traduction effacée dans le portail redevient NULL
    // → le site public affiche de nouveau le français.
    const { rows } = await q(
      `UPDATE faq SET
         question = COALESCE($1, question),
         reponse = COALESCE($2, reponse),
         categorie = COALESCE($3, categorie),
         ordre_affichage = COALESCE($4, ordre_affichage),
         publie = COALESCE($5, publie),
         question_en = CASE WHEN $7::text IS NULL THEN question_en ELSE NULLIF($7,'') END,
         reponse_en  = CASE WHEN $8::text IS NULL THEN reponse_en  ELSE NULLIF($8,'') END,
         date_modification = NOW()
       WHERE id = $6
       RETURNING *`,
      [question, reponse, categorie, ordre_affichage, publie, req.params.id,
       question_en ?? null, reponse_en ?? null]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Question non trouvée' });
    }
    res.json(appliquerLangue(rows[0], langueDe(req)));
  } catch (e) { next(e); }
});

// DELETE /api/faq/:id - Supprimer une question (admin)
r.delete('/:id', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { rows } = await q(
      `DELETE FROM faq WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Question non trouvée' });
    }
    res.json({ message: 'Question supprimée avec succès' });
  } catch (e) { next(e); }
});

// POST /api/faq/reorder - Réorganiser les questions (admin)
r.post('/reorder', roles('ADMIN', 'DIRECTION'), async (req, res, next) => {
  try {
    const { orders } = req.body; // [{ id: 1, ordre: 0 }, { id: 2, ordre: 1 }, ...]
    
    if (!Array.isArray(orders)) {
      return res.status(400).json({ erreur: 'Données invalides' });
    }

    const promises = orders.map(({ id, ordre }) => 
      q(`UPDATE faq SET ordre_affichage = $1 WHERE id = $2`, [ordre, id])
    );
    
    await Promise.all(promises);
    res.json({ message: 'Ordre mis à jour avec succès' });
  } catch (e) { next(e); }
});

export default r;
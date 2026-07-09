// backend/src/routes/stocks.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// GET /api/stocks/articles - Liste des articles
r.get('/articles', async (_req, res, next) => {
  try {
    const { rows } = await q(`SELECT * FROM articles WHERE actif ORDER BY categorie, designation`);
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/stocks/articles - Créer un article
r.post('/articles', roles('ADMIN','MAGASINIER','CHEF_LABO'), async (req, res, next) => {
  try {
    const a = req.body;
    const { rows } = await q(
      `INSERT INTO articles (code, designation, categorie, unite, stock_mini, emplacement, danger, fournisseur)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [a.code, a.designation, a.categorie, a.unite, a.stock_mini || 0, a.emplacement, a.danger, a.fournisseur]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ PATCH /api/stocks/articles/:id - Modifier un article
r.patch('/articles/:id', roles('ADMIN','MAGASINIER','CHEF_LABO'), async (req, res, next) => {
  try {
    const a = req.body;
    const { rows } = await q(
      `UPDATE articles SET
         code = COALESCE($1, code),
         designation = COALESCE($2, designation),
         categorie = COALESCE($3, categorie),
         unite = COALESCE($4, unite),
         stock_mini = COALESCE($5, stock_mini),
         emplacement = COALESCE($6, emplacement),
         danger = COALESCE($7, danger),
         fournisseur = COALESCE($8, fournisseur),
         actif = COALESCE($9, actif)
       WHERE id = $10
       RETURNING *`,
      [a.code, a.designation, a.categorie, a.unite, a.stock_mini, 
       a.emplacement, a.danger, a.fournisseur, a.actif, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Article non trouvé' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ DELETE /api/stocks/articles/:id - Supprimer un article
r.delete('/articles/:id', roles('ADMIN','MAGASINIER'), async (req, res, next) => {
  try {
    // Vérifier si l'article a des mouvements
    const check = await q(`SELECT COUNT(*) FROM mouvements_stock WHERE article_id = $1`, [req.params.id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ 
        erreur: 'Impossible de supprimer cet article car il a des mouvements associés' 
      });
    }
    const { rows } = await q(`DELETE FROM articles WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Article non trouvé' });
    }
    res.json({ message: 'Article supprimé avec succès' });
  } catch (e) { next(e); }
});

// POST /api/stocks/mouvements - Mouvement d'entrée/sortie
r.post('/mouvements', roles('ADMIN','MAGASINIER','TECHNICIEN','CHEF_LABO'), async (req, res, next) => {
  try {
    const m = req.body;
    const qte = ['SORTIE','PERTE','PEREMPTION'].includes(m.type) ? -Math.abs(m.quantite) : Math.abs(m.quantite);
    const { rows } = await q(
      `INSERT INTO mouvements_stock (article_id, lot_id, type, quantite, motif, effectue_par)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [m.article_id, m.lot_id || null, m.type, qte, m.motif, req.utilisateur.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// GET /api/stocks/mouvements - Historique des mouvements
r.get('/mouvements', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT m.*, a.designation, a.unite, u.nom AS operateur
       FROM mouvements_stock m
       JOIN articles a ON a.id = m.article_id
       LEFT JOIN utilisateurs u ON u.id = m.effectue_par
       ORDER BY m.date_mouvement DESC LIMIT 300`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/stocks/alertes - Alertes stock bas + péremptions
r.get('/alertes', async (_req, res, next) => {
  try {
    const { rows } = await q(`SELECT * FROM v_alertes_stock ORDER BY type_alerte, designation`);
    res.json(rows);
  } catch (e) { next(e); }
});

export default r;
// backend/src/routes/laboratoires.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();

// GET /api/laboratoires - Liste publique des laboratoires (sans auth)
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT l.id, l.code, l.nom, l.responsable, l.description,
              d.code AS division_code,
              d.nom AS division_nom,
              COUNT(DISTINCT e.id) AS nb_equipements,
              COUNT(DISTINCT ta.id) AS nb_analyses
       FROM laboratoires l
       LEFT JOIN divisions d ON d.id = l.division_id
       LEFT JOIN equipements e ON e.laboratoire_id = l.id
       LEFT JOIN types_analyse ta ON ta.laboratoire_id = l.id
       GROUP BY l.id, l.code, l.nom, l.responsable, l.description, d.code, d.nom
       ORDER BY l.code`
    );
    res.json(rows);
  } catch (e) { 
    console.error('Erreur GET /laboratoires:', e);
    next(e); 
  }
});

// GET /api/laboratoires/:id - Détail d'un laboratoire
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT l.id, l.code, l.nom, l.responsable, l.description, l.division_id,
              d.code AS division_code, d.nom AS division_nom,
              (SELECT json_agg(DISTINCT jsonb_build_object(
                'id', e.id, 
                'code', e.code, 
                'designation', e.designation
               )) FROM equipements e WHERE e.laboratoire_id = l.id) AS equipements,
              (SELECT json_agg(DISTINCT jsonb_build_object(
                'id', ta.id,
                'code', ta.code,
                'nom', ta.nom,
                'prix_fcfa', ta.prix_fcfa
               )) FROM types_analyse ta WHERE ta.laboratoire_id = l.id AND ta.actif = true) AS analyses
       FROM laboratoires l
       LEFT JOIN divisions d ON d.id = l.division_id
       WHERE l.id = $1`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Laboratoire non trouvé' });
    }
    
    res.json(rows[0]);
  } catch (e) { 
    console.error('Erreur GET /laboratoires/:id:', e);
    next(e); 
  }
});

// ===== ROUTES PROTÉGÉES (admin uniquement) =====

// POST /api/laboratoires - Créer un laboratoire (admin)
r.post('/', authRequis, roles('ADMIN'), async (req, res, next) => {
  try {
    const x = req.body;
    const { rows } = await q(
      `INSERT INTO laboratoires (code, nom, division_id, responsable, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [x.code, x.nom, x.division_id || null, x.responsable || null, x.description || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { 
    console.error('Erreur POST /laboratoires:', e);
    next(e); 
  }
});

// PATCH /api/laboratoires/:id - Modifier un laboratoire (admin)
r.patch('/:id', authRequis, roles('ADMIN'), async (req, res, next) => {
  try {
    const x = req.body;
    const { rows } = await q(
      `UPDATE laboratoires SET
         code = COALESCE($1, code),
         nom = COALESCE($2, nom),
         division_id = COALESCE($3, division_id),
         responsable = COALESCE($4, responsable),
         description = COALESCE($5, description)
       WHERE id = $6
       RETURNING *`,
      [x.code, x.nom, x.division_id, x.responsable, x.description, req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Laboratoire non trouvé' });
    }
    
    res.json(rows[0]);
  } catch (e) { 
    console.error('Erreur PATCH /laboratoires/:id:', e);
    next(e); 
  }
});

// DELETE /api/laboratoires/:id - Supprimer un laboratoire (admin)
r.delete('/:id', authRequis, roles('ADMIN'), async (req, res, next) => {
  try {
    // Vérifier si le laboratoire a des équipements ou analyses associées
    const check = await q(
      `SELECT 
        (SELECT COUNT(*) FROM equipements WHERE laboratoire_id = $1) AS nb_equipements,
        (SELECT COUNT(*) FROM types_analyse WHERE laboratoire_id = $1) AS nb_analyses`,
      [req.params.id]
    );
    
    if (parseInt(check.rows[0].nb_equipements) > 0 || parseInt(check.rows[0].nb_analyses) > 0) {
      return res.status(400).json({ 
        erreur: 'Impossible de supprimer ce laboratoire car il a des équipements ou analyses associés' 
      });
    }
    
    const { rows } = await q(
      `DELETE FROM laboratoires WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Laboratoire non trouvé' });
    }
    
    res.json({ message: 'Laboratoire supprimé avec succès' });
  } catch (e) { 
    console.error('Erreur DELETE /laboratoires/:id:', e);
    next(e); 
  }
});

export default r;
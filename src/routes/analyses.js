// backend/src/routes/analyses.js
import { Router } from 'express';
import { langueDe, appliquerLangueListe } from '../utils/langue.js';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();

// Catalogue public (utilisé aussi par le site vitrine)
r.get('/catalogue', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT ta.*, l.code AS laboratoire
       FROM types_analyse ta 
       LEFT JOIN laboratoires l ON l.id = ta.laboratoire_id
       WHERE ta.actif 
       ORDER BY ta.matrice, ta.categorie, ta.nom`
    );
    res.json(appliquerLangueListe(rows, langueDe(req)));
  } catch (e) { 
    next(e); 
  }
});

// ===== ROUTES PROTÉGÉES =====
r.use(authRequis);

// GET /api/analyses/file-travail - File de travail d'un technicien/laboratoire
r.get('/file-travail', async (req, res, next) => {
  try {
    const { rows } = await q(`
      SELECT 
        ea.id,
        ea.statut,
        e.code AS echantillon,
        ta.nom AS analyse,
        ta.methode,
        ta.code AS code_analyse,
        d.numero AS demande,
        d.urgence,
        d.date_echeance,
        c.raison_sociale AS client
      FROM echantillon_analyses ea
      JOIN echantillons e ON e.id = ea.echantillon_id
      JOIN types_analyse ta ON ta.id = ea.type_analyse_id
      JOIN demandes d ON d.id = e.demande_id
      JOIN clients c ON c.id = d.client_id
      WHERE ea.statut IN ('A_FAIRE', 'EN_COURS')
      ORDER BY d.urgence DESC, d.date_echeance NULLS LAST, e.code
      LIMIT 100
    `);
    res.json(rows);
  } catch (e) { 
    next(e); 
  }
});

// PATCH /api/analyses/:id - Prise en charge / clôture d'une analyse
r.patch('/:id', roles('ADMIN','CHEF_LABO','TECHNICIEN'), async (req, res, next) => {
  try {
    const { statut } = req.body;
    const champsDate = statut === 'EN_COURS' ? 'date_debut = now(),'
                     : statut === 'TERMINEE' ? 'date_fin = now(),' : '';
    const { rows } = await q(
      `UPDATE echantillon_analyses 
       SET ${champsDate} statut = $1, technicien_id = COALESCE(technicien_id, $2)
       WHERE id = $3 
       RETURNING *`,
      [statut, req.utilisateur.id, req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Analyse non trouvée' });
    }
    
    res.json(rows[0]);
  } catch (e) { 
    next(e); 
  }
});

export default r;
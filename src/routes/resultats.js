// backend/src/routes/resultats.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// GET /api/resultats - Liste complète avec relations
r.get('/', async (req, res, next) => {
  try {
    const { rows } = await q(`
      SELECT 
        r.*,
        e.code AS code_echantillon,
        ta.nom AS nom_analyse,
        u.nom AS saisi_par_nom,
        u.prenom AS saisi_par_prenom,
        vu.nom AS valide_par_nom,
        vu.prenom AS valide_par_prenom
      FROM resultats r
      LEFT JOIN echantillon_analyses ea ON ea.id = r.ech_analyse_id
      LEFT JOIN echantillons e ON e.id = ea.echantillon_id
      LEFT JOIN types_analyse ta ON ta.id = ea.type_analyse_id
      LEFT JOIN utilisateurs u ON u.id = r.saisi_par
      LEFT JOIN utilisateurs vu ON vu.id = r.valide_par
      ORDER BY r.saisi_le DESC
    `);
    res.json(rows);
  } catch (e) { 
    next(e); 
  }
});

// POST /api/resultats - Saisie d'un résultat
r.post('/', roles('ADMIN','TECHNICIEN','CHEF_LABO'), async (req, res, next) => {
  try {
    const x = req.body;
    const { rows } = await q(
      `INSERT INTO resultats (
        ech_analyse_id, 
        valeur_num, 
        valeur_txt, 
        unite, 
        incertitude,
        limite_detection, 
        conforme, 
        norme_reference, 
        saisi_par, 
        commentaire
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        x.ech_analyse_id, 
        x.valeur_num ?? null, 
        x.valeur_txt ?? null, 
        x.unite, 
        x.incertitude ?? null,
        x.limite_detection ?? null, 
        x.conforme ?? null, 
        x.norme_reference, 
        req.utilisateur.id, 
        x.commentaire
      ]
    );
    
    // Mettre à jour le statut de l'analyse d'échantillon
    await q(
      `UPDATE echantillon_analyses SET statut = 'TERMINEE', date_fin = now() 
       WHERE id = $1`, 
      [x.ech_analyse_id]
    );
    
    res.status(201).json(rows[0]);
  } catch (e) { 
    next(e); 
  }
});

// PATCH /api/resultats/:id/valider - Validation par chef de labo
r.patch('/:id/valider', roles('ADMIN','CHEF_LABO','QUALITE'), async (req, res, next) => {
  try {
    const { rows } = await q(
      `UPDATE resultats 
       SET valide_par = $1, valide_le = now() 
       WHERE id = $2 
       RETURNING *`,
      [req.utilisateur.id, req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Résultat non trouvé' });
    }
    
    // Mettre à jour le statut de l'analyse d'échantillon
    await q(
      `UPDATE echantillon_analyses SET statut = 'VALIDEE' 
       WHERE id = (SELECT ech_analyse_id FROM resultats WHERE id = $1)`,
      [req.params.id]
    );
    
    // Log dans l'audit
    await q(
      `INSERT INTO audit_log (utilisateur_id, action, table_cible, enregistrement_id)
       VALUES ($1, 'VALIDATE', 'resultats', $2)`,
      [req.utilisateur.id, req.params.id]
    );
    
    res.json(rows[0]);
  } catch (e) { 
    next(e); 
  }
});

// GET /api/resultats/demande/:demandeId - Résultats d'une demande
r.get('/demande/:demandeId', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT 
        e.code AS echantillon, 
        ta.nom AS analyse, 
        ta.methode,
        r.valeur_num, 
        r.valeur_txt, 
        r.unite, 
        r.incertitude, 
        r.conforme,
        r.norme_reference, 
        r.valide_le IS NOT NULL AS valide
       FROM resultats r
       JOIN echantillon_analyses ea ON ea.id = r.ech_analyse_id
       JOIN echantillons e ON e.id = ea.echantillon_id
       JOIN types_analyse ta ON ta.id = ea.type_analyse_id
       WHERE e.demande_id = $1 
       ORDER BY e.code, ta.nom`,
      [req.params.demandeId]
    );
    res.json(rows);
  } catch (e) { 
    next(e); 
  }
});

export default r;
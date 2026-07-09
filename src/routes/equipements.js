// backend/src/routes/equipements.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// GET /api/equipements - Liste des équipements
r.get('/', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT eq.*, l.code AS laboratoire FROM equipements eq
       LEFT JOIN laboratoires l ON l.id = eq.laboratoire_id 
       ORDER BY eq.code`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/equipements - Créer un équipement
r.post('/', roles('ADMIN','CHEF_LABO','QUALITE'), async (req, res, next) => {
  try {
    const x = req.body;
    const { rows } = await q(
      `INSERT INTO equipements (
        code, designation, laboratoire_id, numero_serie, 
        date_mise_service, frequence_etalonnage_mois, prochain_etalonnage
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [x.code, x.designation, x.laboratoire_id, x.numero_serie, 
       x.date_mise_service, x.frequence_etalonnage_mois, x.prochain_etalonnage]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ PATCH /api/equipements/:id - Modifier un équipement
r.patch('/:id', roles('ADMIN','CHEF_LABO','QUALITE'), async (req, res, next) => {
  try {
    const x = req.body;
    const { rows } = await q(
      `UPDATE equipements SET
         code = COALESCE($1, code),
         designation = COALESCE($2, designation),
         laboratoire_id = COALESCE($3, laboratoire_id),
         numero_serie = COALESCE($4, numero_serie),
         date_mise_service = COALESCE($5, date_mise_service),
         frequence_etalonnage_mois = COALESCE($6, frequence_etalonnage_mois),
         prochain_etalonnage = COALESCE($7, prochain_etalonnage)
       WHERE id = $8
       RETURNING *`,
      [x.code, x.designation, x.laboratoire_id, x.numero_serie, 
       x.date_mise_service, x.frequence_etalonnage_mois, x.prochain_etalonnage, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Équipement non trouvé' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// POST /api/equipements/:id/interventions - Ajouter une intervention
r.post('/:id/interventions', roles('ADMIN','CHEF_LABO','QUALITE'), async (req, res, next) => {
  try {
    const x = req.body;
    const { rows } = await q(
      `INSERT INTO interventions_equipement (
        equipement_id, type, date_intervention, prestataire, 
        resultat, prochaine_echeance, cout_fcfa, commentaire
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, x.type, x.date_intervention, x.prestataire, 
       x.resultat, x.prochaine_echeance, x.cout_fcfa, x.commentaire]
    );
    // Si c'est un étalonnage, mettre à jour la date du prochain étalonnage
    if (x.type === 'ETALONNAGE' && x.prochaine_echeance) {
      await q(`UPDATE equipements SET prochain_etalonnage = $1 WHERE id = $2`, 
        [x.prochaine_echeance, req.params.id]
      );
    }
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ DELETE /api/equipements/:id - Supprimer un équipement
r.delete('/:id', roles('ADMIN','CHEF_LABO'), async (req, res, next) => {
  try {
    // Vérifier si l'équipement a des interventions
    const check = await q(`SELECT COUNT(*) FROM interventions_equipement WHERE equipement_id = $1`, [req.params.id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ 
        erreur: 'Impossible de supprimer cet équipement car il a des interventions associées' 
      });
    }
    const { rows } = await q(`DELETE FROM equipements WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Équipement non trouvé' });
    }
    res.json({ message: 'Équipement supprimé avec succès' });
  } catch (e) { next(e); }
});

export default r;
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

r.get('/', async (_req, res, next) => {
  try {
    const [demandes, echantillons, analyses, factures, alertes, etalonnages] = await Promise.all([
      q(`SELECT statut, count(*)::int AS n FROM demandes GROUP BY statut`),
      q(`SELECT count(*)::int AS n FROM echantillons WHERE etat IN ('RECU','EN_ANALYSE')`),
      q(`SELECT count(*)::int AS n FROM echantillon_analyses WHERE statut IN ('A_FAIRE','EN_COURS')`),
      q(`SELECT COALESCE(sum(montant_ttc - COALESCE((SELECT sum(montant) FROM paiements p WHERE p.facture_id = f.id),0)),0)::bigint AS impaye
         FROM factures f WHERE statut IN ('EMISE','PARTIELLEMENT_PAYEE','IMPAYEE')`),
      q(`SELECT count(*)::int AS n FROM v_alertes_stock`),
      q(`SELECT count(*)::int AS n FROM equipements WHERE prochain_etalonnage <= CURRENT_DATE + 30`)
    ]);
    res.json({
      demandes_par_statut: demandes.rows,
      echantillons_actifs: echantillons.rows[0].n,
      analyses_en_attente: analyses.rows[0].n,
      montant_impaye_fcfa: factures.rows[0].impaye,
      alertes_stock: alertes.rows[0].n,
      etalonnages_a_prevoir: etalonnages.rows[0].n
    });
  } catch (e) { next(e); }
});

export default r;

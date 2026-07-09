// ============================================================================
// BANQUE DE DONNÉES DES ANALYSES
// GET  /api/banque/parametres?matrice=SOL      dictionnaire (formulaires dynamiques)
// GET  /api/banque/fiches?...filtres           recherche multi-critères
// GET  /api/banque/fiches/:id                  fiche complète + valeurs
// POST /api/banque/fiches                      créer (métadonnées + valeurs)
// PUT  /api/banque/fiches/:id                  modifier (upsert des valeurs)
// DELETE /api/banque/fiches/:id                supprimer (ADMIN/DIRECTION)
// POST /api/banque/depuis-echantillon/:echId   préremplir depuis un échantillon LIMS
// GET  /api/banque/stats?parametre=SOL_PH_EAU  statistiques (n, moy, min, max, σ)
// ============================================================================
import { Router } from 'express';
import { q, pool } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

const ECRITURE = ['ADMIN','DIRECTION','CHEF_LABO','TECHNICIEN','QUALITE'];

// --- Dictionnaire des paramètres (groupés pour le formulaire)
r.get('/parametres', async (req, res, next) => {
  try {
    const { matrice } = req.query;
    const { rows } = await q(
      `SELECT id, code, libelle, matrice, groupe, unite, methode,
              valeur_min, valeur_max, seuil_norme, ordre
       FROM parametres
       WHERE actif AND ($1::matrice IS NULL OR matrice = $1)
       ORDER BY matrice, ordre, libelle`, [matrice || null]);
    res.json(rows);
  } catch (e) { next(e); }
});

// --- Recherche de fiches
// Filtres : matrice, recherche (texte libre), region, projet, campagne,
//           parametre + val_min/val_max (ex. tous les sols de pH < 5), de, a
r.get('/fiches', async (req, res, next) => {
  try {
    const { matrice, recherche, region, projet, campagne, parametre, val_min, val_max, de, a } = req.query;
    const { rows } = await q(
      `SELECT f.id, f.code, f.matrice, f.designation, f.localisation, f.region,
              f.departement, f.profondeur, f.projet, f.campagne, f.source,
              to_char(f.date_analyse,'DD/MM/YYYY') AS date_analyse,
              count(v.id)::int AS nb_valeurs
       FROM fiches_analyses f
       LEFT JOIN valeurs_analyses v ON v.fiche_id = f.id
       WHERE ($1::matrice IS NULL OR f.matrice = $1)
         AND ($2::text IS NULL OR f.designation ILIKE '%'||$2||'%' OR f.localisation ILIKE '%'||$2||'%'
              OR f.code ILIKE '%'||$2||'%' OR f.projet ILIKE '%'||$2||'%')
         AND ($3::text IS NULL OR f.region ILIKE $3)
         AND ($4::text IS NULL OR f.projet ILIKE '%'||$4||'%')
         AND ($5::text IS NULL OR f.campagne = $5)
         AND ($6::date IS NULL OR f.date_analyse >= $6)
         AND ($7::date IS NULL OR f.date_analyse <= $7)
         AND ($8::text IS NULL OR EXISTS (
              SELECT 1 FROM valeurs_analyses vv JOIN parametres pp ON pp.id = vv.parametre_id
              WHERE vv.fiche_id = f.id AND pp.code = $8
                AND ($9::numeric IS NULL OR vv.valeur_num >= $9)
                AND ($10::numeric IS NULL OR vv.valeur_num <= $10)))
       GROUP BY f.id
       ORDER BY f.date_analyse DESC, f.code DESC
       LIMIT 500`,
      [matrice || null, recherche || null, region || null, projet || null, campagne || null,
       de || null, a || null, parametre || null, val_min || null, val_max || null]);
    res.json(rows);
  } catch (e) { next(e); }
});

// --- Fiche complète
r.get('/fiches/:id', async (req, res, next) => {
  try {
    const f = (await q(`SELECT f.*, u.nom AS cree_par_nom, e.code AS code_echantillon
                        FROM fiches_analyses f
                        LEFT JOIN utilisateurs u ON u.id = f.cree_par
                        LEFT JOIN echantillons e ON e.id = f.echantillon_id
                        WHERE f.id = $1`, [req.params.id])).rows[0];
    if (!f) return res.status(404).json({ erreur: 'Fiche introuvable' });
    const valeurs = (await q(
      `SELECT p.id AS parametre_id, p.code, p.libelle, p.groupe, p.unite, p.seuil_norme,
              v.valeur_num, v.valeur_txt
       FROM valeurs_analyses v JOIN parametres p ON p.id = v.parametre_id
       WHERE v.fiche_id = $1 ORDER BY p.ordre`, [req.params.id])).rows;
    res.json({ ...f, valeurs });
  } catch (e) { next(e); }
});

// --- Création (métadonnées + valeurs en une transaction, avec garde-fous)
r.post('/fiches', roles(...ECRITURE), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const x = req.body;
    await cx.query('BEGIN');
    const f = (await cx.query(
      `INSERT INTO fiches_analyses (code, matrice, source, echantillon_id, designation,
         localisation, region, departement, coordonnees_gps, profondeur,
         date_prelevement, date_analyse, projet, campagne, laboratoire_id, cree_par, observations)
       VALUES (genere_numero('BD','seq_banque'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11, CURRENT_DATE),$12,$13,$14,$15,$16)
       RETURNING *`,
      [x.matrice, x.source || 'DIRECTE', x.echantillon_id || null, x.designation,
       x.localisation, x.region, x.departement, x.coordonnees_gps, x.profondeur,
       x.date_prelevement || null, x.date_analyse || null, x.projet, x.campagne,
       x.laboratoire_id || null, req.utilisateur.id, x.observations])).rows[0];

    const alertes = await insererValeurs(cx, f.id, x.valeurs || []);
    await cx.query('COMMIT');
    res.status(201).json({ ...f, alertes });
  } catch (e) { await cx.query('ROLLBACK'); next(e); }
  finally { cx.release(); }
});

// --- Modification : métadonnées + upsert des valeurs
r.put('/fiches/:id', roles(...ECRITURE), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const x = req.body;
    await cx.query('BEGIN');
    const f = (await cx.query(
      `UPDATE fiches_analyses SET
         designation = COALESCE($1, designation), localisation = COALESCE($2, localisation),
         region = COALESCE($3, region), departement = COALESCE($4, departement),
         coordonnees_gps = COALESCE($5, coordonnees_gps), profondeur = COALESCE($6, profondeur),
         date_prelevement = COALESCE($7, date_prelevement), date_analyse = COALESCE($8, date_analyse),
         projet = COALESCE($9, projet), campagne = COALESCE($10, campagne),
         observations = COALESCE($11, observations)
       WHERE id = $12 RETURNING *`,
      [x.designation, x.localisation, x.region, x.departement, x.coordonnees_gps, x.profondeur,
       x.date_prelevement, x.date_analyse, x.projet, x.campagne, x.observations, req.params.id])).rows[0];
    if (!f) throw Object.assign(new Error('Fiche introuvable'), { status: 404 });

    const alertes = await insererValeurs(cx, f.id, x.valeurs || []);
    await cx.query(`INSERT INTO audit_log (utilisateur_id, action, table_cible, enregistrement_id)
                    VALUES ($1,'UPDATE','fiches_analyses',$2)`, [req.utilisateur.id, f.id]);
    await cx.query('COMMIT');
    res.json({ ...f, alertes });
  } catch (e) { await cx.query('ROLLBACK'); next(e); }
  finally { cx.release(); }
});

// Upsert des valeurs + contrôle de vraisemblance (bornes du dictionnaire)
async function insererValeurs(cx, ficheId, valeurs) {
  const alertes = [];
  for (const v of valeurs) {
    if (v.valeur_num === null && !v.valeur_txt) {           // champ vidé → suppression
      await cx.query(`DELETE FROM valeurs_analyses WHERE fiche_id = $1 AND parametre_id = $2`,
        [ficheId, v.parametre_id]);
      continue;
    }
    const p = (await cx.query(`SELECT code, libelle, valeur_min, valeur_max FROM parametres WHERE id = $1`,
      [v.parametre_id])).rows[0];
    if (p && v.valeur_num !== null && v.valeur_num !== undefined &&
        ((p.valeur_min !== null && Number(v.valeur_num) < Number(p.valeur_min)) ||
         (p.valeur_max !== null && Number(v.valeur_num) > Number(p.valeur_max))))
      alertes.push(`${p.libelle} = ${v.valeur_num} hors bornes de vraisemblance [${p.valeur_min} ; ${p.valeur_max}] — valeur enregistrée, à vérifier.`);

    await cx.query(
      `INSERT INTO valeurs_analyses (fiche_id, parametre_id, valeur_num, valeur_txt)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (fiche_id, parametre_id)
       DO UPDATE SET valeur_num = EXCLUDED.valeur_num, valeur_txt = EXCLUDED.valeur_txt`,
      [ficheId, v.parametre_id, v.valeur_num ?? null, v.valeur_txt ?? null]);
  }
  return alertes;
}

// --- Suppression (réservée)
r.delete('/fiches/:id', roles('ADMIN','DIRECTION'), async (req, res, next) => {
  try {
    await q(`INSERT INTO audit_log (utilisateur_id, action, table_cible, enregistrement_id)
             VALUES ($1,'DELETE','fiches_analyses',$2)`, [req.utilisateur.id, req.params.id]);
    await q(`DELETE FROM fiches_analyses WHERE id = $1`, [req.params.id]);
    res.json({ supprime: true });
  } catch (e) { next(e); }
});

// --- Préremplir une fiche depuis un échantillon du LIMS (métadonnées copiées)
r.post('/depuis-echantillon/:echId', roles(...ECRITURE), async (req, res, next) => {
  try {
    const e = (await q(
      `SELECT e.*, d.objet AS projet FROM echantillons e
       JOIN demandes d ON d.id = e.demande_id WHERE e.id = $1`, [req.params.echId])).rows[0];
    if (!e) return res.status(404).json({ erreur: 'Échantillon introuvable' });
    const f = (await q(
      `INSERT INTO fiches_analyses (code, matrice, source, echantillon_id, designation,
         localisation, coordonnees_gps, date_prelevement, projet, cree_par)
       VALUES (genere_numero('BD','seq_banque'),$1,'LIMS',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [e.matrice, e.id, e.designation, e.lieu_prelevement, e.coordonnees_gps,
       e.date_prelevement, e.projet, req.utilisateur.id])).rows[0];
    res.status(201).json(f);
  } catch (e2) { next(e2); }
});

// --- Statistiques descriptives d'un paramètre (filtrables)
r.get('/stats', async (req, res, next) => {
  try {
    const { parametre, region, projet, de, a } = req.query;
    if (!parametre) return res.status(400).json({ erreur: 'Paramètre requis : ?parametre=SOL_PH_EAU' });
    const { rows } = await q(
      `SELECT p.code, p.libelle, p.unite,
              count(v.valeur_num)::int AS n,
              round(avg(v.valeur_num)::numeric, 3) AS moyenne,
              min(v.valeur_num) AS minimum,
              max(v.valeur_num) AS maximum,
              round(stddev_samp(v.valeur_num)::numeric, 3) AS ecart_type,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY v.valeur_num)::numeric, 3) AS mediane
       FROM valeurs_analyses v
       JOIN parametres p ON p.id = v.parametre_id
       JOIN fiches_analyses f ON f.id = v.fiche_id
       WHERE p.code = $1 AND v.valeur_num IS NOT NULL
         AND ($2::text IS NULL OR f.region ILIKE $2)
         AND ($3::text IS NULL OR f.projet ILIKE '%'||$3||'%')
         AND ($4::date IS NULL OR f.date_analyse >= $4)
         AND ($5::date IS NULL OR f.date_analyse <= $5)
       GROUP BY p.code, p.libelle, p.unite`,
      [parametre, region || null, projet || null, de || null, a || null]);
    res.json(rows[0] || { code: parametre, n: 0, message: 'Aucune donnée pour ce paramètre avec ces filtres' });
  } catch (e) { next(e); }
});

export default r;

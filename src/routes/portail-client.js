// ============================================================================
// PORTAIL CLIENT — le client connecté (rôle CLIENT) ne voit QUE ses données
// GET  /api/portail-client/mes-demandes     suivi en temps réel
// GET  /api/portail-client/mes-factures     factures et paiements
// GET  /api/portail-client/mes-rapports     rapports émis (PDF téléchargeables)
// POST /api/portail-client/comptes          (interne) créer le compte d'un client
// ============================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// Retrouve la fiche client liée au compte connecté
async function clientDe(req) {
  const { rows } = await q(`SELECT * FROM clients WHERE utilisateur_id = $1`, [req.utilisateur.id]);
  if (!rows[0]) throw Object.assign(new Error("Aucune fiche client n'est liée à votre compte. Contactez ICERD."), { status: 404 });
  return rows[0];
}

// --- Suivi des demandes : statut global + avancement analyse par analyse
r.get('/mes-demandes', roles('CLIENT'), async (req, res, next) => {
  try {
    const client = await clientDe(req);
    const { rows } = await q(
      `SELECT d.id, d.numero, d.objet, d.statut, d.urgence,
              to_char(d.date_reception,'DD/MM/YYYY') AS recu_le,
              to_char(d.date_echeance,'DD/MM/YYYY') AS echeance,
              count(ea.id)::int AS nb_analyses,
              count(ea.id) FILTER (WHERE ea.statut = 'VALIDEE')::int AS analyses_validees
       FROM demandes d
       LEFT JOIN echantillons e ON e.demande_id = d.id
       LEFT JOIN echantillon_analyses ea ON ea.echantillon_id = e.id
       WHERE d.client_id = $1
       GROUP BY d.id ORDER BY d.date_reception DESC`, [client.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// --- Détail d'une demande (échantillons + état d'avancement, sans données internes)
r.get('/mes-demandes/:id', roles('CLIENT'), async (req, res, next) => {
  try {
    const client = await clientDe(req);
    const d = (await q(`SELECT id, numero, objet, statut FROM demandes WHERE id = $1 AND client_id = $2`,
      [req.params.id, client.id])).rows[0];
    if (!d) return res.status(404).json({ erreur: 'Demande introuvable' });
    const echs = (await q(
      `SELECT e.code, e.designation, e.matrice, e.etat,
              json_agg(json_build_object('analyse', ta.nom, 'statut', ea.statut) ORDER BY ta.nom) AS analyses
       FROM echantillons e
       LEFT JOIN echantillon_analyses ea ON ea.echantillon_id = e.id
       LEFT JOIN types_analyse ta ON ta.id = ea.type_analyse_id
       WHERE e.demande_id = $1 GROUP BY e.id ORDER BY e.code`, [d.id])).rows;
    res.json({ ...d, echantillons: echs });
  } catch (e) { next(e); }
});

// --- Factures du client
r.get('/mes-factures', roles('CLIENT'), async (req, res, next) => {
  try {
    const client = await clientDe(req);
    const { rows } = await q(
      `SELECT f.numero, to_char(f.date_emission,'DD/MM/YYYY') AS emise_le,
              to_char(f.date_echeance,'DD/MM/YYYY') AS echeance,
              f.montant_ttc, f.statut,
              COALESCE((SELECT sum(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS total_paye
       FROM factures f WHERE f.client_id = $1 ORDER BY f.date_emission DESC`, [client.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// --- Rapports émis (le PDF se télécharge via /api/rapports/demande/:id/pdf,
//     dont le contrôle d'accès vérifie déjà l'appartenance au client)
r.get('/mes-rapports', roles('CLIENT'), async (req, res, next) => {
  try {
    const client = await clientDe(req);
    const { rows } = await q(
      `SELECT r.numero, to_char(r.emis_le,'DD/MM/YYYY') AS emis_le, r.amende,
              d.id AS demande_id, d.numero AS demande, d.objet
       FROM rapports r JOIN demandes d ON d.id = r.demande_id
       WHERE d.client_id = $1 ORDER BY r.emis_le DESC`, [client.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// --- Création du compte portail d'un client (par le personnel ICERD)
r.post('/comptes', roles('ADMIN','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  try {
    const { client_id, email, mot_de_passe } = req.body;
    const client = (await q(`SELECT * FROM clients WHERE id = $1`, [client_id])).rows[0];
    if (!client) return res.status(404).json({ erreur: 'Client introuvable' });
    if (client.utilisateur_id) return res.status(409).json({ erreur: 'Ce client possède déjà un compte portail' });

    const hash = await bcrypt.hash(mot_de_passe, 12);
    const u = (await q(
      `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role_id)
       VALUES ($1, 'Portail', $2, $3, (SELECT id FROM roles WHERE code = 'CLIENT'))
       RETURNING id, email`, [client.raison_sociale.slice(0, 80), email, hash])).rows[0];
    await q(`UPDATE clients SET utilisateur_id = $1 WHERE id = $2`, [u.id, client_id]);
    res.status(201).json({ message: 'Compte portail client créé', email: u.email, client: client.raison_sociale });
  } catch (e) { next(e); }
});

export default r;

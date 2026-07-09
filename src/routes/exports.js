// ============================================================================
// EXPORTS DE DONNÉES — CSV, JSON, Excel (xlsx)
// GET /api/exports/:ressource.:format
//   ressources : clients | demandes | echantillons | resultats | stocks |
//                mouvements | factures | paiements | catalogue | equipements
//   formats    : csv | json | xlsx
// Exemple : /api/exports/resultats.xlsx
// ============================================================================
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// Requêtes d'export : colonnes lisibles, jointures faites, prêtes pour Excel
const RESSOURCES = {
  clients: {
    roles: ['ADMIN','DIRECTION','COMMERCIAL','COMPTABLE'],
    sql: `SELECT code, type, raison_sociale, contact_nom, email, telephone, ville, pays, nui,
                 to_char(cree_le,'DD/MM/YYYY') AS cree_le
          FROM clients ORDER BY code`
  },
  demandes: {
    roles: ['ADMIN','DIRECTION','CHEF_LABO','COMMERCIAL','QUALITE'],
    sql: `SELECT d.numero, c.raison_sociale AS client, d.objet, d.statut, d.urgence,
                 to_char(d.date_reception,'DD/MM/YYYY') AS recu_le,
                 to_char(d.date_echeance,'DD/MM/YYYY') AS echeance,
                 (SELECT count(*) FROM echantillons e WHERE e.demande_id = d.id) AS nb_echantillons
          FROM demandes d JOIN clients c ON c.id = d.client_id ORDER BY d.date_reception DESC`
  },
  echantillons: {
    roles: ['ADMIN','DIRECTION','CHEF_LABO','TECHNICIEN','QUALITE'],
    sql: `SELECT e.code, d.numero AS demande, c.raison_sociale AS client, e.matrice, e.designation,
                 e.lieu_prelevement, e.coordonnees_gps, to_char(e.date_prelevement,'DD/MM/YYYY') AS preleve_le,
                 e.preleve_par, e.quantite, e.etat, e.emplacement_stockage
          FROM echantillons e JOIN demandes d ON d.id = e.demande_id
          JOIN clients c ON c.id = d.client_id ORDER BY e.code`
  },
  resultats: {
    roles: ['ADMIN','DIRECTION','CHEF_LABO','QUALITE'],
    sql: `SELECT e.code AS echantillon, d.numero AS demande, ta.nom AS analyse, ta.methode,
                 res.valeur_num, res.valeur_txt, res.unite, res.incertitude, res.limite_detection,
                 res.conforme, res.norme_reference,
                 to_char(res.saisi_le,'DD/MM/YYYY HH24:MI') AS saisi_le,
                 us.nom AS saisi_par, uv.nom AS valide_par,
                 to_char(res.valide_le,'DD/MM/YYYY HH24:MI') AS valide_le
          FROM resultats res
          JOIN echantillon_analyses ea ON ea.id = res.ech_analyse_id
          JOIN echantillons e ON e.id = ea.echantillon_id
          JOIN demandes d ON d.id = e.demande_id
          JOIN types_analyse ta ON ta.id = ea.type_analyse_id
          LEFT JOIN utilisateurs us ON us.id = res.saisi_par
          LEFT JOIN utilisateurs uv ON uv.id = res.valide_par
          ORDER BY e.code, ta.nom`
  },
  stocks: {
    roles: ['ADMIN','DIRECTION','MAGASINIER','CHEF_LABO','COMPTABLE'],
    sql: `SELECT code, designation, categorie, unite, stock_actuel, stock_mini, emplacement, danger, fournisseur
          FROM articles WHERE actif ORDER BY categorie, designation`
  },
  mouvements: {
    roles: ['ADMIN','DIRECTION','MAGASINIER','COMPTABLE'],
    sql: `SELECT to_char(m.date_mouvement,'DD/MM/YYYY HH24:MI') AS date, a.code, a.designation,
                 m.type, m.quantite, a.unite, m.motif, u.nom AS operateur
          FROM mouvements_stock m JOIN articles a ON a.id = m.article_id
          LEFT JOIN utilisateurs u ON u.id = m.effectue_par ORDER BY m.date_mouvement DESC`
  },
  factures: {
    roles: ['ADMIN','DIRECTION','COMPTABLE'],
    sql: `SELECT f.numero, c.raison_sociale AS client, to_char(f.date_emission,'DD/MM/YYYY') AS emise_le,
                 to_char(f.date_echeance,'DD/MM/YYYY') AS echeance, f.montant_ht, f.tva_taux,
                 f.montant_tva, f.montant_ttc, f.statut,
                 COALESCE((SELECT sum(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS total_paye
          FROM factures f JOIN clients c ON c.id = f.client_id ORDER BY f.date_emission DESC`
  },
  paiements: {
    roles: ['ADMIN','DIRECTION','COMPTABLE'],
    sql: `SELECT to_char(p.date_paiement,'DD/MM/YYYY') AS date, f.numero AS facture,
                 c.raison_sociale AS client, p.montant, p.mode, p.reference, u.nom AS encaisse_par
          FROM paiements p JOIN factures f ON f.id = p.facture_id
          JOIN clients c ON c.id = f.client_id
          LEFT JOIN utilisateurs u ON u.id = p.encaisse_par ORDER BY p.date_paiement DESC`
  },
  catalogue: {
    roles: ['ADMIN','DIRECTION','CHEF_LABO','COMMERCIAL','QUALITE','COMPTABLE'],
    sql: `SELECT ta.code, ta.nom, ta.matrice, ta.categorie, ta.methode, ta.unite,
                 CASE WHEN ta.sur_devis THEN 'Sur devis' ELSE ta.prix_fcfa::text END AS prix_fcfa,
                 ta.delai_jours, l.code AS laboratoire
          FROM types_analyse ta LEFT JOIN laboratoires l ON l.id = ta.laboratoire_id
          WHERE ta.actif ORDER BY ta.code`
  },
  equipements: {
    roles: ['ADMIN','DIRECTION','CHEF_LABO','QUALITE'],
    sql: `SELECT eq.code, eq.designation, l.code AS laboratoire, eq.numero_serie, eq.statut,
                 to_char(eq.prochain_etalonnage,'DD/MM/YYYY') AS prochain_etalonnage
          FROM equipements eq LEFT JOIN laboratoires l ON l.id = eq.laboratoire_id ORDER BY eq.code`
  },
};

// Échappement CSV (séparateur ; — compatible Excel FR)
const csvVal = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

r.get('/:fichier', async (req, res, next) => {
  try {
    const m = req.params.fichier.match(/^([a-z]+)\.(csv|json|xlsx)$/);
    if (!m) return res.status(400).json({ erreur: 'Format attendu : ressource.csv | .json | .xlsx' });
    const [, ressource, format] = m;
    const def = RESSOURCES[ressource];
    if (!def) return res.status(404).json({ erreur: `Ressource inconnue. Disponibles : ${Object.keys(RESSOURCES).join(', ')}` });
    if (!def.roles.includes(req.utilisateur.role) && req.utilisateur.role !== 'ADMIN')
      return res.status(403).json({ erreur: 'Export non autorisé pour votre profil' });

    const { rows } = await q(def.sql);
    const horodatage = new Date().toISOString().slice(0, 10);
    const nom = `icerd_${ressource}_${horodatage}`;

    // Journal d'audit : qui a exporté quoi
    await q(`INSERT INTO audit_log (utilisateur_id, action, table_cible, nouvelle_valeur)
             VALUES ($1,'EXPORT',$2,$3)`,
      [req.utilisateur.id, ressource, JSON.stringify({ format, lignes: rows.length })]);

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${nom}.json"`);
      return res.json({ exporte_le: new Date().toISOString(), ressource, total: rows.length, donnees: rows });
    }

    if (format === 'csv') {
      const colonnes = rows.length ? Object.keys(rows[0]) : [];
      const csv = '\uFEFF' + [colonnes.join(';'), ...rows.map(l => colonnes.map(c => csvVal(l[c])).join(';'))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nom}.csv"`);
      return res.send(csv);
    }

    // xlsx — feuille formatée aux couleurs ICERD
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ICERD LIMS';
    const ws = wb.addWorksheet(ressource.toUpperCase(), { views: [{ state: 'frozen', ySplit: 1 }] });
    const colonnes = rows.length ? Object.keys(rows[0]) : ['aucune_donnee'];
    ws.columns = colonnes.map(c => ({ header: c.replace(/_/g, ' ').toUpperCase(), key: c, width: Math.min(38, Math.max(12, c.length + 6)) }));
    ws.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17362A' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFB4552D' } } };
    });
    rows.forEach(l => ws.addRow(l));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

export default r;

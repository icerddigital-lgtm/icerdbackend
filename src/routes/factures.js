// backend/src/routes/factures.js
import { Router } from 'express';
import { q, pool } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const r = Router();
r.use(authRequis);

// GET /api/factures - Liste des factures
r.get('/', async (req, res, next) => {
  try {
    const { statut } = req.query;
    const { rows } = await q(
      `SELECT f.*, c.raison_sociale,
              COALESCE((SELECT sum(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS total_paye
       FROM factures f JOIN clients c ON c.id = f.client_id
       WHERE ($1::statut_facture IS NULL OR f.statut = $1)
       ORDER BY f.date_emission DESC LIMIT 300`, 
      [statut || null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/factures/:id - Détail d'une facture
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT f.*, c.raison_sociale, c.email, c.telephone,
              COALESCE((SELECT sum(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS total_paye
       FROM factures f JOIN clients c ON c.id = f.client_id
       WHERE f.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Facture non trouvée' });
    }
    const lignes = await q(
      `SELECT * FROM lignes_facture WHERE facture_id = $1`,
      [req.params.id]
    );
    const paiements = await q(
      `SELECT * FROM paiements WHERE facture_id = $1 ORDER BY date_paiement DESC`,
      [req.params.id]
    );
    res.json({ ...rows[0], lignes: lignes.rows, paiements: paiements.rows });
  } catch (e) { next(e); }
});

// ✅ ROUTE PDF - Télécharger le PDF d'une facture (VERSION CORRIGÉE)
r.get('/:id/pdf', async (req, res, next) => {
  try {
    // Récupérer la facture avec ses détails
    const facture = await q(
      `SELECT f.*, c.raison_sociale, c.email, c.telephone, c.adresse,
              COALESCE((SELECT sum(p.montant) FROM paiements p WHERE p.facture_id = f.id),0) AS total_paye
       FROM factures f JOIN clients c ON c.id = f.client_id
       WHERE f.id = $1`,
      [req.params.id]
    );
    
    if (facture.rows.length === 0) {
      return res.status(404).json({ erreur: 'Facture non trouvée' });
    }

    const f = facture.rows[0];

    // Récupérer les lignes de la facture
    const lignes = await q(
      `SELECT * FROM lignes_facture WHERE facture_id = $1`,
      [req.params.id]
    );

    // Créer le PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Facture ${f.numero}`,
        Author: 'ICERD',
        Subject: 'Facture'
      }
    });

    // Définir les headers pour le téléchargement
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Facture_${f.numero}.pdf`);
    
    doc.pipe(res);

    // === EN-TÊTE ===
    // Logo (si disponible)
    try {
      const logoPath = path.join(__dirname, '../../assets/logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 45, { width: 100 });
      }
    } catch (e) {
      // Pas de logo, on continue
    }

    // Titre
    doc.fontSize(24)
       .font('Helvetica-Bold')
       .fillColor('#0f2d80')
       .text('FACTURE', 50, 50, { align: 'center' });
    
    doc.fontSize(14)
       .fillColor('#333333')
       .text(`N° ${f.numero}`, 50, 80, { align: 'center' });

    // === INFORMATIONS ===
    const yStart = 120;
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#333333');

    // Informations ICERD
    doc.text('ICERD - Institut de Recherche', 50, yStart);
    doc.text('B.P. 1234 Yaoundé, Cameroun', 50, yStart + 15);
    doc.text('Tél: +237 666 66 66 66', 50, yStart + 30);
    doc.text('Email: contact@icerd.cm', 50, yStart + 45);

    // Informations Client
    doc.text('Client:', 350, yStart);
    doc.font('Helvetica-Bold')
       .text(f.raison_sociale || 'Client non spécifié', 350, yStart + 15);
    doc.font('Helvetica')
       .text(f.adresse || 'Adresse non spécifiée', 350, yStart + 30);
    doc.text(f.email || 'Email non spécifié', 350, yStart + 45);
    doc.text(f.telephone || 'Téléphone non spécifié', 350, yStart + 60);

    // Dates et statut
    const yInfo = yStart + 90;
    doc.font('Helvetica-Bold');
    doc.text('Date d\'émission:', 50, yInfo);
    doc.text('Date d\'échéance:', 50, yInfo + 20);
    doc.text('Statut:', 350, yInfo);
    
    doc.font('Helvetica');
    doc.text(new Date(f.date_emission).toLocaleDateString('fr-FR'), 180, yInfo);
    doc.text(new Date(f.date_echeance).toLocaleDateString('fr-FR'), 180, yInfo + 20);
    
    const statutLabels = {
      EMISE: 'Émise',
      PARTIELLEMENT_PAYEE: 'Partiellement payée',
      PAYEE: 'Payée',
      ANNULEE: 'Annulée'
    };
    doc.text(statutLabels[f.statut] || f.statut, 430, yInfo);

    // === TABLEAU DES LIGNES (VERSION CORRIGÉE) ===
    const tableTop = yInfo + 50;
    
    // Définition des colonnes - BIEN ALIGNÉES
    const col1 = 50;      // Désignation
    const col2 = 280;     // Quantité
    const col3 = 360;     // Prix unitaire
    const col4 = 460;     // Total

    // En-tête du tableau avec fond gris
    doc.rect(col1, tableTop - 5, 530, 25)
       .fill('#f0f4f8');
    
    doc.fillColor('#0f2d80')
       .font('Helvetica-Bold')
       .fontSize(10);
    
    // Alignement des en-têtes
    doc.text('Désignation', col1 + 5, tableTop);
    doc.text('Quantité', col2, tableTop, { align: 'center', width: 70 });
    doc.text('Prix unitaire', col3, tableTop, { align: 'center', width: 90 });
    doc.text('Total', col4, tableTop, { align: 'center', width: 80 });

    // Ligne de séparation
    doc.strokeColor('#cccccc')
       .lineWidth(1)
       .moveTo(col1, tableTop + 25)
       .lineTo(col1 + 530, tableTop + 25)
       .stroke();

    // === LIGNES DU TABLEAU ===
    let y = tableTop + 35;
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor('#333333');

    let totalHT = 0;
    let index = 0;
    
    for (const ligne of lignes.rows) {
      const totalLigne = Number(ligne.quantite) * Number(ligne.prix_unitaire);
      totalHT += totalLigne;

      // Alterner les couleurs des lignes
      if (index % 2 === 0) {
        doc.rect(col1, y - 3, 530, 20)
           .fill('#f8fafc');
      }

      // Désignation - avec gestion des longs textes
      const designation = ligne.designation || ligne.nom_analyse || 'Service';
      doc.fillColor('#333333')
         .font('Helvetica')
         .fontSize(9)
         .text(designation, col1 + 5, y, { width: 220 });
      
      // Quantité - centré
      doc.text(ligne.quantite.toString(), col2, y, { align: 'center', width: 70 });
      
      // Prix unitaire - centré
      doc.text(`${Number(ligne.prix_unitaire).toLocaleString('fr-FR')} FCFA`, col3, y, { align: 'center', width: 90 });
      
      // Total - centré
      doc.text(`${totalLigne.toLocaleString('fr-FR')} FCFA`, col4, y, { align: 'center', width: 80 });

      y += 20;
      index++;

      // Nouvelle page si nécessaire
      if (y > 700) {
        doc.addPage();
        y = 50;
        // Réafficher les en-têtes sur la nouvelle page
        doc.rect(col1, y - 5, 530, 25)
           .fill('#f0f4f8');
        doc.fillColor('#0f2d80')
           .font('Helvetica-Bold')
           .fontSize(10);
        doc.text('Désignation', col1 + 5, y);
        doc.text('Quantité', col2, y, { align: 'center', width: 70 });
        doc.text('Prix unitaire', col3, y, { align: 'center', width: 90 });
        doc.text('Total', col4, y, { align: 'center', width: 80 });
        doc.strokeColor('#cccccc')
           .lineWidth(1)
           .moveTo(col1, y + 25)
           .lineTo(col1 + 530, y + 25)
           .stroke();
        y += 35;
      }
    }

    // === TOTAUX ===
    y += 15;
    const tvaTaux = Number(f.tva_taux) || 19.25;
    const tva = Number(f.montant_tva) || 0;
    const ttc = Number(f.montant_ttc) || 0;

    // Ligne de séparation des totaux
    doc.strokeColor('#cccccc')
       .lineWidth(1)
       .moveTo(350, y)
       .lineTo(530, y)
       .stroke();

    y += 10;
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#333333');

    // Aligner les totaux à droite
    const totalX = 460;
    
    doc.text('Total HT:', 350, y);
    doc.text(`${totalHT.toLocaleString('fr-FR')} FCFA`, totalX, y, { align: 'right', width: 120 });

    y += 20;
    doc.text(`TVA (${tvaTaux}%):`, 350, y);
    doc.text(`${tva.toLocaleString('fr-FR')} FCFA`, totalX, y, { align: 'right', width: 120 });

    y += 25;
    doc.fontSize(14)
       .fillColor('#0f2d80')
       .font('Helvetica-Bold');
    doc.text('Total TTC:', 350, y);
    doc.text(`${ttc.toLocaleString('fr-FR')} FCFA`, totalX, y, { align: 'right', width: 120 });

    // === PAIEMENTS ===
    if (f.total_paye > 0) {
      y += 40;
      doc.fontSize(10)
         .fillColor('#333333')
         .font('Helvetica-Bold')
         .text('Paiements effectués:', 50, y);

      y += 20;
      doc.font('Helvetica')
         .fontSize(9);
      
      const paiements = await q(
        `SELECT * FROM paiements WHERE facture_id = $1 ORDER BY date_paiement DESC`,
        [req.params.id]
      );

      // Alignement des colonnes des paiements
      const pCol1 = 50;
      const pCol2 = 160;
      const pCol3 = 250;
      const pCol4 = 460;

      doc.font('Helvetica-Bold')
         .text('Date', pCol1, y)
         .text('Mode', pCol2, y)
         .text('Référence', pCol3, y)
         .text('Montant', pCol4, y, { align: 'right' });

      y += 15;
      doc.font('Helvetica');
      
      for (const p of paiements.rows) {
        const date = new Date(p.date_paiement).toLocaleDateString('fr-FR');
        const modeMap = {
          ESPECES: 'Espèces',
          VIREMENT: 'Virement',
          CHEQUE: 'Chèque',
          MOBILE_MONEY: 'Mobile Money',
          CARTE: 'Carte'
        };
        const mode = modeMap[p.mode] || p.mode;
        const ref = p.reference || '-';

        doc.text(date, pCol1, y);
        doc.text(mode, pCol2, y);
        doc.text(ref, pCol3, y);
        doc.text(`${Number(p.montant).toLocaleString('fr-FR')} FCFA`, pCol4, y, { align: 'right' });

        y += 15;
      }

      // Reste à payer
      const reste = ttc - Number(f.total_paye);
      if (reste > 0) {
        y += 10;
        doc.font('Helvetica-Bold')
           .fillColor('#dc2626')
           .fontSize(11)
           .text('Reste à payer:', 350, y);
        doc.text(`${reste.toLocaleString('fr-FR')} FCFA`, totalX, y, { align: 'right', width: 120 });
      }
    }

    // === PIED DE PAGE ===
    const pageHeight = doc.page.height;
    doc.fontSize(8)
       .fillColor('#94a3b8')
       .text('ICERD - Institut de Recherche', 50, pageHeight - 60, { align: 'center' });
    doc.text('Ce document est un justificatif officiel de prestation', 50, pageHeight - 45, { align: 'center' });
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, 50, pageHeight - 30, { align: 'center' });

    // Finaliser le PDF
    doc.end();

  } catch (e) { 
    console.error('Erreur génération PDF:', e);
    next(e); 
  }
});

// POST /api/factures/depuis-demande/:demandeId - Générer une facture depuis une demande
r.post('/depuis-demande/:demandeId', roles('ADMIN','COMPTABLE','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    await cx.query('BEGIN');
    const d = (await cx.query(`SELECT * FROM demandes WHERE id = $1`, [req.params.demandeId])).rows[0];
    if (!d) throw Object.assign(new Error('Demande introuvable'), { status: 404 });

    const lignes = (await cx.query(
      `SELECT ta.nom, count(*) AS quantite, ea.prix_applique
       FROM echantillon_analyses ea
       JOIN echantillons e ON e.id = ea.echantillon_id
       JOIN types_analyse ta ON ta.id = ea.type_analyse_id
       WHERE e.demande_id = $1 GROUP BY ta.nom, ea.prix_applique`, 
      [d.id]
    )).rows;

    const ht = lignes.reduce((s, l) => s + Number(l.quantite) * Number(l.prix_applique || 0), 0);
    const taux = Number(req.body.tva_taux ?? 19.25);
    const tva = Math.round(ht * taux / 100);

    const f = (await cx.query(
      `INSERT INTO factures (numero, demande_id, client_id, montant_ht, tva_taux, montant_tva, montant_ttc, statut, emise_par, date_echeance)
       VALUES (genere_numero('FA','seq_facture'),$1,$2,$3,$4,$5,$6,'EMISE',$7, CURRENT_DATE + 30)
       RETURNING *`, 
      [d.id, d.client_id, ht, taux, tva, ht + tva, req.utilisateur.id]
    )).rows[0];

    for (const l of lignes) {
      await cx.query(
        `INSERT INTO lignes_facture (facture_id, designation, quantite, prix_unitaire) VALUES ($1,$2,$3,$4)`,
        [f.id, l.nom, l.quantite, l.prix_applique || 0]
      );
    }

    await cx.query(`UPDATE demandes SET statut = 'FACTUREE' WHERE id = $1`, [d.id]);
    await cx.query('COMMIT');
    res.status(201).json(f);
  } catch (e) { 
    await cx.query('ROLLBACK'); 
    next(e); 
  } finally { 
    cx.release(); 
  }
});

// POST /api/factures/:id/paiements - Enregistrer un paiement
r.post('/:id/paiements', roles('ADMIN','COMPTABLE','DIRECTION'), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const { montant, mode, reference, compte_id } = req.body;
    await cx.query('BEGIN');
    const p = (await cx.query(
      `INSERT INTO paiements (facture_id, montant, mode, reference, encaisse_par)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, montant, mode, reference, req.utilisateur.id]
    )).rows[0];

    if (compte_id) {
      const f = (await cx.query(`SELECT numero FROM factures WHERE id = $1`, [req.params.id])).rows[0];
      await cx.query(
        `INSERT INTO operations_tresorerie (compte_id, libelle, credit, piece_reference, paiement_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [compte_id, `Encaissement facture ${f.numero}`, montant, f.numero, p.id]
      );
    }

    // Mise à jour du statut de la facture
    await cx.query(
      `UPDATE factures f SET statut = CASE
          WHEN (SELECT COALESCE(sum(montant),0) FROM paiements WHERE facture_id = f.id) >= f.montant_ttc THEN 'PAYEE'
          ELSE 'PARTIELLEMENT_PAYEE' END::statut_facture
       WHERE f.id = $1`, 
      [req.params.id]
    );
    await cx.query('COMMIT');
    res.status(201).json(p);
  } catch (e) { 
    await cx.query('ROLLBACK'); 
    next(e); 
  } finally { 
    cx.release(); 
  }
});

// PATCH /api/factures/:id - Modifier une facture (annulation, etc.)
r.patch('/:id', roles('ADMIN','COMPTABLE','DIRECTION'), async (req, res, next) => {
  try {
    const { statut, date_echeance } = req.body;
    const { rows } = await q(
      `UPDATE factures SET
         statut = COALESCE($1, statut),
         date_echeance = COALESCE($2, date_echeance)
       WHERE id = $3
       RETURNING *`,
      [statut, date_echeance, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Facture non trouvée' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// GET /api/factures/tresorerie/soldes
r.get('/tresorerie/soldes', roles('ADMIN','COMPTABLE','DIRECTION'), async (_req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT 
         ct.id, 
         ct.libelle, 
         ct.type,
         ct.solde_initial + COALESCE(SUM(o.credit - o.debit), 0) AS solde
       FROM comptes_tresorerie ct
       LEFT JOIN operations_tresorerie o ON o.compte_id = ct.id
       GROUP BY ct.id, ct.libelle, ct.type, ct.solde_initial
       ORDER BY ct.id`
    );
    res.json(rows);
  } catch (e) { 
    next(e); 
  }
});

export default r;
// ============================================================================
// RAPPORTS D'ESSAI — génération PDF (pdfkit) et DOCX (docx)
// GET  /api/rapports/demande/:id/pdf   → télécharge le rapport PDF
// GET  /api/rapports/demande/:id/docx  → télécharge le rapport Word
// GET  /api/rapports                   → liste des rapports émis
// ============================================================================
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType
} from 'docx';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

const VERT = '#17362A', LATERITE = '#B4552D', GRIS = '#4D5347';
const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA';
const dateFR = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

// ---------------------------------------------------------------------------
// Collecte des données complètes d'une demande (partagée PDF/DOCX)
// ---------------------------------------------------------------------------
async function donneesRapport(demandeId, utilisateur) {
  const d = (await q(
    `SELECT d.*, c.raison_sociale, c.adresse, c.ville, c.email AS client_email,
            c.telephone AS client_tel, c.utilisateur_id AS client_uid
     FROM demandes d JOIN clients c ON c.id = d.client_id WHERE d.id = $1`, [demandeId])).rows[0];
  if (!d) throw Object.assign(new Error('Demande introuvable'), { status: 404 });

  // Un client (portail) ne peut télécharger que SES rapports
  if (utilisateur.role === 'CLIENT' && d.client_uid !== utilisateur.id)
    throw Object.assign(new Error('Accès refusé à ce rapport'), { status: 403 });

  const lignes = (await q(
    `SELECT e.code AS ech, e.designation, e.matrice, e.lieu_prelevement, e.coordonnees_gps,
            e.date_prelevement, e.preleve_par, e.conditionnement, e.observations,
            ta.nom AS analyse, ta.methode, ta.unite AS unite_cat,
            res.valeur_num, res.valeur_txt, res.unite, res.incertitude,
            res.limite_detection, res.conforme, res.norme_reference,
            res.valide_le, ea.date_debut, ea.date_fin
     FROM echantillon_analyses ea
     JOIN echantillons e ON e.id = ea.echantillon_id
     JOIN types_analyse ta ON ta.id = ea.type_analyse_id
     LEFT JOIN resultats res ON res.ech_analyse_id = ea.id
     WHERE e.demande_id = $1
     ORDER BY e.code, ta.nom`, [demandeId])).rows;

  const nonValides = lignes.filter(l => !l.valide_le).length;
  return { d, lignes, nonValides };
}

async function enregistrerRapport(demandeId, buffer, utilisateurId) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const { rows } = await q(
    `INSERT INTO rapports (numero, demande_id, emis_par, hash_sha256)
     VALUES (genere_numero('RE','seq_rapport'), $1, $2, $3) RETURNING numero`,
    [demandeId, utilisateurId, hash]);
  await q(`UPDATE demandes SET statut = 'RAPPORT_EMIS' WHERE id = $1 AND statut IN ('VALIDEE','EN_COURS')`, [demandeId]);
  return { numero: rows[0].numero, hash };
}

const MENTION = "Les résultats ne se rapportent qu'aux échantillons soumis à l'essai. " +
  "Ce rapport ne peut être reproduit, sinon en entier, sans l'autorisation écrite d'ICERD.";

// ---------------------------------------------------------------------------
// GET /api/rapports/demande/:id/pdf
// ---------------------------------------------------------------------------
r.get('/demande/:id/pdf', async (req, res, next) => {
  try {
    const { d, lignes, nonValides } = await donneesRapport(req.params.id, req.utilisateur);
    if (nonValides > 0 && req.query.brouillon !== '1')
      return res.status(409).json({
        erreur: `${nonValides} résultat(s) non validé(s). Faites valider par le chef de laboratoire, ou ajoutez ?brouillon=1 pour un PDF filigrané PROVISOIRE.` });

    const morceaux = [];
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 66, left: 50, right: 50 }, bufferPages: true });
    doc.on('data', c => morceaux.push(c));

    const brouillon = nonValides > 0;
    const { numero, hash } = brouillon
      ? { numero: 'PROVISOIRE', hash: '' }
      : await enregistrerRapport(d.id, Buffer.from('placeholder'), req.utilisateur.id);

    // ---- En-tête institutionnel
    const enTete = () => {
      doc.rect(50, 42, doc.page.width - 100, 3).fill(LATERITE);
      doc.fillColor(VERT).font('Helvetica-Bold').fontSize(20).text('ICERD', 50, 54);
      doc.fillColor(GRIS).font('Helvetica').fontSize(8)
        .text('International Centre of Environmental Studies and Research for Development', 50, 76)
        .text('1, Rue 8417, Messamendongo, Yaoundé 4 — Cameroun · Tél. +237 689 03 51 88 / 671 87 94 94 · icerdcameroon@gmail.com', 50, 87);
      doc.moveTo(50, 102).lineTo(doc.page.width - 50, 102).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    };
    enTete();

    // ---- Titre
    doc.moveDown(2);
    doc.fillColor(VERT).font('Helvetica-Bold').fontSize(16)
      .text("RAPPORT D'ESSAI", 50, 118, { align: 'center' });
    doc.fillColor(LATERITE).fontSize(11)
      .text(`N° ${numero}`, { align: 'center' });

    if (brouillon) {
      doc.save().rotate(-30, { origin: [300, 400] }).fontSize(72)
        .fillColor('#C23B22').opacity(0.15).text('PROVISOIRE', 80, 360).restore().opacity(1);
    }

    // ---- Bloc identification
    let y = 165;
    const info = (etiq, val, x, largeur = 240) => {
      doc.fontSize(8).fillColor(GRIS).font('Helvetica-Bold').text(etiq.toUpperCase(), x, y, { width: largeur });
      doc.fontSize(10).fillColor('#222').font('Helvetica').text(val || '—', x, y + 10, { width: largeur });
    };
    info('Client', d.raison_sociale, 50); info('Demande n°', d.numero, 320, 220); y += 30;
    info('Adresse', [d.adresse, d.ville].filter(Boolean).join(', '), 50);
    info('Date de réception', dateFR(d.date_reception), 320, 220); y += 30;
    info('Contact', [d.client_tel, d.client_email].filter(Boolean).join(' · '), 50);
    info("Date d'émission", dateFR(new Date()), 320, 220); y += 30;
    info('Objet', d.objet, 50, 490); y += 34;

    // ---- Échantillons (identification détaillée)
    doc.fontSize(11).fillColor(VERT).font('Helvetica-Bold').text('1. IDENTIFICATION DES ÉCHANTILLONS', 50, y); y += 18;
    const echs = [...new Map(lignes.map(l => [l.ech, l])).values()];
    doc.fontSize(8.5).font('Helvetica');
    for (const e of echs) {
      const bloc = `${e.ech} — ${e.designation || 'Sans désignation'} (${e.matrice})` +
        `\n   Prélèvement : ${e.lieu_prelevement || 'non précisé'}` +
        `${e.coordonnees_gps ? ' · GPS ' + e.coordonnees_gps : ''} · le ${dateFR(e.date_prelevement)}` +
        ` · par ${e.preleve_par || 'le client'} · ${e.conditionnement || ''}` +
        (e.observations ? `\n   Réserves : ${e.observations}` : '');
      doc.fillColor('#222').text(bloc, 55, y, { width: 490 });
      y = doc.y + 6;
      if (y > 700) { doc.addPage(); enTete(); y = 120; }
    }

    // ---- Tableau des résultats
    y += 8;
    doc.fontSize(11).fillColor(VERT).font('Helvetica-Bold').text('2. RÉSULTATS DES ANALYSES', 50, y); y += 18;
    const cols = [78, 132, 88, 62, 40, 55, 40];
    const xs = cols.reduce((a, w, i) => (a.push((a[i - 1] ?? 50) + (cols[i - 1] ?? 0)), a), []);
    const rangee = (vals, entete = false, h = 16) => {
      if (y + h > 740) { doc.addPage(); enTete(); y = 120; rangee(['Échantillon','Analyse','Méthode','Résultat','Unité','Norme réf.','Conf.'], true); }
      if (entete) { doc.rect(50, y - 2, 495, 14).fill(VERT); doc.fillColor('#FFF'); }
      else doc.fillColor('#222');
      doc.font(entete ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
      vals.forEach((v, i) => doc.text(String(v ?? '—'), xs[i] + 3, y, { width: cols[i] - 6, height: h }));
      y += entete ? 16 : Math.max(12, doc.heightOfString(String(vals[1] || ''), { width: cols[1] - 6 }) + 4);
      if (!entete) { doc.moveTo(50, y - 2).lineTo(545, y - 2).strokeColor('#DDDDDD').lineWidth(0.4).stroke(); }
    };
    rangee(['Échantillon','Analyse','Méthode','Résultat','Unité','Norme réf.','Conf.'], true);
    for (const l of lignes) {
      const resultat = l.valeur_num ?? l.valeur_txt ?? 'en attente';
      const incert = l.incertitude ? ` ± ${l.incertitude}` : '';
      rangee([l.ech, l.analyse, l.methode, `${resultat}${incert}`, l.unite || l.unite_cat,
        l.norme_reference, l.conforme === null ? '—' : (l.conforme ? 'C' : 'NC')]);
    }
    doc.fontSize(7).fillColor(GRIS)
      .text('C = conforme · NC = non conforme à la norme de référence citée · « en attente » = résultat non encore validé (rapport provisoire).', 50, y + 4, { width: 495 });
    y = doc.y + 14;

    // ---- Observations, validation, signature
    if (y > 640) { doc.addPage(); enTete(); y = 120; }
    doc.fontSize(11).fillColor(VERT).font('Helvetica-Bold').text('3. VALIDATION ET SIGNATURE', 50, y); y += 16;
    doc.fontSize(9).fillColor('#222').font('Helvetica')
      .text("Les analyses ont été réalisées selon les méthodes indiquées, avec contrôles qualité internes (blancs, matériaux de référence, duplicatas). " +
            "Les résultats ont été validés techniquement par le chef de laboratoire avant émission.", 50, y, { width: 495 });
    y = doc.y + 22;
    doc.text('Le Directeur Général', 360, y); doc.text('Professeur MVONDO ZE Antoine', 360, y + 46);
    doc.moveTo(360, y + 42).lineTo(530, y + 42).strokeColor(GRIS).lineWidth(0.6).stroke();

    // ---- Pieds de page sur toutes les pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // évite la création de pages fantômes en écrivant sous la marge
      doc.fontSize(6.5).fillColor(GRIS)
        .text(MENTION, 50, 782, { width: 495, align: 'center' })
        .text(`Rapport ${numero} · Page ${i + 1} / ${pages.count}` + (hash ? ` · Empreinte SHA-256 : ${hash.slice(0, 24)}…` : ''),
          50, 800, { width: 495, align: 'center' });
    }

    doc.end();
    await new Promise(ok => doc.on('end', ok));
    const buffer = Buffer.concat(morceaux);
    if (!brouillon) await q(`UPDATE rapports SET hash_sha256 = $1 WHERE numero = $2`,
      [crypto.createHash('sha256').update(buffer).digest('hex'), numero]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Rapport_${numero}_${d.numero}.pdf"`);
    res.send(buffer);
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// GET /api/rapports/demande/:id/docx — version Word éditable (usage interne)
// ---------------------------------------------------------------------------
r.get('/demande/:id/docx', roles('ADMIN','DIRECTION','CHEF_LABO','QUALITE'), async (req, res, next) => {
  try {
    const { d, lignes } = await donneesRapport(req.params.id, req.utilisateur);
    const bord = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
    const cell = (t, entete = false) => new TableCell({
      shading: entete ? { type: ShadingType.CLEAR, fill: '17362A' } : undefined,
      borders: { top: bord, bottom: bord, left: bord, right: bord },
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [new Paragraph({ children: [new TextRun({
        text: String(t ?? '—'), size: 17, bold: entete, color: entete ? 'FFFFFF' : '222222', font: 'Calibri' })] })]
    });
    const P2 = (t, o = {}) => new Paragraph({ spacing: { after: 120 },
      children: [new TextRun({ text: t, size: o.size || 21, bold: o.bold, color: o.color || '222222', font: 'Calibri' })] });

    const doc = new Document({ sections: [{ children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ICERD', bold: true, size: 40, color: '17362A', font: 'Calibri' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'International Centre of Environmental Studies and Research for Development', size: 17, color: '4D5347', font: 'Calibri' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: '1, Rue 8417, Messamendongo, Yaoundé 4 — Cameroun · +237 689 03 51 88 · icerdcameroon@gmail.com', size: 15, color: '4D5347', font: 'Calibri' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: `RAPPORT D'ESSAI — Demande ${d.numero}`, bold: true, size: 30, color: 'B4552D', font: 'Calibri' })] }),
      P2(`Client : ${d.raison_sociale}`, { bold: true }),
      P2(`Adresse : ${[d.adresse, d.ville].filter(Boolean).join(', ') || '—'}`),
      P2(`Objet : ${d.objet || '—'}`),
      P2(`Date de réception : ${dateFR(d.date_reception)} · Date d'émission : ${dateFR(new Date())}`),
      P2('RÉSULTATS DES ANALYSES', { bold: true, size: 24, color: '17362A' }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ tableHeader: true, children:
          ['Échantillon','Analyse','Méthode','Résultat','Unité','Norme réf.','Conforme'].map(t => cell(t, true)) }),
        ...lignes.map(l => new TableRow({ children: [
          cell(l.ech), cell(l.analyse), cell(l.methode),
          cell(`${l.valeur_num ?? l.valeur_txt ?? 'en attente'}${l.incertitude ? ' ± ' + l.incertitude : ''}`),
          cell(l.unite || l.unite_cat), cell(l.norme_reference),
          cell(l.conforme === null ? '—' : (l.conforme ? 'Conforme' : 'Non conforme'))
        ] }))
      ] }),
      new Paragraph({ spacing: { before: 300, after: 120 }, children: [new TextRun({ text: MENTION, italics: true, size: 17, color: '4D5347', font: 'Calibri' })] }),
      new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'Le Directeur Général\n\n\nProfesseur MVONDO ZE Antoine', size: 21, font: 'Calibri' })] }),
    ] }] });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Rapport_${d.numero}.docx"`);
    res.send(buffer);
  } catch (e) { next(e); }
});

// Liste des rapports émis
r.get('/', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT r.numero, r.emis_le, r.hash_sha256, r.amende, d.numero AS demande, c.raison_sociale
       FROM rapports r JOIN demandes d ON d.id = r.demande_id
       JOIN clients c ON c.id = d.client_id ORDER BY r.emis_le DESC LIMIT 300`);
    res.json(rows);
  } catch (e) { next(e); }
});

export default r;

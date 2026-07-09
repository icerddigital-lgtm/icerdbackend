import { Router } from 'express';
import { q, pool } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// ✅ Liste des statuts valides (correspond à l'énumération PostgreSQL)
const STATUTS_VALIDES = [
  'BROUILLON',
  'ENREGISTREE',
  'EN_COURS',
  'VALIDEE',
  'RAPPORT_EMIS',
  'FACTUREE',
  'CLOTUREE',
  'ANNULEE'
];

// ✅ Middleware de validation des statuts
const validerStatut = (statut) => {
  if (!statut) return false;
  return STATUTS_VALIDES.includes(statut);
};

// Liste avec filtres : ?statut=EN_COURS&client=
r.get('/', async (req, res, next) => {
  try {
    const { statut, client } = req.query;
    
    // ✅ Validation du statut si fourni
    if (statut && !validerStatut(statut)) {
      return res.status(400).json({ 
        erreur: `Statut invalide. Valeurs acceptées: ${STATUTS_VALIDES.join(', ')}` 
      });
    }

    const { rows } = await q(
      `SELECT d.*, c.raison_sociale,
              (SELECT count(*) FROM echantillons e WHERE e.demande_id = d.id) AS nb_echantillons
       FROM demandes d JOIN clients c ON c.id = d.client_id
       WHERE ($1::statut_demande IS NULL OR d.statut = $1)
         AND ($2::uuid IS NULL OR d.client_id = $2)
       ORDER BY d.date_reception DESC LIMIT 300`, 
      [statut || null, client || null]
    );
    res.json(rows);
  } catch (e) { 
    next(e); 
  }
});

// ✅ NOUVEAU: Récupérer les demandes facturables
r.get('/facturables', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT d.*, c.raison_sociale,
              (SELECT count(*) FROM echantillons e WHERE e.demande_id = d.id) AS nb_echantillons
       FROM demandes d 
       JOIN clients c ON c.id = d.client_id
       WHERE d.statut IN ('EN_COURS', 'VALIDEE', 'RAPPORT_EMIS')
       ORDER BY d.date_reception DESC`,
      []
    );
    res.json(rows);
  } catch (e) { 
    next(e); 
  }
});

// Création d'une demande avec ses échantillons et analyses (transaction)
r.post('/', roles('ADMIN','COMMERCIAL','CHEF_LABO','DIRECTION'), async (req, res, next) => {
  const cx = await pool.connect();
  try {
    const { client_id, objet, urgence, date_echeance, echantillons = [] } = req.body;
    
    // ✅ Validation des données
    if (!client_id) {
      return res.status(400).json({ erreur: 'Le client est requis' });
    }
    if (!objet || objet.trim() === '') {
      return res.status(400).json({ erreur: 'L\'objet est requis' });
    }
    if (!echantillons || echantillons.length === 0) {
      return res.status(400).json({ erreur: 'Au moins un échantillon est requis' });
    }

    await cx.query('BEGIN');
    const d = (await cx.query(
      `INSERT INTO demandes (numero, client_id, objet, urgence, date_echeance, recu_par, statut)
       VALUES (genere_numero('DA','seq_demande'), $1, $2, $3, $4, $5, 'ENREGISTREE') RETURNING *`,
      [client_id, objet, urgence || false, date_echeance || null, req.utilisateur.id]
    )).rows[0];

    for (const e of echantillons) {
      // ✅ Validation des échantillons
      if (!e.designation || e.designation.trim() === '') {
        throw new Error(`L'échantillon ${echantillons.indexOf(e) + 1} n'a pas de désignation`);
      }
      if (!e.analyses || e.analyses.length === 0) {
        throw new Error(`L'échantillon "${e.designation}" n'a pas d'analyses`);
      }

      const ech = (await cx.query(
        `INSERT INTO echantillons (code, demande_id, matrice, designation, lieu_prelevement,
                coordonnees_gps, date_prelevement, preleve_par, quantite, conditionnement)
         VALUES (genere_numero('ECH','seq_echantillon'), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [d.id, e.matrice || 'SOL', e.designation.trim(), e.lieu_prelevement || null, 
         e.coordonnees_gps || null, e.date_prelevement || null, e.preleve_par || null, 
         e.quantite || 1, e.conditionnement || null]
      )).rows[0];

      for (const ta of (e.analyses || [])) {
        // ✅ Vérifier que l'analyse existe
        const analyse = await cx.query(
          'SELECT id, prix_fcfa FROM types_analyse WHERE id = $1', [ta]
        );
        if (analyse.rows.length === 0) {
          throw new Error(`L'analyse avec l'ID ${ta} n'existe pas`);
        }
        
        await cx.query(
          `INSERT INTO echantillon_analyses (echantillon_id, type_analyse_id, prix_applique)
           VALUES ($1, $2, $3)`, 
          [ech.id, ta, analyse.rows[0].prix_fcfa]
        );
      }
    }
    await cx.query('COMMIT');
    res.status(201).json(d);
  } catch (e) { 
    await cx.query('ROLLBACK'); 
    if (e.message.includes('n\'a pas de désignation') || e.message.includes('n\'a pas d\'analyses') || e.message.includes('n\'existe pas')) {
      res.status(400).json({ erreur: e.message });
    } else {
      next(e);
    }
  }
  finally { cx.release(); }
});

// Détail complet d'une demande
r.get('/:id', async (req, res, next) => {
  try {
    const d = (await q(
      `SELECT d.*, c.raison_sociale, c.email AS client_email FROM demandes d
       JOIN clients c ON c.id = d.client_id WHERE d.id = $1`, 
      [req.params.id]
    )).rows[0];
    
    if (!d) return res.status(404).json({ erreur: 'Demande introuvable' });
    
    const echs = (await q(
      `SELECT e.*, 
              json_agg(json_build_object(
                'id', ea.id, 
                'analyse', ta.nom, 
                'code_analyse', ta.code,
                'statut', ea.statut, 
                'prix', ea.prix_applique
              )) AS analyses
       FROM echantillons e
       LEFT JOIN echantillon_analyses ea ON ea.echantillon_id = e.id
       LEFT JOIN types_analyse ta ON ta.id = ea.type_analyse_id
       WHERE e.demande_id = $1 
       GROUP BY e.id 
       ORDER BY e.created_at DESC NULLS LAST`, 
      [req.params.id]
    )).rows;
    
    res.json({ ...d, echantillons: echs });
  } catch (e) { 
    next(e); 
  }
});

// Changement de statut avec validation
r.patch('/:id/statut', roles('ADMIN','CHEF_LABO','DIRECTION','QUALITE'), async (req, res, next) => {
  try {
    const { statut } = req.body;
    
    // ✅ Valider le statut
    if (!statut) {
      return res.status(400).json({ 
        erreur: 'Le statut est requis' 
      });
    }
    
    if (!validerStatut(statut)) {
      return res.status(400).json({ 
        erreur: `Statut invalide. Valeurs acceptées: ${STATUTS_VALIDES.join(', ')}` 
      });
    }

    // ✅ Vérifier que la demande existe
    const demande = await q('SELECT id, statut FROM demandes WHERE id = $1', [req.params.id]);
    if (demande.rows.length === 0) {
      return res.status(404).json({ erreur: 'Demande introuvable' });
    }

    // ✅ Log du changement de statut
    console.log(`📝 Changement de statut: ${demande.rows[0].statut} → ${statut} (Demande: ${req.params.id})`);

    // ✅ Mise à jour avec updated_at
    const { rows } = await q(
      `UPDATE demandes SET statut = $1, updated_at = NOW() 
       WHERE id = $2 RETURNING *`,
      [statut, req.params.id]
    );
    
    res.json({
      message: `Statut mis à jour avec succès: ${statut}`,
      demande: rows[0]
    });
  } catch (e) { 
    // ✅ Gestion spécifique des erreurs PostgreSQL
    if (e.code === '22P02') {
      return res.status(400).json({ 
        erreur: `Statut invalide. Utilisez l'un des: ${STATUTS_VALIDES.join(', ')}` 
      });
    }
    next(e); 
  }
});

// ✅ Récupérer les statuts disponibles (utile pour le frontend)
r.get('/statuts/disponibles', async (req, res) => {
  res.json({
    statuts: STATUTS_VALIDES,
    labels: {
      BROUILLON: '📝 Brouillon',
      ENREGISTREE: '📥 Enregistrée',
      EN_COURS: '🔄 En cours',
      VALIDEE: '✅ Validée',
      RAPPORT_EMIS: '📄 Rapport émis',
      FACTUREE: '💰 Facturée',
      CLOTUREE: '🔒 Clôturée',
      ANNULEE: '❌ Annulée'
    },
    couleurs: {
      BROUILLON: 'secondary',
      ENREGISTREE: 'info',
      EN_COURS: 'warning',
      VALIDEE: 'success',
      RAPPORT_EMIS: 'primary',
      FACTUREE: 'primary',
      CLOTUREE: 'success',
      ANNULEE: 'danger'
    }
  });
});

// ✅ Mise à jour en masse des statuts (utile pour les rapports)
r.patch('/statuts/masse', roles('ADMIN','DIRECTION'), async (req, res, next) => {
  try {
    const { ids, statut } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ erreur: 'Liste d\'IDs requise' });
    }
    
    if (!validerStatut(statut)) {
      return res.status(400).json({ 
        erreur: `Statut invalide. Valeurs acceptées: ${STATUTS_VALIDES.join(', ')}` 
      });
    }

    // ✅ Mise à jour en masse avec updated_at
    const { rowCount } = await q(
      `UPDATE demandes SET statut = $1, updated_at = NOW() 
       WHERE id = ANY($2::uuid[]) RETURNING id`,
      [statut, ids]
    );
    
    res.json({
      message: `${rowCount} demande(s) mise(s) à jour avec le statut: ${statut}`,
      count: rowCount
    });
  } catch (e) { 
    next(e); 
  }
});

export default r;
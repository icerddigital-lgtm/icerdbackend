// backend/src/routes/echantillons.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// GET /api/echantillons - Liste avec filtres
r.get('/', async (req, res, next) => {
  try {
    const { etat, matrice } = req.query;
    const { rows } = await q(
      `SELECT e.*, d.numero AS numero_demande, c.raison_sociale
       FROM echantillons e
       JOIN demandes d ON d.id = e.demande_id
       JOIN clients c ON c.id = d.client_id
       WHERE ($1::etat_echantillon IS NULL OR e.etat = $1)
         AND ($2::matrice IS NULL OR e.matrice = $2)
       ORDER BY e.code DESC LIMIT 300`, 
      [etat || null, matrice || null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/echantillons/:id - Récupérer un échantillon spécifique
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(
      `SELECT e.*, d.numero AS numero_demande, c.raison_sociale
       FROM echantillons e
       JOIN demandes d ON d.id = e.demande_id
       JOIN clients c ON c.id = d.client_id
       WHERE e.id = $1`, 
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Échantillon non trouvé' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// POST /api/echantillons - Créer un échantillon
r.post('/', roles('ADMIN','CHEF_LABO','TECHNICIEN'), async (req, res, next) => {
  try {
    const e = req.body;
    
    // ✅ Validation des champs requis (NOT NULL)
    if (!e.demande_id) {
      return res.status(400).json({ erreur: 'La demande est requise' });
    }
    if (!e.matrice) {
      return res.status(400).json({ erreur: 'La matrice est requise' });
    }
    if (!e.designation || e.designation.trim() === '') {
      return res.status(400).json({ erreur: 'La désignation est requise' });
    }

    const { rows } = await q(
      `INSERT INTO echantillons (
        code, demande_id, matrice, designation, lieu_prelevement,
        coordonnees_gps, date_prelevement, preleve_par, quantite, conditionnement, etat
      ) VALUES (
        genere_numero('ECH','seq_echantillon'), $1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'RECU')
      ) RETURNING *`,
      [
        e.demande_id, 
        e.matrice, 
        e.designation.trim(), 
        e.lieu_prelevement || null,
        e.coordonnees_gps || null, 
        e.date_prelevement || null, 
        e.preleve_par || null, 
        e.quantite || '1', 
        e.conditionnement || null,
        e.etat || 'RECU'
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) { 
    console.error('Erreur création échantillon:', e);
    next(e); 
  }
});

// ✅ PATCH /api/echantillons/:id - Modifier un échantillon
r.patch('/:id', roles('ADMIN','CHEF_LABO','TECHNICIEN','QUALITE'), async (req, res, next) => {
  try {
    const e = req.body;
    
    // Vérifier que l'échantillon existe
    const check = await q('SELECT id FROM echantillons WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ erreur: 'Échantillon non trouvé' });
    }

    // ✅ Validation des champs requis (NOT NULL)
    if (!e.demande_id) {
      return res.status(400).json({ erreur: 'La demande est requise' });
    }
    if (!e.matrice) {
      return res.status(400).json({ erreur: 'La matrice est requise' });
    }
    if (!e.designation || e.designation.trim() === '') {
      return res.status(400).json({ erreur: 'La désignation est requise' });
    }

    // ✅ Mise à jour avec TOUS les champs
    const { rows } = await q(
      `UPDATE echantillons SET
         demande_id = $1,
         matrice = $2,
         designation = $3,
         lieu_prelevement = $4,
         coordonnees_gps = $5,
         date_prelevement = $6,
         preleve_par = $7,
         quantite = $8,
         conditionnement = $9,
         etat = $10,
         emplacement_stockage = $11,
         observations = $12
       WHERE id = $13
       RETURNING *`,
      [
        e.demande_id,
        e.matrice,
        e.designation.trim(),
        e.lieu_prelevement || null,
        e.coordonnees_gps || null,
        e.date_prelevement || null,
        e.preleve_par || null,
        e.quantite || '1',
        e.conditionnement || null,
        e.etat || 'RECU',
        e.emplacement_stockage || null,
        e.observations || null,
        req.params.id
      ]
    );
    
    console.log('✅ Échantillon modifié:', rows[0]);
    res.json(rows[0]);
  } catch (e) { 
    console.error('❌ Erreur modification échantillon:', e);
    next(e); 
  }
});

// DELETE /api/echantillons/:id - Supprimer un échantillon
r.delete('/:id', roles('ADMIN','CHEF_LABO'), async (req, res, next) => {
  try {
    // Vérifier si l'échantillon a des analyses
    const check = await q(`SELECT COUNT(*) FROM echantillon_analyses WHERE echantillon_id = $1`, [req.params.id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ 
        erreur: 'Impossible de supprimer cet échantillon car il a des analyses associées' 
      });
    }
    const { rows } = await q(`DELETE FROM echantillons WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Échantillon non trouvé' });
    }
    res.json({ message: 'Échantillon supprimé avec succès' });
  } catch (e) { next(e); }
});

export default r;
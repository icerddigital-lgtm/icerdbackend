// backend/src/routes/clients.js
import { Router } from 'express';
import { q } from '../db.js';
import { authRequis, roles } from '../middleware/auth.js';

const r = Router();
r.use(authRequis);

// GET /api/clients?recherche=
r.get('/', async (req, res, next) => {
  try {
    const { recherche } = req.query;
    const { rows } = await q(
      `SELECT * FROM clients
       WHERE ($1::text IS NULL OR raison_sociale ILIKE '%'||$1||'%' OR code ILIKE '%'||$1||'%')
       ORDER BY cree_le DESC LIMIT 200`, 
      [recherche || null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/clients - Créer un client
r.post('/', roles('ADMIN','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  try {
    const c = req.body;
    const { rows } = await q(
      `INSERT INTO clients (code, type, raison_sociale, contact_nom, email, telephone, adresse, ville, nui, notes)
       VALUES (genere_numero('CLI','seq_client'),$1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c.type || 'PARTICULIER', c.raison_sociale, c.contact_nom, c.email, c.telephone, c.adresse, c.ville, c.nui, c.notes]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// GET /api/clients/:id - Détail d'un client
r.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await q(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erreur: 'Client introuvable' });
    const demandes = await q(
      `SELECT numero, statut, date_reception FROM demandes WHERE client_id = $1 ORDER BY date_reception DESC`, 
      [req.params.id]
    );
    res.json({ ...rows[0], demandes: demandes.rows });
  } catch (e) { next(e); }
});

// ✅ PATCH /api/clients/:id - Modifier un client
r.patch('/:id', roles('ADMIN','DIRECTION','COMMERCIAL'), async (req, res, next) => {
  try {
    const c = req.body;
    const { rows } = await q(
      `UPDATE clients SET
         type = COALESCE($1, type),
         raison_sociale = COALESCE($2, raison_sociale),
         contact_nom = COALESCE($3, contact_nom),
         email = COALESCE($4, email),
         telephone = COALESCE($5, telephone),
         adresse = COALESCE($6, adresse),
         ville = COALESCE($7, ville),
         nui = COALESCE($8, nui),
         notes = COALESCE($9, notes)
       WHERE id = $10
       RETURNING *`,
      [c.type, c.raison_sociale, c.contact_nom, c.email, c.telephone, 
       c.adresse, c.ville, c.nui, c.notes, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Client non trouvé' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ✅ DELETE /api/clients/:id - Supprimer un client
r.delete('/:id', roles('ADMIN','DIRECTION'), async (req, res, next) => {
  try {
    // Vérifier si le client a des demandes
    const check = await q(`SELECT COUNT(*) FROM demandes WHERE client_id = $1`, [req.params.id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ 
        erreur: 'Impossible de supprimer ce client car il a des demandes associées' 
      });
    }
    const { rows } = await q(`DELETE FROM clients WHERE id = $1 RETURNING id`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ erreur: 'Client non trouvé' });
    }
    res.json({ message: 'Client supprimé avec succès' });
  } catch (e) { next(e); }
});

export default r;
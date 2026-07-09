// ============================================================================
// ICERD — SUPPORT BILINGUE CÔTÉ API
//
// PRINCIPE : le client passe ?lang=en. L'API renvoie alors la version anglaise
// si elle existe, SINON le français (COALESCE). Aucun champ ne peut être vide.
//
// UTILISATION dans une route :
//
//   import { langueDe, champBilingue } from '../utils/langue.js';
//
//   r.get('/catalogue', async (req, res, next) => {
//     const L = langueDe(req);                       // 'fr' ou 'en'
//     const { rows } = await q(
//       `SELECT ta.code,
//               ${champBilingue('ta.nom', L)}     AS nom,
//               ${champBilingue('ta.methode', L)} AS methode,
//               ta.prix_fcfa, ta.sur_devis
//        FROM types_analyse ta WHERE ta.actif`);
//     res.json(rows);
//   });
//
// Le nom de la colonne renvoyée reste « nom » : le frontend n'a rien à changer.
// ============================================================================

const LANGUES = ['fr', 'en'];

/** Langue demandée : ?lang=en, sinon en-tête Accept-Language, sinon français */
export function langueDe(req) {
  const q = String(req.query?.lang || '').toLowerCase();
  if (LANGUES.includes(q)) return q;

  const entete = String(req.headers['accept-language'] || '').slice(0, 2).toLowerCase();
  return LANGUES.includes(entete) ? entete : 'fr';
}

/**
 * Construit l'expression SQL bilingue pour une colonne.
 * @param {string} colonne - ex. 'ta.nom' ou 'f.question'
 * @param {string} langue  - 'fr' ou 'en'
 * @returns {string} 'ta.nom' en français,
 *                   "COALESCE(NULLIF(ta.nom_en,''), ta.nom)" en anglais
 *
 * NULLIF traite la chaîne vide comme absente : une traduction saisie puis
 * effacée dans le portail retombe bien sur le français.
 */
export function champBilingue(colonne, langue) {
  if (langue !== 'en') return colonne;

  // ta.nom → ta.nom_en   (gère le préfixe de table)
  const point = colonne.lastIndexOf('.');
  const prefixe = point >= 0 ? colonne.slice(0, point + 1) : '';
  const nom = point >= 0 ? colonne.slice(point + 1) : colonne;

  return `COALESCE(NULLIF(${prefixe}${nom}_en, ''), ${colonne})`;
}

/**
 * Version courte pour plusieurs colonnes d'un coup.
 * champsBilingues(['f.question','f.reponse'], 'en')
 *   → "COALESCE(NULLIF(f.question_en,''), f.question) AS question,
 *      COALESCE(NULLIF(f.reponse_en,''),  f.reponse)  AS reponse"
 */
export function champsBilingues(colonnes, langue) {
  return colonnes.map(c => {
    const alias = c.includes('.') ? c.split('.').pop() : c;
    return `${champBilingue(c, langue)} AS ${alias}`;
  }).join(',\n              ');
}

/**
 * Traduit un objet déjà récupéré (utile quand on fait SELECT *).
 * En anglais : nom prend la valeur de nom_en si elle est renseignée.
 *
 * IMPORTANT : les colonnes _en sont CONSERVÉES dans la réponse.
 * Le portail en a besoin pour afficher et modifier les traductions.
 * Sur le site public, elles sont simplement ignorées par le frontend.
 */
export function appliquerLangue(ligne, langue) {
  if (!ligne || typeof ligne !== 'object') return ligne;
  if (langue !== 'en') return ligne;

  const sortie = { ...ligne };
  for (const cle of Object.keys(ligne)) {
    if (!cle.endsWith('_en')) continue;
    const base = cle.slice(0, -3);
    const traduction = ligne[cle];
    // NULLIF côté JS : la chaîne vide compte comme absente → repli sur le français
    if (traduction !== null && traduction !== undefined && String(traduction).trim() !== '')
      sortie[base] = traduction;
  }
  return sortie;
}

/** Idem pour un tableau de lignes */
export const appliquerLangueListe = (lignes, langue) =>
  Array.isArray(lignes) ? lignes.map(l => appliquerLangue(l, langue)) : lignes;

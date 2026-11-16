import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { cleMedia, estTypeMedia } from "./media.js"

/**
 * Base PostgreSQL.
 * - En ligne : DATABASE_URL (Supabase, chaîne « Session pooler »), via `pg`.
 * - En local sans DATABASE_URL : PGlite, un Postgres embarqué stocké dans DATA_DIR.
 * Le SQL est le même dans les deux cas. Toutes les fonctions sont asynchrones.
 */

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const urlBase = String(process.env.DATABASE_URL ?? "").trim()

let moteur // { query(sql, params) -> { rows, rowCount }, transaction(fn), fermer() }
export let descriptionBase = ""

if (urlBase) {
  const { default: pg } = await import("pg")
  const locale = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(urlBase)
  const pool = new pg.Pool({
    connectionString: urlBase,
    // Supabase impose TLS ; son certificat n'est pas dans le magasin par défaut de Node.
    ssl: locale ? false : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
  })
  // Une connexion inactive coupée par le serveur ne doit pas faire tomber le processus.
  pool.on("error", (erreur) => console.warn("[CineFlow] Connexion Postgres perdue :", erreur.message))

  moteur = {
    query: (sql, params = []) => pool.query(sql, params),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const resultat = await fn({ query: (sql, params = []) => client.query(sql, params) })
        await client.query("COMMIT")
        return resultat
      } catch (erreur) {
        await client.query("ROLLBACK").catch(() => {})
        throw erreur
      } finally {
        client.release()
      }
    },
    fermer: () => pool.end(),
  }
  descriptionBase = `PostgreSQL (${new URL(urlBase).hostname})`
} else {
  const { PGlite } = await import("@electric-sql/pglite")
  const dossier = path.resolve(racine, process.env.DATA_DIR ?? "data", "pglite")
  fs.mkdirSync(dossier, { recursive: true })
  const pg = new PGlite(dossier)
  const adapter = (cible) => async (sql, params = []) => {
    const r = await cible.query(sql, params)
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }
  }
  moteur = {
    query: adapter(pg),
    transaction: (fn) => pg.transaction((tx) => fn({ query: adapter(tx) })),
    fermer: () => pg.close(),
  }
  descriptionBase = `PGlite local (${dossier})`
}

const query = (sql, params) => moteur.query(sql, params)
export const fermerBase = () => moteur.fermer()

/**
 * Migrations versionnées (table schema_version).
 * Ajouter une migration = pousser une chaîne SQL, jamais modifier les précédentes.
 */
const migrations = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar TEXT,
    avatar_decoration TEXT,
    nameplate_asset TEXT,
    nameplate_palette TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, media_type, tmdb_id)
  );

  CREATE TABLE watchlist (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, media_type, tmdb_id)
  );

  CREATE TABLE history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    season INTEGER NOT NULL DEFAULT 0,
    episode INTEGER NOT NULL DEFAULT 0,
    progress DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, media_type, tmdb_id)
  );

  CREATE TABLE recently_viewed (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, media_type, tmdb_id)
  );

  CREATE INDEX idx_favorites_user ON favorites(user_id, created_at DESC);
  CREATE INDEX idx_watchlist_user ON watchlist(user_id, created_at DESC);
  CREATE INDEX idx_history_user ON history(user_id, updated_at DESC);
  CREATE INDEX idx_recently_viewed_user ON recently_viewed(user_id, viewed_at DESC);
  `,
]

async function migrer() {
  await moteur.transaction(async (tx) => {
    // Verrou : deux instances qui démarrent en même temps ne migrent pas deux fois.
    await tx.query("SELECT pg_advisory_xact_lock(727274)")
    await tx.query("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    const { rows } = await tx.query("SELECT version FROM schema_version LIMIT 1")
    let version = rows[0]?.version ?? 0
    if (!rows.length) await tx.query("INSERT INTO schema_version (version) VALUES (0)")

    for (; version < migrations.length; version += 1) {
      // Requêtes multiples sans paramètres : passées une par une (compatibilité pg/PGlite).
      for (const instruction of migrations[version].split(";").map((s) => s.trim()).filter(Boolean)) {
        await tx.query(instruction)
      }
      await tx.query("UPDATE schema_version SET version = $1", [version + 1])
    }
  })
}

/** Promesse résolue quand la base est prête (à attendre avant d'écouter). */
export const pret = migrer()
export const versionSchema = migrations.length

// --- Utilisateurs -----------------------------------------------------------

export async function enregistrerUtilisateur({
  id,
  username,
  avatar,
  avatarDecoration = null,
  nameplateAsset = null,
  nameplatePalette = null,
}) {
  await query(`
    INSERT INTO users (id, username, avatar, avatar_decoration, nameplate_asset, nameplate_palette)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      username = excluded.username,
      avatar = excluded.avatar,
      avatar_decoration = excluded.avatar_decoration,
      nameplate_asset = excluded.nameplate_asset,
      nameplate_palette = excluded.nameplate_palette
  `, [id, username, avatar, avatarDecoration, nameplateAsset, nameplatePalette])

  return utilisateur(id)
}

export async function utilisateur(id) {
  const { rows } = await query(`
    SELECT id, username, avatar, avatar_decoration, nameplate_asset, nameplate_palette, created_at
    FROM users WHERE id = $1
  `, [id])
  return rows[0] ?? null
}

export async function supprimerUtilisateur(id) {
  // Les clés étrangères ON DELETE CASCADE nettoient favoris, liste, historique et vues.
  const { rowCount } = await query("DELETE FROM users WHERE id = $1", [id])
  return rowCount > 0
}

// --- Favoris / liste de lecture --------------------------------------------

function verifierMedia(type, tmdbId) {
  if (!estTypeMedia(type)) throw new Error("Type de média invalide")
  const id = Number(tmdbId)
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw new Error("Identifiant de média invalide")
  return id
}

// Le nom de table vient de cette liste fermée, jamais d'une saisie : les valeurs passent en paramètres.
const TABLES = new Set(["favorites", "watchlist"])
const table = (nom) => {
  if (!TABLES.has(nom)) throw new Error("Table inconnue")
  return nom
}

const ajouter = (t, userId, type, tmdbId) => query(
  `INSERT INTO ${table(t)} (user_id, media_type, tmdb_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
  [userId, type, verifierMedia(type, tmdbId)],
)
const retirer = (t, userId, type, tmdbId) => query(
  `DELETE FROM ${table(t)} WHERE user_id = $1 AND media_type = $2 AND tmdb_id = $3`,
  [userId, type, verifierMedia(type, tmdbId)],
)
const present = async (t, userId, type, tmdbId) => (await query(
  `SELECT 1 FROM ${table(t)} WHERE user_id = $1 AND media_type = $2 AND tmdb_id = $3`,
  [userId, type, verifierMedia(type, tmdbId)],
)).rows.length > 0
const ids = async (t, userId) => new Set(
  (await query(`SELECT media_type, tmdb_id FROM ${table(t)} WHERE user_id = $1`, [userId]))
    .rows.map((ligne) => cleMedia(ligne.media_type, ligne.tmdb_id)),
)
const lister = async (t, userId) => (await query(`
  SELECT media_type, tmdb_id, created_at FROM ${table(t)}
  WHERE user_id = $1
  ORDER BY created_at DESC, tmdb_id DESC
`, [userId])).rows

export const ajouterFavori = (userId, type, tmdbId) => ajouter("favorites", userId, type, tmdbId)
export const retirerFavori = (userId, type, tmdbId) => retirer("favorites", userId, type, tmdbId)
export const estFavori = (userId, type, tmdbId) => present("favorites", userId, type, tmdbId)
export const idsFavoris = (userId) => ids("favorites", userId)
export const listerFavoris = (userId) => lister("favorites", userId)

export const ajouterListe = (userId, type, tmdbId) => ajouter("watchlist", userId, type, tmdbId)
export const retirerListe = (userId, type, tmdbId) => retirer("watchlist", userId, type, tmdbId)
export const estDansListe = (userId, type, tmdbId) => present("watchlist", userId, type, tmdbId)
export const idsListe = (userId) => ids("watchlist", userId)
export const listerListe = (userId) => lister("watchlist", userId)

// --- Historique -------------------------------------------------------------

/**
 * Enregistre la progression réelle du lecteur. Pour une série, `season` et
 * `episode` identifient l'épisode en cours : un seul enregistrement est gardé
 * par titre, avec le dernier épisode regardé.
 */
export async function enregistrerProgression(userId, type, tmdbId, { progress, duration, season = 0, episode = 0 }) {
  const id = verifierMedia(type, tmdbId)
  await query(`
    INSERT INTO history (user_id, media_type, tmdb_id, season, episode, progress, duration, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
    ON CONFLICT (user_id, media_type, tmdb_id) DO UPDATE SET
      season = excluded.season,
      episode = excluded.episode,
      progress = excluded.progress,
      duration = excluded.duration,
      updated_at = clock_timestamp()
  `, [userId, type, id, season, episode, progress, duration])
}

export async function progression(userId, type, tmdbId) {
  const { rows } = await query(`
    SELECT season, episode, progress, duration, updated_at FROM history
    WHERE user_id = $1 AND media_type = $2 AND tmdb_id = $3
  `, [userId, type, verifierMedia(type, tmdbId)])
  return rows[0] ?? null
}

/**
 * Les titres commencés mais pas terminés (moins de 95 %), du plus récent au plus ancien.
 * Un historique sans durée connue reste affiché : on ne peut pas calculer de pourcentage.
 */
export async function historiqueContinu(userId, limite = 12) {
  const { rows } = await query(`
    SELECT media_type, tmdb_id, season, episode, progress, duration, updated_at FROM history
    WHERE user_id = $1
      AND (duration <= 0 OR progress < duration * 0.95)
      AND progress > 0
    ORDER BY updated_at DESC
    LIMIT $2
  `, [userId, limite])
  return rows
}

// --- Titres récemment vus ---------------------------------------------------

const VUES_CONSERVEES = 30

/**
 * Enregistre la consultation d'un titre. La liste est dédupliquée par titre et
 * limitée aux 30 dernières entrées : le reste est supprimé à chaque ajout.
 */
export async function enregistrerVue(userId, type, tmdbId) {
  const id = verifierMedia(type, tmdbId)

  await moteur.transaction(async (tx) => {
    await tx.query(`
      INSERT INTO recently_viewed (user_id, media_type, tmdb_id, viewed_at)
      VALUES ($1, $2, $3, clock_timestamp())
      ON CONFLICT (user_id, media_type, tmdb_id) DO UPDATE SET viewed_at = clock_timestamp()
    `, [userId, type, id])

    await tx.query(`
      DELETE FROM recently_viewed
      WHERE user_id = $1
        AND (media_type, tmdb_id) NOT IN (
          SELECT media_type, tmdb_id FROM recently_viewed
          WHERE user_id = $1
          ORDER BY viewed_at DESC, tmdb_id DESC
          LIMIT $2
        )
    `, [userId, VUES_CONSERVEES])
  })
}

export async function listerVues(userId, limite = 12) {
  const nombre = Math.max(1, Math.min(VUES_CONSERVEES, Number(limite) || 12))
  const { rows } = await query(`
    SELECT media_type, tmdb_id, viewed_at FROM recently_viewed
    WHERE user_id = $1
    ORDER BY viewed_at DESC, tmdb_id DESC
    LIMIT $2
  `, [userId, nombre])
  return rows
}

export async function compteurs(userId) {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM favorites WHERE user_id = $1)::int AS favoris,
      (SELECT COUNT(*) FROM watchlist WHERE user_id = $1)::int AS liste,
      -- Un titre est considéré vu à partir de 95 % de sa durée réelle.
      (SELECT COUNT(*) FROM history
        WHERE user_id = $1 AND duration > 0 AND progress >= duration * 0.95)::int AS vus
  `, [userId])
  return rows[0]
}

/** Requête brute pour les tests et la maintenance (toujours paramétrée). */
export const requeteBrute = query

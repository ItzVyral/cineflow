import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { cleMedia, estTypeMedia } from "./media.js"

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dossier = path.resolve(racine, process.env.DATA_DIR ?? "data")
const fichier = path.join(dossier, "cineflow.db")

export const cheminBase = fichier

fs.mkdirSync(dossier, { recursive: true })

// La base contient des données personnelles : dossier privé quand le système le permet.
try {
  fs.chmodSync(dossier, 0o700)
} catch {
  // Systèmes de fichiers sans permissions POSIX (Windows, volume monté…).
}

export const db = new Database(fichier)

try {
  fs.chmodSync(fichier, 0o600)
} catch {
  // Idem : la restriction n'est pas critique si le dossier est déjà privé.
}

db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

/**
 * Migrations versionnées avec PRAGMA user_version.
 * Ajouter une migration = pousser une fonction dans le tableau, jamais modifier les précédentes.
 */
const migrations = [
  () => {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tmdb_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, tmdb_id)
      );

      CREATE TABLE watchlist (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tmdb_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, tmdb_id)
      );

      CREATE TABLE history (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tmdb_id INTEGER NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, tmdb_id)
      );

      CREATE INDEX idx_favorites_user ON favorites(user_id, created_at DESC);
      CREATE INDEX idx_watchlist_user ON watchlist(user_id, created_at DESC);
      CREATE INDEX idx_history_user ON history(user_id, updated_at DESC);
    `)
  },
  () => {
    // Migration 2 : un même identifiant TMDB peut désigner un film et une série.
    // Les tables sont reconstruites pour intégrer `media_type` dans la clé.
    db.exec(`
      CREATE TABLE favorites_v2 (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
        tmdb_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, media_type, tmdb_id)
      );
      INSERT INTO favorites_v2 (user_id, media_type, tmdb_id, created_at)
        SELECT user_id, 'movie', tmdb_id, created_at FROM favorites;

      CREATE TABLE watchlist_v2 (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
        tmdb_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, media_type, tmdb_id)
      );
      INSERT INTO watchlist_v2 (user_id, media_type, tmdb_id, created_at)
        SELECT user_id, 'movie', tmdb_id, created_at FROM watchlist;

      CREATE TABLE history_v2 (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
        tmdb_id INTEGER NOT NULL,
        season INTEGER NOT NULL DEFAULT 0,
        episode INTEGER NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, media_type, tmdb_id)
      );
      INSERT INTO history_v2 (user_id, media_type, tmdb_id, progress, duration, updated_at)
        SELECT user_id, 'movie', tmdb_id, progress, duration, updated_at FROM history;

      DROP TABLE favorites;
      DROP TABLE watchlist;
      DROP TABLE history;

      ALTER TABLE favorites_v2 RENAME TO favorites;
      ALTER TABLE watchlist_v2 RENAME TO watchlist;
      ALTER TABLE history_v2 RENAME TO history;

      CREATE INDEX idx_favorites_user ON favorites(user_id, created_at DESC);
      CREATE INDEX idx_watchlist_user ON watchlist(user_id, created_at DESC);
      CREATE INDEX idx_history_user ON history(user_id, updated_at DESC);
    `)
  },
  () => {
    // Migration 3 : décoration d'avatar Discord (asset CDN renvoyé par `identify`).
    db.exec("ALTER TABLE users ADD COLUMN avatar_decoration TEXT")
  },
  () => {
    // Migration 4 : nameplate Discord (bannière du profil) : asset du preset et
    // palette de repli, tous deux renvoyés par `identify`.
    db.exec(`
      ALTER TABLE users ADD COLUMN nameplate_asset TEXT;
      ALTER TABLE users ADD COLUMN nameplate_palette TEXT;
    `)
  },
  () => {
    // Migration 5 : titres récemment consultés par un utilisateur connecté.
    // Les visiteurs non connectés gardent cette liste dans localStorage.
    db.exec(`
      CREATE TABLE recently_viewed (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
        tmdb_id INTEGER NOT NULL,
        viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
        PRIMARY KEY (user_id, media_type, tmdb_id)
      );

      CREATE INDEX idx_recently_viewed_user ON recently_viewed(user_id, viewed_at DESC);
    `)
  },
]

const version = db.pragma("user_version", { simple: true })

for (let i = version; i < migrations.length; i += 1) {
  db.transaction(() => {
    migrations[i]()
    db.pragma(`user_version = ${i + 1}`)
  })()
}

// --- Utilisateurs -----------------------------------------------------------

export function enregistrerUtilisateur({
  id,
  username,
  avatar,
  avatarDecoration = null,
  nameplateAsset = null,
  nameplatePalette = null,
}) {
  db.prepare(`
    INSERT INTO users (id, username, avatar, avatar_decoration, nameplate_asset, nameplate_palette)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      avatar = excluded.avatar,
      avatar_decoration = excluded.avatar_decoration,
      nameplate_asset = excluded.nameplate_asset,
      nameplate_palette = excluded.nameplate_palette
  `).run(id, username, avatar, avatarDecoration, nameplateAsset, nameplatePalette)

  return utilisateur(id)
}

export function utilisateur(id) {
  return db.prepare(`
    SELECT id, username, avatar, avatar_decoration, nameplate_asset, nameplate_palette, created_at
    FROM users WHERE id = ?
  `).get(id) ?? null
}

export function supprimerUtilisateur(id) {
  // Les clés étrangères ON DELETE CASCADE nettoient favoris, liste et historique.
  return db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0
}

// --- Favoris / liste de lecture --------------------------------------------

function verifierMedia(type, tmdbId) {
  if (!estTypeMedia(type)) throw new Error("Type de média invalide")
  const id = Number(tmdbId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Identifiant de média invalide")
  return id
}

// Requêtes préparées une fois : aucune valeur n'est concaténée dans le SQL.
const requetes = {
  favorites: {
    ajouter: db.prepare("INSERT OR IGNORE INTO favorites (user_id, media_type, tmdb_id) VALUES (?, ?, ?)"),
    retirer: db.prepare("DELETE FROM favorites WHERE user_id = ? AND media_type = ? AND tmdb_id = ?"),
    present: db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND media_type = ? AND tmdb_id = ?"),
    ids: db.prepare("SELECT media_type, tmdb_id FROM favorites WHERE user_id = ?"),
    lister: db.prepare(`
      SELECT media_type, tmdb_id, created_at FROM favorites
      WHERE user_id = ?
      ORDER BY created_at DESC, tmdb_id DESC
    `),
  },
  watchlist: {
    ajouter: db.prepare("INSERT OR IGNORE INTO watchlist (user_id, media_type, tmdb_id) VALUES (?, ?, ?)"),
    retirer: db.prepare("DELETE FROM watchlist WHERE user_id = ? AND media_type = ? AND tmdb_id = ?"),
    present: db.prepare("SELECT 1 FROM watchlist WHERE user_id = ? AND media_type = ? AND tmdb_id = ?"),
    ids: db.prepare("SELECT media_type, tmdb_id FROM watchlist WHERE user_id = ?"),
    lister: db.prepare(`
      SELECT media_type, tmdb_id, created_at FROM watchlist
      WHERE user_id = ?
      ORDER BY created_at DESC, tmdb_id DESC
    `),
  },
}

const ids = (table, userId) => new Set(
  requetes[table].ids.all(userId).map((ligne) => cleMedia(ligne.media_type, ligne.tmdb_id)),
)

export const ajouterFavori = (userId, type, tmdbId) => requetes.favorites.ajouter.run(userId, type, verifierMedia(type, tmdbId))
export const retirerFavori = (userId, type, tmdbId) => requetes.favorites.retirer.run(userId, type, verifierMedia(type, tmdbId))
export const estFavori = (userId, type, tmdbId) => !!requetes.favorites.present.get(userId, type, verifierMedia(type, tmdbId))
export const idsFavoris = (userId) => ids("favorites", userId)
export const listerFavoris = (userId) => requetes.favorites.lister.all(userId)

export const ajouterListe = (userId, type, tmdbId) => requetes.watchlist.ajouter.run(userId, type, verifierMedia(type, tmdbId))
export const retirerListe = (userId, type, tmdbId) => requetes.watchlist.retirer.run(userId, type, verifierMedia(type, tmdbId))
export const estDansListe = (userId, type, tmdbId) => !!requetes.watchlist.present.get(userId, type, verifierMedia(type, tmdbId))
export const idsListe = (userId) => ids("watchlist", userId)
export const listerListe = (userId) => requetes.watchlist.lister.all(userId)

// --- Historique -------------------------------------------------------------

/**
 * Enregistre la progression réelle du lecteur. Pour une série, `season` et
 * `episode` identifient l'épisode en cours : un seul enregistrement est gardé
 * par titre, avec le dernier épisode regardé.
 */
export function enregistrerProgression(userId, type, tmdbId, { progress, duration, season = 0, episode = 0 }) {
  const id = verifierMedia(type, tmdbId)
  db.prepare(`
    INSERT INTO history (user_id, media_type, tmdb_id, season, episode, progress, duration, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, media_type, tmdb_id) DO UPDATE SET
      season = excluded.season,
      episode = excluded.episode,
      progress = excluded.progress,
      duration = excluded.duration,
      updated_at = datetime('now')
  `).run(userId, type, id, season, episode, progress, duration)
}

export function progression(userId, type, tmdbId) {
  return db.prepare(`
    SELECT season, episode, progress, duration, updated_at FROM history
    WHERE user_id = ? AND media_type = ? AND tmdb_id = ?
  `).get(userId, type, verifierMedia(type, tmdbId)) ?? null
}

/**
 * Les titres commencés mais pas terminés (moins de 95 %), du plus récent au plus ancien.
 * Un historique sans durée connue reste affiché : on ne peut pas calculer de pourcentage.
 */
export function historiqueContinu(userId, limite = 12) {
  return db.prepare(`
    SELECT media_type, tmdb_id, season, episode, progress, duration, updated_at FROM history
    WHERE user_id = ?
      AND (duration <= 0 OR progress < duration * 0.95)
      AND progress > 0
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(userId, limite)
}

// --- Titres récemment vus ---------------------------------------------------

const VUES_CONSERVEES = 30

/**
 * Enregistre la consultation d'un titre. La liste est dédupliquée par titre et
 * limitée aux 30 dernières entrées : le reste est supprimé à chaque ajout.
 */
export function enregistrerVue(userId, type, tmdbId) {
  const id = verifierMedia(type, tmdbId)

  db.transaction(() => {
    db.prepare(`
      INSERT INTO recently_viewed (user_id, media_type, tmdb_id, viewed_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT(user_id, media_type, tmdb_id)
        DO UPDATE SET viewed_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
    `).run(userId, type, id)

    db.prepare(`
      DELETE FROM recently_viewed
      WHERE user_id = ?
        AND rowid NOT IN (
          SELECT rowid FROM recently_viewed
          WHERE user_id = ?
          ORDER BY viewed_at DESC, rowid DESC
          LIMIT ?
        )
    `).run(userId, userId, VUES_CONSERVEES)
  })()
}

export function listerVues(userId, limite = 12) {
  const nombre = Math.max(1, Math.min(VUES_CONSERVEES, Number(limite) || 12))
  return db.prepare(`
    SELECT media_type, tmdb_id, viewed_at FROM recently_viewed
    WHERE user_id = ?
    ORDER BY viewed_at DESC, rowid DESC
    LIMIT ?
  `).all(userId, nombre)
}

export function compteurs(userId) {
  return {
    favoris: db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?").get(userId).n,
    liste: db.prepare("SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?").get(userId).n,
    // Un titre est considéré vu à partir de 95 % de sa durée réelle.
    vus: db.prepare(`
      SELECT COUNT(*) AS n FROM history
      WHERE user_id = ? AND duration > 0 AND progress >= duration * 0.95
    `).get(userId).n,
  }
}

// Suite d'intégration CineFlow — s'exécute contre un serveur déjà lancé.
//   SESSION_SECRET=test-secret PORT=3999 node server.js &
//   SESSION_SECRET=test-secret BASE_URL=http://localhost:3999 npm run test:integration
//
// Le script crée un utilisateur de test, exerce les pages et l'API typée, puis
// supprime ses données. La base ciblée est celle de DATA_DIR (défaut `data`).
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const BASE = process.env.BASE_URL ?? "http://localhost:3999"
const UTILISATEUR = "123456789012345678"

process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret"
process.env.DATA_DIR = process.env.DATA_DIR ?? "data"

let reussis = 0
let echoues = 0
const details = []

function verifier(nom, condition, detail = "") {
  if (condition) {
    reussis += 1
    details.push(`  ok   ${nom}`)
  } else {
    echoues += 1
    details.push(`  FAIL ${nom}${detail ? ` — ${detail}` : ""}`)
  }
}

const { creerJetonSession } = await import(pathToFileURL(path.join(RACINE, "src/session.js")).href)
const db = await import(pathToFileURL(path.join(RACINE, "src/db.js")).href)

const DECORATION = "a_0123456789abcdef"
const NAMEPLATE = "nameplates/nameplates/twilight/"
const NAMEPLATE_PALETTE = "cobalt"
db.enregistrerUtilisateur({
  id: UTILISATEUR,
  username: "Testeur",
  avatar: null,
  avatarDecoration: DECORATION,
  nameplateAsset: NAMEPLATE,
  nameplatePalette: NAMEPLATE_PALETTE,
})
const cookie = `cineflow_session=${creerJetonSession(UTILISATEUR)}`

/** Requête HTTP brute : statut, texte, en-têtes. */
async function requete(chemin, { methode = "GET", corps = null, avecCookie = false, entetes = {} } = {}) {
  const options = { method: methode, redirect: "manual", headers: { ...entetes } }
  if (avecCookie) options.headers.Cookie = cookie
  if (corps != null) {
    options.headers["Content-Type"] = "application/json"
    options.body = JSON.stringify(corps)
  }
  const reponse = await fetch(BASE + chemin, options)
  return { statut: reponse.status, texte: await reponse.text(), entetes: reponse.headers }
}

async function page(chemin, options = {}) {
  return requete(chemin, options)
}

// --- Pages publiques --------------------------------------------------------

const accueil = await page("/")
verifier("GET / → 200", accueil.statut === 200, String(accueil.statut))
verifier("accueil : cartes avec badge", accueil.texte.includes("badge-media"))
verifier("accueil : rangée nouveautés", accueil.texte.includes("Nouveautés"))
verifier("accueil : recherche multi-type", accueil.texte.includes("Film, série, animé"))
verifier("accueil invité : emplacement récemment vus", accueil.texte.includes("data-recents-locaux"))

const film = await page("/titre/movie/550")
verifier("GET /titre/movie/550 → 200", film.statut === 200)
verifier("film : lecteur /embed/movie/550", film.texte.includes("heiwastream.fr/embed/movie/550"))
verifier("film : chip Film", film.texte.includes(">Film<"))
verifier("film : boutons typés movie", film.texte.includes('data-media="movie" data-id="550"'))
verifier("film : données pour les récents locaux", film.texte.includes('data-vue-type="movie" data-vue-id="550"'))
verifier("film : affiche des récents locaux", film.texte.includes('data-vue-affiche="https://image.tmdb.org/t/p/w342'))

const serie = await page("/titre/tv/46260")
verifier("GET /titre/tv/46260 → 200", serie.statut === 200)
verifier("série : sélecteur saison", serie.texte.includes('name="season"') && serie.texte.includes('name="episode"'))
verifier("série : lecteur /embed/tv/46260", /heiwastream\.fr\/embed\/tv\/46260\/\d{2}\/\d{2}/.test(serie.texte))
verifier("série : chip Anime", serie.texte.includes(">Anime<"))

const serieS2 = await page("/titre/tv/46260?season=2&episode=3")
verifier("série S2 E3 retombe sur E53", serieS2.texte.includes("S2 E53"))

const anime = await page("/catalogue?type=anime")
verifier("GET /catalogue?type=anime → 200", anime.statut === 200)
verifier("catalogue animé : badges Anime", anime.texte.includes('badge-media">Anime'))
verifier("catalogue animé : pagination typée", anime.texte.includes("type=anime&amp;page=2"))

const seriePage2 = await page("/catalogue?type=tv&page=2")
verifier("GET /catalogue?type=tv&page=2 → 200", seriePage2.statut === 200)
verifier("catalogue série : pagination typée", seriePage2.texte.includes("type=tv&amp;page=3"))

const rechercheAnime = await page("/recherche?q=naruto&type=anime")
verifier("recherche animé → 200", rechercheAnime.statut === 200)
verifier("recherche animé : uniquement Anime", rechercheAnime.texte.includes('badge-media">Anime') && !rechercheAnime.texte.includes('badge-media">Film'))

const rechercheFilm = await page("/recherche?q=matrix")
verifier("recherche mixte → 200", rechercheFilm.statut === 200)
verifier("recherche mixte : cartes Film", rechercheFilm.texte.includes('badge-media">Film'))
verifier("recherche mixte : liens /titre/movie/603", rechercheFilm.texte.includes('href="/titre/movie/603"'))

const rechercheCourte = await page("/recherche?q=a")
verifier("recherche trop courte : message", rechercheCourte.texte.includes("au moins 2 caractères"))

const animeVide = await page("/recherche?q=arcane&type=anime")
verifier("recherche animé sans résultat : « Aucun animé »", animeVide.texte.includes("Aucun animé"))

const redirectionFilm = await page("/film/550")
verifier("/film/550 → 301", redirectionFilm.statut === 301, String(redirectionFilm.statut))
verifier("/film/550 → /titre/movie/550", redirectionFilm.entetes.get("location") === "/titre/movie/550")

const redirectionSerie = await page("/serie/1399?season=2")
verifier("/serie/1399 → 301", redirectionSerie.statut === 301)
verifier("/serie/1399 conserve la query", redirectionSerie.entetes.get("location") === "/titre/tv/1399?season=2")

const introuvable = await page("/titre/tv/999999999")
verifier("/titre/tv/999999999 → 404", introuvable.statut === 404)
verifier("/titre/movie/abc → 404", (await page("/titre/movie/abc")).statut === 404)

// --- API : authentification et CSRF ----------------------------------------

verifier("API sans cookie → 401", (await requete("/api/favoris/movie/550", { methode: "POST" })).statut === 401)
verifier("API type invalide sans cookie → 401", (await requete("/api/favoris/anime/550", { methode: "POST" })).statut === 401)

const csrf = await requete("/api/favoris/movie/550", {
  methode: "POST",
  avecCookie: true,
  entetes: { Origin: "https://evil.example" },
})
verifier("API origine externe → 403", csrf.statut === 403, String(csrf.statut))

// --- API : favoris et liste typés -----------------------------------------

const favoriFilm = await requete("/api/favoris/movie/550", { methode: "POST", avecCookie: true })
verifier("POST favori film → 200", favoriFilm.statut === 200)
verifier("POST favori film : type renvoyé", JSON.parse(favoriFilm.texte).type === "movie")

const favoriSerie = await requete("/api/favoris/tv/46260", { methode: "POST", avecCookie: true })
verifier("POST favori série → 200", favoriSerie.statut === 200)
verifier("POST favori série : type renvoyé", JSON.parse(favoriSerie.texte).type === "tv")

verifier("POST favori type invalide → 404", (await requete("/api/favoris/anime/550", { methode: "POST", avecCookie: true })).statut === 404)
verifier("POST favori id invalide → 404", (await requete("/api/favoris/movie/abc", { methode: "POST", avecCookie: true })).statut === 404)

const listeFilm = await requete("/api/liste/movie/550", { methode: "POST", avecCookie: true })
verifier("POST liste film → 200", listeFilm.statut === 200)

const favoris = await page("/favoris", { avecCookie: true })
verifier("/favoris contient le film", favoris.texte.includes('href="/titre/movie/550"'))
verifier("/favoris contient la série", favoris.texte.includes('href="/titre/tv/46260"'))

const liste = await page("/liste", { avecCookie: true })
verifier("/liste contient le film", liste.texte.includes('href="/titre/movie/550"'))

// --- API : historique et reprise ------------------------------------------

const historique = await requete("/api/historique/tv/46260", {
  methode: "PUT",
  avecCookie: true,
  corps: { position: 100, duration: 1000, season: 2, episode: 53 },
})
verifier("PUT historique série → 204", historique.statut === 204, String(historique.statut))

const saisonInvalide = await requete("/api/historique/tv/46260", {
  methode: "PUT",
  avecCookie: true,
  corps: { position: 100, duration: 1000, season: -1, episode: 53 },
})
verifier("PUT historique saison invalide → 400", saisonInvalide.statut === 400)

const progression = db.progression(UTILISATEUR, "tv", 46260)
verifier("DB : saison et épisode enregistrés", progression?.season === 2 && progression?.episode === 53)

const reprise = await page("/titre/tv/46260?season=2&episode=53", { avecCookie: true })
verifier("page série : data-reprise=100", reprise.texte.includes('data-reprise="100"'))
verifier("page série : texte de reprise", reprise.texte.includes("Reprise à 1 min 40 s"))

const accueilConnecte = await page("/", { avecCookie: true })
verifier("accueil connecté : Continuer de regarder", accueilConnecte.texte.includes("Continuer de regarder"))
verifier("accueil connecté : sous-titre S2 · E53", accueilConnecte.texte.includes("S2 · E53"))

// --- API : avis -------------------------------------------------------------

const avisType = await requete("/api/avis/anime/550", { methode: "POST", avecCookie: true, corps: { note: 5 } })
verifier("POST avis type invalide → 404", avisType.statut === 404)

const avisNote = await requete("/api/avis/tv/46260", { methode: "POST", avecCookie: true, corps: { note: 9 } })
verifier("POST avis note hors bornes → 400", avisNote.statut === 400)

// Aucun avis réel n'est envoyé à HeiwaStream : le POST valide serait un effet
// de bord sur leur service de production.

// --- Profil -----------------------------------------------------------------

const profil = await page("/profil", { avecCookie: true })
verifier("/profil → 200 connecté", profil.statut === 200)
verifier("/profil affiche le pseudo", profil.texte.includes("Testeur"))
verifier("/profil : zone de suppression", profil.texte.includes("SUPPRIMER"))

// --- Décoration d'avatar Discord -------------------------------------------

const decoUrl = `avatar-decoration-presets/${DECORATION}.png`
verifier("accueil : décoration dans l'en-tête", accueilConnecte.texte.includes(decoUrl))
verifier("accueil : avatar enveloppé (pp)", accueilConnecte.texte.includes('class="pp"'))
verifier("profil : décoration sur l'avatar", profil.texte.includes(decoUrl))
verifier("profil : image décorative aria-hidden", profil.texte.includes('class="deco-avatar"') && profil.texte.includes('aria-hidden="true"'))

// --- Nameplate Discord (profil) --------------------------------------------

const nameplateUrl = `assets/collectibles/${NAMEPLATE}static.png`
verifier("profil : nameplate présente", profil.texte.includes(nameplateUrl))
verifier("profil : nameplate derrière le pseudo", /class="profil-nameplate"[^>]*>[\s\S]*class="nameplate-image"[\s\S]*<h1>Testeur<\/h1>/.test(profil.texte))
verifier("profil : couleur de palette", profil.texte.includes("--np-couleur:#4a5cdb"))
verifier("profil : nameplate décorative aria-hidden", /class="nameplate-image"[^>]*aria-hidden="true"/.test(profil.texte))

const { estAssetNameplate, estPaletteNameplate, urlNameplate } = await import(pathToFileURL(path.join(RACINE, "src/nameplate.js")).href)
verifier("nameplate : URL CDN construite", urlNameplate(NAMEPLATE) === `https://cdn.discordapp.com/${nameplateUrl}`)
verifier("nameplate : traversée de chemin refusée", !estAssetNameplate("../evil/") && urlNameplate("../evil/") === "")
verifier("nameplate : asset avec requête refusé", !estAssetNameplate("nameplates/twilight/static.png?x=1"))
verifier("nameplate : palette officielle acceptée", estPaletteNameplate("cobalt"))
verifier("nameplate : palette inconnue refusée", !estPaletteNameplate("inconnue"))

// --- Titres récemment vus ---------------------------------------------------

// Visiter une fiche connecté l'enregistre côté SQLite, sans doublon.
await page("/titre/movie/550", { avecCookie: true })
await page("/titre/movie/603", { avecCookie: true })
await page("/titre/movie/550", { avecCookie: true })

const vues = db.listerVues(UTILISATEUR)
verifier("DB : titres récemment vus enregistrés", vues.length >= 2)
verifier("DB : dernière vue en tête", vues[0]?.media_type === "movie" && vues[0]?.tmdb_id === 550)
verifier("DB : vues dédupliquées", vues.filter((vue) => vue.media_type === "movie" && vue.tmdb_id === 550).length === 1)

const accueilVues = await page("/", { avecCookie: true })
verifier("accueil connecté : rangée Récemment vus", accueilVues.texte.includes("Récemment vus"))
verifier("accueil connecté : carte récemment vue", accueilVues.texte.includes('data-media="movie" data-id="603"'))
verifier("accueil connecté : pas d'emplacement local", !accueilVues.texte.includes("data-recents-locaux"))

// --- Nettoyage et intégrité de la base --------------------------------------

await requete("/api/favoris/movie/550", { methode: "DELETE", avecCookie: true })
await requete("/api/favoris/tv/46260", { methode: "DELETE", avecCookie: true })
await requete("/api/liste/movie/550", { methode: "DELETE", avecCookie: true })
db.supprimerUtilisateur(UTILISATEUR)

verifier("DB : version 5", db.db.pragma("user_version", { simple: true }) === 5)
verifier("DB : favorites.media_type", db.db.prepare("PRAGMA table_info(favorites)").all().some((c) => c.name === "media_type"))
verifier("DB : history.season/episode", ["season", "episode"].every((n) => db.db.prepare("PRAGMA table_info(history)").all().some((c) => c.name === n)))
verifier("DB : users.avatar_decoration", db.db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "avatar_decoration"))
verifier("DB : users.nameplate_asset/palette", ["nameplate_asset", "nameplate_palette"].every((n) => db.db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === n)))
verifier("DB : recently_viewed typé", ["media_type", "tmdb_id", "viewed_at"].every((n) => db.db.prepare("PRAGMA table_info(recently_viewed)").all().some((c) => c.name === n)))
verifier("DB : vues supprimées avec le compte", db.listerVues(UTILISATEUR).length === 0)
verifier("DB : clés étrangères valides", db.db.prepare("PRAGMA foreign_key_check").all().length === 0)
verifier("DB : intégrité OK", db.db.pragma("integrity_check", { simple: true }) === "ok")
verifier("DB : utilisateur de test supprimé", db.utilisateur(UTILISATEUR) == null)

// --- Migrations isolées (v1 → v5, base neuve) ------------------------------

const racine = RACINE
const dossierV1 = "/tmp/cineflow-test-v1"
const dossierNeuf = "/tmp/cineflow-test-neuf"
fs.rmSync(dossierV1, { recursive: true, force: true })
fs.rmSync(dossierNeuf, { recursive: true, force: true })
fs.mkdirSync(dossierV1, { recursive: true })
fs.mkdirSync(dossierNeuf, { recursive: true })

const scriptV1 = `
import Database from "better-sqlite3"
const db = new Database(${JSON.stringify(`${dossierV1}/cineflow.db`)})
db.pragma("journal_mode = WAL")
db.exec(\`
  CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tmdb_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, tmdb_id));
  CREATE TABLE watchlist (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tmdb_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, tmdb_id));
  CREATE TABLE history (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tmdb_id INTEGER NOT NULL, progress REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, tmdb_id));
  PRAGMA user_version = 1;
  INSERT INTO users (id, username) VALUES ('u1', 'Ancien');
  INSERT INTO favorites (user_id, tmdb_id) VALUES ('u1', 550);
  INSERT INTO watchlist (user_id, tmdb_id) VALUES ('u1', 603);
  INSERT INTO history (user_id, tmdb_id, progress, duration) VALUES ('u1', 550, 42, 8400);
\`)
db.close()
`

const migration = spawnSync(process.execPath, ["--input-type=module", "-e", scriptV1], { cwd: racine, encoding: "utf8" })
verifier("migration : schéma v1 créé", migration.status === 0, migration.stderr)

const scriptVerifV1 = `
process.env.DATA_DIR = ${JSON.stringify(dossierV1)}
const m = await import(${JSON.stringify(`${racine}/src/db.js?test-v1`)})
const out = {
  version: m.db.pragma("user_version", { simple: true }),
  favoris: m.listerFavoris("u1").map((l) => [l.media_type, l.tmdb_id]),
  liste: m.listerListe("u1").map((l) => [l.media_type, l.tmdb_id]),
  progression: m.progression("u1", "movie", 550),
  deco: m.utilisateur("u1")?.avatar_decoration,
  nameplate: m.utilisateur("u1")?.nameplate_asset,
  palette: m.utilisateur("u1")?.nameplate_palette,
  vues: m.listerVues("u1").length,
  fk: m.db.prepare("PRAGMA foreign_key_check").all().length,
  integrite: m.db.pragma("integrity_check", { simple: true }),
}
console.log(JSON.stringify(out))
`
const verifV1 = spawnSync(process.execPath, ["--input-type=module", "-e", scriptVerifV1], { cwd: racine, encoding: "utf8" })
let v1 = null
try { v1 = JSON.parse(verifV1.stdout.trim()) } catch { /* signalé plus bas */ }
verifier("migration v1 : script exécuté", verifV1.status === 0 && v1 != null, verifV1.stderr)
verifier("migration v1 → version 5", v1?.version === 5)
verifier("migration v1 : favori conservé en movie", JSON.stringify(v1?.favoris) === JSON.stringify([["movie", 550]]))
verifier("migration v1 : liste conservée en movie", JSON.stringify(v1?.liste) === JSON.stringify([["movie", 603]]))
verifier("migration v1 : historique conservé", v1?.progression?.progress === 42 && v1?.progression?.season === 0 && v1?.progression?.episode === 0)
verifier("migration v1 : décoration nulle", v1?.deco === null)
verifier("migration v1 : nameplate nulle", v1?.nameplate === null && v1?.palette === null)
verifier("migration v1 : aucune vue récente", v1?.vues === 0)
verifier("migration v1 : intégrité OK", v1?.fk === 0 && v1?.integrite === "ok")

const scriptNeuf = `
process.env.DATA_DIR = ${JSON.stringify(dossierNeuf)}
const m = await import(${JSON.stringify(`${racine}/src/db.js?test-neuf`)})
console.log(JSON.stringify({
  version: m.db.pragma("user_version", { simple: true }),
  tables: m.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((t) => t.name),
  deco: m.db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "avatar_decoration"),
  nameplate: ["nameplate_asset", "nameplate_palette"].every((n) => m.db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === n)),
  vues: m.db.prepare("PRAGMA table_info(recently_viewed)").all().some((c) => c.name === "viewed_at"),
  integrite: m.db.pragma("integrity_check", { simple: true }),
}))
`
const neuf = spawnSync(process.execPath, ["--input-type=module", "-e", scriptNeuf], { cwd: racine, encoding: "utf8" })
let frais = null
try { frais = JSON.parse(neuf.stdout.trim()) } catch { /* signalé plus bas */ }
verifier("base neuve : script exécuté", neuf.status === 0 && frais != null, neuf.stderr)
verifier("base neuve : version 5", frais?.version === 5)
verifier("base neuve : 5 tables", JSON.stringify(frais?.tables) === JSON.stringify(["favorites", "history", "recently_viewed", "users", "watchlist"]))
verifier("base neuve : colonne avatar_decoration", frais?.deco === true)
verifier("base neuve : colonnes nameplate", frais?.nameplate === true)
verifier("base neuve : table recently_viewed", frais?.vues === true)
verifier("base neuve : intégrité OK", frais?.integrite === "ok")

fs.rmSync(dossierV1, { recursive: true, force: true })
fs.rmSync(dossierNeuf, { recursive: true, force: true })

// --- Résultat ---------------------------------------------------------------

console.log(details.join("\n"))
console.log(`\n${reussis} vérification(s) réussie(s), ${echoues} échec(s).`)
process.exit(echoues === 0 ? 0 : 1)

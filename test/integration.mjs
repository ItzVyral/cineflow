// Suite d'intégration CineFlow — s'exécute contre un serveur déjà lancé.
//   npm run test:integration
// Sans BASE_URL, le serveur est lancé dans ce processus (même base que le test).
// DATA_DIR / DATABASE_URL choisissent la base (PGlite local par défaut).
//
// Le script crée un utilisateur de test, exerce les pages et l'API typée, puis
// supprime ses données. La base ciblée est celle de DATA_DIR (défaut `data`).
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let BASE = process.env.BASE_URL
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
await db.pret

let serveurLocal = null
if (!BASE) {
  const { app } = await import(pathToFileURL(path.join(RACINE, "server.js")).href)
  serveurLocal = await new Promise((ok) => { const s = app.listen(0, () => ok(s)) })
  BASE = `http://localhost:${serveurLocal.address().port}`
}

const DECORATION = "a_0123456789abcdef"
const NAMEPLATE = "nameplates/nameplates/twilight/"
const NAMEPLATE_PALETTE = "cobalt"
await db.enregistrerUtilisateur({
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
verifier("accueil : liens vers /serie", accueil.texte.includes('href="/serie/'))

const film = await page("/film/550")
verifier("GET /film/550 → 200", film.statut === 200, String(film.statut))
verifier("film : lecteur /embed/movie/550", film.texte.includes("heiwastream.fr/embed/movie/550"))
verifier("film : paramètres du lecteur", film.texte.includes("site=") && film.texte.includes("report=1"))
verifier("film : structure du cadre", film.texte.includes("lecteur-cadre") && film.texte.includes("barre-lecteur"))
verifier("film : retour et copie du lien", film.texte.includes("data-retour") && film.texte.includes("data-copier"))
verifier("film : pas de panneau série", !film.texte.includes("class=\"panneau\""))
verifier("film : script du lecteur", film.texte.includes('/player.js'))
verifier("film : chip Film", film.texte.includes(">Film<"))
verifier("film : boutons typés movie", film.texte.includes('data-media="movie" data-id="550"'))
verifier("film : données pour les récents locaux", film.texte.includes('data-vue-type="movie" data-vue-id="550"'))
verifier("film : affiche des récents locaux", film.texte.includes('data-vue-affiche="https://image.tmdb.org/t/p/w342'))
verifier("film : fiche TMDB complète", film.texte.includes('class="fiche"') && film.texte.includes("Casting") && film.texte.includes("Titres similaires"))
verifier("film : bande-annonce accessible", film.texte.includes("data-bande-annonce=") && film.texte.includes("role=\"dialog\""))

const serie = await page("/serie/46260/1/1")
verifier("GET /serie/46260/1/1 → 200", serie.statut === 200, String(serie.statut))
verifier("série : lecteur /embed/tv/46260/1/1", /heiwastream\.fr\/embed\/tv\/46260\/1\/1\?/.test(serie.texte))
verifier("série : paramètres du lecteur", ["site=", "color=ff0033", "progress=ff0033", "bg=101012", "name=CineFlow", "room=0", "report=1", "episodes=0"].every((p) => serie.texte.includes(p)))
verifier("série : panneau présent", serie.texte.includes('class="panneau"') && serie.texte.includes("data-panneau-contenu"))
verifier("série : en-tête du panneau", serie.texte.includes("En lecture") && serie.texte.includes("S01E01"))
verifier("série : onglets accessibles", serie.texte.includes('role="tablist"') && serie.texte.includes('role="tab"') && serie.texte.includes("Langues ·") && serie.texte.includes("Épisodes ·"))
verifier("série : épisode actif", serie.texte.includes('aria-current="true"') && serie.texte.includes("En lecture"))
verifier("série : liste des épisodes", serie.texte.includes("episodes-liste") && serie.texte.includes("episode-titre"))
verifier("série : langues proposées", serie.texte.includes("langues-liste") && serie.texte.includes("aria-pressed="))
verifier("série : bouton suivant", serie.texte.includes("data-suivant") && serie.texte.includes("Suivant · Saison"))
verifier("série : genre Animation", serie.texte.includes('<span class="chip">Animation</span>'))
verifier("série : saisons TMDB", serie.texte.includes("<h2>Saisons</h2>") && serie.texte.includes("saison-carte"))
verifier("série : fiche TMDB complète", serie.texte.includes("Casting") && serie.texte.includes("Titres similaires"))

const serieS2 = await page("/serie/46260/2")
verifier("/serie/46260/2 → 302", serieS2.statut === 302, String(serieS2.statut))
verifier("/serie/46260/2 → premier épisode", /^\/serie\/46260\/2\/\d+/.test(serieS2.entetes.get("location") ?? ""))

const serieRacine = await page("/serie/46260")
verifier("/serie/46260 → 302", serieRacine.statut === 302, String(serieRacine.statut))
verifier("/serie/46260 → S1E1 avec reprise", serieRacine.entetes.get("location") === "/serie/46260/1/1?reprise=1")

const panneau = await page("/serie/46260/2/panneau?actifSaison=1&actifEpisode=5&lang=vostfr")
verifier("panneau JSON → 200", panneau.statut === 200, String(panneau.statut))
const donneesPanneau = JSON.parse(panneau.texte)
verifier("panneau JSON : HTML complet", typeof donneesPanneau.html === "string" && donneesPanneau.html.includes("panneau-onglets"))
verifier("panneau JSON : saison affichée", donneesPanneau.saison === 2 && donneesPanneau.actifSaison === 1 && donneesPanneau.actifEpisode === 5)
verifier("panneau JSON : langue active", donneesPanneau.langue === "vostfr")
verifier("panneau JSON : pas de cache", panneau.entetes.get("cache-control") === "no-store")

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
verifier("recherche mixte : liens /film/603", rechercheFilm.texte.includes('href="/film/603"'))

const rechercheCourte = await page("/recherche?q=a")
verifier("recherche trop courte : message", rechercheCourte.texte.includes("au moins 2 caractères"))

const animeVide = await page("/recherche?q=arcane&type=anime")
verifier("recherche animé sans résultat : « Aucun animé »", animeVide.texte.includes("Aucun animé"))

const ancienneFicheFilm = await page("/titre/movie/550")
verifier("/titre/movie/550 → 301", ancienneFicheFilm.statut === 301, String(ancienneFicheFilm.statut))
verifier("/titre/movie/550 → /film/550", ancienneFicheFilm.entetes.get("location") === "/film/550")

const ancienneFicheSerie = await page("/titre/tv/46260?season=2&episode=53")
verifier("/titre/tv/… → 301", ancienneFicheSerie.statut === 301)
verifier("/titre/tv/… → /serie/46260/2/53", ancienneFicheSerie.entetes.get("location") === "/serie/46260/2/53")

const introuvable = await page("/film/999999999")
verifier("/film/999999999 → 404", introuvable.statut === 404)
verifier("/film/abc → 404", (await page("/film/abc")).statut === 404)
verifier("/serie/46260/abc/1 → 404", (await page("/serie/46260/abc/1")).statut === 404)

// --- API : authentification et CSRF ----------------------------------------

verifier("API sans cookie → 401", (await requete("/api/favoris/movie/550", { methode: "POST" })).statut === 401)
verifier("API type invalide sans cookie → 401", (await requete("/api/favoris/anime/550", { methode: "POST" })).statut === 401)

const csrf = await requete("/api/favoris/movie/550", {
  methode: "POST",
  avecCookie: true,
  entetes: { Origin: "https://evil.example" },
})
verifier("API origine externe → 403", csrf.statut === 403, String(csrf.statut))

// --- API : demandes de titres ----------------------------------------------

const demandeType = await requete("/api/demande", { methode: "POST", corps: { type: "anime", id: 550 } })
verifier("POST /api/demande type invalide → 404", demandeType.statut === 404)

const demandeSaison = await requete("/api/demande", { methode: "POST", corps: { type: "tv", id: 46260 } })
verifier("POST /api/demande série sans saison → 400", demandeSaison.statut === 400)

// 550 est disponible : HeiwaStream renvoie « already_available » sans créer de
// nouvelle demande. Cela vérifie le mapping des statuts sans effet de bord.
const demandeDispo = await requete("/api/demande", { methode: "POST", corps: { type: "movie", id: 550 } })
const corpsDemande = JSON.parse(demandeDispo.texte)
verifier("POST /api/demande disponible → 200", demandeDispo.statut === 200, String(demandeDispo.statut))
verifier("POST /api/demande disponible : rechargement", corpsDemande.ok === true && corpsDemande.recharger === true)
verifier("POST /api/demande disponible : statut", ["already_available", "already_requested"].includes(corpsDemande.statut))

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
verifier("/favoris contient le film", favoris.texte.includes('href="/film/550"'))
verifier("/favoris contient la série", favoris.texte.includes('href="/serie/46260"'))

const liste = await page("/liste", { avecCookie: true })
verifier("/liste contient le film", liste.texte.includes('href="/film/550"'))

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

const progression = await db.progression(UTILISATEUR, "tv", 46260)
verifier("DB : saison et épisode enregistrés", progression?.season === 2 && progression?.episode === 53)

const reprise = await page("/serie/46260/2/53", { avecCookie: true })
verifier("page série : data-reprise=100", reprise.texte.includes('data-reprise="100"'))
verifier("page série : texte de reprise", reprise.texte.includes("Reprise à 1 min 40 s"))

const serieReprise = await page("/serie/46260", { avecCookie: true })
verifier("/serie/46260 connecté → dernier épisode", serieReprise.statut === 302 && serieReprise.entetes.get("location") === "/serie/46260/2/53")

const accueilConnecte = await page("/", { avecCookie: true })
verifier("accueil connecté : Continuer de regarder", accueilConnecte.texte.includes("Continuer de regarder"))
verifier("accueil connecté : sous-titre S02E53", accueilConnecte.texte.includes("S02E53"))
verifier("accueil connecté : lien vers l'épisode", accueilConnecte.texte.includes('href="/serie/46260/2/53"'))

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
await page("/film/550", { avecCookie: true })
await page("/film/603", { avecCookie: true })
await page("/film/550", { avecCookie: true })

const vues = await db.listerVues(UTILISATEUR)
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
await db.supprimerUtilisateur(UTILISATEUR)

verifier("DB : vues supprimées avec le compte", (await db.listerVues(UTILISATEUR)).length === 0)
verifier("DB : utilisateur de test supprimé", (await db.utilisateur(UTILISATEUR)) == null)

// --- Schéma PostgreSQL ------------------------------------------------------

const colonnes = async (table) => new Set((await db.requeteBrute(
  "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
  [table],
)).rows.map((c) => c.column_name))
const [usersCols, historyCols, vuesCols] = await Promise.all([colonnes("users"), colonnes("history"), colonnes("recently_viewed")])
const tables = (await db.requeteBrute(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name",
)).rows.map((t) => t.table_name)
verifier("schéma : 7 tables", JSON.stringify(tables) === JSON.stringify(["favorites", "history", "recently_viewed", "schema_version", "users", "watch_days", "watchlist"]), JSON.stringify(tables))
verifier("schéma : version à jour", (await db.requeteBrute("SELECT version FROM schema_version")).rows[0]?.version === db.versionSchema)
verifier("schéma : users.nameplate", ["avatar_decoration", "nameplate_asset", "nameplate_palette"].every((n) => usersCols.has(n)))
verifier("schéma : history.season/episode", ["season", "episode"].every((n) => historyCols.has(n)))
verifier("schéma : recently_viewed typé", ["media_type", "tmdb_id", "viewed_at"].every((n) => vuesCols.has(n)))

// Données orphelines (clé étrangère contournée) : il ne doit y en avoir aucune.
const orphelins = (await db.requeteBrute(`
  SELECT (SELECT COUNT(*) FROM favorites f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.user_id))
       + (SELECT COUNT(*) FROM history h WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = h.user_id)) AS n
`)).rows[0].n
verifier("DB : aucune donnée orpheline", Number(orphelins) === 0)

if (serveurLocal) serveurLocal.close()
await db.fermerBase()

// --- Résultat ---------------------------------------------------------------

console.log(details.join("\n"))
console.log(`\n${reussis} vérification(s) réussie(s), ${echoues} échec(s).`)
process.exit(echoues === 0 ? 0 : 1)

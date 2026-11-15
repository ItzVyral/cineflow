import "dotenv/config"
import { estTypeMedia } from "./media.js"

const BASE = "https://heiwastream.fr/api/v1"
const DELAI_MAX_MS = 12_000

export const IMG = "https://image.tmdb.org/t/p/"

/** Erreur HTTP renvoyée par HeiwaStream, avec le corps JSON quand il existe. */
export class ErreurHeiwa extends Error {
  constructor(status, message, corps = null) {
    super(message)
    this.name = "ErreurHeiwa"
    this.status = status
    this.corps = corps
  }
}

/** Erreur HTTP renvoyée par TMDB (utilisée pour les fiches et les images). */
export class ErreurTmdb extends Error {
  constructor(status, message) {
    super(message)
    this.name = "ErreurTmdb"
    this.status = status
  }
}

/**
 * Appelle l'API HeiwaStream. La clé ne quitte jamais le serveur.
 * `options.body` peut être un objet JSON : il est sérialisé automatiquement.
 */
export async function heiwa(chemin, options = {}) {
  const cle = process.env.HEIWA_CLE
  if (!cle) throw new ErreurHeiwa(503, "HEIWA_CLE est absent du .env")

  const entetes = {
    Authorization: `Bearer ${cle}`,
    "User-Agent": "CineFlow/1.2",
    ...options.headers,
  }

  let corps = options.body
  if (corps && typeof corps === "object") {
    corps = JSON.stringify(corps)
    entetes["Content-Type"] = "application/json"
  }

  const reponse = await fetch(BASE + chemin, {
    ...options,
    body: corps,
    headers: entetes,
    signal: options.signal ?? AbortSignal.timeout(DELAI_MAX_MS),
  })

  const texte = await reponse.text()
  let donnees = null
  if (texte) {
    try {
      donnees = JSON.parse(texte)
    } catch {
      donnees = null
    }
  }

  if (!reponse.ok) {
    const message = donnees?.message ?? donnees?.error ?? `HeiwaStream ${reponse.status}`
    throw new ErreurHeiwa(reponse.status, message, donnees)
  }

  return donnees
}

// --- Cache mémoire ----------------------------------------------------------

const memoire = new Map()

export async function enCache(cle, minutes, charger) {
  const garde = memoire.get(cle)
  if (garde && garde.jusqua > Date.now()) return garde.valeur

  const valeur = await charger()
  memoire.set(cle, { valeur, jusqua: Date.now() + minutes * 60_000 })

  // Évite de garder indéfiniment les clés de recherche / disponibilité.
  if (memoire.size > 1200) {
    const maintenant = Date.now()
    for (const [k, v] of memoire) {
      if (v.jusqua <= maintenant) memoire.delete(k)
    }
  }

  return valeur
}

export function oublier(cle) {
  memoire.delete(cle)
}

// --- TMDB (fiches et images) -------------------------------------------------

function cleTmdb() {
  if (!process.env.TMDB_KEY) throw new ErreurTmdb(503, "TMDB_KEY est absent du .env")
  return process.env.TMDB_KEY
}

const tmdbBrut = (type, id) => enCache(`tmdb:${type}:${id}`, 60, async () => {
  // Une seule requête TMDB : la fiche, le casting, les vidéos, les
  // recommandations et les images arrivent ensemble, puis restent en cache 1 h.
  const url = `https://api.themoviedb.org/3/${type}/${id}?language=fr-FR&include_image_language=fr,en,null&append_to_response=credits,videos,recommendations,images&api_key=${cleTmdb()}`
  const reponse = await fetch(url, {
    headers: { "User-Agent": "CineFlow/1.3" },
    signal: AbortSignal.timeout(DELAI_MAX_MS),
  })
  if (!reponse.ok) throw new ErreurTmdb(reponse.status, `TMDB ${reponse.status}`)
  return reponse.json()
})

const tmdbSaisonBrut = (id, saison) => enCache(`tmdb:saison:${id}:${saison}`, 60, async () => {
  const url = `https://api.themoviedb.org/3/tv/${id}/season/${saison}?language=fr-FR&api_key=${cleTmdb()}`
  const reponse = await fetch(url, {
    headers: { "User-Agent": "CineFlow/1.3" },
    signal: AbortSignal.timeout(DELAI_MAX_MS),
  })
  if (reponse.status === 404) return null
  if (!reponse.ok) throw new ErreurTmdb(reponse.status, `TMDB ${reponse.status}`)
  return reponse.json()
})

function genresDe(donnees) {
  return (donnees?.genres ?? [])
    .map((genre) => (typeof genre === "string" ? genre : genre?.name))
    .filter(Boolean)
}

/** Un animé TMDB est une série japonaise classée « Animation ». */
function estAnime(donnees) {
  return donnees?.original_language === "ja" && genresDe(donnees).includes("Animation")
}

function logoDe(donnees) {
  const logos = donnees?.images?.logos ?? []
  return (logos.find((logo) => logo.iso_639_1 === "fr") ?? logos[0])?.file_path ?? null
}

function castingDe(donnees) {
  return (donnees?.credits?.cast ?? [])
    .map((personne) => ({
      nom: personne?.name ?? "",
      personnage: personne?.character ?? (Array.isArray(personne?.roles) ? personne.roles[0]?.character : "") ?? "",
      photo: personne?.profile_path ?? null,
    }))
    .filter((personne) => personne.nom)
    .slice(0, 12)
}

function nomsEquipe(crew, metiers) {
  const vus = new Set()
  const noms = []
  for (const personne of Array.isArray(crew) ? crew : []) {
    if (!metiers.includes(personne?.job)) continue
    const nom = String(personne?.name ?? "").trim()
    if (!nom || vus.has(nom)) continue
    vus.add(nom)
    noms.push(nom)
    if (noms.length >= 5) break
  }
  return noms
}

function bandeAnnonceDe(donnees) {
  const videos = (donnees?.videos?.results ?? []).filter((video) => video?.site === "YouTube" && video?.key)
  const trailer = videos.find((video) => video.type === "Trailer" && video.iso_639_1 === "fr")
    ?? videos.find((video) => video.type === "Trailer" && video.official)
    ?? videos.find((video) => video.type === "Trailer")
    ?? videos.find((video) => video.type === "Teaser")
  return trailer?.key ?? null
}

function recommandationsDe(donnees, type) {
  const vus = new Set()
  const recommandations = []
  for (const element of donnees?.recommendations?.results ?? []) {
    const id = Number(element?.id)
    if (!Number.isSafeInteger(id) || id <= 0 || vus.has(id)) continue
    vus.add(id)
    recommandations.push({
      type,
      id,
      titre: (type === "tv" ? element?.name : element?.title) ?? element?.original_name ?? element?.original_title ?? "Sans titre",
      poster_path: element?.poster_path ?? null,
      backdrop_path: element?.backdrop_path ?? null,
      date: (type === "tv" ? element?.first_air_date : element?.release_date) ?? "",
      note: Number(element?.vote_average) || 0,
      genres: [],
      langue: element?.original_language ?? null,
      kind: null,
    })
    if (recommandations.length >= 18) break
  }
  return recommandations
}

function normaliserTmdb(type, id, donnees) {
  const estSerie = type === "tv"
  const genres = genresDe(donnees)
  const crew = donnees?.credits?.crew ?? []

  return {
    type,
    id: Number(donnees?.id ?? id),
    titre: (estSerie ? donnees?.name : donnees?.title)
      ?? donnees?.original_name
      ?? donnees?.original_title
      ?? "Sans titre",
    titreOriginal: (estSerie ? donnees?.original_name : donnees?.original_title) ?? "",
    overview: donnees?.overview ?? "",
    slogan: donnees?.tagline ?? "",
    poster_path: donnees?.poster_path ?? null,
    backdrop_path: donnees?.backdrop_path ?? null,
    logo: logoDe(donnees),
    date: (estSerie ? donnees?.first_air_date : donnees?.release_date) ?? "",
    note: Number(donnees?.vote_average) || 0,
    runtime: estSerie ? null : (Number(donnees?.runtime) || null),
    dureeEpisodes: estSerie ? (Number(donnees?.episode_run_time?.[0]) || null) : null,
    saisons: estSerie ? (Number(donnees?.number_of_seasons) || 0) : 0,
    saisonListe: estSerie
      ? (donnees?.seasons ?? [])
        .filter((saison) => Number(saison.season_number) > 0)
        .map((saison) => ({
          saison: Number(saison.season_number),
          episodes: Number(saison.episode_count) || 0,
          nom: saison.name ?? "",
          date: saison.air_date ?? "",
          poster_path: saison.poster_path ?? null,
          overview: saison.overview ?? "",
        }))
      : [],
    genres,
    langue: donnees?.original_language ?? null,
    kind: estSerie ? (estAnime(donnees) ? "anime" : "series") : "movie",
    casting: castingDe(donnees),
    realisateurs: nomsEquipe(crew, ["Director"]),
    scenaristes: nomsEquipe(crew, ["Screenplay", "Writer", "Story", "Teleplay"]),
    createurs: (donnees?.created_by ?? []).map((personne) => personne?.name).filter(Boolean),
    bandeAnnonce: bandeAnnonceDe(donnees),
    recommandations: recommandationsDe(donnees, type),
  }
}

function normaliserHeiwa(type, id, donnees) {
  const estSerie = type === "tv"

  return {
    type,
    id: Number(donnees?.tmdb ?? id),
    titre: donnees?.title ?? "Sans titre",
    titreOriginal: donnees?.original_title ?? "",
    overview: donnees?.overview ?? "",
    slogan: donnees?.tagline ?? "",
    poster_path: donnees?.poster ?? null,
    backdrop_path: donnees?.backdrop ?? null,
    logo: donnees?.logo ?? null,
    date: donnees?.release_date ?? "",
    note: 0,
    runtime: estSerie ? null : (Number(donnees?.runtime) || null),
    dureeEpisodes: null,
    saisons: estSerie
      ? (typeof donnees?.seasons === "number" ? donnees.seasons : (donnees?.seasons?.length ?? 0))
      : 0,
    saisonListe: estSerie && Array.isArray(donnees?.seasons)
      ? donnees.seasons
        .filter((saison) => Number(saison?.season ?? saison?.season_number) > 0)
        .map((saison) => ({
          saison: Number(saison.season ?? saison.season_number),
          episodes: Number(saison.episodes?.length ?? saison.episode_count) || 0,
          nom: saison.name ?? "",
          date: saison.air_date ?? "",
          poster_path: saison.poster ?? saison.poster_path ?? null,
          overview: "",
        }))
      : [],
    genres: genresDe(donnees),
    langue: null,
    kind: estSerie ? "series" : "movie",
    casting: [],
    realisateurs: [],
    scenaristes: [],
    createurs: [],
    bandeAnnonce: donnees?.trailer ?? null,
    recommandations: [],
  }
}

/**
 * Fiche normalisée d'un film ou d'une série. TMDB fournit les affiches, le
 * logo et la note ; l'API HeiwaStream sert de secours si TMDB est indisponible.
 */
export async function fiche(type, id) {
  if (!estTypeMedia(type)) throw new ErreurTmdb(404, "Type de média invalide")
  const numero = Number(id)
  if (!Number.isSafeInteger(numero) || numero <= 0) throw new ErreurTmdb(404, "Titre introuvable")

  try {
    const donnees = await tmdbBrut(type, numero)
    return normaliserTmdb(type, numero, donnees)
  } catch (erreur) {
    try {
      const donnees = await titreHeiwa(type, numero)
      return normaliserHeiwa(type, numero, donnees)
    } catch {
      throw erreur
    }
  }
}

// --- HeiwaStream -------------------------------------------------------------

/** Recherche dans le catalogue HeiwaStream (films, séries et animés). */
export async function rechercherHeiwa(requete, { type = null } = {}) {
  const q = String(requete ?? "").trim().slice(0, 100)
  if (q.length < 2) return { query: q, results: [] }

  const typeValide = estTypeMedia(type) ? type : null
  // L'API répond 505 quand l'espace est encodé en %20 : elle attend un « + ».
  const titre = encodeURIComponent(q).replace(/%20/g, "+")
  const parametres = `limit=20${typeValide ? `&type=${typeValide}` : ""}`

  const donnees = await enCache(`find:${typeValide ?? "tous"}:${q.toLowerCase()}`, 5,
    () => heiwa(`/find/${titre}?${parametres}`))

  return { ...donnees, results: Array.isArray(donnees?.results) ? donnees.results : [] }
}

/** Nouveautés mixtes : films et épisodes de séries. */
export const nouveautes = () => enCache("nouveautes", 5, () => heiwa("/news"))

/** Classement des titres les plus regardés (`week` ou `month`). */
export function topTitres(periode = "week") {
  const periodeValide = periode === "month" ? "month" : "week"
  return enCache(`top:${periodeValide}`, 30, () => heiwa(`/top/${periodeValide}`))
}

/** Catalogue paginé : `movie`, `tv` ou `anime`. */
export function catalogue(type = "movie", page = 1) {
  const typeValide = type === "tv" || type === "anime" ? type : "movie"
  const numero = Math.max(1, Math.min(20, Number(page) || 1))
  return enCache(`catalogue:${typeValide}:${numero}`, 5,
    () => heiwa(`/catalog/${typeValide}?sort=added&page=${numero}`))
}

/** Fiche brute HeiwaStream (secours de `fiche`). */
export const titreHeiwa = (type, id) => enCache(`titre:${type}:${id}`, 60,
  () => heiwa(`/title/${type}/${id}`))

/** Saisons et épisodes d'une série, pour une saison précise. */
export const episodes = (id, saison) => enCache(`episodes:${id}:${saison}`, 30,
  () => heiwa(`/tv/${id}/${saison}`))

/** Détail TMDB d'une saison : titres, dates, durées et miniatures des épisodes. */
export async function saisonTmdb(id, saison) {
  return tmdbSaisonBrut(Number(id), Number(saison))
}

/** Disponibilité d'un film ou d'un épisode (langues, qualité, sources). */
export function disponibilite(type, id, saison = null, episode = null) {
  if (!estTypeMedia(type)) throw new ErreurHeiwa(404, "Type de média invalide")
  const suffixe = type === "tv" && saison && episode
    ? `/${Number(saison)}/${Number(episode)}`
    : ""
  return enCache(`dispo:${type}:${id}:${saison ?? ""}:${episode ?? ""}`, 10,
    () => heiwa(`/available/${type}/${id}${suffixe}`))
}

/**
 * Disponibilité de plusieurs titres en un seul appel (100 identifiants au plus
 * par lot). Renvoie une Map `id -> fiche de disponibilité`.
 */
export async function disponibilitesLot(type, ids) {
  if (!estTypeMedia(type)) throw new ErreurHeiwa(404, "Type de média invalide")

  const numeros = [...new Set((Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0))]

  const sortie = new Map()
  for (let index = 0; index < numeros.length; index += 100) {
    const lot = numeros.slice(index, index + 100)
    const donnees = await enCache(`dispo-lot:${type}:${lot.join(",")}`, 10,
      () => heiwa(`/available/${type}/${lot.join(",")}`))

    // La réponse de lot est un objet `{ type, results: { "<id>": {...} } }` ;
    // on accepte aussi les tableaux et les variantes déjà rencontrées.
    const elements = []
    const sources = [donnees, donnees?.results, donnees?.titles, donnees?.data]
    for (const source of sources) {
      if (Array.isArray(source)) {
        elements.push(...source.map((element) => [null, element]))
        break
      }
      if (source && typeof source === "object") {
        const entrees = Object.entries(source)
          .filter(([cle, valeur]) => /^\d+$/.test(cle) && valeur && typeof valeur === "object")
        if (entrees.length) {
          elements.push(...entrees.map(([cle, valeur]) => [Number(cle), valeur]))
          break
        }
      }
    }

    for (const [cle, element] of elements) {
      const id = Number(element?.tmdb ?? element?.id ?? cle)
      if (Number.isSafeInteger(id) && id > 0) sortie.set(id, element)
    }
  }

  return sortie
}

/** Demande d'un titre manquant. `requester` est un identifiant anonyme stable. */
export function demanderTitre({ type, tmdb, season = null, episode = null, requester }) {
  const corps = { type, tmdb: Number(tmdb), requester: String(requester) }
  if (type === "tv" && season && episode) {
    corps.season = Number(season)
    corps.episode = Number(episode)
  }
  return heiwa("/requests", { method: "POST", body: corps })
}

// Jeton « sans publicité » : la clé reste côté serveur. Un échec est mémorisé
// quelques minutes pour ne pas marteler l'API à chaque chargement de page.
let cacheSansPub = null

export async function jetonSansPub() {
  if (process.env.HEIWA_SANS_PUB !== "1") return null
  if (cacheSansPub && cacheSansPub.jusqua > Date.now()) return cacheSansPub.token

  try {
    const donnees = await enCache("sans-pub", 350, () => heiwa("/key/ad-free"))
    const token = donnees?.token ?? null
    cacheSansPub = { token, jusqua: Date.now() + 350 * 60_000 }
    return token
  } catch {
    cacheSansPub = { token: null, jusqua: Date.now() + 5 * 60_000 }
    return null
  }
}

// On ne filtre pas avec ?text=1 : les notes sans commentaire restent utiles
// pour afficher la moyenne et les étoiles.
export const avisTitre = (type, id) => enCache(`avis:${type}:${id}`, 5,
  () => heiwa(`/reviews/${type}/${id}`))

export async function publierAvis(avis) {
  const resultat = await heiwa("/reviews", { method: "POST", body: avis })
  // Le cache des avis doit refléter l'envoi dès la prochaine visite.
  oublier(`avis:${avis.type}:${avis.tmdb}`)
  return resultat
}

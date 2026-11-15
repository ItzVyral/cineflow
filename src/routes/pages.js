import express from "express"
import * as db from "../db.js"
import {
  IMG,
  avisTitre,
  catalogue,
  disponibilite,
  episodes,
  fiche,
  nouveautes,
  rechercherHeiwa,
  topTitres,
} from "../heiwa.js"
import {
  cleMedia,
  estTypeCatalogue,
  estTypeMedia,
  filtreRecherche,
  typeDepuisFiltre,
} from "../media.js"
import {
  avecNameplate,
  avatarAvecDecoration,
  boutonsMedia,
  carte,
  chipsInfos,
  e,
  etatVide,
  page,
  pageErreur,
  pagination,
} from "../render.js"
import { effacerSession } from "../session.js"

export const pagesRouter = express.Router()

const FILTRES = [
  ["tous", "Tous"],
  ["movie", "Films"],
  ["tv", "Séries"],
  ["anime", "Animés"],
]

const SINGULIERS = {
  tous: "Aucun titre",
  movie: "Aucun film",
  tv: "Aucune série",
  anime: "Aucun animé",
}

const CATALOGUES = {
  movie: { libelle: "Films", texte: "Les derniers films ajoutés au catalogue HeiwaStream." },
  tv: { libelle: "Séries", texte: "Les dernières séries ajoutées au catalogue HeiwaStream." },
  anime: { libelle: "Animés", texte: "Les derniers animés ajoutés au catalogue HeiwaStream." },
}

function etatsUtilisateur(user) {
  if (!user) return { favoris: new Set(), liste: new Set() }
  return { favoris: db.idsFavoris(user.id), liste: db.idsListe(user.id) }
}

/**
 * Charge des fiches par petits lots : évite de déclencher la limite de débit
 * de TMDB quand une page contient beaucoup d'affiches.
 */
async function parLots(elements, transformer, taille = 8) {
  const resultats = []
  for (let i = 0; i < elements.length; i += taille) {
    resultats.push(...await Promise.all(elements.slice(i, i + taille).map(transformer)))
  }
  return resultats
}

/** Transforme un résultat HeiwaStream (`/find`, `/catalog`, `/news`) en carte. */
function depuisElement(element) {
  const type = element?.type === "tv" ? "tv" : "movie"
  const id = Number(element?.tmdb)
  if (!Number.isSafeInteger(id) || id <= 0) return null

  return {
    type,
    id,
    titre: element.title ?? "Sans titre",
    titreOriginal: "",
    overview: "",
    poster_path: null,
    backdrop_path: null,
    logo: null,
    date: element.year ? `${element.year}-01-01` : "",
    note: 0,
    runtime: null,
    saisons: 0,
    saisonListe: [],
    genres: [],
    langue: null,
    // `kind` vaut movie, series ou anime : il vient de l'API HeiwaStream.
    kind: element.kind ?? null,
  }
}

/**
 * Résultats HeiwaStream normalisés, dédupliqués et limités à `limite` titres.
 * `exclure` contient les clés `type:id` déjà affichées ailleurs sur la page.
 */
function elementsUniques(donnees, limite, exclure = new Set()) {
  const vus = new Set(exclure)
  const elements = []

  for (const element of Array.isArray(donnees?.results) ? donnees.results : []) {
    const normalise = depuisElement(element)
    if (!normalise) continue
    const cle = cleMedia(normalise.type, normalise.id)
    if (vus.has(cle)) continue
    vus.add(cle)
    elements.push(normalise)
    if (elements.length >= limite) break
  }

  return elements
}

/** Complète les résultats avec TMDB (affiches, résumé, note), sans les bloquer. */
async function enrichir(elements) {
  const resultats = await parLots(elements, async (element) => {
    if (!element) return null
    try {
      const complete = await fiche(element.type, element.id)
      return { ...complete, kind: element.kind ?? complete.kind }
    } catch {
      return element
    }
  })
  return resultats.filter(Boolean)
}

function dateLisible(valeur) {
  if (!valeur) return ""
  const texte = String(valeur)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(texte)
    ? new Date(`${texte}T12:00:00Z`)
    : new Date(texte)
  if (Number.isNaN(date.getTime())) return texte
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

function dateFr(sqlite) {
  if (!sqlite) return ""
  const date = new Date(`${String(sqlite).replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

async function blocContinuer(user, etats, lignes = db.historiqueContinu(user.id, 12)) {
  if (!lignes.length) return ""

  const cartes = (await parLots(lignes, async (ligne) => {
    let media
    try {
      media = await fiche(ligne.media_type, ligne.tmdb_id)
    } catch {
      return ""
    }

    const progression = ligne.duration > 0 ? (ligne.progress / ligne.duration) * 100 : null
    const estSerie = ligne.media_type === "tv" && ligne.season > 0
    return carte(media, {
      favori: etats.favoris.has(cleMedia(ligne.media_type, ligne.tmdb_id)),
      liste: etats.liste.has(cleMedia(ligne.media_type, ligne.tmdb_id)),
      progression,
      sousTitre: estSerie ? `S${ligne.season} · E${ligne.episode}` : "",
      lien: estSerie ? `/titre/tv/${ligne.tmdb_id}?season=${ligne.season}&episode=${ligne.episode}` : null,
    })
  })).join("")

  if (!cartes) return ""
  return `<h2>Continuer de regarder</h2><div class="rang">${cartes}</div>`
}

async function blocAvis(type, id) {
  let donnees
  try {
    donnees = await avisTitre(type, id)
  } catch {
    return `<section class="avis-section"><h2>Avis</h2><p class="vide">Les avis sont momentanément indisponibles.</p></section>`
  }

  const moyenne = donnees?.average == null ? null : Number(donnees.average)
  const resume = donnees?.count
    ? `<div class="avis-resume"><p class="note-moyenne">${Number.isFinite(moyenne) ? moyenne.toFixed(1) : "–"}<span>/5</span></p>
        <p class="vide">${donnees.count} avis</p></div>`
    : `<p class="vide">Pas encore d'avis.</p>`

  const liste = (Array.isArray(donnees?.results) ? donnees.results : []).map((avis) => {
    const note = Math.max(1, Math.min(5, Number(avis.rating) || 0))
    const commentaire = avis.comment ? e(avis.comment) : ""
    const texte = avis.spoiler && commentaire
      ? `<details class="spoiler"><summary>Voir quand même (spoiler)</summary><p>${commentaire}</p></details>`
      : commentaire
        ? `<p>${commentaire}</p>`
        : ""

    return `<article class="avis">
      <header><b>${e(avis.author || "Anonyme")}</b>
      <span class="etoiles" aria-label="${note} sur 5">${"★".repeat(note)}<span class="etoiles-vides">${"☆".repeat(5 - note)}</span></span></header>
      ${texte}
      ${avis.date ? `<time class="avis-date" datetime="${e(avis.date)}">${e(dateLisible(avis.date))}</time>` : ""}
    </article>`
  }).join("")

  return `<section class="avis-section"><h2>Avis</h2>${resume}${liste}</section>`
}

function formulaireAvis(type, id, user, chemin) {
  if (!user) {
    return `<div class="avis-cta">
      <p>Connecte-toi pour noter ce titre et laisser un commentaire.</p>
      <a class="discord" href="/auth/discord?retour=${encodeURIComponent(chemin)}">Se connecter avec Discord</a>
    </div>`
  }

  const etoiles = [5, 4, 3, 2, 1].map((note) => `
    <input type="radio" id="note-${type}-${id}-${note}" name="note" value="${note}" required>
    <label for="note-${type}-${id}-${note}" title="${note} étoile${note > 1 ? "s" : ""}">
      <span class="sr-only">${note} sur 5</span>★
    </label>`).join("")

  return `<form class="form-avis" data-avis="${id}" data-media="${type}">
    <h3>Donner mon avis</h3>
    <fieldset class="choix-note">
      <legend>Ta note</legend>
      <div class="etoiles-note">${etoiles}</div>
    </fieldset>
    <label class="champ">
      <span>Commentaire <small>(facultatif, 2 caractères minimum)</small></span>
      <textarea name="comment" rows="4" maxlength="1000" placeholder="Ce que tu as pensé de ce titre…"></textarea>
    </label>
    <label class="case">
      <input type="checkbox" name="spoiler">
      <span>Ce commentaire contient des spoilers</span>
    </label>
    <p class="form-aide">Les avis envoyés à HeiwaStream sont signés « Anonyme » : leur API ne transmet pas les pseudos Discord.</p>
    <p class="form-msg" role="status" aria-live="polite"></p>
    <button class="play" type="submit">Envoyer mon avis</button>
  </form>`
}

function ongletsCatalogue(typeActif) {
  return `<nav class="onglets" aria-label="Type de catalogue">${Object.entries(CATALOGUES).map(([cle, infos]) => `
    <a class="onglet${cle === typeActif ? " on" : ""}" href="/catalogue?type=${cle}"
      ${cle === typeActif ? 'aria-current="page"' : ""}>${infos.libelle}</a>`).join("")}
  </nav>`
}

function ongletsRecherche(q, filtreActif) {
  return `<nav class="onglets" aria-label="Filtrer par type">${FILTRES.map(([cle, libelle]) => {
    const parametres = new URLSearchParams()
    if (q) parametres.set("q", q)
    parametres.set("type", cle)
    return `<a class="onglet${cle === filtreActif ? " on" : ""}" href="/recherche?${parametres.toString()}"
      ${cle === filtreActif ? 'aria-current="page"' : ""}>${libelle}</a>`
  }).join("")}
  </nav>`
}

function listeSaisons(media) {
  if (media.saisonListe?.length) return media.saisonListe
  const nombre = Math.max(1, Number(media.saisons) || 1)
  return Array.from({ length: nombre }, (_, index) => ({
    saison: index + 1,
    episodes: 0,
    nom: "",
    date: "",
  }))
}

function formulaireEpisodes(id, saisons, saison, listeEpisodes, episode) {
  if (!saisons.length) return ""

  const optionsSaisons = saisons.map((element) => `<option value="${element.saison}"
    ${element.saison === saison ? "selected" : ""}>Saison ${element.saison}</option>`).join("")

  const optionsEpisodes = listeEpisodes.length
    ? listeEpisodes.map((element) => `<option value="${element.episode}"
      ${Number(element.episode) === episode ? "selected" : ""}>Épisode ${element.episode}${element.title ? ` — ${e(element.title)}` : ""}</option>`).join("")
    : `<option value="${episode}" selected>Épisode ${episode}</option>`

  return `<form class="choix-episode" method="get" action="/titre/tv/${id}">
    <label>Saison<select name="season">${optionsSaisons}</select></label>
    <label>Épisode<select name="episode">${optionsEpisodes}</select></label>
    <button class="play" type="submit">Regarder cet épisode</button>
  </form>`
}

// --- Accueil ----------------------------------------------------------------

pagesRouter.get("/", async (req, res, next) => {
  try {
    const etats = etatsUtilisateur(req.user)
    let medias = []

    try {
      const donnees = await nouveautes()
      const dejaVus = new Set()
      const elements = (Array.isArray(donnees?.results) ? donnees.results : [])
        .filter((element) => {
          const id = Number(element?.tmdb)
          const type = element?.type === "tv" ? "tv" : "movie"
          const cle = cleMedia(type, id)
          if (!Number.isSafeInteger(id) || id <= 0 || dejaVus.has(cle)) return false
          dejaVus.add(cle)
          return true
        })
        .slice(0, 14)
        .map(depuisElement)

      medias = await enrichir(elements)
    } catch (erreur) {
      console.warn(`[CineFlow] Nouveautés indisponibles : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
    }

    const vedettes = medias.slice(0, 5)

    const hero = vedettes.map((media, index) => {
      const fond = media.backdrop_path ?? media.poster_path
      const styleFond = fond ? ` style="--bg:url(${e(`${IMG}original${fond}`)})"` : ""
      const titre = media.logo
        ? `<img class="titre" src="${e(`${IMG}w500${media.logo}`)}" alt="${e(media.titre)}">`
        : `<h1>${e(media.titre)}</h1>`

      return `<article class="slide${index === 0 ? " on" : ""}"${styleFond}>
        <div class="txt">${titre}
        <div class="chips">${chipsInfos(media)}</div><p>${e(media.overview)}</p>
        <a class="play" href="/titre/${media.type}/${media.id}">▶ Lecture</a></div></article>`
    }).join("")

    const cartes = medias.map((media) => carte(media, {
      favori: etats.favoris.has(cleMedia(media.type, media.id)),
      liste: etats.liste.has(cleMedia(media.type, media.id)),
    })).join("")

    const continuerLignes = req.user ? db.historiqueContinu(req.user.id, 12) : []
    const continuer = req.user ? await blocContinuer(req.user, etats, continuerLignes) : ""
    const dejaEnCours = new Set(continuerLignes.map((ligne) => cleMedia(ligne.media_type, ligne.tmdb_id)))
    const recents = req.user ? await blocRecemmentVus(req.user, etats, dejaEnCours) : ""
    const confirmation = req.query.compte === "supprime"
      ? `<p class="bandeau-succes" role="status">Ton compte et toutes tes données ont bien été supprimés.</p>`
      : ""

    const heros = vedettes.length
      ? `<section class="hero">${hero}
        <div class="dots">${vedettes.map((_, index) => `<i class="${index === 0 ? "on" : ""}" role="button" tabindex="0" aria-label="Affiche ${index + 1}"></i>`).join("")}</div></section>`
      : ""

    const nouveautesHtml = medias.length
      ? `<h2>Nouveautés</h2><div class="rang">${cartes}</div>`
      : `<div class="page">${etatVide({
        titre: "Aucune nouveauté disponible",
        texte: "Le catalogue est momentanément vide ou indisponible. Réessaie dans un instant.",
        lien: "/catalogue",
        libelle: "Voir le catalogue",
      })}</div>`

    res.send(page({
      titre: "Accueil",
      actif: "accueil",
      user: req.user,
      chemin: req.originalUrl,
      nomPage: "accueil",
      description: "Les derniers films, séries et animés arrivés, à regarder en streaming.",
      corps: `${confirmation}${heros}${nouveautesHtml}${continuer}${recents}${req.user ? "" : blocRecentsLocaux}`,
    }))
  } catch (erreur) {
    next(erreur)
  }
})

// --- Page d'un titre --------------------------------------------------------

pagesRouter.get("/titre/:type/:id", async (req, res, next) => {
  const type = req.params.type
  const id = Number(req.params.id)

  if (!estTypeMedia(type) || !Number.isInteger(id) || id <= 0) {
    return res.status(404).send(pageErreur(404, "Titre introuvable", "Ce titre n'existe pas.", { user: req.user, chemin: req.originalUrl }))
  }

  let media
  try {
    media = await fiche(type, id)
  } catch (erreur) {
    if (erreur?.status === 404) {
      return res.status(404).send(pageErreur(404, "Titre introuvable", "Ce titre n'existe pas.", { user: req.user, chemin: req.originalUrl }))
    }
    return next(erreur)
  }

  // Vue enregistrée côté serveur pour les comptes connectés. Les visiteurs
  // utilisent localStorage (voir public/app.js).
  if (req.user) {
    try {
      db.enregistrerVue(req.user.id, type, id)
    } catch (erreur) {
      console.warn(`[CineFlow] Vue non enregistrée : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
    }
  }

  const estSerie = type === "tv"
  const historique = req.user ? db.progression(req.user.id, type, id) : null

  let saison = 1
  let episode = 1
  let saisons = []
  let listeEpisodes = []
  let episodeChoisi = null

  if (estSerie) {
    saisons = listeSaisons(media)
    const saisonHistorique = Number(historique?.season) || 0
    const saisonDemandee = Number.parseInt(req.query.season, 10)
    const candidate = Number.isInteger(saisonDemandee) ? saisonDemandee : saisonHistorique
    saison = saisons.some((element) => element.saison === candidate)
      ? candidate
      : (saisons[0]?.saison ?? 1)

    try {
      const donnees = await episodes(id, saison)
      const bloc = (donnees?.seasons ?? []).find((element) => Number(element.season) === saison)
      listeEpisodes = (bloc?.episodes ?? []).filter((element) => {
        const numero = Number(element?.episode)
        return Number.isInteger(numero) && numero > 0
      })
    } catch (erreur) {
      console.warn(`[CineFlow] Épisodes indisponibles pour ${id} saison ${saison} : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
    }

    const episodeHistorique = saisonHistorique === saison ? (Number(historique?.episode) || 0) : 0
    const episodeDemande = Number.parseInt(req.query.episode, 10)
    const candidat = Number.isInteger(episodeDemande) ? episodeDemande : episodeHistorique
    episode = listeEpisodes.some((element) => Number(element.episode) === candidat)
      ? candidat
      : (Number(listeEpisodes[0]?.episode) || 1)

    episodeChoisi = listeEpisodes.find((element) => Number(element.episode) === episode) ?? null
  }

  const [dispo, avisHtml] = await Promise.all([
    disponibilite(type, id, estSerie ? saison : null, estSerie ? episode : null).catch(() => null),
    blocAvis(type, id),
  ])

  const favori = req.user ? db.estFavori(req.user.id, type, id) : false
  const dansListe = req.user ? db.estDansListe(req.user.id, type, id) : false

  const memeEpisode = !estSerie
    || (Number(historique?.season) === saison && Number(historique?.episode) === episode)
  const dejaVu = historique && historique.duration > 0 && historique.progress / historique.duration < 0.95
  const reprise = dejaVu && memeEpisode && historique.progress > 10 ? Math.floor(historique.progress) : 0

  const site = encodeURIComponent(process.env.HEIWA_SITE ?? "")
  const source = estSerie
    ? `https://heiwastream.fr/embed/tv/${id}/${String(saison).padStart(2, "0")}/${String(episode).padStart(2, "0")}?site=${site}&report=1${reprise ? `&t=${reprise}` : ""}`
    : `https://heiwastream.fr/embed/movie/${id}?site=${site}&report=1${reprise ? `&t=${reprise}` : ""}`

  const titreLecture = estSerie ? `${media.titre} — S${saison} E${episode}` : media.titre
  const lecteur = dispo?.available
    ? `<iframe data-lecteur data-media="${type}" data-id="${id}"
        ${estSerie ? `data-season="${saison}" data-episode="${episode}"` : ""} data-reprise="${reprise}" src="${e(source)}"
        allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
        title="Lecteur HeiwaStream pour ${e(titreLecture)}"></iframe>`
    : `<p class="vide">${dispo ? `Ce ${estSerie ? "épisode" : "film"} n'est pas encore disponible chez HeiwaStream.` : "Impossible de vérifier la disponibilité pour le moment."}</p>`

  const langues = (Array.isArray(dispo?.languages) ? dispo.languages : [])
    .map((langue) => `<span class="chip">${e(langue)}</span>`).join("")
  const qualite = dispo?.quality ? `<span class="chip">${e(dispo.quality)}</span>` : ""
  const fond = media.backdrop_path ? ` style="--bg:url(${e(`${IMG}original${media.backdrop_path}`)})"` : ""
  const afficheVue = media.poster_path ? `${IMG}w342${media.poster_path}` : ""
  const kindVue = media.kind ?? (estSerie ? "series" : "movie")

  const infosEpisode = estSerie && episodeChoisi
    ? `<p class="episode-info">
        S${saison} E${episode}${episodeChoisi.title ? ` · ${e(episodeChoisi.title)}` : ""}
        ${episodeChoisi.air_date ? ` · ${e(dateLisible(episodeChoisi.air_date))}` : ""}
      </p>`
    : ""

  const indexEpisode = listeEpisodes.findIndex((element) => Number(element.episode) === episode)
  const precedent = indexEpisode > 0 ? listeEpisodes[indexEpisode - 1] : null
  const suivant = indexEpisode >= 0 && indexEpisode < listeEpisodes.length - 1
    ? listeEpisodes[indexEpisode + 1]
    : null

  const navEpisodes = estSerie && (precedent || suivant)
    ? `<nav class="nav-episodes" aria-label="Navigation entre les épisodes">
        ${precedent ? `<a class="btn-ligne" href="/titre/tv/${id}?season=${saison}&episode=${precedent.episode}">‹ Épisode ${precedent.episode}</a>` : ""}
        ${suivant ? `<a class="btn-ligne" href="/titre/tv/${id}?season=${saison}&episode=${suivant.episode}">Épisode ${suivant.episode} ›</a>` : ""}
      </nav>`
    : ""

  res.send(page({
    titre: estSerie ? `${media.titre} — S${saison} E${episode}` : media.titre,
    user: req.user,
    chemin: req.originalUrl,
    nomPage: "titre",
    description: media.overview?.slice(0, 160),
    corps: `<main class="film"${fond} data-vue-type="${e(type)}" data-vue-id="${id}"
      data-vue-titre="${e(media.titre)}" data-vue-affiche="${e(afficheVue)}" data-vue-kind="${e(kindVue)}">
      ${estSerie ? formulaireEpisodes(id, saisons, saison, listeEpisodes, episode) : ""}
      <div class="lecteur">${lecteur}</div>
      ${infosEpisode}
      ${navEpisodes}
      <div class="film-infos">
        <div>
          <h1>${e(media.titre)}</h1>
          <div class="chips">${chipsInfos(media)}${langues}${qualite}</div>
          ${boutonsMedia(type, id, favori, dansListe)}
        </div>
        <p class="resume">${e(media.overview)}</p>
      </div>
      ${reprise ? `<p class="reprise-info">Reprise à ${Math.floor(reprise / 60)} min ${String(reprise % 60).padStart(2, "0")} s${estSerie ? ` (S${saison} E${episode})` : ""}.</p>` : ""}
      ${avisHtml}
      ${formulaireAvis(type, id, req.user, req.originalUrl)}
    </main>`,
  }))
})

// Anciennes adresses : conservées pour les liens déjà partagés.
pagesRouter.get("/film/:id", (req, res) => {
  const query = new URLSearchParams(req.query).toString()
  res.redirect(301, `/titre/movie/${encodeURIComponent(req.params.id)}${query ? `?${query}` : ""}`)
})

pagesRouter.get("/serie/:id", (req, res) => {
  const query = new URLSearchParams(req.query).toString()
  res.redirect(301, `/titre/tv/${encodeURIComponent(req.params.id)}${query ? `?${query}` : ""}`)
})

// --- Recherche --------------------------------------------------------------

pagesRouter.get("/recherche", async (req, res, next) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : ""
  const filtre = filtreRecherche(req.query.type)
  const etats = etatsUtilisateur(req.user)

  let medias = []
  let message = ""

  if (q.length >= 2) {
    try {
      const donnees = await rechercherHeiwa(q, { type: typeDepuisFiltre(filtre) })
      let resultats = donnees.results
      if (filtre === "anime") resultats = resultats.filter((element) => element?.kind === "anime")
      medias = await enrichir(resultats.map(depuisElement).filter(Boolean))
    } catch (erreur) {
      console.warn(`[CineFlow] Recherche indisponible : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
      message = "La recherche est momentanément indisponible. Réessaie dans un instant."
    }
  } else {
    message = "Écris au moins 2 caractères pour lancer une recherche."
  }

  const grille = medias.length
    ? `<div class="grille">${medias.map((media) => carte(media, {
      favori: etats.favoris.has(cleMedia(media.type, media.id)),
      liste: etats.liste.has(cleMedia(media.type, media.id)),
    })).join("")}</div>`
    : q.length >= 2 && !message
      ? etatVide({
        titre: "Aucun résultat disponible",
        texte: `${SINGULIERS[filtre]} disponible chez HeiwaStream pour « ${q} ».`,
        lien: "/catalogue",
        libelle: "Parcourir le catalogue",
      })
      : ""

  res.send(page({
    titre: q ? `Recherche : ${q}` : "Recherche",
    user: req.user,
    recherche: q,
    chemin: req.originalUrl,
    nomPage: "recherche",
    corps: `<main class="page">
      <h1 class="titre-page">${q ? `Résultats pour « ${e(q)} »` : "Rechercher un film, une série ou un animé"}</h1>
      ${ongletsRecherche(q, filtre)}
      ${medias.length ? `<p class="vide">${medias.length} résultat(s) disponible(s) chez HeiwaStream.</p>` : ""}
      ${message ? `<p class="vide">${e(message)}</p>` : ""}
      ${grille}
    </main>`,
  }))
})

// --- Catalogue paginé -------------------------------------------------------

pagesRouter.get("/catalogue", async (req, res, next) => {
  const type = estTypeCatalogue(req.query.type) ? req.query.type : "movie"
  const pageDemandee = Number.parseInt(req.query.page, 10)
  const numero = Number.isInteger(pageDemandee) ? Math.max(1, Math.min(20, pageDemandee)) : 1
  const etats = etatsUtilisateur(req.user)
  const infos = CATALOGUES[type]

  try {
    const donnees = await catalogue(type, numero)
    const elements = Array.isArray(donnees?.results) ? donnees.results : []
    const medias = await enrichir(elements.map(depuisElement).filter(Boolean))
    const pages = Math.max(1, Math.min(20, Number(donnees?.pages) || 1))

    res.send(page({
      titre: `Catalogue ${infos.libelle}`,
      actif: "catalogue",
      user: req.user,
      recherche: "",
      chemin: req.originalUrl,
      nomPage: "catalogue",
      description: `Le catalogue de ${infos.libelle.toLowerCase()} disponible chez HeiwaStream, page par page.`,
      corps: `<main class="page">
        <h1 class="titre-page">Catalogue</h1>
        ${ongletsCatalogue(type)}
        <p class="vide">${infos.texte}</p>
        ${medias.length
          ? `<div class="grille">${medias.map((media) => carte(media, {
            favori: etats.favoris.has(cleMedia(media.type, media.id)),
            liste: etats.liste.has(cleMedia(media.type, media.id)),
          })).join("")}</div>`
          : etatVide({ titre: "Catalogue vide", texte: `Aucun titre sur cette page de ${infos.libelle.toLowerCase()}.`, lien: "/", libelle: "Retour à l'accueil" })}
        ${pagination(numero, pages, type)}
      </main>`,
    }))
  } catch (erreur) {
    next(erreur)
  }
})

// --- Favoris / liste de lecture --------------------------------------------

async function pageListe(req, res, { actif, nomPage, titre, lignes, videTitre, videTexte }) {
  const etats = etatsUtilisateur(req.user)

  if (!req.user) {
    return res.send(page({
      titre,
      actif,
      user: null,
      chemin: req.originalUrl,
      nomPage,
      corps: `<main class="page">
        <h1 class="titre-page">${titre}</h1>
        ${etatVide({
          titre: "Connecte-toi pour retrouver tes titres",
          texte: "Tes favoris et ta liste sont liés à ton compte Discord, sur tous tes appareils.",
          lien: `/auth/discord?retour=${encodeURIComponent(req.originalUrl)}`,
          libelle: "Se connecter avec Discord",
        })}
      </main>`,
    }))
  }

  const medias = (await parLots(lignes, async (ligne) => {
    try {
      return await fiche(ligne.media_type, ligne.tmdb_id)
    } catch {
      return null
    }
  })).filter(Boolean)

  res.send(page({
    titre,
    actif,
    user: req.user,
    chemin: req.originalUrl,
    nomPage,
    corps: `<main class="page">
      <h1 class="titre-page">${titre}</h1>
      ${medias.length
        ? `<div class="grille">${medias.map((media) => carte(media, {
          favori: etats.favoris.has(cleMedia(media.type, media.id)),
          liste: etats.liste.has(cleMedia(media.type, media.id)),
        })).join("")}</div>`
        : etatVide({ titre: videTitre, texte: videTexte, lien: "/", libelle: "Découvrir des titres" })}
    </main>`,
  }))
}

pagesRouter.get("/favoris", async (req, res, next) => {
  try {
    const lignes = req.user ? db.listerFavoris(req.user.id) : []
    await pageListe(req, res, {
      actif: "favoris",
      nomPage: "favoris",
      titre: "Favoris",
      lignes,
      videTitre: "Aucun favori pour l'instant",
      videTexte: "Clique sur le cœur d'un film, d'une série ou d'un animé pour le retrouver ici.",
    })
  } catch (erreur) {
    next(erreur)
  }
})

pagesRouter.get("/liste", async (req, res, next) => {
  try {
    const lignes = req.user ? db.listerListe(req.user.id) : []
    await pageListe(req, res, {
      actif: "liste",
      nomPage: "liste",
      titre: "Ma liste",
      lignes,
      videTitre: "Ta liste est vide",
      videTexte: "Clique sur « + » sur une affiche pour garder un titre à regarder plus tard.",
    })
  } catch (erreur) {
    next(erreur)
  }
})

// --- Profil -----------------------------------------------------------------

pagesRouter.get("/profil", (req, res) => {
  if (!req.user) {
    return res.send(page({
      titre: "Profil",
      user: null,
      chemin: req.originalUrl,
      nomPage: "profil",
      corps: `<main class="page page-etroite">
        <h1>Profil</h1>
        ${etatVide({
          titre: "Connecte-toi pour voir ton profil",
          texte: "Ton avatar, tes compteurs et tes données sont liés à ton compte Discord.",
          lien: `/auth/discord?retour=${encodeURIComponent(req.originalUrl)}`,
          libelle: "Se connecter avec Discord",
        })}
      </main>`,
    }))
  }

  const comptes = db.compteurs(req.user.id)
  const membreDepuis = dateFr(req.user.created_at)
  const identite = `<h1>${e(req.user.username)}</h1>
          ${membreDepuis ? `<p class="vide">Membre depuis le ${e(membreDepuis)}</p>` : ""}`

  res.send(page({
    titre: "Profil",
    user: req.user,
    chemin: req.originalUrl,
    nomPage: "profil",
    corps: `<main class="page page-etroite">
      <section class="profil-entete">
        ${avatarAvecDecoration(req.user, { taille: 96, cdn: 128, classe: "avatar-geant", alt: `Avatar de ${req.user.username}` })}
        ${avecNameplate(req.user, identite)}
      </section>

      <div class="compteurs">
        <a class="compteur" href="/favoris"><b>${comptes.favoris}</b><span>favoris</span></a>
        <a class="compteur" href="/liste"><b>${comptes.liste}</b><span>dans ma liste</span></a>
        <span class="compteur"><b>${comptes.vus}</b><span>titres terminés</span></span>
      </div>

      <details class="zone-danger">
        <summary>Supprimer mon compte et mes données</summary>
        <p>Cette action supprime définitivement ton compte, tes favoris, ta liste de lecture, ton historique et tes titres récemment vus. Aucune récupération n'est possible.</p>
        <form method="post" action="/profil/supprimer" data-suppression>
          <label class="champ">
            <span>Écris <b>SUPPRIMER</b> pour confirmer</span>
            <input type="text" name="confirmation" autocomplete="off" required pattern="SUPPRIMER">
          </label>
          <p class="form-msg" role="alert"></p>
          <button class="danger" type="submit">Supprimer définitivement</button>
        </form>
      </details>
    </main>`,
  }))
})

pagesRouter.post("/profil/supprimer", (req, res) => {
  if (!req.user) return res.redirect("/")

  const confirmation = String(req.body?.confirmation ?? "").trim()
  if (confirmation !== "SUPPRIMER") {
    return res.status(400).send(pageErreur(
      400,
      "Suppression non confirmée",
      "Écris exactement SUPPRIMER pour confirmer la suppression de ton compte.",
      { user: req.user, chemin: "/profil" },
    ))
  }

  db.supprimerUtilisateur(req.user.id)
  effacerSession(res)
  res.redirect("/?compte=supprime")
})

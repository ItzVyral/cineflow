import express from "express"
import * as db from "../db.js"
import {
  IMG,
  avisTitre,
  catalogue,
  disponibilite,
  disponibilitesLot,
  episodes,
  fiche,
  jetonSansPub,
  nouveautes,
  rechercherHeiwa,
  saisonTmdb,
  titreHeiwa,
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
  badgesDiscord,
  banniereUrl,
  boutonsMedia,
  carte,
  chipsInfos,
  couleurAccent,
  duree,
  e,
  etatVide,
  page,
  pageErreur,
  pagination,
  tagServeur,
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

async function etatsUtilisateur(user) {
  if (!user) return { favoris: new Set(), liste: new Set() }
  const [favoris, liste] = await Promise.all([db.idsFavoris(user.id), db.idsListe(user.id)])
  return { favoris, liste }
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
  const date = sqlite instanceof Date ? sqlite : new Date(sqlite)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

async function blocContinuer(user, etats, lignes) {
  lignes ??= await db.historiqueContinu(user.id, 12)
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
      sousTitre: estSerie ? `S${String(ligne.season).padStart(2, "0")}E${String(ligne.episode).padStart(2, "0")}` : "",
      lien: estSerie ? `/serie/${ligne.tmdb_id}/${ligne.season}/${ligne.episode}` : null,
    })
  })).join("")

  if (!cartes) return ""
  return `<h2>Continuer de regarder</h2><div class="rang">${cartes}</div>`
}

/** Rangée des derniers titres consultés par un compte connecté. */
async function blocRecemmentVus(user, etats, exclure = new Set()) {
  const lignes = await db.listerVues(user.id, 12)
  const cartes = (await parLots(lignes, async (ligne) => {
    const cle = cleMedia(ligne.media_type, ligne.tmdb_id)
    if (exclure.has(cle)) return ""
    try {
      const media = await fiche(ligne.media_type, ligne.tmdb_id)
      return carte(media, {
        favori: etats.favoris.has(cle),
        liste: etats.liste.has(cle),
      })
    } catch {
      return ""
    }
  })).join("")

  if (!cartes) return ""
  return `<h2>Récemment vus</h2><div class="rang">${cartes}</div>`
}

// Rempli côté navigateur pour les visiteurs non connectés (voir public/app.js).
const blocRecentsLocaux = `<section data-recents-locaux hidden>
  <h2>Récemment vus</h2>
  <div class="rang"></div>
</section>`

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
    poster_path: null,
  }))
}

// --- Lecteur ----------------------------------------------------------------

const LANGUES_LISIBLES = {
  vf: "VF",
  vostfr: "VOSTFR",
  vo: "VO",
  vovf: "VO/VF",
  multi: "Multi",
}

const DESCRIPTIONS_LANGUES = {
  vf: "Version française",
  vostfr: "Version originale sous-titrée en français",
  vo: "Version originale",
  vovf: "Version originale et version française",
  multi: "Plusieurs langues",
}

const PREFIXE_EMBED = "https://heiwastream.fr/embed"

function codeLangue(langue) {
  if (typeof langue === "string") return langue.trim().toLowerCase()
  if (!langue || typeof langue !== "object") return ""
  const valeur = langue.code ?? langue.lang ?? langue.language ?? langue.id ?? langue.name ?? ""
  return String(valeur).trim().toLowerCase()
}

function libelleLangue(code) {
  return LANGUES_LISIBLES[code] ?? String(code).toUpperCase()
}

function languesUniques(liste) {
  const vues = new Set()
  const langues = []
  for (const element of Array.isArray(liste) ? liste : []) {
    const code = codeLangue(element)
    if (!code || vues.has(code)) continue
    vues.add(code)
    langues.push({
      code,
      libelle: libelleLangue(code),
      description: DESCRIPTIONS_LANGUES[code] ?? "",
    })
  }
  return langues
}

function languesDeDispo(dispo, secours = []) {
  const source = Array.isArray(dispo?.languages) && dispo.languages.length
    ? dispo.languages
    : secours
  return languesUniques(source)
}

function langueActive(langues, demandee) {
  const code = codeLangue(demandee)
  return langues.find((langue) => langue.code === code)?.code ?? langues[0]?.code ?? ""
}

function codeEpisode(saison, episode) {
  return `S${String(saison).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
}

function dureeMinutes(minutes) {
  const nombre = Number(minutes)
  if (!Number.isFinite(nombre) || nombre <= 0) return ""
  if (nombre < 60) return `${Math.round(nombre)} min`
  return `${Math.floor(nombre / 60)} h ${String(Math.round(nombre % 60)).padStart(2, "0")}`
}

function dateCourte(valeur) {
  if (!valeur) return ""
  const texte = String(valeur)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(texte)
    ? new Date(`${texte}T12:00:00Z`)
    : new Date(texte)
  if (Number.isNaN(date.getTime())) return texte
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
}

function initiales(nom) {
  return String(nom ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0]?.toUpperCase() ?? "")
    .join("")
}

function sourceLecteur(type, id, saison = null, episode = null) {
  const parametres = new URLSearchParams()
  parametres.set("site", process.env.HEIWA_SITE ?? "")

  if (type === "tv") {
    parametres.set("color", "ff0033")
    parametres.set("progress", "ff0033")
    parametres.set("bg", "101012")
    parametres.set("name", "CineFlow")
    parametres.set("room", "0")
    parametres.set("report", "1")
    parametres.set("episodes", "0")
  } else {
    parametres.set("report", "1")
  }

  const chemin = type === "tv"
    ? `${PREFIXE_EMBED}/tv/${id}/${saison}/${episode}`
    : `${PREFIXE_EMBED}/movie/${id}`

  return {
    base: `${chemin}?${parametres.toString()}`,
    avecReprise(langue = "", reprise = 0) {
      const url = new URL(this.base)
      if (type === "tv" && langue) url.searchParams.set("lang", langue)
      if (reprise > 0) url.searchParams.set("t", String(Math.floor(reprise)))
      return url.toString()
    },
  }
}

function normaliserListeEpisodes(listeHeiwa, tmdbSaison, saison) {
  const details = new Map(
    (Array.isArray(tmdbSaison?.episodes) ? tmdbSaison.episodes : [])
      .map((element) => [Number(element?.episode_number), element]),
  )

  return (Array.isArray(listeHeiwa) ? listeHeiwa : [])
    .map((element) => {
      const numero = Number(element?.episode)
      if (!Number.isInteger(numero) || numero <= 0) return null
      const detail = details.get(numero) ?? null
      return {
        saison: Number(element?.season) || saison,
        episode: numero,
        titre: detail?.name || element?.title || `Épisode ${numero}`,
        image: detail?.still_path ?? null,
        duree: Number(detail?.runtime) || null,
        date: detail?.air_date ?? element?.air_date ?? "",
        langues: languesUniques(element?.languages),
      }
    })
    .filter(Boolean)
}

async function donneesPanneau({
  media,
  saisonAffichee,
  actifSaison,
  actifEpisode,
  langueDemandee,
  dispo = null,
  sansPub = null,
}) {
  const id = Number(media.id)
  const saisons = listeSaisons(media)
    .filter((element) => Number(element.saison) > 0)
    .sort((a, b) => Number(a.saison) - Number(b.saison))
  const affichee = saisons.some((element) => Number(element.saison) === Number(saisonAffichee))
    ? Number(saisonAffichee)
    : (Number(saisons[0]?.saison) || Number(saisonAffichee) || 1)

  const [donneesEpisodes, tmdbSaison, dispoActif, jeton] = await Promise.all([
    episodes(id, affichee).catch(() => null),
    saisonTmdb(id, affichee).catch(() => null),
    dispo ?? disponibilite("tv", id, actifSaison, actifEpisode).catch(() => null),
    sansPub === null ? jetonSansPub() : sansPub,
  ])

  const bloc = (donneesEpisodes?.seasons ?? []).find((element) => Number(element.season) === affichee)
  const liste = normaliserListeEpisodes(bloc?.episodes, tmdbSaison, affichee)
  const langues = languesDeDispo(
    dispoActif,
    liste.find((element) => Number(element.episode) === Number(actifEpisode))?.langues ?? [],
  )
  const langue = langueActive(langues, langueDemandee)

  // Le bouton « Suivant » dépend de l'épisode réellement en lecture, même quand
  // le panneau affiche une autre saison.
  let listeActive = liste
  if (affichee !== Number(actifSaison)) {
    const donneesActives = await episodes(id, actifSaison).catch(() => null)
    const blocActif = (donneesActives?.seasons ?? []).find((element) => Number(element.season) === Number(actifSaison))
    listeActive = normaliserListeEpisodes(blocActif?.episodes, null, Number(actifSaison))
  }

  const index = listeActive.findIndex((element) => Number(element.episode) === Number(actifEpisode))
  let suivant = null
  if (index >= 0 && index < listeActive.length - 1) {
    suivant = { saison: Number(actifSaison), episode: listeActive[index + 1].episode }
  } else if (index === listeActive.length - 1 && listeActive.length) {
    const prochaineSaison = saisons.find((element) => Number(element.saison) > Number(actifSaison))
    if (prochaineSaison) {
      const donneesSuivantes = await episodes(id, prochaineSaison.saison).catch(() => null)
      const blocSuivant = (donneesSuivantes?.seasons ?? [])
        .find((element) => Number(element.season) === Number(prochaineSaison.saison))
      const listeSuivante = normaliserListeEpisodes(blocSuivant?.episodes, null, prochaineSaison.saison)
      if (listeSuivante.length) {
        suivant = { saison: prochaineSaison.saison, episode: listeSuivante[0].episode }
      }
    }
  }

  return {
    saisons,
    affichee,
    liste,
    langues,
    langue,
    sansPub: !!jeton,
    suivant,
    actifSaison: Number(actifSaison),
    actifEpisode: Number(actifEpisode),
  }
}

function htmlPanneau(donnees, media) {
  const {
    saisons,
    affichee,
    liste,
    langues,
    langue,
    sansPub,
    suivant,
    actifSaison,
    actifEpisode,
  } = donnees
  const id = Number(media.id)

  const optionsSaisons = saisons.map((element) => `<option value="${element.saison}"
    ${Number(element.saison) === affichee ? "selected" : ""}>Saison ${element.saison}</option>`).join("")

  const episodes = liste.map((element) => {
    const actif = affichee === Number(actifSaison) && Number(element.episode) === Number(actifEpisode)
    const mini = element.image
      ? `<img loading="lazy" src="${e(`${IMG}w300${element.image}`)}" alt="" width="150" height="84">`
      : `<span class="episode-sans-image" aria-hidden="true">E${String(element.episode).padStart(2, "0")}</span>`
    const infos = [
      dureeMinutes(element.duree),
      element.langues.map((langueEpisode) => langueEpisode.libelle).join(" · "),
      dateCourte(element.date),
    ].filter(Boolean).join(" · ")

    return `<button type="button" class="episode${actif ? " on" : ""}" data-saison="${element.saison}"
      data-episode="${element.episode}" ${actif ? 'aria-current="true"' : ""}
      aria-label="Épisode ${element.episode}${element.titre ? ` : ${e(element.titre)}` : ""}">
      ${mini}
      <span class="episode-corps">
        <span class="episode-titre">E${String(element.episode).padStart(2, "0")} · ${e(element.titre)}</span>
        ${infos ? `<span class="episode-meta">${e(infos)}</span>` : ""}
      </span>
      ${actif ? `<span class="episode-actif">En lecture</span>` : ""}
    </button>`
  }).join("")

  const languesHtml = langues.length
    ? langues.map((element) => {
      const actif = element.code === langue
      return `<button type="button" class="langue${actif ? " on" : ""}" data-lang="${e(element.code)}"
        aria-pressed="${actif}">
        <span class="langue-code">${e(element.libelle)}</span>
        ${element.description ? `<span class="langue-desc">${e(element.description)}</span>` : ""}
        <span class="langue-etat">${actif ? "En lecture" : "Choisir"}</span>
      </button>`
    }).join("")
    : `<p class="vide panneau-vide">Aucune langue annoncée pour cet épisode.</p>`

  const libelleSuivant = suivant
    ? `Suivant · Saison ${suivant.saison} · E${String(suivant.episode).padStart(2, "0")} ›`
    : "Dernier épisode"

  return `<div class="panneau-entete">
    <p class="panneau-sur-titre">En lecture</p>
    <p class="panneau-titre">${e(media.titre)}</p>
    <p class="panneau-sous-titre">
      <span class="panneau-code" data-panneau-code>${e(codeEpisode(actifSaison, actifEpisode))}</span>
      ${sansPub ? '<span class="badge-sans-pub">Sans publicité</span>' : ""}
    </p>
  </div>

  <div class="panneau-onglets" role="tablist" aria-label="Détails de la série">
    <button type="button" class="panneau-onglet" role="tab" id="onglet-langues"
      aria-controls="panneau-langues" aria-selected="false" tabindex="-1">Langues · ${langues.length}</button>
    <button type="button" class="panneau-onglet on" role="tab" id="onglet-episodes"
      aria-controls="panneau-episodes" aria-selected="true" tabindex="0">Épisodes · ${liste.length}</button>
  </div>

  <div class="panneau-onglet-contenu" id="panneau-episodes" role="tabpanel" aria-labelledby="onglet-episodes">
    ${saisons.length > 1 ? `<label class="panneau-saison"><span>Saison</span>
      <select data-saison-panneau aria-label="Choisir la saison affichée">${optionsSaisons}</select></label>` : ""}
    <div class="episodes-liste">
      ${episodes || '<p class="vide panneau-vide">Aucun épisode disponible pour cette saison.</p>'}
    </div>
  </div>

  <div class="panneau-onglet-contenu" id="panneau-langues" role="tabpanel" aria-labelledby="onglet-langues" hidden>
    <div class="langues-liste">${languesHtml}</div>
  </div>

  <div class="panneau-pied">
    <button type="button" class="suivant" data-suivant
      ${suivant ? `data-saison="${suivant.saison}" data-episode="${suivant.episode}"` : "disabled"}>
      ${e(libelleSuivant)}
    </button>
  </div>`
}

function barreLecteur(media, { estSerie, saison, episode }) {
  return `<div class="barre-lecteur">
    <button type="button" class="barre-retour" data-retour>‹ Retour</button>
    <p class="barre-titre"><b data-titre-lecteur>${e(media.titre)}</b>
      ${estSerie ? `<span class="barre-code" data-code-episode>${e(codeEpisode(saison, episode))}</span>` : ""}</p>
    <button type="button" class="barre-copier" data-copier aria-label="Copier le lien de cette page">Copier le lien</button>
    <span class="sr-only" data-copie-msg role="status" aria-live="polite"></span>
  </div>`
}

function blocIndisponible({ type, id, saison, episode, estSerie, verificationImpossible = false }) {
  if (verificationImpossible) {
    return `<div class="indisponible">
      <p class="indisponible-titre">Disponibilité inconnue</p>
      <p>Impossible de vérifier la disponibilité pour le moment. Recharge la page dans un instant.</p>
    </div>`
  }

  const libelle = estSerie ? "Demander cet épisode" : "Demander ce film"
  return `<div class="indisponible">
    <p class="indisponible-titre">Pas encore disponible</p>
    <p>${estSerie ? "Cet épisode" : "Ce film"} n'est pas encore proposé par HeiwaStream. Tu peux envoyer une demande pour le voir arriver sur la plateforme.</p>
    <form class="demande" data-demande data-type="${e(type)}" data-id="${id}"
      ${estSerie ? `data-saison="${saison}" data-episode="${episode}"` : ""}>
      <button class="btn-demande" type="submit">${libelle}</button>
      <p class="form-msg" role="status" aria-live="polite"></p>
    </form>
    <p class="demande-note">Trois demandes par visiteur et par jour au maximum.</p>
  </div>`
}

function boutonBandeAnnonce(cle) {
  return cle
    ? `<button type="button" class="btn-ligne btn-bande-annonce" data-bande-annonce="${e(cle)}">▶ Bande-annonce</button>`
    : ""
}

function modaleBandeAnnonce(cle) {
  if (!cle) return ""
  return `<div class="modale" data-modale hidden>
    <div class="modale-fond" data-fermer></div>
    <div class="modale-boite" role="dialog" aria-modal="true" aria-labelledby="titre-bande-annonce">
      <button type="button" class="modale-fermer" data-fermer aria-label="Fermer la bande-annonce">×</button>
      <h2 class="sr-only" id="titre-bande-annonce">Bande-annonce</h2>
      <div class="modale-video"><iframe data-video-bande-annonce title="Bande-annonce" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
    </div>
  </div>`
}

function blocCasting(casting) {
  if (!Array.isArray(casting) || !casting.length) return ""
  const personnes = casting.map((personne) => {
    const photo = personne.photo
      ? `<img loading="lazy" src="${e(`${IMG}w185${personne.photo}`)}" alt="Portrait de ${e(personne.nom)}" width="96" height="96">`
      : `<span class="personne-sans-photo" aria-hidden="true">${e(initiales(personne.nom))}</span>`
    return `<article class="personne">
      <span class="personne-photo">${photo}</span>
      <p class="personne-nom">${e(personne.nom)}</p>
      ${personne.personnage ? `<p class="personne-role">${e(personne.personnage)}</p>` : ""}
    </article>`
  }).join("")

  return `<h2>Casting</h2><div class="casting-rang">${personnes}</div>`
}

function blocEquipe(media, estSerie) {
  const lignes = []
  if (estSerie && media.createurs?.length) lignes.push(["Création", media.createurs])
  if (media.realisateurs?.length) lignes.push(["Réalisation", media.realisateurs])
  if (media.scenaristes?.length) lignes.push(["Scénario", media.scenaristes])
  if (!lignes.length) return ""
  return `<dl class="equipe">${lignes.map(([libelle, noms]) =>
    `<div><dt>${e(libelle)}</dt><dd>${e(noms.join(", "))}</dd></div>`).join("")}</dl>`
}

function blocSaisons(media, saisonActive) {
  const saisons = (media.saisonListe ?? []).filter((element) => Number(element.saison) > 0)
  if (!saisons.length) return ""

  const cartes = saisons.map((saison) => {
    const active = Number(saison.saison) === Number(saisonActive)
    const affiche = saison.poster_path
      ? `<img loading="lazy" src="${e(`${IMG}w185${saison.poster_path}`)}" alt="Affiche de la saison ${saison.saison}" width="185" height="278">`
      : `<span class="saison-sans-affiche" aria-hidden="true">S${saison.saison}</span>`
    return `<a class="saison-carte${active ? " on" : ""}" href="/serie/${media.id}/${saison.saison}"
      ${active ? 'aria-current="page"' : ""}>
      ${affiche}
      <span class="saison-nom">Saison ${saison.saison}</span>
      <span class="saison-meta">${saison.episodes ? `${saison.episodes} épisode${saison.episodes > 1 ? "s" : ""}` : "Épisodes à venir"}</span>
      ${saison.date ? `<span class="saison-meta">${e(dateCourte(saison.date))}</span>` : ""}
    </a>`
  }).join("")

  return `<h2>Saisons</h2><div class="saisons-grille">${cartes}</div>`
}

function blocTitresSimilaires(similaires, etats) {
  if (!similaires.length) return ""
  const cartes = similaires.map((media) => carte(media, {
    favori: etats.favoris.has(cleMedia(media.type, media.id)),
    liste: etats.liste.has(cleMedia(media.type, media.id)),
  })).join("")
  return `<h2>Titres similaires</h2><div class="rang">${cartes}</div>`
}

async function similairesDisponibles(media) {
  const recommandations = Array.isArray(media.recommandations) ? media.recommandations : []
  if (!recommandations.length) return []
  try {
    const dispos = await disponibilitesLot(media.type, recommandations.map((element) => element.id))
    return recommandations
      .filter((element) => dispos.get(Number(element.id))?.available === true)
      .slice(0, 12)
  } catch {
    return []
  }
}

function blocInfosMedia(media, {
  type,
  estSerie,
  saisonActive,
  favori,
  dansListe,
  similaires,
  etats,
}) {
  const annee = media.date?.slice(0, 4)
  const note = Number(media.note)
  const genres = (media.genres ?? []).map((genre) => `<span class="chip">${e(genre)}</span>`).join("")
  const chips = [
    annee,
    estSerie
      ? (media.saisons ? `${media.saisons} saison${media.saisons > 1 ? "s" : ""}` : "")
      : duree(media.runtime),
    Number.isFinite(note) && note > 0 ? `★ ${note.toFixed(1)}` : "",
  ].filter(Boolean).map((contenu) => `<span class="chip">${e(contenu)}</span>`).join("")

  const affiche = media.poster_path
    ? `<img src="${e(`${IMG}w342${media.poster_path}`)}" alt="Affiche de ${e(media.titre)}" width="342" height="513">`
    : `<span class="fiche-sans-affiche">${e(media.titre)}</span>`

  return `<section class="fiche" aria-labelledby="titre-fiche">
    <div class="fiche-principale">
      <div class="fiche-affiche">${affiche}</div>
      <div class="fiche-texte">
        <h1 id="titre-fiche">${e(media.titre)}</h1>
        ${media.titreOriginal && media.titreOriginal !== media.titre
          ? `<p class="titre-original">Titre original : ${e(media.titreOriginal)}</p>` : ""}
        <div class="chips">${chips}${genres}</div>
        ${media.slogan ? `<p class="slogan">« ${e(media.slogan)} »</p>` : ""}
        <p class="resume">${e(media.overview || "Synopsis indisponible.")}</p>
        ${boutonsMedia(type, media.id, favori, dansListe, {
          extra: boutonBandeAnnonce(media.bandeAnnonce),
        })}
        ${blocEquipe(media, estSerie)}
      </div>
    </div>
    ${blocCasting(media.casting)}
    ${estSerie ? blocSaisons(media, saisonActive) : ""}
    ${blocTitresSimilaires(similaires, etats)}
  </section>`
}

// --- Accueil ----------------------------------------------------------------

pagesRouter.get("/", async (req, res, next) => {
  try {
    const etats = await etatsUtilisateur(req.user)
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
        <span class="slide-flou" aria-hidden="true"></span>
        <div class="txt"><div class="gl">${titre}</div>
        <div class="gl"><div class="chips">${chipsInfos(media)}</div></div><div class="gl"><p>${e(media.overview)}</p></div>
        <a class="play" href="${media.type === "tv" ? `/serie/${media.id}` : `/film/${media.id}`}">▶ Lecture</a></div></article>`
    }).join("")

    const cartes = medias.map((media) => carte(media, {
      favori: etats.favoris.has(cleMedia(media.type, media.id)),
      liste: etats.liste.has(cleMedia(media.type, media.id)),
    })).join("")

    const continuerLignes = req.user ? await db.historiqueContinu(req.user.id, 12) : []
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

// --- Lecteur ----------------------------------------------------------------

function entierPositif(valeur) {
  const nombre = Number(valeur)
  return Number.isSafeInteger(nombre) && nombre > 0 ? nombre : null
}

function introuvable(req, res, message = "Ce titre n'existe pas.") {
  return res.status(404).send(pageErreur(
    404,
    "Titre introuvable",
    message,
    { user: req.user, chemin: req.originalUrl },
  ))
}

function repriseLisible(reprise, saison, episode, estSerie) {
  if (!reprise) return ""
  return `<p class="reprise-info">Reprise à ${Math.floor(reprise / 60)} min ${String(reprise % 60).padStart(2, "0")} s${estSerie ? ` (${codeEpisode(saison, episode)})` : ""}.</p>`
}

async function rendreLecture(req, res, next, {
  type,
  id,
  saison = null,
  episode = null,
  repriseAuto = false,
}) {
  let media
  try {
    media = await fiche(type, id)
  } catch (erreur) {
    if (erreur?.status === 404) return introuvable(req, res)
    return next(erreur)
  }

  // Vue enregistrée côté serveur pour les comptes connectés. Les visiteurs
  // utilisent localStorage (voir public/app.js).
  if (req.user) {
    try {
      await db.enregistrerVue(req.user.id, type, id)
    } catch (erreur) {
      console.warn(`[CineFlow] Vue non enregistrée : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
    }
  }

  const estSerie = type === "tv"
  const historique = req.user ? await db.progression(req.user.id, type, id) : null
  const memeEpisode = !estSerie
    || (Number(historique?.season) === Number(saison) && Number(historique?.episode) === Number(episode))
  const dejaVu = historique && historique.duration > 0 && historique.progress / historique.duration < 0.95
  const reprise = dejaVu && memeEpisode && historique.progress > 10
    ? Math.floor(historique.progress)
    : 0

  const [dispo, avisHtml] = await Promise.all([
    disponibilite(type, id, estSerie ? saison : null, estSerie ? episode : null).catch(() => null),
    blocAvis(type, id),
  ])

  const disponible = dispo?.available === true
  const donneesLecteurPanneau = estSerie
    ? await donneesPanneau({
      media,
      saisonAffichee: saison,
      actifSaison: saison,
      actifEpisode: episode,
      langueDemandee: req.query.lang,
      dispo,
    })
    : null
  const langue = donneesLecteurPanneau?.langue ?? ""
  const source = sourceLecteur(type, id, saison, episode)
  const sourceFinale = source.avecReprise(langue, reprise)

  const iframe = disponible
    ? `<iframe data-lecteur data-media="${e(type)}" data-id="${id}"
        ${estSerie ? `data-season="${saison}" data-episode="${episode}" data-lang="${e(langue)}"` : ""}
        data-reprise="${reprise}" data-src-base="${e(source.base)}" src="${e(sourceFinale)}"
        allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
        title="Lecteur HeiwaStream pour ${e(estSerie ? `${media.titre} ${codeEpisode(saison, episode)}` : media.titre)}"></iframe>`
    : blocIndisponible({
      type,
      id,
      saison,
      episode,
      estSerie,
      verificationImpossible: !dispo,
    })

  const panneau = estSerie
    ? `<aside class="panneau" aria-label="Épisodes et langues de la série">
        <div class="panneau-contenu" data-panneau-contenu>${htmlPanneau(donneesLecteurPanneau, media)}</div>
      </aside>`
    : ""

  const favori = req.user ? await db.estFavori(req.user.id, type, id) : false
  const dansListe = req.user ? await db.estDansListe(req.user.id, type, id) : false
  const etats = await etatsUtilisateur(req.user)
  const similaires = await similairesDisponibles(media)

  const fond = media.backdrop_path ? ` style="--bg:url(${e(`${IMG}original${media.backdrop_path}`)})"` : ""
  const afficheVue = media.poster_path ? `${IMG}w342${media.poster_path}` : ""
  const kindVue = media.kind ?? (estSerie ? "series" : "movie")
  const titrePage = estSerie ? `${media.titre} · ${codeEpisode(saison, episode)}` : media.titre

  res.send(page({
    titre: titrePage,
    user: req.user,
    chemin: req.originalUrl,
    nomPage: "lecture",
    description: media.overview?.slice(0, 160),
    scripts: ["/app.js", "/player.js"],
    corps: `<main class="lecture"${fond} data-lecture data-type="${e(type)}" data-id="${id}"
      ${estSerie ? `data-saison="${saison}" data-episode="${episode}"` : ""}
      data-titre="${e(media.titre)}" data-reprise-auto="${repriseAuto ? 1 : 0}"
      data-vue-type="${e(type)}" data-vue-id="${id}"
      data-vue-titre="${e(media.titre)}" data-vue-affiche="${e(afficheVue)}" data-vue-kind="${e(kindVue)}">
      <section class="lecteur-zone" aria-label="Lecteur vidéo">
        <div class="lecteur-cadre">
          ${barreLecteur(media, { estSerie, saison, episode })}
          <div class="lecteur-corps${estSerie ? " avec-panneau" : ""}">
            <div class="lecteur-video">${iframe}</div>
            ${panneau}
          </div>
          <div class="suite-lecture" data-suite hidden role="status" aria-live="polite">
            <span data-suite-texte>Épisode suivant dans 5 s…</span>
            <button type="button" class="btn-ligne" data-suite-maintenant>Lire maintenant</button>
            <button type="button" class="btn-ligne" data-suite-annuler>Annuler</button>
          </div>
        </div>
        ${repriseLisible(reprise, saison, episode, estSerie)}
      </section>

      ${blocInfosMedia(media, {
        type,
        estSerie,
        saisonActive: saison,
        favori,
        dansListe,
        similaires,
        etats,
      })}
      ${avisHtml}
      ${formulaireAvis(type, id, req.user, req.originalUrl)}
      ${modaleBandeAnnonce(media.bandeAnnonce)}
    </main>`,
  }))
}

pagesRouter.get("/film/:id", async (req, res, next) => {
  const id = entierPositif(req.params.id)
  if (!id) return introuvable(req, res)
  try {
    await rendreLecture(req, res, next, { type: "movie", id })
  } catch (erreur) {
    next(erreur)
  }
})

// Le panneau est déclaré avant la route générique : `panneau` ne doit pas être
// interprété comme un numéro d'épisode.
pagesRouter.get("/serie/:id/:saison/panneau", async (req, res, next) => {
  const id = entierPositif(req.params.id)
  const saison = entierPositif(req.params.saison)
  if (!id || !saison) return res.status(404).json({ erreur: "Série introuvable." })

  try {
    const media = await fiche("tv", id)
    const actifSaison = entierPositif(req.query.actifSaison) ?? saison
    const actifEpisode = entierPositif(req.query.actifEpisode) ?? 0
    const donnees = await donneesPanneau({
      media,
      saisonAffichee: saison,
      actifSaison,
      actifEpisode,
      langueDemandee: req.query.lang,
    })

    res.set("Cache-Control", "no-store")
    return res.json({
      html: htmlPanneau(donnees, media),
      saison: donnees.affichee,
      actifSaison: donnees.actifSaison,
      actifEpisode: donnees.actifEpisode,
      langue: donnees.langue,
    })
  } catch (erreur) {
    if (erreur?.status === 404) return res.status(404).json({ erreur: "Série introuvable." })
    return next(erreur)
  }
})

pagesRouter.get("/serie/:id/:saison/:episode", async (req, res, next) => {
  const id = entierPositif(req.params.id)
  const saison = entierPositif(req.params.saison)
  const episode = entierPositif(req.params.episode)
  if (!id || !saison || !episode) return introuvable(req, res)

  try {
    await rendreLecture(req, res, next, {
      type: "tv",
      id,
      saison,
      episode,
      repriseAuto: req.query.reprise === "1",
    })
  } catch (erreur) {
    next(erreur)
  }
})

pagesRouter.get("/serie/:id/:saison", async (req, res, next) => {
  const id = entierPositif(req.params.id)
  const saison = entierPositif(req.params.saison)
  if (!id || !saison) return introuvable(req, res)

  let episode = 1
  try {
    const donnees = await episodes(id, saison)
    const bloc = (donnees?.seasons ?? []).find((element) => Number(element.season) === saison)
    const premier = (bloc?.episodes ?? []).find((element) => entierPositif(element?.episode))
    if (premier) episode = Number(premier.episode)
  } catch (erreur) {
    if (erreur?.status === 404) return introuvable(req, res, "Cette saison n'existe pas.")
  }

  const parametres = new URLSearchParams()
  if (typeof req.query.lang === "string" && req.query.lang) parametres.set("lang", req.query.lang)
  const suffixe = parametres.toString() ? `?${parametres.toString()}` : ""
  res.redirect(302, `/serie/${id}/${saison}/${episode}${suffixe}`)
})

pagesRouter.get("/serie/:id", async (req, res, next) => {
  const id = entierPositif(req.params.id)
  if (!id) return introuvable(req, res)

  // Un compte connecté reprend directement son dernier épisode.
  if (req.user) {
    const historique = await db.progression(req.user.id, "tv", id)
    if (entierPositif(historique?.season) && entierPositif(historique?.episode)) {
      const parametres = new URLSearchParams()
      if (typeof req.query.lang === "string" && req.query.lang) parametres.set("lang", req.query.lang)
      const suffixe = parametres.toString() ? `?${parametres.toString()}` : ""
      return res.redirect(302, `/serie/${id}/${historique.season}/${historique.episode}${suffixe}`)
    }
  }

  let media
  try {
    media = await fiche("tv", id)
  } catch (erreur) {
    if (erreur?.status === 404) return introuvable(req, res)
    return next(erreur)
  }

  const saisons = listeSaisons(media)
    .filter((element) => Number(element.saison) > 0)
    .sort((a, b) => Number(a.saison) - Number(b.saison))
  const saison = Number(saisons[0]?.saison) || 1
  let episode = 1
  try {
    const donnees = await episodes(id, saison)
    const bloc = (donnees?.seasons ?? []).find((element) => Number(element.season) === saison)
    const premier = (bloc?.episodes ?? []).find((element) => entierPositif(element?.episode))
    if (premier) episode = Number(premier.episode)
  } catch {
    // Le premier épisode reste le point de départ : la page indiquera que
    // l'épisode n'est pas encore disponible.
  }

  // `reprise=1` autorise player.js à remplacer cet épisode par le dernier
  // épisode regardé dans le navigateur (visiteur non connecté).
  res.redirect(302, `/serie/${id}/${saison}/${episode}?reprise=1`)
})

// Ancienne adresse : conservée pour les liens déjà partagés.
pagesRouter.get("/titre/:type/:id", (req, res) => {
  const type = req.params.type
  const id = entierPositif(req.params.id)
  if (!estTypeMedia(type) || !id) {
    return res.status(404).send(pageErreur(
      404,
      "Titre introuvable",
      "Ce titre n'existe pas.",
      { user: req.user, chemin: req.originalUrl },
    ))
  }

  const parametres = new URLSearchParams()
  if (typeof req.query.lang === "string" && req.query.lang) parametres.set("lang", req.query.lang)
  const suffixe = parametres.toString() ? `?${parametres.toString()}` : ""

  if (type === "movie") {
    return res.redirect(301, `/film/${id}${suffixe}`)
  }

  const saison = entierPositif(req.query.season)
  const episode = entierPositif(req.query.episode)
  const cible = saison && episode
    ? `/serie/${id}/${saison}/${episode}`
    : saison
      ? `/serie/${id}/${saison}`
      : `/serie/${id}`
  return res.redirect(301, `${cible}${suffixe}`)
})

// --- Recherche --------------------------------------------------------------

pagesRouter.get("/recherche", async (req, res, next) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : ""
  const filtre = filtreRecherche(req.query.type)
  const etats = await etatsUtilisateur(req.user)

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
  const etats = await etatsUtilisateur(req.user)
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
  const etats = await etatsUtilisateur(req.user)
  const icone = actif === "favoris"
    ? '<path d="M12 20.5s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.7-7.5 10.1-7.5 10.1z"/>'
    : '<path d="M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6"/>'

  // Grand état vide : repères aux angles, affiches fantômes en fond.
  const vide = ({ titreVide, texte, lien, libelle }) => `<section class="pl-vide">
        <span class="pf-croix pf-croix-hg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-hd" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bd" aria-hidden="true"></span>
        <div class="pl-fantomes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <span class="pl-vide-icone" aria-hidden="true"><svg viewBox="0 0 24 24">${icone}</svg></span>
        <p class="pl-vide-titre">${e(titreVide)}</p>
        <p class="pl-vide-texte">${e(texte)}</p>
        <a class="play" href="${e(lien)}">${e(libelle)}</a>
      </section>`

  const entete = (compte) => `<div class="pl-tete">
        <div>
          <p class="pl-etiquette">( ${titre} )</p>
          <h1 class="pl-titre">${titre}</h1>
        </div>
        ${compte == null ? "" : `<p class="pl-compte" data-pl-compte="${compte}">${compte} titre${compte > 1 ? "s" : ""}</p>`}
      </div>`

  if (!req.user) {
    return res.send(page({
      titre,
      actif,
      user: null,
      chemin: req.originalUrl,
      nomPage,
      corps: `<main class="page page-liste">
        ${entete(null)}
        ${vide({
          titreVide: "Connecte-toi pour retrouver tes titres",
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
    corps: `<main class="page page-liste">
      ${entete(medias.length)}
      ${medias.length
        ? `<div class="grille">${medias.map((media) => carte(media, {
          favori: etats.favoris.has(cleMedia(media.type, media.id)),
          liste: etats.liste.has(cleMedia(media.type, media.id)),
        })).join("")}</div>`
        : vide({ titreVide: videTitre, texte: videTexte, lien: "/catalogue", libelle: "Découvrir des titres" })}
    </main>`,
  }))
}

pagesRouter.get("/favoris", async (req, res, next) => {
  try {
    const lignes = req.user ? await db.listerFavoris(req.user.id) : []
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
    const lignes = req.user ? await db.listerListe(req.user.id) : []
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

pagesRouter.get("/mentions-legales", (req, res) => {
  res.send(page({
    titre: "Mentions légales",
    user: req.user,
    chemin: req.originalUrl,
    nomPage: "mentions",
    description: "Mentions légales de CineFlow : éditeur, hébergement, données personnelles et crédits.",
    corps: `<main class="page page-etroite page-legal">
      <p class="pl-etiquette">( Informations )</p>
      <h1 class="pl-titre">Mentions légales</h1>

      <h2>Éditeur</h2>
      <p>CineFlow est un projet personnel, non commercial, édité par ItzVyral. Le site ne vend rien, n'affiche aucune publicité et ne génère aucun revenu. Contact : via le serveur Discord ou le dépôt GitHub indiqués en bas de page.</p>

      <h2>Hébergement</h2>
      <p>Le site est hébergé par Render (Render Services, Inc., San Francisco, États-Unis). La base de données est hébergée par Supabase.</p>

      <h2>Contenus</h2>
      <p>CineFlow n'héberge aucune vidéo. Les fiches, affiches et images proviennent de TMDB. Le lecteur est fourni par un service tiers, intégré dans la page. Ce site utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.</p>
      <p>Pour signaler un contenu, utilise le drapeau de signalement du lecteur ou contacte-nous sur Discord.</p>

      <h2>Données personnelles</h2>
      <p>La connexion se fait avec Discord. CineFlow enregistre uniquement ton identifiant Discord, ton pseudo et les éléments publics de ton profil (avatar, décoration, bannière, badges), ainsi que tes favoris, ta liste, ta progression de lecture et tes titres récemment vus. Aucune adresse e-mail n'est collectée.</p>
      <p>Tu peux supprimer ton compte et toutes ces données à tout moment depuis la page <a class="lien" href="/profil">Profil</a>.</p>

      <h2>Cookies</h2>
      <p>Le site utilise seulement des cookies nécessaires à son fonctionnement : la session de connexion et un identifiant technique anonyme pour limiter les abus. Aucun cookie publicitaire ni traceur tiers n'est déposé par CineFlow.</p>
    </main>`,
  }))
})

pagesRouter.get("/profil", async (req, res) => {
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

  const [comptes, etats] = await Promise.all([db.compteurs(req.user.id), etatsUtilisateur(req.user)])
  const recents = await blocRecemmentVus(req.user, etats).catch(() => "")
  const membreDepuis = dateFr(req.user.created_at)
  // Le grand pseudo est posé sur la nameplate Discord (animée) quand il y en a une.
  const titre = avecNameplate(req.user, `<h1>${e(req.user.username)}</h1>`)
  const banniere = banniereUrl(req.user)
  const accent = couleurAccent(req.user)
  const tag = tagServeur(req.user)
  const badges = badgesDiscord(req.user)
  const compte = [
    req.user.handle ? `<span class="pf-handle">@${e(req.user.handle)}</span>` : "",
    tag ? `<span class="pf-tag" title="Tag de serveur Discord">${tag.badge ? `<img src="${e(tag.badge)}" alt="" aria-hidden="true" width="14" height="14">` : ""}${e(tag.tag)}</span>` : "",
  ].filter(Boolean).join('<span class="pf-point" aria-hidden="true">•</span>')

  // Colonne de statistique : index, nombre (odomètre côté client), libellé qui roule.
  const stat = (index, valeur, libelle, href) => {
    const nombre = Number(valeur) || 0
    const contenu = `<span class="pf-index">${index}</span>
        <b class="pf-nombre" data-compte="${nombre}">${nombre}</b>
        <span class="pf-libelle"><span class="roule"><span>${libelle}</span><span aria-hidden="true">${libelle}</span></span></span>`
    return href
      ? `<a class="pf-stat" href="${href}">${contenu}<span class="pf-fleche" aria-hidden="true"><i>→</i><i>→</i></span></a>`
      : `<div class="pf-stat">${contenu}</div>`
  }

  res.send(page({
    titre: "Profil",
    user: req.user,
    chemin: req.originalUrl,
    nomPage: "profil",
    corps: `<main class="page page-profil">
      <section class="pf" aria-label="Ton profil">
        <span class="pf-croix pf-croix-hg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-hd" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bd" aria-hidden="true"></span>
        <div class="pf-banniere${banniere ? "" : " pf-banniere-vide"}"${accent ? ` style="--pf-accent:${e(accent)}"` : ""}>
          ${banniere ? `<img src="${e(banniere)}" alt="" aria-hidden="true">` : ""}
        </div>
        <div class="pf-tete">
          <div class="pf-avatar">
            ${avatarAvecDecoration(req.user, { taille: 148, cdn: 256, classe: "avatar-geant", alt: `Avatar de ${req.user.username}` })}
          </div>
          <p class="pf-etiquette">
            <span class="pf-masque"><span>( Profil )</span></span>
            <span class="pf-masque"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 5.3A16.5 16.5 0 0 0 15.5 4l-.5 1a15 15 0 0 0-6 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C1.8 9.2 1.1 13 1.4 16.7A16.6 16.6 0 0 0 6.5 19.3l1-1.6a10.7 10.7 0 0 1-1.7-.8l.4-.3a11.8 11.8 0 0 0 11.6 0l.4.3a10.7 10.7 0 0 1-1.7.8l1 1.6a16.6 16.6 0 0 0 5.1-2.6c.4-4.3-.7-8-3-11.4zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>Connecté avec Discord</span></span>
          </p>
        </div>
        <div class="pf-nom">
          ${titre}
          ${compte ? `<p class="pf-compte">${compte}</p>` : ""}
          ${badges.length ? `<p class="pf-badges" aria-label="Badges Discord">${badges.map((b) => `<span class="pf-badge">${e(b)}</span>`).join("")}</p>` : ""}
          ${membreDepuis ? `<p class="vide">Membre depuis le ${e(membreDepuis)}</p>` : ""}
        </div>
        <span class="pf-filet" aria-hidden="true"></span>
      </section>

      <div class="pf-stats">
        ${stat("01", comptes.favoris, "Favoris", "/favoris")}
        ${stat("02", comptes.liste, "Ma liste", "/liste")}
        ${stat("03", comptes.vus, "Titres terminés")}
      </div>

      ${recents ? `<section class="profil-recents">${recents}</section>` : ""}

      <details class="zone-danger">
        <summary>Supprimer mon compte et mes données</summary>
        <div class="zone-danger-corps">
          <p>Cette action supprime définitivement ton compte, tes favoris, ta liste de lecture, ton historique et tes titres récemment vus. Aucune récupération n'est possible.</p>
          <form method="post" action="/profil/supprimer" data-suppression>
            <label class="champ">
              <span>Écris <b>SUPPRIMER</b> pour confirmer</span>
              <input type="text" name="confirmation" autocomplete="off" required pattern="SUPPRIMER">
            </label>
            <p class="form-msg" role="alert"></p>
            <button class="danger" type="submit">Supprimer définitivement</button>
          </form>
        </div>
      </details>
    </main>`,
  }))
})

pagesRouter.post("/profil/supprimer", async (req, res) => {
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

  await db.supprimerUtilisateur(req.user.id)
  effacerSession(res)
  res.redirect("/?compte=supprime")
})
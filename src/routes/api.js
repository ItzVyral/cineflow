import express from "express"
import * as db from "../db.js"
import { ErreurHeiwa, demanderTitre, publierAvis } from "../heiwa.js"
import { estTypeMedia } from "../media.js"

export const apiRouter = express.Router()

apiRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store")
  next()
})

function exigerConnexion(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ erreur: "Connexion requise.", code: "non_connecte" })
  }
  next()
}

/** Valide le couple `type` / `id` de l'URL et renvoie un identifiant sûr. */
function lireMedia(req, res) {
  const type = req.params.type
  if (!estTypeMedia(type)) {
    res.status(404).json({ erreur: "Titre introuvable." })
    return null
  }

  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(404).json({ erreur: "Titre introuvable." })
    return null
  }

  return { type, id }
}

// --- Favoris ----------------------------------------------------------------

apiRouter.post("/favoris/:type/:id", exigerConnexion, async (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  await db.ajouterFavori(req.user.id, media.type, media.id)
  res.json({ favori: true, ...media })
})

apiRouter.delete("/favoris/:type/:id", exigerConnexion, async (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  await db.retirerFavori(req.user.id, media.type, media.id)
  res.json({ favori: false, ...media })
})

// --- Liste de lecture -------------------------------------------------------

apiRouter.post("/liste/:type/:id", exigerConnexion, async (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  await db.ajouterListe(req.user.id, media.type, media.id)
  res.json({ liste: true, ...media })
})

apiRouter.delete("/liste/:type/:id", exigerConnexion, async (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  await db.retirerListe(req.user.id, media.type, media.id)
  res.json({ liste: false, ...media })
})

// --- Progression ------------------------------------------------------------

/** Entier borné, ou `null` quand la valeur envoyée est invalide. */
function entierBorne(valeur, max, defaut) {
  if (valeur == null || valeur === "") return defaut
  const nombre = Number(valeur)
  return Number.isInteger(nombre) && nombre >= 0 && nombre <= max ? nombre : null
}

apiRouter.put("/historique/:type/:id", exigerConnexion, async (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  const position = Number(req.body?.position)
  const dureeBrute = Number(req.body?.duration)

  if (!Number.isFinite(position) || position < 0) {
    return res.status(400).json({ erreur: "Position invalide." })
  }

  const season = entierBorne(req.body?.season, 1000, 0)
  const episode = entierBorne(req.body?.episode, 10000, 0)
  if (season == null || episode == null) {
    return res.status(400).json({ erreur: "Saison ou épisode invalide." })
  }

  const duration = Number.isFinite(dureeBrute) && dureeBrute > 0 ? Math.min(dureeBrute, 86_400) : 0
  const progress = Math.min(position, duration || position, 86_400)

  await db.enregistrerProgression(req.user.id, media.type, media.id, {
    progress,
    duration,
    season: media.type === "tv" ? season : 0,
    episode: media.type === "tv" ? episode : 0,
  })
  res.status(204).end()
})

// --- Avis -------------------------------------------------------------------

apiRouter.post("/avis/:type/:id", exigerConnexion, async (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  const rating = Number(req.body?.note)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ erreur: "La note doit être un nombre entier de 1 à 5." })
  }

  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 1000) : ""
  if (comment.length === 1) {
    return res.status(400).json({ erreur: "Le commentaire doit faire au moins 2 caractères." })
  }

  const spoiler = req.body?.spoiler === true

  try {
    // `reviewer` doit être stable pour un même visiteur : l'identifiant Discord convient.
    // HeiwaStream signe de toute façon les avis partenaires « Anonyme ».
    const resultat = await publierAvis({
      type: media.type,
      tmdb: media.id,
      rating,
      ...(comment ? { comment } : {}),
      spoiler,
      reviewer: `discord-${req.user.id}`,
    })

    if (resultat?.status === "already_reviewed") {
      return res.status(409).json({ erreur: "Tu as déjà noté ce titre.", statut: resultat.status })
    }

    const message = resultat?.status === "rating_published_text_pending"
      ? "Ta note est publiée. Ton commentaire sera relu par l'équipe avant publication."
      : "Merci, ton avis est publié."

    return res.json({ ok: true, statut: resultat?.status ?? "published", message })
  } catch (erreur) {
    if (!(erreur instanceof ErreurHeiwa)) {
      console.error("[CineFlow] Erreur inattendue lors de l'envoi d'un avis :", erreur)
      return res.status(502).json({ erreur: "Impossible d'envoyer l'avis pour le moment." })
    }

    if (erreur.corps?.status === "already_reviewed") {
      return res.status(409).json({ erreur: "Tu as déjà noté ce titre.", statut: "already_reviewed" })
    }

    if (erreur.status === 429) {
      return res.status(429).json({ erreur: "Trop d'avis envoyés. Réessaie dans un instant." })
    }

    if (erreur.status === 503 || erreur.corps?.error === "reviews_closed") {
      return res.status(503).json({ erreur: "Les avis sont momentanément fermés. Réessaie plus tard." })
    }

    if (erreur.status === 400) {
      return res.status(400).json({ erreur: "L'avis a été refusé. Vérifie la note et le commentaire." })
    }

    console.warn(`[CineFlow] Envoi d'avis refusé par HeiwaStream (${erreur.status}).`)
    return res.status(502).json({ erreur: "HeiwaStream n'a pas accepté l'avis. Réessaie plus tard." })
  }
})

// --- Demandes de titres -----------------------------------------------------

// La documentation HeiwaStream limite à 3 demandes par visiteur et par jour.
// Le compteur local évite d'envoyer des requêtes inutiles ; HeiwaStream reste
// l'autorité finale et renvoie 429 le cas échéant.
const demandesParVisiteur = new Map()
const MAX_DEMANDES_JOUR = 3

function jourCourant() {
  return new Date().toISOString().slice(0, 10)
}

function compterDemande(requester) {
  const jour = jourCourant()
  const garde = demandesParVisiteur.get(requester)
  if (!garde || garde.jour !== jour) {
    demandesParVisiteur.set(requester, { jour, nombre: 1 })
    return
  }
  garde.nombre += 1
}

function demandesRestantes(requester) {
  const garde = demandesParVisiteur.get(requester)
  if (!garde || garde.jour !== jourCourant()) return MAX_DEMANDES_JOUR
  return Math.max(0, MAX_DEMANDES_JOUR - garde.nombre)
}

function statutDemande(resultat) {
  return resultat?.status ?? resultat?.statut ?? null
}

apiRouter.post("/demande", async (req, res) => {
  const type = req.body?.type
  if (!estTypeMedia(type)) {
    return res.status(404).json({ erreur: "Titre introuvable." })
  }

  const id = Number(req.body?.id ?? req.body?.tmdb)
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(404).json({ erreur: "Titre introuvable." })
  }

  let season = null
  let episode = null
  if (type === "tv") {
    season = Number(req.body?.season)
    episode = Number(req.body?.episode)
    if (!Number.isInteger(season) || season <= 0 || !Number.isInteger(episode) || episode <= 0) {
      return res.status(400).json({ erreur: "Indique une saison et un épisode valides." })
    }
  }

  const requester = String(req.requester ?? "")
  if (!requester) {
    return res.status(400).json({ erreur: "Visiteur non identifié. Recharge la page." })
  }

  if (demandesRestantes(requester) <= 0) {
    return res.status(429).json({
      erreur: "Tu as atteint la limite de 3 demandes par jour. Réessaie demain.",
      statut: "limite_locale",
    })
  }

  try {
    const resultat = await demanderTitre({
      type,
      tmdb: id,
      season,
      episode,
      requester,
    })
    const statut = statutDemande(resultat)

    if (statut === "received" || statut === "joined") {
      compterDemande(requester)
      return res.json({
        ok: true,
        statut,
        message: statut === "joined"
          ? "Demande envoyée. D'autres personnes l'ont déjà demandée."
          : "Demande envoyée.",
      })
    }

    if (statut === "already_requested") {
      return res.json({
        ok: true,
        statut,
        message: "Ce titre a déjà été demandé.",
      })
    }

    if (statut === "already_available") {
      return res.json({
        ok: true,
        statut,
        recharger: true,
        message: "Ce titre est déjà disponible. La page va se recharger.",
      })
    }

    if (statut === "not_released") {
      return res.status(409).json({ erreur: "Pas encore sorti : la demande n'est pas encore possible.", statut })
    }

    if (statut === "requests_closed") {
      return res.status(503).json({ erreur: "Les demandes sont momentanément fermées. Réessaie plus tard.", statut })
    }

    if (statut === "recently_refused") {
      return res.status(409).json({ erreur: "Une demande pour ce titre a été refusée récemment.", statut })
    }

    if (statut === "not_requestable") {
      return res.status(400).json({ erreur: "Ce titre ne peut pas être demandé.", statut })
    }

    if (statut === "requests_banned") {
      return res.status(403).json({ erreur: "Les demandes sont bloquées pour ce visiteur.", statut })
    }

    if (statut === "not_found") {
      return res.status(404).json({ erreur: "Titre introuvable chez HeiwaStream.", statut })
    }

    console.warn(`[CineFlow] Demande refusée par HeiwaStream : ${statut ?? "statut inconnu"}.`)
    return res.status(502).json({ erreur: "HeiwaStream n'a pas accepté la demande. Réessaie plus tard." })
  } catch (erreur) {
    if (!(erreur instanceof ErreurHeiwa)) {
      console.error("[CineFlow] Erreur inattendue lors d'une demande :", erreur)
      return res.status(502).json({ erreur: "Impossible d'envoyer la demande pour le moment." })
    }

    const statut = statutDemande(erreur.corps)

    if (erreur.status === 429) {
      return res.status(429).json({
        erreur: "La limite de demandes est atteinte pour aujourd'hui. Réessaie demain.",
        statut: statut ?? "limite",
      })
    }

    if (statut === "already_available") {
      return res.json({
        ok: true,
        statut,
        recharger: true,
        message: "Ce titre est déjà disponible. La page va se recharger.",
      })
    }

    if (statut === "not_released") {
      return res.status(409).json({ erreur: "Pas encore sorti : la demande n'est pas encore possible.", statut })
    }

    if (statut === "requests_closed") {
      return res.status(503).json({ erreur: "Les demandes sont momentanément fermées. Réessaie plus tard.", statut })
    }

    console.warn(`[CineFlow] Demande refusée par HeiwaStream (${erreur.status}).`)
    return res.status(502).json({ erreur: "Impossible d'envoyer la demande pour le moment." })
  }
})

apiRouter.use((req, res) => {
  res.status(404).json({ erreur: "Route API introuvable." })
})

apiRouter.use((erreur, req, res, next) => {
  console.error("[CineFlow] Erreur API :", erreur)
  res.status(500).json({ erreur: "Erreur interne." })
})

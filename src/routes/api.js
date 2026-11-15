import express from "express"
import * as db from "../db.js"
import { ErreurHeiwa, publierAvis } from "../heiwa.js"
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

apiRouter.use(exigerConnexion)

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

apiRouter.post("/favoris/:type/:id", (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  db.ajouterFavori(req.user.id, media.type, media.id)
  res.json({ favori: true, ...media })
})

apiRouter.delete("/favoris/:type/:id", (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  db.retirerFavori(req.user.id, media.type, media.id)
  res.json({ favori: false, ...media })
})

// --- Liste de lecture -------------------------------------------------------

apiRouter.post("/liste/:type/:id", (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  db.ajouterListe(req.user.id, media.type, media.id)
  res.json({ liste: true, ...media })
})

apiRouter.delete("/liste/:type/:id", (req, res) => {
  const media = lireMedia(req, res)
  if (!media) return

  db.retirerListe(req.user.id, media.type, media.id)
  res.json({ liste: false, ...media })
})

// --- Progression ------------------------------------------------------------

/** Entier borné, ou `null` quand la valeur envoyée est invalide. */
function entierBorne(valeur, max, defaut) {
  if (valeur == null || valeur === "") return defaut
  const nombre = Number(valeur)
  return Number.isInteger(nombre) && nombre >= 0 && nombre <= max ? nombre : null
}

apiRouter.put("/historique/:type/:id", (req, res) => {
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

  db.enregistrerProgression(req.user.id, media.type, media.id, {
    progress,
    duration,
    season: media.type === "tv" ? season : 0,
    episode: media.type === "tv" ? episode : 0,
  })
  res.status(204).end()
})

// --- Avis -------------------------------------------------------------------

apiRouter.post("/avis/:type/:id", async (req, res) => {
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

apiRouter.use((req, res) => {
  res.status(404).json({ erreur: "Route API introuvable." })
})

apiRouter.use((erreur, req, res, next) => {
  console.error("[CineFlow] Erreur API :", erreur)
  res.status(500).json({ erreur: "Erreur interne." })
})

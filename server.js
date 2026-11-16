import "dotenv/config"
import crypto from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import helmet from "helmet"
import { rateLimit } from "express-rate-limit"
import * as db from "./src/db.js"
import { authRouter } from "./src/auth.js"
import { lireCookie, middlewareSession } from "./src/session.js"
import { apiRouter } from "./src/routes/api.js"
import { pagesRouter } from "./src/routes/pages.js"
import { pageErreur } from "./src/render.js"

const racine = path.dirname(fileURLToPath(import.meta.url))
const enProduction = process.env.NODE_ENV === "production"

const app = express()

app.disable("x-powered-by")
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Aucun script inline : tout le JS client est dans public/app.js et public/player.js.
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://image.tmdb.org", "https://cdn.discordapp.com"],
      frameSrc: [
        "https://heiwastream.fr",
        "https://www.youtube-nocookie.com",
        "https://www.youtube.com",
      ],
      connectSrc: ["'self'"],
      // cdn.discordapp.com : nameplate animée du profil (vidéo webm).
      mediaSrc: ["'self'", "https://heiwastream.fr", "https://cdn.discordapp.com"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: enProduction ? [] : null,
    },
  },
  // Le lecteur est une iframe externe : pas de COEP/COOP restrictif sur nos pages.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}))

app.use(express.urlencoded({ extended: false, limit: "16kb" }))
app.use(express.json({ limit: "16kb" }))

// Fichier de vérification du domaine fourni par HeiwaStream (racine du projet).
app.get("/.well-known/heiwastream.txt", (req, res, next) => {
  // `dotfiles` est nécessaire : send ignore par défaut les chemins contenant
  // un dossier commençant par un point.
  res.sendFile(path.join(racine, ".well-known", "heiwastream.txt"), { dotfiles: "allow" }, (erreur) => {
    if (erreur && !res.headersSent) next()
  })
})

app.use(express.static(path.join(racine, "public"), {
  maxAge: enProduction ? "1h" : 0,
  etag: true,
}))

app.use(middlewareSession(db))

// Identifiant anonyme et stable du visiteur pour les demandes de titres.
// Cookie httpOnly : le navigateur ne peut pas le lire, et il ne contient
// aucune donnée personnelle.
const NOM_DEMANDEUR = "cineflow_requester"

app.use((req, res, next) => {
  let demandeur = lireCookie(req, NOM_DEMANDEUR)
  if (!demandeur || !/^[a-f0-9]{32,64}$/.test(demandeur)) {
    demandeur = crypto.randomBytes(24).toString("hex")
    res.cookie(NOM_DEMANDEUR, demandeur, {
      httpOnly: true,
      sameSite: "lax",
      secure: enProduction,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: "/",
    })
  }
  req.requester = demandeur
  next()
})

// Les pages contiennent le pseudo et l'état de connexion : jamais de cache partagé.
app.use((req, res, next) => {
  res.set("Cache-Control", "private, no-cache")
  next()
})

// CSRF : le cookie est déjà SameSite=Lax. En plus, toute requête qui modifie des
// données et qui vient d'un autre site est refusée (l'absence d'Origin reste
// acceptée pour les clients non-navigateur).
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next()

  const origine = req.get("origin")
  if (!origine) return next()

  let hote = null
  try {
    hote = new URL(origine).host
  } catch {
    hote = null
  }

  if (hote === req.get("host")) return next()

  if (req.originalUrl?.startsWith("/api")) {
    return res.status(403).json({ erreur: "Origine refusée." })
  }
  return res.status(403).send(pageErreur(
    403,
    "Requête refusée",
    "Cette action doit être lancée depuis le site CineFlow.",
    { user: req.user, chemin: "/" },
  ))
})

const limiteurAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).send(pageErreur(
      429,
      "Trop de tentatives",
      "Trop de demandes de connexion. Réessaie dans quelques minutes.",
      { user: req.user, chemin: "/" },
    ))
  },
})

const limiteurApi = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ erreur: "Trop de requêtes. Réessaie dans un instant." })
  },
})

app.use("/auth", limiteurAuth, authRouter)
app.use("/api", limiteurApi, apiRouter)
app.use(pagesRouter)

app.use((req, res) => {
  res.status(404).send(pageErreur(
    404,
    "Page introuvable",
    "Cette adresse n'existe pas ou n'existe plus.",
    { user: req.user, chemin: "/" },
  ))
})

app.use((erreur, req, res, next) => {
  const statut = Number.isInteger(erreur?.status) && erreur.status >= 400 && erreur.status < 600
    ? erreur.status
    : 500

  // Les erreurs de parsing JSON ou de corps trop volumineux ne sont pas des bugs serveur.
  if (statut >= 500) console.error("[CineFlow] Erreur :", erreur)

  if (req.originalUrl?.startsWith("/api")) {
    const message = statut === 400
      ? "Requête invalide."
      : statut === 413
        ? "Requête trop volumineuse."
        : "Erreur interne."
    return res.status(statut).json({ erreur: message })
  }

  const titre = statut === 400 || statut === 413 ? "Requête invalide" : "Oups"
  const message = statut === 400 || statut === 413
    ? "La requête est invalide."
    : "Impossible de charger cette page. Réessaie dans un instant."

  res.status(statut).send(pageErreur(statut, titre, message, { user: req.user, chemin: "/" }))
})

function avertissements() {
  for (const [nom, valeur] of [
    ["HEIWA_CLE", process.env.HEIWA_CLE],
    ["HEIWA_SITE", process.env.HEIWA_SITE],
    ["TMDB_KEY", process.env.TMDB_KEY],
  ]) {
    if (!valeur) console.warn(`[CineFlow] ${nom} est absent du .env : certaines pages ne fonctionneront pas.`)
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn("[CineFlow] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET absents : la connexion Discord est désactivée.")
  }

  if (!enProduction) {
    console.warn("[CineFlow] Mode développement : cookies non « secure ». Utilise NODE_ENV=production derrière HTTPS.")
  }
}

const port = Number(process.env.PORT) || 3000
const fichierPrincipal = fileURLToPath(import.meta.url)

if (process.argv[1] && path.resolve(process.argv[1]) === fichierPrincipal) {
  avertissements()

  // PORT vide dans le .env : on prend le premier port libre à partir de 3000
  const portAuto = !String(process.env.PORT ?? "").trim()

  const demarrer = (p) => {
    // Express 5 appelle aussi ce callback en cas d'erreur : on l'ignore ici
    const serveur = app.listen(p, (erreur) => {
      if (erreur) return
      console.log(`[CineFlow] Ouvre http://localhost:${p}`)
      console.log(`[CineFlow] Base : ${db.descriptionBase}`)
    })

    serveur.on("error", (erreur) => {
      if (erreur?.code === "EADDRINUSE" && portAuto && p < 65535) {
        console.warn(`[CineFlow] Port ${p} occupé, essai du ${p + 1}…`)
        demarrer(p + 1)
        return
      }
      if (erreur?.code === "EADDRINUSE") {
        console.error(`[CineFlow] Le port ${p} est déjà utilisé. Change PORT dans le .env (ou laisse-le vide).`)
      } else {
        console.error("[CineFlow] Impossible de démarrer le serveur :", erreur)
      }
      process.exitCode = 1
    })
  }

  // La base doit être migrée avant d’accepter des requêtes.
  db.pret.then(
    () => demarrer(port),
    (erreur) => {
      console.error("[CineFlow] Base de données inaccessible (DATABASE_URL ?) :", erreur?.message ?? erreur)
      process.exit(1)
    },
  )
}

export { app }

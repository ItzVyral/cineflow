import "dotenv/config"
import crypto from "node:crypto"

const NOM_SESSION = "cineflow_session"
const DUREE_SESSION_MS = 30 * 24 * 60 * 60 * 1000

const enProduction = process.env.NODE_ENV === "production"
export const cookieSecurise = enProduction

let secret = process.env.SESSION_SECRET

if (!secret) {
  if (enProduction) {
    throw new Error("SESSION_SECRET est obligatoire en production.")
  }
  // En développement seulement : les sessions sont invalidées à chaque redémarrage.
  secret = crypto.randomBytes(32).toString("hex")
  console.warn("[CineFlow] SESSION_SECRET absent : secret de développement généré, les sessions ne survivront pas au redémarrage.")
}

function signature(valeur) {
  return crypto.createHmac("sha256", secret).update(valeur).digest("base64url")
}

function signatureValide(recue, attendue) {
  const a = Buffer.from(String(recue))
  const b = Buffer.from(String(attendue))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Emballe un objet JSON dans une valeur signée HMAC (payload.signature). */
export function emballer(objet) {
  const charge = Buffer.from(JSON.stringify(objet)).toString("base64url")
  return `${charge}.${signature(charge)}`
}

/** Déballe une valeur signée, ou null si la signature / le JSON est invalide. */
export function deballer(valeur) {
  if (typeof valeur !== "string") return null
  const separateur = valeur.lastIndexOf(".")
  if (separateur <= 0) return null
  const charge = valeur.slice(0, separateur)
  if (!signatureValide(valeur.slice(separateur + 1), signature(charge))) return null
  try {
    return JSON.parse(Buffer.from(charge, "base64url").toString("utf8"))
  } catch {
    return null
  }
}

export function creerJetonSession(userId) {
  return emballer({ u: String(userId), e: Date.now() + DUREE_SESSION_MS })
}

export function verifierJetonSession(jeton) {
  const donnees = deballer(jeton)
  if (!donnees || typeof donnees.u !== "string" || !Number.isFinite(donnees.e)) return null
  if (donnees.e <= Date.now()) return null
  return donnees.u
}

export function lireCookie(req, nom) {
  const entete = req.headers.cookie
  if (!entete) return null
  for (const morceau of entete.split(";")) {
    const egal = morceau.indexOf("=")
    if (egal < 0) continue
    if (morceau.slice(0, egal).trim() !== nom) continue
    const valeur = morceau.slice(egal + 1).trim()
    try {
      return decodeURIComponent(valeur)
    } catch {
      return null
    }
  }
  return null
}

export function poserSession(res, userId) {
  res.cookie(NOM_SESSION, creerJetonSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecurise,
    maxAge: DUREE_SESSION_MS,
    path: "/",
  })
}

export function effacerSession(res) {
  res.clearCookie(NOM_SESSION, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecurise,
    path: "/",
  })
}

/**
 * N'accepte qu'un chemin interne : évite les redirections ouvertes
 * (/auth/discord?retour=https://exemple.test).
 */
export function cheminRetour(valeur, defaut = "/") {
  if (
    typeof valeur !== "string" ||
    !valeur.startsWith("/") ||
    valeur.startsWith("//") ||
    valeur.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(valeur)
  ) {
    return defaut
  }
  return valeur
}

export function middlewareSession(db) {
  return (req, res, next) => {
    const jeton = lireCookie(req, NOM_SESSION)
    const userId = verifierJetonSession(jeton)
    const utilisateur = userId ? db.utilisateur(userId) : null

    req.user = utilisateur
    res.locals.user = utilisateur
    res.locals.connecte = !!utilisateur

    // Compte supprimé ou session forgée : on nettoie le cookie.
    if (jeton && !utilisateur) effacerSession(res)
    next()
  }
}

export const nomCookieSession = NOM_SESSION

import "dotenv/config"
import crypto from "node:crypto"
import express from "express"
import * as db from "./db.js"
import {
  cookieSecurise,
  deballer,
  effacerSession,
  emballer,
  cheminRetour,
  lireCookie,
  poserSession,
} from "./session.js"
import { estAssetNameplate, estPaletteNameplate } from "./nameplate.js"
import { page, pageErreur, e } from "./render.js"

export const authRouter = express.Router()

const NOM_COOKIE_ETAT = "cineflow_oauth"
const DUREE_ETAT_MS = 10 * 60 * 1000
const URL_AUTORISATION = "https://discord.com/oauth2/authorize"
const URL_TOKEN = "https://discord.com/api/oauth2/token"
const URL_PROFIL = "https://discord.com/api/users/@me"

authRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store")
  next()
})

function configDiscord() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.DISCORD_REDIRECT_URI?.trim() || "http://localhost:3000/auth/discord/callback",
  }
}

function optionsCookieEtat() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecurise,
    maxAge: DUREE_ETAT_MS,
    path: "/",
  }
}

function memeChaine(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function erreurAuth(req, res, statut, titre, message) {
  // On ne remet jamais l'URL courante dans le bouton de connexion : elle peut contenir
  // le code OAuth ou le state.
  res.status(statut).send(pageErreur(statut, titre, message, { user: req.user, chemin: "/" }))
}

// 1) Redirection vers Discord avec un state aléatoire signé.
authRouter.get("/discord", (req, res) => {
  const { clientId, clientSecret, redirectUri } = configDiscord()

  if (!clientId || !clientSecret) {
    return erreurAuth(
      req,
      res,
      503,
      "Connexion Discord indisponible",
      "Renseigne DISCORD_CLIENT_ID et DISCORD_CLIENT_SECRET dans le fichier .env, puis redémarre le serveur.",
    )
  }

  const state = crypto.randomBytes(32).toString("base64url")
  const retour = cheminRetour(req.query.retour)
  const etatSigne = emballer({ s: state, r: retour, e: Date.now() + DUREE_ETAT_MS })

  res.cookie(NOM_COOKIE_ETAT, etatSigne, optionsCookieEtat())

  const url = new URL(URL_AUTORISATION)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "identify")
  url.searchParams.set("state", state)
  res.redirect(url.toString())
})

// 2) Retour de Discord : vérification du state, échange du code, création de la session.
authRouter.get("/discord/callback", async (req, res) => {
  const { clientId, clientSecret, redirectUri } = configDiscord()

  if (!clientId || !clientSecret) {
    return erreurAuth(req, res, 503, "Connexion Discord indisponible", "La configuration Discord est incomplète sur ce serveur.")
  }

  const etatRecu = lireCookie(req, NOM_COOKIE_ETAT)
  res.clearCookie(NOM_COOKIE_ETAT, { path: "/" })

  if (req.query.error) {
    return erreurAuth(req, res, 400, "Connexion annulée", "La connexion avec Discord a été annulée ou refusée.")
  }

  const donneesEtat = deballer(etatRecu)
  const state = typeof req.query.state === "string" ? req.query.state : ""

  if (
    !donneesEtat ||
    typeof donneesEtat.s !== "string" ||
    !memeChaine(donneesEtat.s, state) ||
    !Number.isFinite(donneesEtat.e) ||
    donneesEtat.e <= Date.now()
  ) {
    return erreurAuth(
      req,
      res,
      400,
      "Vérification impossible",
      "La vérification de sécurité a échoué. Recommence la connexion depuis le site.",
    )
  }

  const code = typeof req.query.code === "string" ? req.query.code : ""
  if (!code) {
    return erreurAuth(req, res, 400, "Code manquant", "Discord n'a pas renvoyé de code d'autorisation.")
  }

  try {
    const reponseToken = await fetch(URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!reponseToken.ok) {
      console.warn(`[CineFlow] Échange du code Discord refusé (${reponseToken.status}).`)
      return erreurAuth(req, res, 502, "Connexion impossible", "Discord a refusé la connexion. Réessaie dans un instant.")
    }

    const jeton = await reponseToken.json()
    const accessToken = jeton?.access_token
    if (typeof accessToken !== "string" || !accessToken) {
      return erreurAuth(req, res, 502, "Connexion impossible", "Discord n'a pas renvoyé de jeton valide.")
    }

    const reponseProfil = await fetch(URL_PROFIL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    })

    // Le token Discord n'est volontairement jamais stocké : il ne vit que dans cette requête.
    if (!reponseProfil.ok) {
      console.warn(`[CineFlow] Profil Discord inaccessible (${reponseProfil.status}).`)
      return erreurAuth(req, res, 502, "Connexion impossible", "Impossible de récupérer ton profil Discord.")
    }

    const profil = await reponseProfil.json()
    const id = String(profil?.id ?? "")

    if (!/^\d{5,32}$/.test(id)) {
      return erreurAuth(req, res, 502, "Réponse Discord invalide", "Discord a renvoyé un profil inattendu.")
    }

    const username = String(profil.global_name || profil.username || "Membre Discord").trim().slice(0, 64) || "Membre Discord"
    const avatar = typeof profil.avatar === "string" && /^[A-Za-z0-9_]+$/.test(profil.avatar) ? profil.avatar : null
    // Bannière de profil et couleur d'accent : renvoyées par `identify`, validées avant stockage.
    const banner = typeof profil.banner === "string" && /^[A-Za-z0-9_]{1,64}$/.test(profil.banner) ? profil.banner : null
    const accentColor = Number.isInteger(profil.accent_color) && profil.accent_color >= 0 && profil.accent_color <= 0xffffff
      ? profil.accent_color
      : null
    // Identité Discord affichée sur le profil. Tout est validé avant stockage.
    const handle = typeof profil.username === "string" && /^[A-Za-z0-9_.]{2,32}$/.test(profil.username) ? profil.username : null
    const publicFlags = Number.isInteger(profil.public_flags) && profil.public_flags >= 0 ? profil.public_flags : null
    const premiumType = [0, 1, 2, 3].includes(profil.premium_type) ? profil.premium_type : null
    // Tag de serveur (« primary_guild ») : seulement s'il est activé par le membre.
    const guilde = profil.primary_guild?.identity_enabled ? profil.primary_guild : null
    const guildId = /^\d{5,32}$/.test(String(guilde?.identity_guild_id ?? "")) ? String(guilde.identity_guild_id) : null
    const guildTag = guildId && typeof guilde.tag === "string" && guilde.tag.trim() ? guilde.tag.trim().slice(0, 8) : null
    const guildBadge = guildTag && typeof guilde.badge === "string" && /^[A-Za-z0-9_]{1,64}$/.test(guilde.badge) ? guilde.badge : null
    // Décorations d'avatar : disponibles avec le scope `identify`. L'asset doit
    // être validé avant de finir dans une URL CDN rendue côté HTML.
    const decoBrute = profil.avatar_decoration_data?.asset
    const avatarDecoration = typeof decoBrute === "string" && /^a_[A-Za-z0-9]+$/.test(decoBrute) ? decoBrute : null
    // Nameplate : asset de preset et palette (bannière du profil). Les deux
    // champs sont validés séparément : un preset inconnu reste sans nameplate.
    const nameplate = profil.collectibles?.nameplate
    const nameplateAsset = nameplate?.asset
    const nameplatePalette = nameplate?.palette

    await db.enregistrerUtilisateur({
      id,
      username,
      avatar,
      avatarDecoration,
      nameplateAsset: estAssetNameplate(nameplateAsset) ? nameplateAsset : null,
      nameplatePalette: estPaletteNameplate(nameplatePalette) ? nameplatePalette : null,
      banner,
      accentColor,
      handle,
      publicFlags,
      premiumType,
      guildTag,
      guildId: guildTag ? guildId : null,
      guildBadge,
    })
    poserSession(res, id)

    res.redirect(cheminRetour(donneesEtat.r))
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur)
    console.warn(`[CineFlow] Échec de la connexion Discord : ${message}`)
    return erreurAuth(req, res, 502, "Connexion impossible", "Discord est injoignable pour le moment. Réessaie dans un instant.")
  }
})

// 3) Déconnexion : GET affiche une confirmation, POST supprime le cookie de session.
authRouter.get("/logout", (req, res) => {
  const retour = cheminRetour(req.query.retour)
  res.send(page({
    titre: "Déconnexion",
    user: req.user,
    chemin: retour,
    nomPage: "deconnexion",
    corps: `<main class="page page-etroite">
      <h1>Se déconnecter ?</h1>
      <p class="vide">Ta session sera supprimée sur cet appareil. Tes favoris, ta liste et ton historique restent enregistrés.</p>
      <form method="post" action="/auth/logout" class="actions-forme">
        <input type="hidden" name="retour" value="${e(retour)}">
        <button class="play" type="submit">Se déconnecter</button>
        <a class="btn-ligne" href="/">Annuler</a>
      </form>
    </main>`,
  }))
})

authRouter.post("/logout", (req, res) => {
  effacerSession(res)
  res.redirect(cheminRetour(req.body?.retour))
})

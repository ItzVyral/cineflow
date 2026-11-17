import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { IMG } from "./heiwa.js"
import { libelleKind } from "./media.js"
import { estPaletteNameplate, PALETTES_NAMEPLATE, urlNameplate } from "./nameplate.js"

const DOSSIER_PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")

/** Ajoute un paramètre de version basé sur la date du fichier pour éviter les caches obsolètes. */
function asset(src) {
  if (!src.startsWith("/")) return src
  try {
    const { mtimeMs } = fs.statSync(path.join(DOSSIER_PUBLIC, src.slice(1)))
    return `${src}?v=${Math.floor(mtimeMs)}`
  } catch {
    return src
  }
}

export const e = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[c])

export const duree = (minutes) => (minutes ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min` : "")

function dureeSaisons(media) {
  if (media.type !== "tv" || !media.saisons) return ""
  return `${media.saisons} saison${media.saisons > 1 ? "s" : ""}`
}

export function chipsInfos(media) {
  const note = Number(media.note)
  return [
    libelleKind(media),
    media.date?.slice(0, 4),
    duree(media.runtime) || dureeSaisons(media),
    Number.isFinite(note) && note > 0 ? `★ ${note.toFixed(1)}` : "",
  ].filter(Boolean).map((contenu) => `<span class="chip">${e(contenu)}</span>`).join("")
}

export function avatarUrl(user, taille = 64) {
  if (!user) return ""
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=${taille}`
  }
  let index = 0
  try {
    index = Number((BigInt(user.id) >> 22n) % 6n)
  } catch {
    index = 0
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

/** Décoration d'avatar Discord : un preset PNG de 288 px, superposé à l'avatar. */
export function avatarDecorationUrl(user) {
  if (!user?.avatar_decoration) return ""
  // `passthrough=true` : le CDN renvoie l'APNG animé (comme dans Discord).
  return `https://cdn.discordapp.com/avatar-decoration-presets/${encodeURIComponent(user.avatar_decoration)}.png?size=240&passthrough=true`
}

/**
 * Avatar avec sa décoration Discord éventuelle. La décoration est rendue à
 * 120 % de l'avatar, la proportion prévue par les presets Discord.
 */
export function avatarAvecDecoration(user, { taille = 34, cdn = 64, classe = "avatar", alt = "" } = {}) {
  const deco = avatarDecorationUrl(user)
  return `<span class="pp">
    <img class="${classe}" src="${e(avatarUrl(user, cdn))}" alt="${e(alt)}" width="${taille}" height="${taille}">
    ${deco ? `<img class="deco-avatar" src="${e(deco)}" alt="" aria-hidden="true">` : ""}
  </span>`
}

/** Bannière du profil Discord (animée si le hash commence par `a_`), vide sinon. */
export function banniereUrl(user) {
  if (!user?.banner || !/^[A-Za-z0-9_]{1,64}$/.test(user.banner)) return ""
  const extension = user.banner.startsWith("a_") ? "gif" : "png"
  return `https://cdn.discordapp.com/banners/${encodeURIComponent(user.id)}/${user.banner}.${extension}?size=1024`
}

/** Couleur d'accent du profil Discord en `#rrggbb`, vide si absente. */
export function couleurAccent(user) {
  const n = user?.accent_color
  return Number.isInteger(n) && n >= 0 && n <= 0xffffff ? `#${n.toString(16).padStart(6, "0")}` : ""
}

const BADGES_DISCORD = [
  [1 << 0, "Équipe Discord"],
  [1 << 1, "Partenaire Discord"],
  [1 << 2, "HypeSquad Events"],
  [1 << 3, "Chasseur de bugs"],
  [1 << 14, "Chasseur de bugs (or)"],
  [1 << 6, "HypeSquad Bravery"],
  [1 << 7, "HypeSquad Brilliance"],
  [1 << 8, "HypeSquad Balance"],
  [1 << 9, "Soutien de la première heure"],
  [1 << 17, "Développeur de bot certifié"],
  [1 << 18, "Modérateur certifié"],
  [1 << 22, "Développeur actif"],
]
const NITRO = { 1: "Nitro Classic", 2: "Nitro", 3: "Nitro Basic" }

/** Badges du profil Discord déductibles de `identify` (Nitro + drapeaux publics). */
export function badgesDiscord(user) {
  const badges = []
  if (NITRO[user?.premium_type]) badges.push(NITRO[user.premium_type])
  const drapeaux = Number.isInteger(user?.public_flags) ? user.public_flags : 0
  for (const [bit, libelle] of BADGES_DISCORD) if (drapeaux & bit) badges.push(libelle)
  return badges
}

/** Tag de serveur Discord : `{ tag, badge }` (badge = URL ou vide), ou null. */
export function tagServeur(user) {
  if (!user?.guild_tag) return null
  const valide = /^\d{5,32}$/.test(String(user.guild_id ?? "")) && /^[A-Za-z0-9_]{1,64}$/.test(String(user.guild_badge ?? ""))
  return {
    tag: String(user.guild_tag),
    badge: valide ? `https://cdn.discordapp.com/guild-tag-badges/${user.guild_id}/${user.guild_badge}.png?size=32` : "",
  }
}

/** Nameplate Discord : bannière statique affichée derrière le pseudo du profil. */
export function nameplateUrl(user) {
  return urlNameplate(user?.nameplate_asset)
}

/** Couleur de repli de la palette Discord, vide si la palette est inconnue. */
export function nameplateCouleur(user) {
  return estPaletteNameplate(user?.nameplate_palette) ? PALETTES_NAMEPLATE[user.nameplate_palette] : ""
}

/**
 * Enveloppe le bloc d'identité du profil avec sa nameplate. Sans nameplate,
 * le contenu est renvoyé inchangé : la page garde son rendu habituel.
 */
export function avecNameplate(user, contenu) {
  const url = nameplateUrl(user)
  if (!url) return contenu
  const couleur = nameplateCouleur(user)
  return `<div class="profil-nameplate"${couleur ? ` style="--np-couleur:${e(couleur)}"` : ""}>
    <video class="nameplate-image" aria-hidden="true" tabindex="-1" autoplay loop muted playsinline disablepictureinpicture
      poster="${e(url)}" src="${e(url.replace(/static\.png$/, "asset.webm"))}" width="672" height="126"></video>
    <div class="profil-nameplate-contenu">${contenu}</div>
  </div>`
}

const svgCoeur = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.2-4.35-9.33-8.12C.8 9.9 2.4 6 6.07 6c2.02 0 3.36 1.1 4.18 2.3C11.07 7.1 12.41 6 14.43 6c3.67 0 5.27 3.9 3.4 6.88C19.2 16.65 12 21 12 21z"/></svg>`

const svgPlus = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path class="ico-plus" d="M12 5v14M5 12h14"/>
  <path class="ico-check" d="M5 13l4 4L19 7"/>
</svg>`

function boutonFavori(media, id, actif) {
  return `<button type="button" class="act coeur" data-action="favori" data-media="${media}" data-id="${id}"
    aria-pressed="${actif}" aria-label="${actif ? "Retirer des favoris" : "Ajouter aux favoris"}"
    title="${actif ? "Retirer des favoris" : "Ajouter aux favoris"}">
    ${svgCoeur}
  </button>`
}

function boutonListe(media, id, actif) {
  return `<button type="button" class="act plus" data-action="liste" data-media="${media}" data-id="${id}"
    aria-pressed="${actif}" aria-label="${actif ? "Retirer de ma liste" : "Ajouter à ma liste"}"
    title="${actif ? "Retirer de ma liste" : "À regarder plus tard"}">
    ${svgPlus}
  </button>`
}

/** Boutons avec libellé visible, pour la page d'un titre. */
export function boutonsMedia(type, id, favori, liste, { extra = "" } = {}) {
  return `<div class="actions-film">
    <button type="button" class="act act-texte coeur" data-action="favori" data-media="${type}" data-id="${id}"
      aria-pressed="${favori}" aria-label="${favori ? "Retirer des favoris" : "Ajouter aux favoris"}">
      ${svgCoeur}<span>${favori ? "Dans mes favoris" : "Favori"}</span>
    </button>
    <button type="button" class="act act-texte plus" data-action="liste" data-media="${type}" data-id="${id}"
      aria-pressed="${liste}" aria-label="${liste ? "Retirer de ma liste" : "Ajouter à ma liste"}">
      ${svgPlus}<span>${liste ? "Dans ma liste" : "À regarder plus tard"}</span>
    </button>
    ${extra}
  </div>`
}

/**
 * Carte d'affiche réutilisée partout (rangées, grilles, recherche, favoris).
 * `progression` est un pourcentage 0-100 pour la barre « Continuer de regarder ».
 */
export function carte(media, { favori = false, liste = false, progression = null, sousTitre = "", lien = null } = {}) {
  const id = Number(media.id)
  const type = media.type === "tv" ? "tv" : "movie"
  const titre = media.titre ?? media.title ?? media.name ?? "Sans titre"
  const href = lien ?? (type === "tv" ? `/serie/${id}` : `/film/${id}`)
  const affiche = media.poster_path
    ? `<img loading="lazy" src="${IMG}w342${e(media.poster_path)}" alt="Affiche de ${e(titre)}">`
    : `<span class="sans-affiche"><span>${e(titre)}</span></span>`

  const pourcent = progression == null ? null : Math.max(0, Math.min(100, Math.round(progression)))
  const barre = pourcent != null
    ? `<span class="barre" aria-hidden="true"><i style="width:${pourcent}%"></i></span><span class="sr-only">${pourcent} % déjà regardé</span>`
    : ""

  return `<article class="carte" data-media="${type}" data-id="${id}">
    <a class="affiche" href="${e(href)}">${affiche}<span class="badge-media">${e(libelleKind(media))}</span>${barre}</a>
    <div class="actions-carte">${boutonFavori(type, id, favori)}${boutonListe(type, id, liste)}</div>
    <a class="titre-carte" href="${e(href)}" title="${e(titre)}">${e(titre)}</a>
    ${sousTitre ? `<span class="sous-titre-carte">${e(sousTitre)}</span>` : ""}
  </article>`
}

export function etatVide({ titre, texte, lien = "/", libelle = "Retour à l'accueil" }) {
  return `<div class="vide-boite">
    <p class="vide-titre">${e(titre)}</p>
    <p>${e(texte)}</p>
    <a class="play" href="${e(lien)}">${e(libelle)}</a>
  </div>`
}

export function pagination(pageActuelle, pages, type = "movie") {
  if (pages <= 1) return ""
  const base = `/catalogue?type=${encodeURIComponent(type)}`
  const liens = []
  if (pageActuelle > 1) liens.push(`<a class="page-lien" href="${e(`${base}&page=${pageActuelle - 1}`)}" rel="prev" aria-label="Page précédente">‹</a>`)
  for (let n = 1; n <= pages; n += 1) {
    liens.push(`<a class="page-lien${n === pageActuelle ? " on" : ""}" href="${e(`${base}&page=${n}`)}"
      ${n === pageActuelle ? 'aria-current="page"' : ""}>${n}</a>`)
  }
  if (pageActuelle < pages) liens.push(`<a class="page-lien" href="${e(`${base}&page=${pageActuelle + 1}`)}" rel="next" aria-label="Page suivante">›</a>`)
  return `<nav class="pagination" aria-label="Pagination du catalogue">${liens.join("")}</nav>`
}

const iconeDiscord = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495a18.2708 18.2708 0 0 0-5.4868 0c-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561 19.9026 19.9026 0 0 0 5.9929 3.0294.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057 13.1069 13.1069 0 0 1-1.8722-.8923.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286 19.846 19.846 0 0 0 6.0023-3.0294.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>`

function compte(user, chemin) {
  if (!user) {
    return `<a class="discord" href="/auth/discord?retour=${encodeURIComponent(chemin)}" aria-label="Se connecter avec Discord">
      ${iconeDiscord}<span class="discord-texte">Se connecter avec Discord</span>
    </a>`
  }
  return `<details class="compte">
    <summary aria-label="Menu de ${e(user.username)}">
      ${avatarAvecDecoration(user, { cdn: 64 })}
      <span class="nom-compte">${e(user.username)}</span>
    </summary>
    <div class="menu-compte">
      <p class="menu-nom">${e(user.username)}</p>
      <a href="/profil" role="menuitem">Profil</a>
      <form method="post" action="/auth/logout">
        <input type="hidden" name="retour" value="${e(chemin)}">
        <button type="submit" role="menuitem">Déconnexion</button>
      </form>
    </div>
  </details>`
}

const liensNav = [
  ["accueil", "/", "Accueil"],
  ["catalogue", "/catalogue", "Catalogue"],
  ["favoris", "/favoris", "Favoris"],
  ["liste", "/liste", "Ma liste"],
]

const LIEN_GITHUB = "https://github.com/ItzVyral/cineflow"

/** Invitation Discord (DISCORD_SERVER_LINK), vide si absente ou mal formée. */
function lienDiscord() {
  const valeur = String(process.env.DISCORD_SERVER_LINK ?? "").trim()
  return /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,64}$/.test(valeur) ? valeur : ""
}

/** Pied de page commun. La mention TMDB est obligatoire. */
function piedDePage() {
  const discord = lienDiscord()
  return `<footer class="pied">
  <div class="pied-haut">
    <div class="pied-marque">
      <img src="/logo.svg" alt="CineFlow" height="28">
      <p>Données et images : TMDB. Ce site utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.</p>
    </div>
    <nav class="pied-liens" aria-label="Liens du pied de page">
      <a href="/mentions-legales">Mentions légales</a>
      ${discord ? `<a href="${e(discord)}" target="_blank" rel="noopener noreferrer">Discord</a>` : ""}
      <a href="${LIEN_GITHUB}" target="_blank" rel="noopener noreferrer">GitHub</a>
    </nav>
  </div>
  <div class="pied-bas">
    <span class="built" tabindex="0">Built by ItzVyral<span class="built-plus"><span><i>…and ✺ Claude too</i></span></span></span>
  </div>
  <div class="pied-geant" aria-hidden="true"><span>Cine</span><span>Flow</span></div>
</footer>`
}

/**
 * Gabarit HTML commun. Tout ce qui vient de la base ou de TMDB doit être passé par e().
 */
export function page({ titre, corps, actif = "", user = null, recherche = "", chemin = "/", nomPage = "", description = "", scripts = ["/app.js"] }) {
  const nav = liensNav.map(([cle, href, libelle]) => `<a class="pill${actif === cle ? " on" : ""}" href="${href}"
    ${actif === cle ? 'aria-current="page"' : ""}>${libelle}</a>`).join("")

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101012">
<title>${e(titre)} · CineFlow</title>
${description ? `<meta name="description" content="${e(description)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="icon" type="image/svg+xml" href="/icone.svg">
<link rel="stylesheet" href="${asset("/style.css")}">
</head>
<body data-connecte="${user ? 1 : 0}" data-page="${e(nomPage)}">
<header>
  <a class="logo" href="/" aria-label="CineFlow, accueil"><img src="/logo.svg" alt="CineFlow"></a>
  <nav class="pills" aria-label="Navigation principale">${nav}</nav>
  <div class="entete-droite">
    <form class="recherche" action="/recherche" method="get" role="search">
      <label class="sr-only" for="recherche-q">Rechercher un film, une série ou un animé</label>
      <input id="recherche-q" type="search" name="q" value="${e(recherche)}" placeholder="Film, série, animé…" autocomplete="off">
      <button type="submit" aria-label="Lancer la recherche">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/></svg>
      </button>
    </form>
    ${compte(user, chemin)}
  </div>
</header>
${corps}
${piedDePage()}
${[...new Set([...scripts, "/motion.js"])].map((src) => `<script src="${e(asset(src))}" defer></script>`).join("\n")}
</body>
</html>`
}

const SCENES_ERREUR = {
  403: "Accès coupé",
  404: "Scène introuvable",
  429: "Projection saturée",
  500: "Bobine bloquée",
  502: "Projecteur en panne",
  503: "Salle fermée",
}

export function pageErreur(statut, titre, message, { user = null, chemin = "/" } = {}) {
  const code = String(statut)
  const scene = SCENES_ERREUR[statut] ?? "Hors champ"
  return page({
    titre,
    user,
    chemin,
    nomPage: "erreur",
    corps: `<main class="page page-erreur">
      <section class="err" aria-labelledby="err-titre">
        <span class="pf-croix pf-croix-hg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-hd" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bd" aria-hidden="true"></span>
        <span class="err-scan" aria-hidden="true"></span>
        <div class="err-fond" aria-hidden="true"><span>${code}</span></div>
        <div class="err-contenu">
          <p class="err-etiquette">
            <span class="pf-masque"><span>( Erreur ${code} )</span></span>
            <span class="pf-masque"><span>${e(scene)}</span></span>
          </p>
          <div class="err-code-ligne">
            <span class="err-code" aria-hidden="true">${code}</span>
            <h1 class="err-titre" id="err-titre">${e(titre)}</h1>
          </div>
          <p class="err-texte">${e(message)}</p>
          <form class="err-recherche" action="/recherche" method="get" role="search">
            <label class="sr-only" for="err-q">Rechercher un film, une série ou un animé</label>
            <input id="err-q" type="search" name="q" placeholder="Un titre à retrouver ?" minlength="2" required autocomplete="off">
            <button type="submit">Rechercher
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>
            </button>
          </form>
          <nav class="err-liens" aria-label="Pages utiles">
            <a class="play" href="/">Retour à l'accueil</a>
            <a class="btn-ligne" href="/catalogue">Explorer le catalogue</a>
          </nav>
        </div>
        <div class="err-bas" aria-hidden="true">
          <span>${e(scene)}</span>
          <span class="err-track"><i></i></span>
          <span>24 IPS · 2.39:1</span>
        </div>
      </section>
    </main>`,
  })
}

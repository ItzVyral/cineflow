// Nameplates Discord : presets statiques rendus derrière le pseudo du profil.
// L'asset vient de l'API Discord (scope `identify`) et doit être validé avant
// de finir dans une URL CDN.

/** Couleur de repli associée à chaque palette officielle Discord. */
export const PALETTES_NAMEPLATE = Object.freeze({
  crimson: "#c42b4a",
  berry: "#9b3f8f",
  sky: "#3f8fd2",
  teal: "#2aa3a3",
  forest: "#3f8f5a",
  bubble_gum: "#e06fb4",
  violet: "#7a5af8",
  cobalt: "#4a5cdb",
  clover: "#3fa34d",
  lemon: "#c9b13b",
  white: "#e8e8ee",
})

const LONGUEUR_MAX_ASSET = 128
const RE_ASSET = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/

/** Chemin d'asset Discord valide, par exemple `nameplates/nameplates/twilight/`. */
export function estAssetNameplate(valeur) {
  return typeof valeur === "string" &&
    valeur.length > 0 &&
    valeur.length <= LONGUEUR_MAX_ASSET &&
    RE_ASSET.test(valeur) &&
    !valeur.includes("..")
}

export function estPaletteNameplate(valeur) {
  return typeof valeur === "string" && Object.hasOwn(PALETTES_NAMEPLATE, valeur)
}

/** URL du PNG statique du preset, ou chaîne vide si l'asset est invalide. */
export function urlNameplate(asset) {
  if (!estAssetNameplate(asset)) return ""
  const chemin = asset.split("/").filter(Boolean).map(encodeURIComponent).join("/")
  return `https://cdn.discordapp.com/assets/collectibles/${chemin}/static.png`
}

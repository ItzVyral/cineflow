// Types de média acceptés par HeiwaStream et par la base locale.
// `anime` n'est pas un type d'API : ce sont des séries `tv` avec kind = "anime".
export const TYPES_MEDIA = ["movie", "tv"]

export const FILTRES_RECHERCHE = ["tous", "movie", "tv", "anime"]

export const estTypeMedia = (valeur) => TYPES_MEDIA.includes(valeur)

export const estTypeCatalogue = (valeur) => valeur === "movie" || valeur === "tv" || valeur === "anime"

export const cleMedia = (type, id) => `${type}:${Number(id)}`

export function filtreRecherche(valeur) {
  return FILTRES_RECHERCHE.includes(valeur) ? valeur : "tous"
}

/** Type envoyé à l'API pour un filtre de recherche (`anime` se cherche dans `tv`). */
export function typeDepuisFiltre(filtre) {
  if (filtre === "movie") return "movie"
  if (filtre === "tv" || filtre === "anime") return "tv"
  return null
}

export function libelleKind({ type, kind, genres, langue } = {}) {
  if (kind === "anime") return "Anime"
  if (type === "movie") return "Film"
  if (Array.isArray(genres) && langue === "ja" && genres.includes("Animation")) return "Anime"
  return "Série"
}

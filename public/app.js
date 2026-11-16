// CineFlow — JS vanilla, chargé en defer depuis le gabarit serveur.
(() => {
  "use strict"

  const connecte = document.body.dataset.connecte === "1"
  const pageCourante = document.body.dataset.page || ""

  // --- Utilitaires ---------------------------------------------------------

  let minuteurToast = null

  function toast(message) {
    let element = document.querySelector(".toast")
    if (!element) {
      element = document.createElement("div")
      element.className = "toast"
      element.setAttribute("role", "status")
      element.setAttribute("aria-live", "polite")
      document.body.append(element)
    }
    element.textContent = message
    element.classList.add("on")
    clearTimeout(minuteurToast)
    minuteurToast = setTimeout(() => element.classList.remove("on"), 3800)
  }

  function ouvrirConnexion() {
    const retour = location.pathname + location.search
    location.href = `/auth/discord?retour=${encodeURIComponent(retour)}`
  }

  async function appelerApi(url, options = {}) {
    let reponse
    try {
      reponse = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.headers ?? {}),
        },
      })
    } catch {
      throw new Error("Impossible de joindre le serveur. Vérifie ta connexion.")
    }

    if (reponse.status === 401) {
      ouvrirConnexion()
      const erreur = new Error("Connexion requise.")
      erreur.statut = 401
      throw erreur
    }

    const donnees = await reponse.json().catch(() => null)

    if (!reponse.ok) {
      const erreur = new Error(donnees?.erreur ?? "Une erreur est survenue.")
      erreur.statut = reponse.status
      throw erreur
    }

    return donnees
  }

  // --- Favoris / liste de lecture ------------------------------------------

  const libelles = {
    favori: { actif: "Retirer des favoris", inactif: "Ajouter aux favoris", texteActif: "Dans mes favoris", texteInactif: "Favori" },
    liste: { actif: "Retirer de ma liste", inactif: "Ajouter à ma liste", texteActif: "Dans ma liste", texteInactif: "À regarder plus tard" },
  }

  function peindreBouton(bouton, action, actif) {
    bouton.setAttribute("aria-pressed", String(actif))
    const textes = libelles[action]
    const libelle = actif ? textes.actif : textes.inactif
    bouton.setAttribute("aria-label", libelle)
    if (bouton.hasAttribute("title")) bouton.setAttribute("title", libelle)
    const texte = bouton.querySelector("span")
    if (texte) texte.textContent = actif ? textes.texteActif : textes.texteInactif
  }

  function retirerCarteDeLaGrille(media, id) {
    const carte = document.querySelector(`.carte[data-media="${media}"][data-id="${id}"]`)
    if (!carte) return
    const grille = carte.closest(".grille")
    carte.remove()

    const compte = document.querySelector("[data-pl-compte]")
    if (compte && grille) {
      const n = grille.querySelectorAll(".carte").length
      compte.textContent = `${n} titre${n > 1 ? "s" : ""}`
    }

    if (grille && !grille.querySelector(".carte")) {
      const vide = document.createElement("section")
      vide.className = "pl-vide"
      vide.innerHTML = `<span class="pf-croix pf-croix-hg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-hd" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bg" aria-hidden="true"></span>
        <span class="pf-croix pf-croix-bd" aria-hidden="true"></span>
        <div class="pl-fantomes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <p class="pl-vide-titre">C'est vide pour l'instant</p>
        <p class="pl-vide-texte">Ajoute un film, une série ou un animé depuis son affiche.</p>
        <a class="play" href="/catalogue">Découvrir des titres</a>`
      grille.replaceWith(vide)
    }
  }

  document.addEventListener("click", async (event) => {
    const bouton = event.target.closest("[data-action]")
    if (!bouton) return

    event.preventDefault()

    if (!connecte) {
      ouvrirConnexion()
      return
    }

    const action = bouton.dataset.action
    const media = bouton.dataset.media
    const id = bouton.dataset.id
    if (!libelles[action] || !media || !id || bouton.disabled) return

    const etaitActif = bouton.getAttribute("aria-pressed") === "true"
    const devientActif = !etaitActif
    const endpoint = action === "favori" ? "favoris" : "liste"

    peindreBouton(bouton, action, devientActif)
    bouton.disabled = true

    try {
      const resultat = await appelerApi(`/api/${endpoint}/${media}/${id}`, {
        method: devientActif ? "POST" : "DELETE",
      })

      const actif = action === "favori" ? resultat.favori : resultat.liste
      peindreBouton(bouton, action, !!actif)
      toast(actif ? "Ajouté." : "Retiré.")

      // Sur /favoris et /liste, retirer une carte la fait disparaître immédiatement.
      if (!actif && ((pageCourante === "favoris" && action === "favori") || (pageCourante === "liste" && action === "liste"))) {
        retirerCarteDeLaGrille(media, id)
      }
    } catch (erreur) {
      peindreBouton(bouton, action, etaitActif)
      if (erreur.statut === 429) toast("Trop de requêtes, réessaie dans un instant.")
      else if (erreur.statut !== 401) toast(erreur.message)
    } finally {
      bouton.disabled = false
    }
  })

  // --- Avis ----------------------------------------------------------------

  document.addEventListener("submit", async (event) => {
    const formulaire = event.target.closest("form[data-avis]")
    if (!formulaire) return

    event.preventDefault()

    if (!connecte) {
      ouvrirConnexion()
      return
    }

    const message = formulaire.querySelector(".form-msg")
    const bouton = formulaire.querySelector('button[type="submit"]')
    const donnees = new FormData(formulaire)
    const note = Number(donnees.get("note"))
    const comment = String(donnees.get("comment") ?? "").trim()
    const spoiler = donnees.get("spoiler") != null

    if (!Number.isInteger(note) || note < 1 || note > 5) {
      message.textContent = "Choisis une note entre 1 et 5 étoiles."
      message.className = "form-msg erreur"
      return
    }

    if (comment.length === 1) {
      message.textContent = "Le commentaire doit faire au moins 2 caractères."
      message.className = "form-msg erreur"
      return
    }

    message.textContent = "Envoi en cours…"
    message.className = "form-msg"
    bouton.disabled = true

    try {
      const resultat = await appelerApi(`/api/avis/${formulaire.dataset.media}/${formulaire.dataset.avis}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, comment, spoiler }),
      })

      message.textContent = resultat.message ?? "Merci, ton avis est publié."
      message.className = "form-msg ok"
      formulaire.reset()
    } catch (erreur) {
      if (erreur.statut !== 401) {
        message.textContent = erreur.message
        message.className = "form-msg erreur"
      }
    } finally {
      bouton.disabled = false
    }
  })

  // --- Suppression du compte ----------------------------------------------

  document.addEventListener("submit", (event) => {
    const formulaire = event.target.closest("form[data-suppression]")
    if (!formulaire) return

    const confirmation = formulaire.querySelector('input[name="confirmation"]')
    const message = formulaire.querySelector(".form-msg")
    const valeur = confirmation?.value.trim() ?? ""

    if (valeur !== "SUPPRIMER") {
      event.preventDefault()
      message.textContent = "Écris exactement SUPPRIMER pour confirmer."
      message.className = "form-msg erreur"
      return
    }

    if (!window.confirm("Supprimer définitivement ton compte, tes favoris, ta liste, ton historique et tes titres récemment vus ?")) {
      event.preventDefault()
    }
  })

  // --- Titres récemment vus (visiteurs) ------------------------------------

  const CLE_RECENTS = "cineflow:recemment-vus"
  const MAX_RECENTS = 12
  const PREFIXE_AFFICHE = "https://image.tmdb.org/t/p/"

  /**
   * Liste locale, relue à chaque fois : un autre onglet peut l'avoir modifiée.
   * Tout élément inattendu est écarté avant d'être affiché.
   */
  function lireRecentsLocaux() {
    try {
      const liste = JSON.parse(localStorage.getItem(CLE_RECENTS) || "[]")
      if (!Array.isArray(liste)) return []
      return liste
        .filter((item) => item?.type === "movie" || item?.type === "tv")
        .map((item) => ({
          type: item.type,
          id: Number(item.id),
          titre: typeof item.titre === "string" ? item.titre.slice(0, 200) : "Sans titre",
          affiche: typeof item.affiche === "string" ? item.affiche : "",
          kind: typeof item.kind === "string" ? item.kind : "",
        }))
        .filter((item) => Number.isSafeInteger(item.id) && item.id > 0)
        .slice(0, MAX_RECENTS)
    } catch {
      return []
    }
  }

  function enregistrerVueLocale() {
    if (connecte) return
    const zone = document.querySelector("[data-vue-id]")
    if (!zone) return

    const type = zone.dataset.vueType === "tv" ? "tv" : zone.dataset.vueType === "movie" ? "movie" : ""
    const id = Number(zone.dataset.vueId)
    if (!type || !Number.isSafeInteger(id) || id <= 0) return

    // Le titre courant repasse en tête, sans doublon.
    const liste = lireRecentsLocaux().filter((item) => !(item.type === type && item.id === id))
    liste.unshift({
      type,
      id,
      titre: zone.dataset.vueTitre || "Sans titre",
      affiche: zone.dataset.vueAffiche || "",
      kind: zone.dataset.vueKind || "",
      vu: Date.now(),
    })

    try {
      localStorage.setItem(CLE_RECENTS, JSON.stringify(liste.slice(0, MAX_RECENTS)))
    } catch {
      // Stockage plein ou désactivé : la navigation reste possible.
    }
  }

  /** Carte construite avec l'API DOM : aucune donnée locale n'est interprétée en HTML. */
  function carteRecente(item) {
    const article = document.createElement("article")
    article.className = "carte"

    const lien = item.type === "movie" ? `/film/${item.id}` : `/serie/${item.id}`
    const affiche = document.createElement("a")
    affiche.className = "affiche"
    affiche.href = lien

    if (item.affiche.startsWith(PREFIXE_AFFICHE)) {
      const image = document.createElement("img")
      image.loading = "lazy"
      image.src = item.affiche
      image.alt = `Affiche de ${item.titre}`
      affiche.append(image)
    } else {
      const vide = document.createElement("span")
      vide.className = "sans-affiche"
      const texte = document.createElement("span")
      texte.textContent = item.titre
      vide.append(texte)
      affiche.append(vide)
    }

    const badge = document.createElement("span")
    badge.className = "badge-media"
    badge.textContent = item.kind === "anime" ? "Anime" : item.type === "movie" ? "Film" : "Série"
    affiche.append(badge)

    const titre = document.createElement("a")
    titre.className = "titre-carte"
    titre.href = lien
    titre.title = item.titre
    titre.textContent = item.titre

    article.append(affiche, titre)
    return article
  }

  function afficherRecentsLocaux() {
    if (connecte) return
    const section = document.querySelector("[data-recents-locaux]")
    const rangee = section?.querySelector(".rang")
    if (!section || !rangee) return

    const liste = lireRecentsLocaux()
    if (!liste.length) return

    const fragment = document.createDocumentFragment()
    for (const item of liste) fragment.append(carteRecente(item))
    rangee.replaceChildren(fragment)
    section.hidden = false
  }

  // --- Bandeau héros -------------------------------------------------------

  function demarrerHeros() {
    const slides = [...document.querySelectorAll(".slide")]
    const points = [...document.querySelectorAll(".dots i")]
    if (!slides.length) return

    let index = 0
    const afficher = (suivant) => {
      const cible = ((suivant % slides.length) + slides.length) % slides.length
      if (cible === index) return
      // « sort » : le texte de la diapo quittée glisse vers le bas, hors de son masque.
      for (const slide of slides) slide.classList.remove("sort")
      slides[index]?.classList.add("sort")
      slides[index]?.classList.remove("on")
      points[index]?.classList.remove("on")
      index = ((suivant % slides.length) + slides.length) % slides.length
      slides[index].classList.add("on")
      points[index]?.classList.add("on")
    }

    for (const [position, point] of points.entries()) {
      point.addEventListener("click", () => afficher(position))
      point.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          afficher(position)
        }
      })
    }

    if (slides.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInterval(() => afficher(index + 1), 8000)
    }
  }

  // --- Menus ---------------------------------------------------------------

  function fermerMenus() {
    const compte = document.querySelector("details.compte")
    if (!compte) return
    document.addEventListener("click", (event) => {
      if (!compte.contains(event.target)) compte.open = false
    })
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") compte.open = false
    })
  }

  enregistrerVueLocale()
  afficherRecentsLocaux()
  demarrerHeros()
  fermerMenus()
})()

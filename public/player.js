// CineFlow — lecteur HeiwaStream, panneau série et progression locale.
// Ce fichier n'est chargé que sur /film/:id et /serie/:id/:saison/:episode.
(() => {
  "use strict"

  const ORIGINE_LECTEUR = "https://heiwastream.fr"
  const CLE_PROGRESSION = "cineflow:progression:v1"
  const INTERVALLE_SAUVEGARDE = 15_000
  const DELAI_SUITE = 5

  const racine = document.querySelector("[data-lecture]")
  if (!racine) return

  const type = racine.dataset.type === "tv" ? "tv" : "movie"
  const id = Number(racine.dataset.id)
  if (!Number.isSafeInteger(id) || id <= 0) return

  const estSerie = type === "tv"
  const connecte = document.body.dataset.connecte === "1"
  const titre = racine.dataset.titre || document.title.replace(/ · CineFlow$/, "")
  let saison = estSerie ? Number(racine.dataset.saison) || 0 : 0
  let episode = estSerie ? Number(racine.dataset.episode) || 0 : 0

  const iframe = racine.querySelector("[data-lecteur]")
  const panneau = racine.querySelector("[data-panneau-contenu]")
  const zoneSuite = racine.querySelector("[data-suite]")
  let langueActive = iframe?.dataset.lang || panneau?.querySelector(".langue.on")?.dataset.lang || ""
  let repriseServeur = Number(iframe?.dataset.reprise) || 0

  let position = 0
  let derniereDuree = 0
  let derniereSauvegarde = 0
  let aRepris = false
  let chargementPanneau = 0
  let minuteurSuite = null
  let secondesSuite = DELAI_SUITE
  let cibleSuite = null
  let focusAvantModale = null

  const codeEpisode = (numeroSaison, numeroEpisode) =>
    `S${String(numeroSaison).padStart(2, "0")}E${String(numeroEpisode).padStart(2, "0")}`

  // --- Progression ---------------------------------------------------------

  function lireProgression() {
    try {
      const donnees = JSON.parse(localStorage.getItem(CLE_PROGRESSION) || "{}")
      return donnees && typeof donnees === "object" && !Array.isArray(donnees) ? donnees : {}
    } catch {
      return {}
    }
  }

  function ecrireProgression(donnees) {
    try {
      localStorage.setItem(CLE_PROGRESSION, JSON.stringify(donnees))
    } catch {
      // Stockage plein ou désactivé : la lecture reste possible.
    }
  }

  function cleProgression(numeroSaison = 0, numeroEpisode = 0) {
    return `${type}:${id}:${numeroSaison}:${numeroEpisode}`
  }

  function entreeProgression(numeroSaison, numeroEpisode) {
    const entree = lireProgression()[cleProgression(numeroSaison, numeroEpisode)]
    return entree && typeof entree === "object" ? entree : null
  }

  function enregistrerProgression(nouvellePosition, nouvelleDuree, keepalive = false) {
    if (!Number.isFinite(nouvellePosition) || nouvellePosition < 0) return
    const positionArrondie = Math.max(0, Math.round(nouvellePosition))
    const dureeArrondie = Number.isFinite(nouvelleDuree) && nouvelleDuree > 0
      ? Math.max(0, Math.round(nouvelleDuree))
      : 0

    const tout = lireProgression()
    tout[cleProgression(saison, episode)] = {
      type,
      id,
      season: estSerie ? saison : 0,
      episode: estSerie ? episode : 0,
      position: positionArrondie,
      duration: dureeArrondie,
      updated: Date.now(),
    }

    // La progression ne sert qu'à reprendre : on garde les 250 dernières
    // entrées pour ne pas faire grossir indéfiniment localStorage.
    const entrees = Object.entries(tout)
    if (entrees.length > 250) {
      entrees
        .sort((a, b) => Number(b[1]?.updated) - Number(a[1]?.updated))
        .slice(250)
        .forEach(([cle]) => delete tout[cle])
    }
    ecrireProgression(tout)

    if (!connecte) return
    fetch(`/api/historique/${type}/${id}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        position: positionArrondie,
        duration: dureeArrondie,
        season: estSerie ? saison : 0,
        episode: estSerie ? episode : 0,
      }),
      keepalive,
    }).catch(() => {})
  }

  function dernierEpisodeLocal() {
    let dernier = null
    for (const entree of Object.values(lireProgression())) {
      if (entree?.type !== "tv" || Number(entree.id) !== id) continue
      const numeroSaison = Number(entree.season)
      const numeroEpisode = Number(entree.episode)
      if (!Number.isInteger(numeroSaison) || numeroSaison <= 0) continue
      if (!Number.isInteger(numeroEpisode) || numeroEpisode <= 0) continue
      if (!dernier || Number(entree.updated) > Number(dernier.updated)) dernier = entree
    }
    return dernier
  }

  function repriseLocale() {
    const entree = entreeProgression(saison, episode)
    if (!entree) return 0
    const sauvee = Number(entree.position)
    const dureeSauvee = Number(entree.duration)
    if (!Number.isFinite(sauvee) || sauvee <= 10) return 0
    if (dureeSauvee > 0 && sauvee / dureeSauvee >= 0.95) return 0
    return sauvee
  }

  // Un visiteur non connecté qui ouvre /serie/:id est envoyé sur S1E1 par le
  // serveur. S'il a déjà regardé un épisode, on le remplace par le dernier.
  if (estSerie && racine.dataset.repriseAuto === "1") {
    const dernier = dernierEpisodeLocal()
    if (dernier && (Number(dernier.season) !== saison || Number(dernier.episode) !== episode)) {
      location.replace(`/serie/${id}/${dernier.season}/${dernier.episode}`)
      return
    }
  }

  const reprise = Math.max(repriseServeur, repriseLocale())

  // --- Lecteur -------------------------------------------------------------

  function envoyerAuLecteur(message) {
    iframe?.contentWindow?.postMessage(message, ORIGINE_LECTEUR)
  }

  function envoyerEpisode(numeroSaison, numeroEpisode) {
    if (!estSerie) return
    const saisonValide = Number(numeroSaison)
    const episodeValide = Number(numeroEpisode)
    if (!Number.isInteger(saisonValide) || saisonValide <= 0) return
    if (!Number.isInteger(episodeValide) || episodeValide <= 0) return
    envoyerAuLecteur({ heiwa: "episode", season: saisonValide, episode: episodeValide })
  }

  function mettreAJourBarre() {
    const code = racine.querySelector("[data-code-episode]")
    if (code) code.textContent = codeEpisode(saison, episode)
    racine.dataset.saison = String(saison)
    racine.dataset.episode = String(episode)
  }

  function mettreAJourUrl() {
    if (!estSerie) return
    const parametres = new URLSearchParams(location.search)
    parametres.delete("reprise")
    if (langueActive) parametres.set("lang", langueActive)
    else parametres.delete("lang")
    const query = parametres.toString()
    history.replaceState(null, "", `/serie/${id}/${saison}/${episode}${query ? `?${query}` : ""}`)
  }

  function mettreAJourTitre() {
    document.title = estSerie
      ? `${titre} · ${codeEpisode(saison, episode)} · CineFlow`
      : `${titre} · CineFlow`
  }

  // Le lecteur change parfois d'épisode lui-même (URL de l'iframe). La base
  // utilisée pour les rechargements de langue doit suivre cet épisode.
  function mettreAJourBaseEpisode() {
    const base = iframe?.dataset.srcBase
    if (!base) return
    try {
      const url = new URL(base)
      const correspondance = url.pathname.match(/\/embed\/tv\/(\d+)\/\d+\/\d+$/)
      if (!correspondance) return
      url.pathname = `/embed/tv/${correspondance[1]}/${saison}/${episode}`
      url.searchParams.delete("lang")
      url.searchParams.delete("t")
      iframe.dataset.srcBase = url.toString()
    } catch {
      // Base illisible : on garde l'ancienne, le lecteur reste utilisable.
    }
  }

  function synchroniserEpisode(numeroSaison, numeroEpisode) {
    if (!estSerie) return
    const nouvelleSaison = Number(numeroSaison)
    const nouvelEpisode = Number(numeroEpisode)
    if (!Number.isInteger(nouvelleSaison) || nouvelleSaison <= 0) return
    if (!Number.isInteger(nouvelEpisode) || nouvelEpisode <= 0) return
    if (nouvelleSaison === saison && nouvelEpisode === episode) return

    saison = nouvelleSaison
    episode = nouvelEpisode
    mettreAJourBaseEpisode()
    position = 0
    derniereDuree = 0
    derniereSauvegarde = 0
    aRepris = false
    repriseServeur = 0
    cacherSuite()
    mettreAJourBarre()
    mettreAJourTitre()
    mettreAJourUrl()
    chargerPanneau(saison, saison, episode, langueActive)
  }

  function appliquerLangue(code) {
    if (!estSerie || !code) return
    langueActive = code
    if (panneau) {
      for (const bouton of panneau.querySelectorAll("[data-lang]")) {
        const actif = bouton.dataset.lang === code
        bouton.classList.toggle("on", actif)
        bouton.setAttribute("aria-pressed", String(actif))
        const etat = bouton.querySelector(".langue-etat")
        if (etat) etat.textContent = actif ? "En lecture" : "Choisir"
      }
    }

    const base = iframe?.dataset.srcBase
    if (base) {
      const url = new URL(base)
      url.searchParams.set("lang", code)
      if (position >= 1) url.searchParams.set("t", String(Math.floor(position)))
      iframe.dataset.lang = code
      aRepris = position >= 1
      iframe.src = url.toString()
    }
    mettreAJourUrl()
  }

  function vouloirReprendre() {
    if (reprise > 10 && !aRepris) {
      aRepris = true
      envoyerAuLecteur({ heiwa: "seek", position: Math.floor(reprise) })
    }
  }

  // --- Panneau -------------------------------------------------------------

  function activerOnglet(idOnglet) {
    if (!panneau) return
    for (const onglet of panneau.querySelectorAll('[role="tab"]')) {
      const actif = onglet.id === idOnglet
      onglet.setAttribute("aria-selected", String(actif))
      onglet.tabIndex = actif ? 0 : -1
      onglet.classList.toggle("on", actif)
      const contenu = document.getElementById(onglet.getAttribute("aria-controls"))
      if (contenu) contenu.hidden = !actif
    }
  }

  async function chargerPanneau(saisonAffichee, actifSaison, actifEpisode, langue) {
    if (!panneau || !estSerie) return
    const jeton = ++chargementPanneau
    const parametres = new URLSearchParams({
      actifSaison: String(actifSaison),
      actifEpisode: String(actifEpisode),
    })
    if (langue) parametres.set("lang", langue)

    try {
      const reponse = await fetch(`/serie/${id}/${saisonAffichee}/panneau?${parametres.toString()}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
      if (!reponse.ok) return
      const donnees = await reponse.json()
      if (jeton !== chargementPanneau || typeof donnees?.html !== "string") return

      const ongletActif = panneau.querySelector('[role="tab"][aria-selected="true"]')?.id
      panneau.innerHTML = donnees.html
      activerOnglet(ongletActif === "onglet-langues" ? "onglet-langues" : "onglet-episodes")

      // L'épisode réellement en lecture peut ne pas proposer la langue choisie
      // précédemment : le serveur renvoie alors la langue de repli.
      if (Number(donnees.actifSaison) === saison && Number(donnees.actifEpisode) === episode
        && typeof donnees.langue === "string" && donnees.langue && donnees.langue !== langueActive) {
        langueActive = donnees.langue
        if (iframe) iframe.dataset.lang = langueActive
        mettreAJourUrl()
      }
    } catch {
      // Le panneau précédent reste utilisable.
    }
  }

  // --- Suite automatique ---------------------------------------------------

  function cacherSuite() {
    if (minuteurSuite) clearInterval(minuteurSuite)
    minuteurSuite = null
    cibleSuite = null
    if (zoneSuite) zoneSuite.hidden = true
  }

  function afficherSuite() {
    if (!estSerie || !zoneSuite || !panneau) return
    const bouton = panneau.querySelector("[data-suivant]")
    if (!bouton || bouton.disabled) return
    const saisonSuivante = Number(bouton.dataset.saison)
    const episodeSuivant = Number(bouton.dataset.episode)
    if (!Number.isInteger(saisonSuivante) || !Number.isInteger(episodeSuivant)) return

    cibleSuite = { saison: saisonSuivante, episode: episodeSuivant }
    secondesSuite = DELAI_SUITE
    const texte = zoneSuite.querySelector("[data-suite-texte]")
    if (texte) texte.textContent = `Épisode suivant dans ${secondesSuite} s…`
    zoneSuite.hidden = false

    if (minuteurSuite) clearInterval(minuteurSuite)
    minuteurSuite = setInterval(() => {
      secondesSuite -= 1
      if (secondesSuite <= 0) {
        const cible = cibleSuite
        cacherSuite()
        if (cible) envoyerEpisode(cible.saison, cible.episode)
        return
      }
      if (texte) texte.textContent = `Épisode suivant dans ${secondesSuite} s…`
    }, 1000)
  }

  // --- Messages du lecteur -------------------------------------------------

  window.addEventListener("message", (event) => {
    if (event.origin !== ORIGINE_LECTEUR) return
    const donnees = event.data
    if (!donnees || typeof donnees !== "object") return

    if (donnees.heiwa === "ready") {
      vouloirReprendre()
      return
    }

    if (donnees.heiwa === "play") {
      vouloirReprendre()
      return
    }

    if (donnees.heiwa === "time") {
      const nouvellePosition = Number(donnees.position)
      const nouvelleDuree = Number(donnees.duration)
      if (!Number.isFinite(nouvellePosition) || nouvellePosition < 0) return
      position = nouvellePosition
      if (Number.isFinite(nouvelleDuree) && nouvelleDuree > 0) derniereDuree = nouvelleDuree

      if (Date.now() - derniereSauvegarde >= INTERVALLE_SAUVEGARDE) {
        derniereSauvegarde = Date.now()
        enregistrerProgression(position, derniereDuree)
      }
      return
    }

    if (donnees.heiwa === "ended") {
      enregistrerProgression(derniereDuree || position, derniereDuree, true)
      afficherSuite()
      return
    }

    if (donnees.heiwa === "episode") {
      synchroniserEpisode(donnees.season ?? donnees.saison, donnees.episode)
    }
  })

  window.addEventListener("pagehide", () => {
    if (position > 0) enregistrerProgression(position, derniereDuree, true)
  })

  // --- Actions du panneau et de la barre -----------------------------------

  document.addEventListener("click", (event) => {
    const onglet = event.target.closest('[role="tab"]')
    if (onglet && panneau?.contains(onglet)) {
      event.preventDefault()
      activerOnglet(onglet.id)
      return
    }

    const boutonEpisode = event.target.closest(".episode[data-episode]")
    if (boutonEpisode && panneau?.contains(boutonEpisode)) {
      event.preventDefault()
      const numeroSaison = Number(boutonEpisode.dataset.saison) || saison
      const numeroEpisode = Number(boutonEpisode.dataset.episode)
      cacherSuite()
      envoyerEpisode(numeroSaison, numeroEpisode)
      return
    }

    const boutonSuivant = event.target.closest("[data-suivant]")
    if (boutonSuivant && panneau?.contains(boutonSuivant) && !boutonSuivant.disabled) {
      event.preventDefault()
      cacherSuite()
      envoyerEpisode(Number(boutonSuivant.dataset.saison), Number(boutonSuivant.dataset.episode))
      return
    }

    const boutonLangue = event.target.closest("[data-lang]")
    if (boutonLangue && panneau?.contains(boutonLangue)) {
      event.preventDefault()
      appliquerLangue(boutonLangue.dataset.lang)
      return
    }

    if (event.target.closest("[data-suite-maintenant]")) {
      event.preventDefault()
      const cible = cibleSuite
      cacherSuite()
      if (cible) envoyerEpisode(cible.saison, cible.episode)
      return
    }

    if (event.target.closest("[data-suite-annuler]")) {
      event.preventDefault()
      cacherSuite()
      return
    }

    const boutonRetour = event.target.closest("[data-retour]")
    if (boutonRetour) {
      event.preventDefault()
      if (history.length > 1) history.back()
      else location.assign("/")
      return
    }

    const boutonCopier = event.target.closest("[data-copier]")
    if (boutonCopier) {
      event.preventDefault()
      copierLien(boutonCopier)
      return
    }

    const boutonBandeAnnonce = event.target.closest("[data-bande-annonce]")
    if (boutonBandeAnnonce) {
      event.preventDefault()
      ouvrirBandeAnnonce(boutonBandeAnnonce.dataset.bandeAnnonce)
      return
    }

    if (event.target.closest("[data-fermer]")) {
      event.preventDefault()
      fermerBandeAnnonce()
    }
  })

  document.addEventListener("change", (event) => {
    const selecteur = event.target.closest("[data-saison-panneau]")
    if (!selecteur) return
    const nouvelleSaison = Number(selecteur.value)
    if (!Number.isInteger(nouvelleSaison) || nouvelleSaison <= 0) return
    chargerPanneau(nouvelleSaison, saison, episode, langueActive)
  })

  panneau?.addEventListener("keydown", (event) => {
    const onglets = [...panneau.querySelectorAll('[role="tab"]')]
    if (!onglets.length) return
    const index = onglets.indexOf(document.activeElement)
    if (index < 0) return

    let cible = null
    if (event.key === "ArrowRight") cible = onglets[(index + 1) % onglets.length]
    else if (event.key === "ArrowLeft") cible = onglets[(index - 1 + onglets.length) % onglets.length]
    else if (event.key === "Home") cible = onglets[0]
    else if (event.key === "End") cible = onglets[onglets.length - 1]
    if (!cible) return

    event.preventDefault()
    cible.focus()
    activerOnglet(cible.id)
  })

  // --- Copie du lien -------------------------------------------------------

  function copierTexte(texte) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(texte)

    return new Promise((resolve, reject) => {
      const zone = document.createElement("textarea")
      zone.value = texte
      zone.setAttribute("readonly", "")
      zone.style.position = "fixed"
      zone.style.opacity = "0"
      document.body.append(zone)
      zone.select()
      const ok = document.execCommand("copy")
      zone.remove()
      if (ok) resolve()
      else reject(new Error("Copie impossible"))
    })
  }

  async function copierLien(bouton) {
    const message = racine.querySelector("[data-copie-msg]")
    const libelle = bouton.dataset.libelle ?? bouton.textContent
    bouton.dataset.libelle = libelle

    try {
      await copierTexte(location.href)
      bouton.textContent = "Lien copié"
      if (message) message.textContent = "Lien copié dans le presse-papiers."
    } catch {
      bouton.textContent = "Copie impossible"
      if (message) message.textContent = "Impossible de copier le lien."
    }

    setTimeout(() => {
      bouton.textContent = bouton.dataset.libelle
      if (message) message.textContent = ""
    }, 2200)
  }

  // --- Bande-annonce -------------------------------------------------------

  const modale = racine.querySelector("[data-modale]")
  const videoModale = modale?.querySelector("[data-video-bande-annonce]")

  function ouvrirBandeAnnonce(cle) {
    if (!modale || !videoModale || !cle) return
    focusAvantModale = document.activeElement
    videoModale.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(cle)}?autoplay=1&rel=0`
    modale.hidden = false
    document.body.classList.add("modale-ouverte")
    modale.querySelector(".modale-fermer")?.focus()
  }

  function fermerBandeAnnonce() {
    if (!modale || modale.hidden) return
    modale.hidden = true
    videoModale?.removeAttribute("src")
    document.body.classList.remove("modale-ouverte")
    if (focusAvantModale instanceof HTMLElement) focusAvantModale.focus()
    focusAvantModale = null
  }

  // Tab peut sortir d'une iframe YouTube sans que le keydown remonte ici :
  // on ramène le focus dans la modale dès qu'il atteint l'extérieur.
  document.addEventListener("focusin", (event) => {
    if (!modale || modale.hidden || modale.contains(event.target)) return
    modale.querySelector(".modale-fermer")?.focus()
  })

  document.addEventListener("keydown", (event) => {
    if (!modale || modale.hidden) return

    if (event.key === "Escape") {
      event.preventDefault()
      fermerBandeAnnonce()
      return
    }

    if (event.key !== "Tab") return
    const focusables = [...modale.querySelectorAll("button, [href], iframe, [tabindex]:not([tabindex=\"-1\"])")]
      .filter((element) => !element.disabled && element.offsetParent !== null)
    if (!focusables.length) return

    const premier = focusables[0]
    const dernier = focusables[focusables.length - 1]
    if (event.shiftKey && document.activeElement === premier) {
      event.preventDefault()
      dernier.focus()
    } else if (!event.shiftKey && document.activeElement === dernier) {
      event.preventDefault()
      premier.focus()
    }
  })

  // --- Demandes de titres --------------------------------------------------

  document.addEventListener("submit", async (event) => {
    const formulaire = event.target.closest("[data-demande]")
    if (!formulaire) return
    event.preventDefault()

    const message = formulaire.querySelector(".form-msg")
    const bouton = formulaire.querySelector('button[type="submit"]')
    const corps = {
      type: formulaire.dataset.type,
      id: Number(formulaire.dataset.id),
    }
    if (corps.type === "tv") {
      corps.season = Number(formulaire.dataset.saison)
      corps.episode = Number(formulaire.dataset.episode)
    }

    if (bouton) bouton.disabled = true
    if (message) {
      message.textContent = "Envoi en cours…"
      message.className = "form-msg"
    }

    try {
      const reponse = await fetch("/api/demande", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(corps),
      })
      const donnees = await reponse.json().catch(() => null)

      if (!reponse.ok) {
        if (message) {
          message.textContent = donnees?.erreur ?? "Impossible d'envoyer la demande pour le moment."
          message.className = "form-msg erreur"
        }
        return
      }

      if (message) {
        message.textContent = donnees?.message ?? "Demande envoyée."
        message.className = "form-msg ok"
      }
      if (donnees?.recharger) setTimeout(() => location.reload(), 1200)
    } catch {
      if (message) {
        message.textContent = "Impossible de joindre le serveur. Vérifie ta connexion."
        message.className = "form-msg erreur"
      }
    } finally {
      if (bouton) bouton.disabled = false
    }
  })

  mettreAJourTitre()
  mettreAJourUrl()
})()
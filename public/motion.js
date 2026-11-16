// CineFlow : animations et finitions de l'interface.
// Purement décoratif : sans ce script, le site reste complet et utilisable.
// Rien ne bouge si le visiteur demande moins d'animations (prefers-reduced-motion).
(() => {
  const calme = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const pointeurFin = window.matchMedia("(hover: hover) and (pointer: fine)").matches
  const racine = document.documentElement

  // --- Images : fondu à l'arrivée, fin du shimmer de la case -----------------
  function suivreImages(zone = document) {
    for (const a of zone.querySelectorAll(".affiche:not(.charge)")) if (!a.querySelector("img")) a.classList.add("charge")
    for (const img of zone.querySelectorAll(".affiche img, .fiche-affiche img, .saison-carte img, .personne-photo img, .episode img")) {
      if (img.dataset.suivie) continue
      img.dataset.suivie = "1"
      const pret = () => {
        img.classList.add("img-ok")
        img.closest(".affiche")?.classList.add("charge")
      }
      if (img.complete && img.naturalWidth) pret()
      else {
        img.classList.add("img-attente")
        img.addEventListener("load", pret, { once: true })
        img.addEventListener("error", pret, { once: true })
      }
    }
  }

  // --- En-tête : verre dépoli dès qu'on défile + barre de progression --------
  function entete() {
    const header = document.querySelector("header")
    const barre = document.createElement("div")
    barre.className = "progression-defilement"
    barre.setAttribute("aria-hidden", "true")
    document.body.append(barre)

    let attente = false
    const maj = () => {
      attente = false
      const y = window.scrollY
      header?.classList.toggle("defile", y > 12)
      const max = document.documentElement.scrollHeight - window.innerHeight
      barre.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`
    }
    window.addEventListener("scroll", () => {
      if (!attente) {
        attente = true
        requestAnimationFrame(maj)
      }
    }, { passive: true })
    maj()
  }

  // --- Navigation en pilules : indicateur qui glisse --------------------------
  function pilules() {
    const nav = document.querySelector("nav.pills")
    if (!nav) return
    const indic = document.createElement("span")
    indic.className = "pill-indicateur"
    indic.setAttribute("aria-hidden", "true")
    nav.prepend(indic)
    nav.classList.add("avec-indicateur")

    const placer = (pill, instantane = false) => {
      if (!pill) {
        indic.style.opacity = "0"
        return
      }
      if (instantane) indic.style.transition = "none"
      indic.style.opacity = "1"
      indic.style.width = `${pill.offsetWidth}px`
      indic.style.transform = `translateX(${pill.offsetLeft}px)`
      if (instantane) requestAnimationFrame(() => { indic.style.transition = "" })
    }
    const actif = () => nav.querySelector(".pill.on")

    placer(actif(), true)
    nav.classList.toggle("survol-libre", !actif())
    for (const pill of nav.querySelectorAll(".pill")) {
      pill.addEventListener("pointerenter", () => {
        nav.classList.add("survol")
        placer(pill)
      })
    }
    nav.addEventListener("pointerleave", () => {
      nav.classList.remove("survol")
      placer(actif())
    })
    window.addEventListener("resize", () => placer(actif(), true))
    document.fonts?.ready.then(() => placer(actif(), true))
  }

  // --- Apparition au défilement (cascade) -------------------------------------
  const SELECTEUR_REVELE = [
    ".rang .carte", ".grille .carte", "main h2", ".fiche-principale",
    ".saison-carte", ".personne", ".avis", ".vide-boite",
    ".lecteur-cadre", ".avis-cta", ".form-avis", ".zone-danger", ".onglets", ".titre-page",
    ".pl-tete", ".pl-vide", ".pied-geant",
  ].join(",")

  function reveler() {
    const elements = [...document.querySelectorAll(SELECTEUR_REVELE)].filter((el) => !el.closest(".pf, .pf-stats"))
    if (!elements.length) return

    // Position dans le parent : sert de délai pour l'effet cascade (plafonné).
    for (const el of elements) {
      const freres = el.parentElement ? [...el.parentElement.children] : [el]
      el.style.setProperty("--i", String(Math.min(freres.indexOf(el), 10)))
      // Cartes d'affiche : hauteur du masque dans lequel elles glissent.
      if (el.classList.contains("carte")) el.style.setProperty("--h", `${el.offsetHeight + 8}px`)
      el.classList.add("rv")
    }

    const observateur = new IntersectionObserver((entrees) => {
      for (const entree of entrees) {
        if (!entree.isIntersecting) continue
        entree.target.classList.add("vu")
        observateur.unobserve(entree.target)
      }
    }, { rootMargin: "0px 40px -6% 40px", threshold: 0.01 })

    for (const el of elements) observateur.observe(el)

    // Filet de sécurité : rien ne doit rester invisible.
    setTimeout(() => {
      for (const el of elements) {
        const r = el.getBoundingClientRect()
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("vu")
      }
    }, 1600)
  }

  // --- Affiches : inclinaison 3D et reflet qui suit la souris -----------------
  function inclinaison() {
    let cible = null
    let image = 0

    document.addEventListener("pointermove", (event) => {
      const affiche = event.target.closest?.(".carte .affiche, .fiche-affiche")
      if (affiche !== cible) {
        cible?.classList.remove("incline")
        cible?.style.removeProperty("--rx")
        cible?.style.removeProperty("--ry")
        cible = affiche
      }
      if (!affiche) return
      cancelAnimationFrame(image)
      image = requestAnimationFrame(() => {
        const r = affiche.getBoundingClientRect()
        const x = (event.clientX - r.left) / r.width
        const y = (event.clientY - r.top) / r.height
        affiche.classList.add("incline")
        affiche.style.setProperty("--rx", `${((0.5 - y) * 10).toFixed(2)}deg`)
        affiche.style.setProperty("--ry", `${((x - 0.5) * 12).toFixed(2)}deg`)
        affiche.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`)
        affiche.style.setProperty("--my", `${(y * 100).toFixed(1)}%`)
      })
    }, { passive: true })

    document.addEventListener("pointerleave", () => {
      cible?.classList.remove("incline")
      cible = null
    })
  }

  // --- Projecteur : halo qui suit la souris sur les cartes -------------------
  function projecteur() {
    document.addEventListener("pointermove", (event) => {
      const el = event.target.closest?.(".saison-carte, .vide-boite, .avis, .langue, .avis-cta, .form-avis")
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty("--px", `${event.clientX - r.left}px`)
      el.style.setProperty("--py", `${event.clientY - r.top}px`)
    }, { passive: true })
  }

  // --- Compteurs du profil : défilement des chiffres --------------------------
  function compteurs() {
    const nombres = document.querySelectorAll("[data-compte]:not(.pf-nombre)")
    if (!nombres.length) return
    const observateur = new IntersectionObserver((entrees) => {
      for (const entree of entrees) {
        if (!entree.isIntersecting) continue
        observateur.unobserve(entree.target)
        const el = entree.target
        const fin = Number(el.dataset.compte) || 0
        if (fin === 0) continue
        const duree = Math.min(1400, 500 + fin * 40)
        const t0 = performance.now()
        const pas = (t) => {
          const p = Math.min(1, (t - t0) / duree)
          const lisse = 1 - Math.pow(1 - p, 4)
          el.textContent = String(Math.round(fin * lisse))
          if (p < 1) requestAnimationFrame(pas)
        }
        el.textContent = "0"
        requestAnimationFrame(pas)
      }
    }, { threshold: 0.4 })
    for (const n of nombres) observateur.observe(n)
  }

  // --- Boutons : onde au clic --------------------------------------------------
  function ondes() {
    document.addEventListener("pointerdown", (event) => {
      const bouton = event.target.closest?.(".play, .btn-demande, .suivant, .danger, .discord, .btn-ligne, .act-texte")
      if (!bouton) return
      const r = bouton.getBoundingClientRect()
      const onde = document.createElement("span")
      onde.className = "onde"
      onde.style.left = `${event.clientX - r.left}px`
      onde.style.top = `${event.clientY - r.top}px`
      bouton.append(onde)
      onde.addEventListener("animationend", () => onde.remove(), { once: true })
    })
  }

  // --- Rangées : défilement horizontal à la molette + flèches -----------------
  function rangees() {
    for (const rang of document.querySelectorAll(".rang")) {
      if (rang.dataset.fleches) continue
      rang.dataset.fleches = "1"
      const cadre = document.createElement("div")
      cadre.className = "rang-cadre"
      rang.before(cadre)
      cadre.append(rang)

      const fleche = (sens) => {
        const b = document.createElement("button")
        b.type = "button"
        b.className = `rang-fleche rang-fleche-${sens > 0 ? "droite" : "gauche"}`
        b.setAttribute("aria-label", sens > 0 ? "Défiler vers la droite" : "Défiler vers la gauche")
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${sens > 0 ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"}"/></svg>`
        b.addEventListener("click", () => rang.scrollBy({ left: sens * rang.clientWidth * 0.85, behavior: calme ? "auto" : "smooth" }))
        cadre.append(b)
        return b
      }
      const gauche = fleche(-1)
      const droite = fleche(1)
      const etat = () => {
        const max = rang.scrollWidth - rang.clientWidth - 2
        gauche.classList.toggle("off", rang.scrollLeft <= 2)
        droite.classList.toggle("off", rang.scrollLeft >= max)
        cadre.classList.toggle("debordant", max > 0)
      }
      rang.addEventListener("scroll", etat, { passive: true })
      window.addEventListener("resize", etat)
      etat()
    }
  }

  // --- Profil : lettres masquées, odomètre, parallaxe (inspiration Lusion) ----
  function profil() {
    const pf = document.querySelector(".pf")
    if (!pf) return
    const stats = document.querySelector(".pf-stats")

    // Enveloppe le contenu dans un masque : il monte depuis sous la ligne.
    const masquer = (el, delai = 0) => {
      if (!el) return
      const masque = document.createElement("span")
      masque.className = "pf-masque"
      const dedans = document.createElement("span")
      dedans.style.setProperty("--d", `${delai}ms`)
      while (el.firstChild) dedans.append(el.firstChild)
      masque.append(dedans)
      el.append(masque)
    }

    // Pseudo : un masque par mot, une lettre (graphème) par span.
    const h1 = pf.querySelector("h1")
    if (h1) {
      const texte = h1.textContent.trim()
      const graphemes = (mot) => (typeof Intl !== "undefined" && Intl.Segmenter
        ? [...new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(mot)].map((g) => g.segment)
        : Array.from(mot))
      h1.setAttribute("aria-label", texte)
      h1.textContent = ""
      let i = 0
      for (const [position, mot] of texte.split(/\s+/).filter(Boolean).entries()) {
        if (position) h1.append(" ")
        const boite = document.createElement("span")
        boite.className = "pf-mot"
        boite.setAttribute("aria-hidden", "true")
        for (const g of graphemes(mot)) {
          const lettre = document.createElement("span")
          lettre.className = "pf-car"
          lettre.style.setProperty("--i", String(i))
          lettre.textContent = g
          boite.append(lettre)
          i += 1
        }
        h1.append(boite)
      }
    }
    masquer(pf.querySelector(".pf-compte"), 560)
    masquer(pf.querySelector(".pf-badges"), 620)
    masquer(pf.querySelector(".pf-nom .vide"), 680)

    // Odomètre : chaque chiffre est une bande 0-9 (deux tours) qui défile.
    const bandes = []
    const odometre = (b, delai) => {
      const valeur = String(Math.max(0, Number(b.dataset.compte) || 0))
      b.setAttribute("aria-label", valeur)
      b.textContent = ""
      for (const [position, chiffre] of [...valeur].entries()) {
        const od = document.createElement("span")
        od.className = "od"
        od.setAttribute("aria-hidden", "true")
        const bande = document.createElement("span")
        bande.className = "od-bande"
        bande.style.setProperty("--n", "-1")
        bande.style.setProperty("--od-d", `${delai + (valeur.length - 1 - position) * 60}ms`)
        for (let k = 0; k < 20; k += 1) {
          const ligne = document.createElement("span")
          ligne.textContent = String(k % 10)
          bande.append(ligne)
        }
        od.append(bande)
        b.append(od)
        bandes.push([bande, 10 + Number(chiffre)])
      }
    }
    for (const [c, colonne] of [...(stats?.querySelectorAll(".pf-stat") ?? [])].entries()) {
      masquer(colonne.querySelector(".pf-index"), c * 120)
      const nombre = colonne.querySelector(".pf-nombre")
      if (nombre) odometre(nombre, c * 120 + 80)
      masquer(colonne.querySelector(".pf-libelle"), c * 120 + 160)
    }

    // Entrée de l'en-tête : après les polices (ou 400 ms au plus tard).
    let pret = false
    const lancer = () => {
      if (pret) return
      pret = true
      requestAnimationFrame(() => requestAnimationFrame(() => pf.classList.add("pf-pret")))
    }
    document.fonts?.ready.then(lancer)
    setTimeout(lancer, 400)
    setTimeout(() => pf.classList.add("pf-pret"), 1500)

    // Statistiques : à l'entrée dans l'écran.
    if (stats) {
      const voir = () => {
        if (stats.classList.contains("pf-vu")) return
        stats.classList.add("pf-vu")
        requestAnimationFrame(() => requestAnimationFrame(() => {
          for (const [bande, fin] of bandes) bande.style.setProperty("--n", String(fin))
        }))
      }
      const observateur = new IntersectionObserver((entrees) => {
        if (entrees.some((entree) => entree.isIntersecting)) {
          observateur.disconnect()
          voir()
        }
      }, { threshold: 0.25 })
      observateur.observe(stats)
      setTimeout(() => {
        const r = stats.getBoundingClientRect()
        if (r.top < window.innerHeight && r.bottom > 0) voir()
      }, 2500)
    }

  }

  // --- Profil sans bannière : bandeau à la couleur moyenne de l'avatar ---------
  function couleurBandeau() {
    const bandeau = document.querySelector(".pf-banniere-vide")
    const avatar = document.querySelector(".pf-avatar .avatar-geant")
    if (!bandeau || !avatar || bandeau.style.getPropertyValue("--pf-accent")) return
    const image = new Image()
    image.crossOrigin = "anonymous"
    image.addEventListener("load", () => {
      try {
        const toile = document.createElement("canvas")
        toile.width = 8
        toile.height = 8
        const contexte = toile.getContext("2d")
        contexte.drawImage(image, 0, 0, 8, 8)
        const pixels = contexte.getImageData(0, 0, 8, 8).data
        let rouge = 0
        let vert = 0
        let bleu = 0
        for (let i = 0; i < pixels.length; i += 4) {
          rouge += pixels[i]
          vert += pixels[i + 1]
          bleu += pixels[i + 2]
        }
        const n = pixels.length / 4
        bandeau.style.setProperty("--pf-accent", `rgb(${Math.round(rouge / n)},${Math.round(vert / n)},${Math.round(bleu / n)})`)
      } catch {
        // Image non lisible (CORS) : le bandeau garde sa couleur neutre.
      }
    })
    image.src = avatar.currentSrc || avatar.src
  }

  // --- Démarrage --------------------------------------------------------------
  const demarrer = () => {
    suivreImages()
    entete()
    rangees()
    couleurBandeau()
    if (calme) {
      // Moins d'animations : la nameplate reste sur son image fixe.
      for (const video of document.querySelectorAll("video.nameplate-image")) {
        video.removeAttribute("autoplay")
        video.pause()
      }
      return
    }
    racine.classList.add("js-motion")
    pilules()
    profil()
    reveler()
    compteurs()
    ondes()
    if (pointeurFin) {
      inclinaison()
      projecteur()
    }
    // Contenu ajouté plus tard (récents locaux, retours d'API) : images et rangées suivies aussi.
    new MutationObserver(() => {
      suivreImages()
      rangees()
    }).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer)
  else demarrer()
})()

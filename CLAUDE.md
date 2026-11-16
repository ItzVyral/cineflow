# CineFlow

Site de streaming de films et séries. Données et images via TMDB, catalogue et lecteur via l'API HeiwaStream. Design sombre inspiré de Jellyfin avec un accent rouge. Interface et textes en français.

## Stack

- Node 18+, Express 5, ESM (`"type": "module"`)
- HTML rendu côté serveur (template strings), JS vanilla dans `public/`
- Pas de framework front, pas de bundler
- Dépendances : `express`, `dotenv` (d'autres seulement si la tâche l'exige, ex. `better-sqlite3`, `helmet`)

## Commandes

- `npm install` : installer
- `npm start` : lancer sur http://localhost:3000
- `node --check server.js` : vérifier la syntaxe

## Structure

```
server.js        routes et gabarits HTML
heiwa.js         client HeiwaStream, cache mémoire (enCache), client TMDB
public/
  style.css      tout le CSS
  logo.svg       bannière transparente (en-tête)
  icone.svg      icône « C » (favicon)
  player.js      JS de la page de lecture (si présent)
.env             secrets, jamais commité
```

Découper en fichiers (auth.js, db.js, routes/…) quand `server.js` grossit, plutôt que d'en faire un fichier géant.

## Variables d'environnement

- `HEIWA_CLE` : clé API HeiwaStream (`hs_…`), serveur uniquement
- `HEIWA_SITE` : identifiant public du lecteur (`pk_…`), visible dans les iframes
- `TMDB_KEY` : clé TMDB v3, serveur uniquement
- `SITE_URL` : URL publique en https (pour le paramètre `logo` du lecteur), facultatif

Maintenir `.env.example` à jour. Ne jamais mettre de clé dans une page, une URL ou un commit.

## Design

- Fond `#101012`, cartes `#1c1c20`, texte `#f1f1f4`, texte doux `#a4a4ad`
- Accent rouge `#FF0033` : boutons principaux, états actifs, focus, barre de progression
- Police Inter, rayons 10 à 16 px
- Disposition inspirée de Jellyfin : bandeau héros, onglets en pilule, rangées d'affiches
- Focus clavier visible, `prefers-reduced-motion` respecté, `aria-label` sur les boutons-icônes
- Logo : `public/logo.svg` dans l'en-tête, `public/icone.svg` en favicon
- Le pied de page garde la mention d'attribution TMDB (obligatoire)

## TMDB

- Appels côté serveur uniquement, en une requête avec `append_to_response` (credits, videos, recommendations, images), langue `fr-FR`
- Images : `https://image.tmdb.org/t/p/{taille}{chemin}` (w185, w300, w342, w500, original)
- Cache d'une heure via `enCache`

## API HeiwaStream

Base : `https://heiwastream.fr/api/v1`. Doc complète : https://heiwastream.fr/docs/api. **Ne rien inventer** : si un paramètre, une route ou un événement n'est pas dans la doc, le dire au lieu de deviner.

Requêtes : en-têtes `Authorization: Bearer ${HEIWA_CLE}` et `User-Agent: CineFlow/1.0` (le User-Agent évite des 403 en ligne).

Routes utilisées :
- `GET /news/{type}` : derniers ajouts (items `{type, tmdb, season?, episode?, languages, at}`)
- `GET /available/{type}/{id}[/{saison}/{episode}]` : disponibilité, langues, qualité ; plusieurs titres d'un coup avec `id,id,id` (100 max)
- `GET /tv/{id}[/{saison}]` : saisons et épisodes avec langues
- `GET /title/{type}/{id}` : fiche (titre, résumé, poster, backdrop, logo, durée, genres, trailer)
- `GET /find/{titre}`, `GET /catalog/{type}`, `GET /top/{period}/{type}`, `GET /calendar`
- `GET /reviews/{type}/{id}` et `POST /reviews` (avis, signés « Anonyme » côté API)
- `POST /requests`, `GET /requests` : demander un titre manquant
- `POST /report`, `GET /report` : signalements
- `GET /key/ad-free` : jeton sans pub valable 6 h (à demander côté serveur)

Limites : 10 req/s, 300/min, 250 000/jour ; recherche, catalogue, lots et envois : 60/min ensemble. Sur un 429, attendre `Retry-After`. Continuer à envoyer des requêtes refusées fait suspendre la clé : mettre en cache, grouper en lots, ne jamais boucler.

Envois par visiteur : demandes 3/jour, signalements 5/jour, avis 20/jour. Le `requester`/`reporter`/`reviewer` est un identifiant aléatoire stable par visiteur (cookie httpOnly), jamais un email ni un pseudo.

Webhooks (facultatif) : `POST /heiwa/webhook`, répondre 200 tout de suite, vérifier l'en-tête privé ou la signature `X-Heiwa-Signature`. `event` vaut `news`, `report`, `request` ou `test`.

## Lecteur HeiwaStream (iframe)

- Film : `https://heiwastream.fr/embed/movie/{id}`
- Épisode : `https://heiwastream.fr/embed/tv/{id}/{saison}/{episode}`
- Toujours `?site=${HEIWA_SITE}` ; sans lui, ou sur un domaine non déclaré dans « Mes sites » (localhost compris, pas `file://`), aucun réglage ne s'applique
- Attributs : `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen`
- Réglages utilisés : `color=ff0033`, `progress=ff0033`, `bg=101012`, `name=CineFlow`, `room=0` (masque « Regarder ensemble »), `report=1` (drapeau de signalement), `episodes=0` (masque la liste du lecteur quand le panneau du site la remplace), `t=` (seconde de départ), `lang=vf|vostfr`
- Messages du lecteur (`postMessage`, toujours vérifier `e.origin === "https://heiwastream.fr"`) : `ready`, `play`, `pause`, `time` (position, duration, toutes les 5 s), `ended`, `episode` (season, episode), `error`
- Commandes vers le lecteur : `play`, `pause`, `seek` (position), `volume`, `mute`, `episode` (season, episode)
- Le choix de la langue se fait par l'URL (`lang=`), pas par message

## Page de lecture

- `/film/:id` et `/serie/:id/:saison/:episode`
- Barre fine en haut (« ‹ Retour », titre + SxxExx, « Copier le lien »), lecteur dans un cadre arrondi, infos TMDB dessous
- Séries : panneau d'épisodes à droite construit par le site (miniatures TMDB, saisons, langues, bouton « Suivant »), synchronisé avec le lecteur via les messages `episode` et `time`
- Pas de « Regarder ensemble », pas de bouton de téléchargement
- Si `available` vaut `false` : état « Pas encore disponible » avec bouton « Demander ce titre »

## Conventions

- Échapper tout texte affiché avec `e()`
- Les erreurs externes (TMDB, HeiwaStream) ne doivent jamais faire tomber une page : `.catch(() => null)` et état vide propre
- Requêtes SQL préparées uniquement (si base de données)
- Commentaires en français quand c'est utile, noms de variables en français ou en anglais selon l'existant
- Routes `/api/…` : JSON avec des codes HTTP propres (401, 404, 429)

## Idées prévues (pas encore faites)

Connexion Discord (OAuth2, scope `identify`), favoris, liste de lecture, reprise de lecture en base (SQLite), formulaire d'avis, recherche, page catalogue, profil avec suppression des données.

## Règles pour l'IA

- Lire `server.js`, `heiwa.js` et `public/style.css` avant de modifier
- Ne pas changer l'identité visuelle sans demande
- Ne pas inventer d'endpoint, de paramètre ou d'événement HeiwaStream : consulter la doc, sinon le dire
- Tester les parcours concernés après chaque changement et dire ce qui n'a pas pu être vérifié
- Mettre à jour le README et `.env.example` quand on ajoute une variable ou une étape d'installation
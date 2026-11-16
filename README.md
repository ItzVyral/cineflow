# CineFlow

CineFlow est une interface de streaming de films, de séries et d'animés
construite autour de l'API HeiwaStream et des métadonnées TMDB. La recherche,
le catalogue, la disponibilité, les épisodes et les avis viennent de
HeiwaStream ; les fiches, affiches et logos viennent de TMDB (avec l'API
HeiwaStream en secours).

Le site fonctionne sans framework front : pages rendues côté serveur avec
Express, JavaScript vanilla côté client, PostgreSQL (Supabase en ligne) pour les comptes et les données
personnelles.

## Fonctionnalités

- **Recherche multi-type** : la recherche passe par `GET /find/{titre}` de
  HeiwaStream et couvre les films, les séries et les animés. Filtres
  « Tous / Films / Séries / Animés ». L'identifiant TMDB renvoyé par l'API (et
  présent dans les URL du lecteur) sert à charger les affiches et les fiches.
- **Catalogue** : nouveautés mixtes sur l'accueil, catalogue paginé par type
  (`/catalogue?type=movie|tv|anime`, 20 pages).
- **Lecteur intégré** : chaque film et chaque épisode a sa page
  (`/film/:id`, `/serie/:id/:saison/:episode`) avec le lecteur HeiwaStream dans
  un cadre 16:9, un en-tête fin (retour, titre, copie du lien) et, pour les
  séries, un panneau latéral « En lecture ».
- **Panneau série** : onglets « Langues » et « Épisodes », choix de la saison,
  liste des épisodes disponibles avec vignette et langues, bouton « Suivant »
  qui enchaîne sur l'épisode ou la saison suivante. Les changements d'épisode
  se font sans recharger la page : le lecteur, l'URL, le titre et le panneau
  restent synchronisés.
- **Fiche TMDB complète** : affiche, titres, note, genres, synopsis, casting,
  réalisation et scénario, saisons, bande-annonce dans une modale accessible,
  et « Titres similaires » filtrés par la disponibilité HeiwaStream.
- **Demandes de titres** : quand un film ou un épisode manque, un bouton envoie
  une demande à HeiwaStream (3 par visiteur et par jour) et affiche un message
  clair selon la réponse : demande envoyée, déjà disponible, pas encore sorti
  ou demandes fermées.
- **Sans publicité (option)** : avec `HEIWA_SANS_PUB=1`, CineFlow demande un
  jeton `GET /key/ad-free` (valable 6 h, mis en cache côté serveur) et affiche
  le badge « Sans publicité » dans le panneau.
- **Comptes Discord** : connexion OAuth2 avec le seul scope `identify`. Seuls
  l'identifiant Discord, le pseudo, l'avatar, la décoration d'avatar et la
  nameplate sont enregistrés. Aucun token Discord n'est conservé. La décoration
  choisie sur Discord est affichée autour de la photo de profil (en-tête et
  profil), et la nameplate sert de bannière derrière le pseudo sur `/profil`.
- **Favoris et liste de lecture** : cœur et bouton « + » sur chaque affiche et
  sur la page d'un titre, sans rechargement. Les films et les séries sont
  distingués par leur type. Pages dédiées `/favoris` et `/liste`.
- **Reprise de lecture** : la progression réelle du lecteur HeiwaStream est
  enregistrée (événements `time`, `ended`) avec la saison et l'épisode, puis
  reprise automatique via `t=` et `seek`. Elle est stockée en base pour un
  compte connecté et dans `localStorage` pour un visiteur. Une rangée
  « Continuer de regarder » apparaît sur l'accueil.
- **Récemment vus** : une rangée sur l'accueil liste les derniers titres
  consultés. Elle est stockée en base pour un compte connecté (sur tous ses
  appareils) et dans `localStorage` pour un visiteur non connecté.
- **Avis** : consultation des avis HeiwaStream et formulaire de note (1 à 5)
  avec commentaire et spoiler, pour les films comme pour les séries. Le cache
  est invalidé après envoi.
- **Profil** : avatar, nameplate Discord derrière le pseudo, compteurs et
  suppression définitive du compte et de toutes ses données, avec confirmation.

## Prérequis

- **Node.js 22 ou plus**.
- Une clé API HeiwaStream et l'identifiant public du site (`pk_…`).
- Une clé API TMDB (v3), recommandée pour les affiches, les notes et les
  saisons. Sans elle, CineFlow bascule sur les fiches `GET /title/{type}/{id}`
  de HeiwaStream (moins complètes).
- Une application Discord (facultatif pour consulter le site, nécessaire pour
  les comptes).

## Installation

```bash
npm install
cp .env.example .env
```

Renseigne ensuite le `.env` (voir la section suivante), puis lance :

```bash
npm start
```

Le site est disponible sur <http://localhost:3000>. Sans `DATABASE_URL`, la base est un
Postgres embarqué (PGlite) stocké dans `data/pglite`, créé au premier
démarrage avec ses migrations : rien à installer. Avec `DATABASE_URL`, le
site utilise ce PostgreSQL (Supabase en production).

## Base Supabase

1. Créer un projet sur https://supabase.com (offre gratuite) et noter le mot
   de passe de la base.
2. **Connect** (en haut du projet) > **Connection string** > **Session
   pooler** : copier l'URL
   `postgresql://postgres.<ref>:<mot de passe>@aws-…pooler.supabase.com:5432/postgres`.
3. La mettre dans `DATABASE_URL` (`.env` en local, variables Render en
   ligne). Les tables sont créées automatiquement au démarrage.

Le serveur parle directement à Postgres : ni la clé `anon` ni le SDK Supabase
ne sont utilisés. Sur l'offre gratuite, un projet sans activité pendant 7 jours
est mis en pause : le réactiver depuis le tableau de bord Supabase.

## Déploiement sur Render

Le fichier `render.yaml` décrit le service (offre gratuite, Node 22, HTTPS géré
par Render). Les données sont dans Supabase (voir ci-dessus).

1. Pousser le dépôt sur GitHub.
2. Sur https://dashboard.render.com : **New > Blueprint**, choisir le dépôt.
3. Renseigner les valeurs demandées : `DATABASE_URL`, `HEIWA_CLE`, `HEIWA_SITE`, `TMDB_KEY`,
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`
   (`https://<service>.onrender.com/auth/discord/callback`).
   `SESSION_SECRET` est généré automatiquement.
4. Une fois en ligne :
   - ajouter l'URL de redirection dans l'application Discord (OAuth2) ;
   - déclarer le domaine `<service>.onrender.com` dans « Mes sites » sur
     HeiwaStream, sinon les réglages du lecteur ne s'appliquent pas.

Sur l'offre gratuite, le service s'endort après 15 min sans visite et met
environ 30 s à se réveiller. Les données ne sont pas perdues : elles sont dans
Supabase.

Chaque push sur `main` redéploie automatiquement.

## Configuration Discord

1. Ouvre <https://discord.com/developers/applications> et crée une
   **New Application**.
2. Dans **OAuth2**, copie le **Client ID** et génère un **Client Secret**.
3. Ajoute une URL de redirection autorisée :
   `http://localhost:3000/auth/discord/callback`
   (ou l'URL publique exacte du site en production).
4. Renseigne le `.env` :

```dotenv
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
SESSION_SECRET=…
```

Aucun bot Discord n'est nécessaire : le scope demandé est uniquement
`identify`. Le secret Discord ne doit jamais être exposé côté navigateur.

Génère `SESSION_SECRET` avec :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `PORT` | Port HTTP. Vide : premier port libre à partir de `3000`. |
| `NODE_ENV` | `production` active les cookies `Secure` et le cache des fichiers statiques. |
| `TRUST_PROXY` | `1` derrière un reverse proxy de confiance (HTTPS, IP cliente réelle). |
| `DATABASE_URL` | Chaîne PostgreSQL (Supabase « Session pooler »). Vide : PGlite local. |
| `DATA_DIR` | Dossier de la base PGlite locale si `DATABASE_URL` est vide (défaut `data`). |
| `HEIWA_CLE` | Clé privée de l'API HeiwaStream. Ne jamais la diffuser. |
| `HEIWA_SITE` | Identifiant public du site (`pk_…`) utilisé par le lecteur. |
| `HEIWA_SANS_PUB` | `1` active la demande de jeton sans publicité et le badge correspondant (défaut `0`). |
| `TMDB_KEY` | Clé API TMDB v3 (recommandée : affiches, notes, liste des saisons). |
| `DISCORD_CLIENT_ID` | Client ID de l'application Discord. |
| `DISCORD_CLIENT_SECRET` | Client Secret de l'application Discord. |
| `DISCORD_REDIRECT_URI` | URL de retour OAuth2, identique à celle déclarée dans Discord. |
| `DISCORD_SERVER_LINK` | Invitation du serveur Discord affichée dans le pied de page (facultatif). |
| `SESSION_SECRET` | Secret HMAC des cookies de session, obligatoire en production. |

`.env` est ignoré par Git. `.env.example` ne contient que les noms des
variables, jamais de valeur réelle.

## Structure

```text
server.js               # application Express, sécurité, montage des routes
src/
├── auth.js             # OAuth2 Discord, state signé, déconnexion
├── db.js               # PostgreSQL / PGlite, migrations, requêtes paramétrées
├── heiwa.js            # client HeiwaStream, TMDB et cache mémoire
├── media.js            # types (movie/tv), filtres (anime), libellés de badge
├── nameplate.js        # validation des assets/palettes et URL CDN Discord
├── render.js           # gabarit HTML, cartes, boutons, pagination, nameplate
├── session.js          # cookie de session signé HMAC
└── routes/
    ├── pages.js        # accueil, lecteur film/série, recherche, catalogue, favoris, profil
    └── api.js          # favoris, liste, historique, avis, demandes (JSON)
public/
├── app.js              # actions client (favoris, avis, menus, récemment vus)
├── player.js           # lecteur : messages Heiwa, panneau, reprise, demandes, modale
├── style.css           # design sombre, responsive
├── logo.svg
└── icone.svg
.well-known/
└── heiwastream.txt     # vérification du domaine, servie telle quelle
```

## Routes

| Route | Contenu |
| --- | --- |
| `/` | Nouveautés mixtes, « Continuer de regarder », recherche. |
| `/film/:id` | Fiche et lecteur d'un film, pleine largeur. |
| `/serie/:id/:saison/:episode` | Fiche et lecteur d'un épisode, avec panneau langues et épisodes. |
| `/serie/:id` | Redirige vers le dernier épisode commencé (compte connecté) ou le premier épisode disponible (`?reprise=1`). |
| `/serie/:id/:saison` | Redirige vers le premier épisode disponible de la saison. |
| `/serie/:id/:saison/panneau` | JSON du panneau pour la saison, l'épisode et la langue actifs (`Cache-Control: no-store`). |
| `/titre/:type/:id` | Ancienne adresse, redirigée en 301 vers `/film/:id` ou `/serie/:id`. |
| `/recherche?q=…&type=tous\|movie\|tv\|anime` | Recherche HeiwaStream filtrée. |
| `/catalogue?type=movie\|tv\|anime&page=N` | Catalogue paginé (20 pages). |
| `/favoris`, `/liste`, `/profil` | Données personnelles (connexion Discord requise). |
| `/api/favoris\|liste\|historique\|avis/:type/:id` | JSON, session obligatoire. |
| `POST /api/demande` | Demande de titre à HeiwaStream, publique, 3 par visiteur et par jour. |

## Données et sécurité

- Base PostgreSQL : `users`, `favorites`, `watchlist`, `history`,
  `recently_viewed`. Les clés étrangères en cascade suppriment toutes les
  données d'un compte.
- Un même identifiant TMDB pouvant désigner un film et une série, `favorites`,
  `watchlist` et `history` ont pour clé `(user_id, media_type, tmdb_id)`.
  `history` stocke en plus `season` et `episode` pour la reprise d'une série.
- Migrations versionnées par `PRAGMA user_version` : la migration 2 ajoute
  `media_type` (et `season`/`episode`) en conservant les données existantes,
  reprises en `movie` ; la migration 3 ajoute `users.avatar_decoration` (asset
  du preset Discord, `NULL` si absent) ; la migration 4 ajoute
  `users.nameplate_asset` et `users.nameplate_palette` ; la migration 5 ajoute
  `recently_viewed` (30 dernières consultations par compte).
- Toutes les requêtes SQL sont préparées ; aucune valeur n'est concaténée.
- Tout contenu dynamique est échappé avec `e()` avant rendu HTML.
- Session : cookie `httpOnly`, `SameSite=Lax`, `Secure` en production, signé en
  HMAC-SHA256 et valable 30 jours. Le cookie ne contient qu'un identifiant
  utilisateur et une date d'expiration.
- Demandes de titres : un cookie `httpOnly` `cineflow_requester` (anonyme,
  stable, 365 jours) identifie le visiteur auprès de HeiwaStream ; une limite
  locale de 3 demandes par jour double celle de l'API. `POST /api/demande` est
  la seule route `/api` publique, les autres vérifient la session.
- Appels externes : clés `HEIWA_CLE` et `TMDB_KEY` réservées au serveur, cache
  mémoire (TMDB : 1 h) et lots de disponibilité pour respecter les limites de
  l'API (10 requêtes/s, 300/min). Un `User-Agent` explicite est envoyé.
- OAuth2 : `state` aléatoire signé et expirant après 10 minutes, retour limité
  aux chemins internes (pas de redirection ouverte).
- Les routes `/auth` et `/api` sont limitées en débit ; les API renvoient du
  JSON `401`, `404` et `429`.
- CSP restrictive : iframe autorisée pour `heiwastream.fr` et les bandes-annonces
  YouTube (`youtube-nocookie.com`, `youtube.com`), images pour `image.tmdb.org`
  et `cdn.discordapp.com`, polices Google.
- Les secrets restent dans `.env` et les tokens Discord ne sont jamais stockés
  ni journalisés.

## Limites connues

- **Numérotation des épisodes** : CineFlow suit celle de HeiwaStream, pas celle
  de TMDB. Pour certains animés, elle est absolue : la saison 2 de Naruto
  commence à l'épisode 53, et `/serie/46260/2/3` retombe donc sur le premier
  épisode disponible de la saison.
- **Recherche** : `GET /find` répond 505 quand l'espace est encodé `%20`. Le
  client encode les espaces en `+`, comme attendu par l'API.
- **Auteur des avis** : l'API HeiwaStream ne permet pas de choisir l'auteur.
  Les avis envoyés depuis un site partenaire sont affichés « Anonyme ». Le
  formulaire l'indique et un identifiant stable (`discord-<id>`) est transmis
  pour respecter la règle « un avis par visiteur et par titre ».
- **Progression** : elle dépend des événements du lecteur. Quand la vidéo est
  jouée par un hébergeur externe, HeiwaStream n'envoie que `ready` et
  `episode` : aucune position n'est alors inventée. Pour un visiteur non
  connecté, la progression reste dans `localStorage`
  (`cineflow:progression:v1`) et ne suit pas le compte.
- **Avis en attente** : les commentaires sont relus par HeiwaStream. Une note
  seule est publiée immédiatement, un commentaire peut rester en attente.
- **Disponibilité** : un titre absent de HeiwaStream n'est pas proposé à la
  lecture, même s'il existe sur TMDB. La disponibilité d'une série est vérifiée
  épisode par épisode.
- **Récemment vus (visiteur)** : la liste locale reste dans le navigateur
  (`cineflow:recemment-vus`) et ne suit pas le compte. La vider ou changer de
  navigateur la fait disparaître ; un compte connecté utilise la base.
- **Décoration d'avatar et nameplate** : elles sont lues à la connexion Discord
  et enregistrées avec le profil. Un changement sur Discord n'apparaît qu'après
  une nouvelle connexion au site. Seuls les presets statiques de nameplate sont
  rendus : un asset animé (WebM) est ignoré.
- Le catalogue et les fiches dépendent de la disponibilité des API externes ;
  les erreurs sont affichées sans exposer les détails techniques.

## Tests d'intégration

La suite `test/integration.mjs` vérifie les pages (film, série, animé,
catalogue, recherche), le lecteur et son panneau (langues, épisodes, bouton
suivant), le JSON du panneau, les redirections 301 des anciennes adresses,
`/serie/:id` vers la reprise, les demandes de titres (validation, statuts,
limite), la décoration d'avatar, la nameplate, les titres récemment vus et
l'API typée (401, 403, 404, 400, favoris, liste, historique, reprise), ainsi que
le schéma PostgreSQL. Elle lance le serveur dans son propre processus :

```bash
SESSION_SECRET=test-secret npm run test:integration
```

`BASE_URL` permet de viser un serveur déjà lancé (même `SESSION_SECRET` et même
`DATABASE_URL` obligatoires). Le script crée l'utilisateur `123456789012345678`
dans la base (`DATABASE_URL`, sinon PGlite dans `DATA_DIR`),
puis le supprime à la fin. Aucun avis n'est réellement envoyé à HeiwaStream.

## Vérifications manuelles

1. Accueil, `/film/550`, `/catalogue?type=movie`, `/catalogue?type=anime`,
   `/recherche?q=matrix` et `/recherche?q=naruto&type=anime` s'affichent.
2. `/serie/46260` redirige vers un épisode disponible ; `/serie/46260/1/1`
   affiche le lecteur et le panneau. Les onglets « Langues » et « Épisodes »,
   le sélecteur de saison et la liste des épisodes répondent au clavier.
3. Changer d'épisode depuis le lecteur : le panneau, l'en-tête (`S01E02`),
   l'URL et le titre du document suivent sans rechargement. Cliquer un épisode
   du panneau met à jour le lecteur de la même façon.
4. Changer de langue dans le panneau : le lecteur est rechargé avec `lang=`
   et reprend à la position courante (`t=`).
5. Le bouton « Suivant » enchaîne sur l'épisode suivant, puis sur la saison
   suivante ; à la fin d'un épisode, un compte à rebours de 5 secondes propose
   la suite et peut être annulé.
6. Lecture d'un film ou d'un épisode, puis retour à l'accueil : « Continuer de
   regarder » et la barre de progression apparaissent ; la page reprend à la
   position enregistrée. Déconnecté, la reprise reste disponible après un
   rechargement grâce à `localStorage`.
7. « Copier le lien » affiche « Lien copié » et l'annonce est lue par les
   lecteurs d'écran (`aria-live`).
8. Un titre absent de HeiwaStream affiche le formulaire de demande et un
   message adapté à chaque réponse. Éviter d'envoyer une vraie demande en
   production : le statut « déjà disponible » suffit pour vérifier le flux.
9. « Bande-annonce » ouvre une modale YouTube : `Échap` ferme, le focus reste
   dans la modale puis revient au bouton. Le bouton n'apparaît que si une
   bande-annonce existe.
10. En mobile, le panneau passe sous le lecteur en pleine largeur, sans
    débordement horizontal, et le cadre garde ses coins arrondis.
11. Connexion Discord, puis retour sur la page d'origine : décoration d'avatar
    et nameplate sur `/profil`.
12. Cœur et « + » sur une carte film et sur une carte série ; `/favoris` et
    `/liste` affichent les deux types. Envoi d'un avis, puis rechargement.
13. Déconnexion, suppression du compte depuis `/profil` en écrivant
    `SUPPRIMER`, puis vérification des en-têtes CSP et des réponses JSON
    `401` / `404` / `429`.

## Ce qui n'a pas pu être vérifié

- La connexion Discord réelle : elle exige une application Discord valide
  (`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`) et une URL de retour
  déclarée.
- L'envoi réel d'un avis ou d'une demande de titre à HeiwaStream : validé par
  le code, les tests d'intégration et des réponses simulées, volontairement pas
  envoyé sur leur service de production.
- Le presse-papiers réel : le navigateur de test refuse l'accès au
  presse-papiers. Le retour « Lien copié » et `aria-live` ont été vérifiés en
  simulant une copie réussie.
- La disposition deux colonnes au-delà de 1020 px : la fenêtre de test ne
  dépassait pas 517 px. Le panneau sous le lecteur, l'absence de débordement et
  les styles desktop (colonne de 360 px, rayon 16 px, hauteur maximale) ont été
  vérifiés dans le DOM et la feuille de style.
- La lecture vidéo réelle et le `seek` auprès des hébergeurs : la
  synchronisation repose sur les messages documentés `ready`, `time` et
  `episode`, testés en injectant ces événements.

## Crédits

- Données et images : [TMDB](https://www.themoviedb.org/). Ce site utilise
  l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
- Catalogue, disponibilité, lecteur et avis : HeiwaStream.

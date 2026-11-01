# MetalFlix

Catalogue de films, séries et animes dans un habillage **métal liquide** ([Argent](https://github.com/seangeng/argent)),
avec le lecteur de [Moviez](https://api.moviez.ac).

Site statique (Vite + React + TypeScript) publié sur GitHub Pages : **https://yutsioff.github.io/metalflix/**

## Ce que fait le site

- **Catalogue de 46 322 titres** (37 750 films, 6 989 séries, 1 583 animes), tous réellement servis par l'API Moviez,
  avec affiche et année — c'est tout ce que `/api/browse` expose, pas un échantillon. Il est découpé en deux chunks :
  les 14 000 titres du haut de liste (~1 Mo) peignent l'interface, le reste (~2,4 Mo) arrive en arrière-plan et élargit
  les compteurs, la recherche et la pagination.
- **Filtres et tri** : catégorie, genre (18 genres, dont Horreur, Science-fiction, Western…), décennie et tri par année,
  combinables avec la recherche.
- **Carrousel à la une** : six titres qui tournent toutes les 9 s, chacun avec son affiche en fond plein cadre, fondue vers le bas,
  une jauge de progression et un court résumé venu de l'article Wikipédia du titre.
- **Lecteur intégré** : `/api/check/<id>` puis `<iframe>` vers le lecteur Moviez (film) ou
  sa variante série, avec choix saison / épisode / langue.
- **Lecteur sans publicité** : la page du lecteur passe par le proxy `proxy/worker.js`, qui la sert depuis
  son propre domaine sans ses scripts publicitaires et relaie `/api/v2/stream` ainsi que la playlist et les
  segments HLS côté serveur. C'est nécessaire : Moviez répond `403` à toute origine étrangère (et son préflight
  CORS n'autorise que `GET`), donc une iframe directe ne peut ni retirer les pubs ni lire le flux. Le Worker
  tourne sur l'hébergement gratuit de Sites (quota 10 000 requêtes/jour), sans clé ni base de données.
- **Reprendre votre visionnage** : une rangée de cartes 16:9 en haut de l'accueil, avec le titre, la saison
  et l'épisode en cours, et la position de lecture. La barre de progression vient du lecteur lui-même :
  la page du proxy renvoie `currentTime / duration` par `postMessage` toutes les ~4 s, que `PlayerModal`
  enregistre dans l'historique local (`recordProgress`). Cliquer sur une carte relance directement le bon
  épisode. Ça marche sans compte (historique « invité »), et la croix retire une carte.
- **Comptes locaux gratuits** : création de profil, connexion, mot de passe étiré en PBKDF2-SHA256 (150 000 tours).
  Aucun serveur, aucune inscription externe, rien ne quitte le navigateur.
- **Historique et watch list par profil**, classés par films, séries et animes, avec saison/épisode vus et date
  relative. Chaque entrée est marquée **En cours** ou **Terminé** : le lecteur est une iframe tierce et ne peut pas
  rapporter la position de lecture, donc le statut est explicite (bouton « J'ai terminé » dans le lecteur, ou ✓ dans
  l'historique). Historique limité aux 300 derniers titres, exportable en JSON.
- **Recherche** par titre (insensible aux accents) et **filtres** films / séries / animes, avec pagination par 60.
- **Recherche directe par id TMDB** : l'API Moviez est adressée par id, donc coller un id ouvre la fiche et le lecteur.
- **Liens partageables** : `#/t/1399` ouvre directement le lecteur, `#/compte` la page du profil.

Les langues disponibles ne sont pas stockées dans le catalogue : elles sont demandées à `/api/check` à l'ouverture du
lecteur, ce qui reste exact titre par titre (VF, VO, VOSTFR, MULTI).

## API

Aucune clé n'est nécessaire : `api.moviez.ac` est ouvert (`Access-Control-Allow-Origin: *`) et l'id TMDB est l'adresse.

| Endpoint | Rôle |
| --- | --- |
| `GET /api/check/<tmdb>` | disponibilité, type (film/série), langues, affiche, titre, année, saisons |
| `GET /api/browse?kind=movie\|tv&limit=120&offset=N` | catalogue paginé (limit plafonne à 120) |
| `GET /api/stats` | volumétrie du catalogue |
| `GET /<tmdb>` | lecteur d'un film |
| `GET /serie/<tmdb>/<saison>/<épisode>` | lecteur d'un épisode |

Paramètres de lecture : `?autoplay=1`, `?lang=vf|vo|vostfr|multi` (défaut `vf`).

## Construire le catalogue

Rien n'est saisi à la main : les titres, affiches et années viennent des réponses de l'API, et les ids TMDB de Wikidata
servent seulement à classer les animes et à remonter les titres connus.

```bash
node scripts/harvest.mjs 330 110   # pages de 120 : ~38 200 films + ~8 800 séries via /api/browse
node scripts/wikidata.mjs          # ids notables (films/séries) + animes
node scripts/genres.mjs            # genres par id TMDB (masque de bits)
node scripts/build-catalog.mjs     # fusionne et écrit src/data/catalog.json
```

La récolte s'arrête d'elle-même quand une page revient vide : les films vont jusqu'à l'offset ~38 400, les séries
jusqu'à ~11 500. `src/data/catalog.json` (les 14 000 premiers) et `src/data/catalog-rest.json` (le reste) sont deux
tableaux compacts `[tmdbId, titre, année, code, cheminAffiche, masqueGenres?]` avec `code` 0=film, 1=série, 2=anime,
tirés du même tri par notoriété puis par année — les données brutes de collecte restent dans `.cache/` (non versionné).

Les genres ne viennent pas de Moviez (`/api/browse` ni `/api/check` ne les exposent) : `scripts/genres.mjs` les collecte
sur Wikidata, une requête par genre pour les films et une requête groupée sur les libellés réellement utilisés pour les
séries. 9 773 titres du catalogue sont étiquetés, en priorité les plus notables. Le masque est un entier : les 18 genres
occupent chacun un bit, donc un titre coûte 2 à 4 octets de plus. Un genre ajouté doit être ajouté en fin de liste
(l'ordre fixe l'indice du bit).

`scripts/verify-ids.mjs` reste disponible pour sonder une liste d'ids TMDB à la main (`/api/check`), utile quand un id
de film et un id de série se recouvrent numériquement : l'API en renvoie un seul, et la curation tranche.

## Comptes

Il n'y a pas de backend : un compte est un profil du navigateur (`src/lib/accounts.ts`), l'historique et la watch list
vivent dans `localStorage` sous `metalflix.library.<id>` (`src/lib/library.ts`).

- Mot de passe : sel aléatoire de 16 octets + PBKDF2-SHA256, 150 000 itérations via WebCrypto ; seul le sel et
  l'empreinte sont stockés.
- Les entrées gardent un instantané du titre (affiche, année, type), donc les listes restent lisibles même pour un id
  absent du catalogue.
- Export JSON depuis la page compte. Conséquence assumée : les données ne suivent pas d'un appareil à l'autre, et vider
  les données du navigateur les efface.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + build dans dist/
npm run preview
```

## Design

Habillage construit sur `argentui` (métal liquide, MIT) : `MetalText` pour le titre à la une et le nom du profil,
`MetalButton` / `MetalBadge` pour les contrôles, `MetalCard` pour les blocs de la page compte. Le shader Paper
(`@paper-design/shaders-react`) est une dépendance peer d'Argent, sous licence PolyForm Shield.

Les affiches n'utilisent volontairement **pas** de canvas WebGL : un contexte par vignette dépassait la limite du
navigateur (~16) et cassait le shader des surfaces visibles. Le reste de l'interface est désormais statique lui aussi
(compte, lecteur, filtres, boutons) : le métal liquide ne reste que sur le mot-symbole. Un shader qui bouge sous une
liste qu'on lit fatigue plus qu'il n'habille.

Les vignettes remplissent leur carte : la grille étire toutes les cartes d'une rangée à la hauteur de la plus grande, et
le bloc interne ne suivait pas, laissant apparaître le liseré chromé en bas. Le bloc interne occupe 100 % de la hauteur
donc le contour garde ses 2,5 px de métal — argent, cobalt ou améthyste selon la catégorie, avec un halo assorti.

La vedette demande les affiches en `/original/` pour les deux visuels affichés (les autres restent en `w500`), et le
résumé vient de Wikipédia : `scripts` ne collecte que `titre, année, affiche`, donc l'id TMDB est résolu vers l'article
français via Wikidata (`P4947` films, `P4983` séries), deux requêtes mises en cache pour la session. Un titre sans
article n'affiche simplement pas de paragraphe.

Le fond neutre et les surfaces sombres viennent des variables `--argent-panel`, `--argent-panel-text`,
`--argent-halo-line` redéfinies dans `src/styles.css`.

## Déploiement

Le site est publié sur GitHub Pages depuis la branche `gh-pages`, qui ne contient que le build :

```bash
npm run deploy
```

`scripts/deploy.mjs` construit le site puis force-push `dist/` (avec un `.nojekyll`) sur `gh-pages`, et Pages sert
cette branche en mode « Deploy from a branch ». Un workflow Actions serait possible, mais pousser un fichier dans
`.github/workflows` demande le scope `workflow` sur le token gh (`gh auth refresh -s workflow`).

Le proxy du lecteur se déploie séparément, avec `proxy/deploy.json` (Worker ES module, aucun binding) : son URL est
`PLAYER_PROXY` dans `src/lib/moviez.ts`. La mettre à vide fait retomber le site sur la page Moviez d'origine, pubs
comprises.

# MetalFlix

Catalogue de films, séries et animes dans un habillage **métal liquide** ([Argent](https://github.com/seangeng/argent)),
avec le lecteur de [Moviez](https://api.moviez.ac).

Site statique (Vite + React + TypeScript) publié sur GitHub Pages.

## Ce que fait le site

- **Catalogue** de ~160 titres, chacun avec affiche, année, langues disponibles et nombre de saisons.
- **Lecteur intégré** : `/api/check/<id>` puis `<iframe>` vers `https://api.moviez.ac/<id>` (film) ou
  `https://api.moviez.ac/serie/<id>/<saison>/<épisode>` (série), avec choix saison / épisode / langue.
- **Recherche** par titre (insensible aux accents) et **filtres** films / séries / animes + langue (VF, VOSTFR, VO, MULTI).
- **Recherche directe par id TMDB** : l'API Moviez est adressée par id, donc coller un id ouvre la fiche et le lecteur.
- **Liens partageables** : `#/t/1399` ouvre directement le lecteur sur un titre.

## API

Aucune clé n'est nécessaire : `api.moviez.ac` est ouvert (`Access-Control-Allow-Origin: *`) et l'id TMDB est l'adresse.

| Endpoint | Rôle |
| --- | --- |
| `GET /api/check/<tmdb>` | disponibilité, type (film/série), langues, affiche, titre, année, saisons |
| `GET /<tmdb>` | lecteur d'un film |
| `GET /serie/<tmdb>/<saison>/<épisode>` | lecteur d'un épisode |

Paramètres de lecture : `?autoplay=1`, `?lang=vf|vo|vostfr|multi` (défaut `vf`).

Le catalogue est généré à partir de l'API elle-même — les titres, affiches et langues ne sont jamais saisis à la main :

```bash
node scripts/verify-ids.mjs candidates.json verify-results.json   # sonde des ids TMDB
node scripts/build-catalog.mjs                                    # écrit src/data/catalog.json
```

`scripts/build-catalog.mjs` ne garde que les ids explicitement retenus : certains ids TMDB de films et de séries se
recouvrent numériquement, et l'API renvoie alors l'autre titre.

## Développement

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + build dans dist/
npm run preview
```

## Design

Habillage construit sur `argentui` (métal liquide, MIT) : `MetalText` pour le titre à la une, `MetalCard` pour les
affiches, `MetalButton` / `MetalBadge` pour les contrôles. Le shader Paper (`@paper-design/shaders-react`) est une
dépendance peer d'Argent, sous licence PolyForm Shield.

Le fond neutre et les surfaces sombres viennent des variables `--argent-panel`, `--argent-panel-text`,
`--argent-halo-line` redéfinies dans `src/styles.css`.

## Déploiement

`.github/workflows/deploy.yml` construit et publie `dist/` sur GitHub Pages à chaque push sur `main`
(Pages doit être configuré en source « GitHub Actions »).

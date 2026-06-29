# CLAUDE.md

Guide pour les assistants IA travaillant sur ce dépôt. **La langue de travail
du projet est le français** : commits, UI, commentaires de code et messages
sont tous en français. Conserve cette convention.

## Vue d'ensemble

**« Dépose ton EPK · Sur la scène »** — application web d'un seul fichier qui
permet aux artistes de la programmation scène de **La Brassée** de déposer leur
EPK (dossier de presse électronique) et de gérer leur candidature.

L'app sert trois publics via la même page :
1. **Artistes programmés / permanents** — ouvrent leur dossier existant pour le
   compléter ou le mettre à jour.
2. **Candidatures spontanées** — un nouvel artiste se présente sans dossier
   préexistant.
3. **Permanents** — réservent eux-mêmes leurs dates d'automne (self-serve).

## Stack technique

- **Frontend** : un seul fichier `index.html` (~1600 lignes) contenant tout le
  HTML, le CSS (`<style>` inline) et le JS (`<script>` inline). **Aucune étape
  de build, aucun gestionnaire de paquets, aucun `node_modules`.**
- **Backend** : [Supabase](https://supabase.com) (Postgres + Storage), accédé
  via le client `@supabase/supabase-js@2` chargé depuis unpkg (CDN).
- **PWA** : `manifest.webmanifest` + icônes ; app installable. Pas de service
  worker (pas de cache offline).
- **Polices** : Oswald (titres) + Lato (corps), chargées via Google Fonts.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Toute l'application (HTML + CSS + JS inline) |
| `manifest.webmanifest` | Manifeste PWA |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Icônes PWA / iOS |
| `full_logo_white.svg`, `picto_outlined_white.svg` | Logos La Brassée (chargés en filigrane) |
| `iacouba-lockup-contenu.svg` | Signature IAcouba (pied de page) |
| `docs/DECISIONS.md` | Journal des décisions d'architecture — **à lire et à mettre à jour** |
| `.gitignore` | Ignore `.DS_Store`, `.vercel`, `node_modules/`, `*.log` |

## Déploiement — RÈGLE CRITIQUE

Le déploiement se fait **uniquement par `git push origin main`** (intégration
GitHub → Vercel). **Ne jamais utiliser** `vercel deploy`, `vercel --prod` ni
aucun outil de déploiement direct : cela écraserait la production.

> Pour ce travail, développe sur la branche `claude/claude-md-docs-l5alhx` et
> n'ouvre pas de PR sauf demande explicite. La règle « push sur `main` =
> production » concerne le flux de prod normal, pas les branches de travail.

Tester localement : ouvrir `index.html` dans un navigateur. L'app a besoin d'un
paramètre d'URL (voir ci-dessous) et de Supabase, donc utilise un vrai token de
test ou le mode candidature.

## Modes d'exécution (paramètres d'URL)

L'app lit `window.location.search` dans `init()` (vers la ligne 1012) :

- `?t=<token>` — ouvre un dossier **existant** en édition (lecture via
  `get_dossier_scene`).
- `?candidature=scene` (sans `t`) — **candidature spontanée** : accueille un
  nouvel artiste ; le dossier (et son `token_depot`) est créé à l'envoi.
- `?date=YYYY-MM-DD` — pré-sélectionne une date dans le sélecteur (mode
  candidature).
- Aucun paramètre valide → écran « Ce lien n'est pas valide » (`#app-erreur-token`).

Trois conteneurs principaux dans le DOM, basculés en `display` :
`#app-chargement` (spinner), `#app-charge` (le formulaire), `#app-erreur-token`.

## Modèle de données Supabase

- `SUPABASE_URL` / `SUPABASE_ANON_KEY` sont dans `index.html` (~ligne 764). La
  clé anon est **publique par nature** — d'où le durcissement RLS ci-dessous.
- **Tables** : `artistes_scene` (PII, `token_depot`, `categorie`, `statut`,
  liens sociaux, rider, etc.), `concerts`, `concerts_artistes` (table de
  liaison artiste ↔ soirée).
- **Bucket Storage** : `artistes-scene-epk` — chemins
  `<token_depot>/artiste/…`, `<token_depot>/photos-hd/…`,
  `<token_depot>/videos/…`.

### Sécurité : accès token-gated via RPC (NE PAS contourner)

Le client **n'accède plus directement** aux colonnes sensibles. Tous les
chemins PII passent par des fonctions RPC `SECURITY DEFINER` qui vérifient le
token et appliquent une liste blanche de colonnes :

- `get_dossier_scene(p_token)` — lecture du dossier (résout la **fusion de
  tokens** côté serveur ; le `token_depot` n'est jamais relu par le client).
- `creer_candidature_scene(payload)` — création (token généré côté serveur,
  statut forcé à `candidature`).
- `maj_dossier_scene(p_token, payload)` — mise à jour (statut limité à
  `candidature_complete` / `depot_complet` ; champs admin intouchables).
- `maj_concert_par_artiste(p_token, concert_id, payload)` — MAJ d'une soirée
  liée, seulement si l'artiste y est rattaché.
- `reserver_date_scene(p_token, …)` — réservation self-serve d'une date d'automne.

Les lectures REST directes (`/rest/v1/concerts?...`) ne servent qu'aux données
**non sensibles** (dates de concerts pour le calendrier). **Ne jamais
réintroduire de lecture/écriture directe des PII ou du `token_depot`.**

## Conventions de logique métier

- **Catégories d'artiste** : `musique`, `impro`, `poesie`, `conference`,
  `cabaret`, `autre`. Au chargement, le JS pose `body.cat-<categorie>` ; le CSS
  masque/affiche les blocs `.cat-musique` / `.cat-non-musique` en conséquence.
- **Statuts** : `candidature` → `candidature_complete` → `depot_complet`.
- **Permanents** : artistes résidents ; l'automne (sept→déc) leur est réservé
  (fermé aux candidatures publiques) et ils y réservent leurs dates eux-mêmes.
- **Fusion de tokens** : plusieurs liens peuvent pointer vers le même dossier
  canonique (`fusionne_vers`), résolu serveur-side.
- **Limites médias** : `MAX_VIDEOS = 3`, `MAX_VIDEO_MO = 40` (~ligne 777).
- **Dates** : tout est calculé en heure de Montréal (`todayMtlISO`), libellés
  français (`JOURS_LONG_DEPOT`, `MOIS_LONG_DEPOT`).

## Règles de marque (Maïa)

- **Jamais d'emoji abeille** 🐝 : utiliser le logo graphique, jamais l'insecte.
- **Signature IAcouba** en pied de page (lockup corail « Contenu », lien
  iacouba.ca) — déjà en place, ne pas retirer.
- Palette « scène » : jaune `#f7d135` sur fond sombre, esthétique glassmorphism
  (voir les variables `:root` en tête du `<style>`).

## Style de code

- JS vanilla, pas de framework. Fonctions nommées en français
  (`envoyerTout`, `peuplerSelectsDatesLibres`, `renderPhotos`…).
- Toujours échapper le HTML inséré dynamiquement (`escaperHtml`) et assainir
  les URLs (`sanitizeUrl`).
- Les commentaires expliquent souvent un **pourquoi** non évident (ex. retrait
  de `backdrop-filter`/`background-attachment:fixed` pour le scroll iOS) —
  conserver ce niveau de contexte lors de modifications de perf/CSS.
- Garder tout dans `index.html` ; ne pas introduire de build ni de découpage en
  modules sans demande explicite.

## Au moment de modifier

1. Tout changement notable d'architecture/sécurité doit être consigné dans
   `docs/DECISIONS.md` (format : date, contexte, décision, déploiement).
2. Commits en français, descriptifs, avec préfixe conventionnel observé dans
   l'historique : `feat(scene):`, `fix(depot):`, `chore:`, `feat(pwa):`…
3. Pas de PR sans demande explicite de l'utilisateur.

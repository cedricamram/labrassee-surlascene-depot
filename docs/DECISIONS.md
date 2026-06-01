# Décisions — labrassee-surlascene-depot

## 2026-06-01 — Durcissement RLS et accès Supabase (protection des PII artistes)

**Contexte.** Les politiques RLS de la table `artistes_scene` étaient trop
permissives (`USING true` en lecture comme en écriture). Or la clé anon est, par
nature, publiée en clair dans `index.html`. N'importe quel visiteur pouvait donc
aspirer l'ensemble des données personnelles des artistes (courriels, cellulaires,
riders, besoins d'accueil, signatures) — y compris le `token_depot`, qui est le
secret autorisant l'édition d'un dossier — et écraser n'importe quelle candidature.

**Décision.** Le formulaire n'accède plus directement à la table. Tous les chemins
passent désormais par des fonctions RPC Supabase `SECURITY DEFINER`, vérifiant le
token et limitées à une liste blanche de colonnes :

- `get_dossier_scene(token)` — lecture du dossier (résout la fusion de tokens côté
  serveur). Le `token_depot` n'est plus jamais relu par le client.
- `maj_dossier_scene(token, payload)` — mise à jour (le statut ne peut prendre que
  `candidature_complete` ou `depot_complet` ; les champs admin sont intouchables).
- `creer_candidature_scene(payload)` — création ; le `token_depot` est généré côté
  serveur et le statut est forcé à `candidature`.
- `maj_concert_par_artiste(token, concert_id, payload)` — mise à jour de la soirée
  liée, autorisée uniquement si l'artiste est bien rattaché au concert.

Par ailleurs, les colonnes PII et le `token_depot` ne sont plus lisibles via la clé
anon (REVOKE/GRANT au niveau colonne, RLS conservée en lecture pour les seules
colonnes « vitrine » nécessaires au site public).

**Déploiement.** Uniquement `git push origin main` (intégration GitHub-Vercel).
Jamais de `vercel deploy`, `vercel --prod` ni d'outil de déploiement direct, qui
écraseraient la production.

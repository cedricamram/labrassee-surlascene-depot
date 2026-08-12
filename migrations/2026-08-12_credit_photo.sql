-- ═══════════════════════════════════════════════════════════════════════════
--  credit_photo — champ photographe dans le dépôt artiste
--  2026-08-12 · directive Cédric 2026-08-10 via Apollon → Héphaïstos
-- ═══════════════════════════════════════════════════════════════════════════
--
--  POURQUOI
--  Cédric : « s'il y a un crédit photo tu le mets » — sur TOUS les axes de
--  communication. Impossible sans collecter l'info. Apollon a confirmé que les
--  métadonnées IPTC/XMP sont absentes des images déposées. Un champ texte libre
--  dans le formulaire est la seule façon fiable de capturer cette donnée.
--
--  CE QUI CHANGE
--  1. Nouvelle colonne nullable `credit_photo` sur artistes_scene.
--  2. maj_dossier_scene étendue pour persister le champ.
--
--  RESTAURATION
--  Retirer le champ : ALTER TABLE artistes_scene DROP COLUMN credit_photo;
--  Restaurer l'ancienne fonction : rejouer la version annotée en bas de fichier.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.artistes_scene
  ADD COLUMN IF NOT EXISTS credit_photo text;

CREATE OR REPLACE FUNCTION public.maj_dossier_scene(p_token text, p_payload jsonb)
 RETURNS artistes_scene
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_row public.artistes_scene;
begin
  select coalesce(a.fusionne_vers, a.id) into v_id
  from public.artistes_scene a where a.token_depot = p_token;
  if v_id is null then raise exception 'token inconnu'; end if;

  update public.artistes_scene set
    bio                  = case when p_payload ? 'bio'                  then p_payload->>'bio' else bio end,
    titre_set            = case when p_payload ? 'titre_set'            then p_payload->>'titre_set' else titre_set end,
    genre                = case when p_payload ? 'genre'                then p_payload->>'genre' else genre end,
    courriel             = case when p_payload ? 'courriel'             then p_payload->>'courriel' else courriel end,
    cellulaire           = case when p_payload ? 'cellulaire'           then p_payload->>'cellulaire' else cellulaire end,
    instagram            = case when p_payload ? 'instagram'            then p_payload->>'instagram' else instagram end,
    instagram_perso      = case when p_payload ? 'instagram_perso'      then p_payload->>'instagram_perso' else instagram_perso end,
    facebook             = case when p_payload ? 'facebook'             then p_payload->>'facebook' else facebook end,
    facebook_perso       = case when p_payload ? 'facebook_perso'       then p_payload->>'facebook_perso' else facebook_perso end,
    tiktok               = case when p_payload ? 'tiktok'               then p_payload->>'tiktok' else tiktok end,
    tiktok_perso         = case when p_payload ? 'tiktok_perso'         then p_payload->>'tiktok_perso' else tiktok_perso end,
    site_web             = case when p_payload ? 'site_web'             then p_payload->>'site_web' else site_web end,
    bandsintown_url      = case when p_payload ? 'bandsintown_url'      then p_payload->>'bandsintown_url' else bandsintown_url end,
    spotify_url          = case when p_payload ? 'spotify_url'          then p_payload->>'spotify_url' else spotify_url end,
    bandcamp_url         = case when p_payload ? 'bandcamp_url'         then p_payload->>'bandcamp_url' else bandcamp_url end,
    soundcloud_url       = case when p_payload ? 'soundcloud_url'       then p_payload->>'soundcloud_url' else soundcloud_url end,
    youtube_url          = case when p_payload ? 'youtube_url'          then p_payload->>'youtube_url' else youtube_url end,
    vimeo_url            = case when p_payload ? 'vimeo_url'            then p_payload->>'vimeo_url' else vimeo_url end,
    setlist              = case when p_payload ? 'setlist'              then p_payload->>'setlist' else setlist end,
    rider_technique      = case when p_payload ? 'rider_technique'      then p_payload->>'rider_technique' else rider_technique end,
    besoins_hospitality  = case when p_payload ? 'besoins_hospitality'  then p_payload->>'besoins_hospitality' else besoins_hospitality end,
    signature_nom        = case when p_payload ? 'signature_nom'        then p_payload->>'signature_nom' else signature_nom end,
    nb_personnes_scene   = case when p_payload ? 'nb_personnes_scene'   then nullif(p_payload->>'nb_personnes_scene','')::int else nb_personnes_scene end,
    duree_set_minutes    = case when p_payload ? 'duree_set_minutes'    then nullif(p_payload->>'duree_set_minutes','')::int else duree_set_minutes end,
    photo_artiste_path   = case when p_payload ? 'photo_artiste_path'   then p_payload->>'photo_artiste_path' else photo_artiste_path end,
    photos_hd_paths      = case when jsonb_typeof(p_payload->'photos_hd_paths')='array' then (select coalesce(array_agg(x),'{}'::text[]) from jsonb_array_elements_text(p_payload->'photos_hd_paths') x) else photos_hd_paths end,
    videos_paths         = case when jsonb_typeof(p_payload->'videos_paths')='array' then (select coalesce(array_agg(x),'{}'::text[]) from jsonb_array_elements_text(p_payload->'videos_paths') x) else videos_paths end,
    captation_audio_video= case when p_payload ? 'captation_audio_video' then (p_payload->>'captation_audio_video')::boolean else captation_audio_video end,
    signature_acceptee   = case when p_payload ? 'signature_acceptee'   then (p_payload->>'signature_acceptee')::boolean else signature_acceptee end,
    signature_le         = case when p_payload ? 'signature_le'         then nullif(p_payload->>'signature_le','')::timestamptz else signature_le end,
    credit_photo         = case when p_payload ? 'credit_photo'         then p_payload->>'credit_photo' else credit_photo end,
    statut               = case when p_payload->>'statut' in ('candidature_complete','depot_complet') then p_payload->>'statut' else statut end,
    maj_le               = now()
  where id = v_id
  returning * into v_row;
  return v_row;
end;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
--  reserver_date_scene — ouvrir la réservation aux artistes DÉJÀ CONNUS
--  2026-07-27 (nuit) · demandé par Cédric
-- ═══════════════════════════════════════════════════════════════════════════
--
--  POURQUOI
--  Le courriel « ton espace permanent » promet à l'artiste : « ton dossier reste
--  enregistré, tu choisis simplement ta date à ton retour ». C'était faux. Le
--  formulaire n'affiche un choix de date que dans trois cas : candidature
--  spontanée (sans jeton), artiste ayant déjà une date à venir, ou artiste
--  permanent. Un habitué revenu sans date à venir — Reno De Stefano au 18/07,
--  Off Brasil — ouvre son lien et lit « DATE DU SHOW : À CONFIRMER », sans
--  aucun moyen de proposer quoi que ce soit. La promesse ne tenait pas.
--
--  CE QUI CHANGE
--  La réservation n'est plus l'apanage des permanents. Tout artiste porteur d'un
--  jeton valide peut poser une date, avec DEUX régimes distincts :
--    • PERMANENT   → fenêtre automne réservée (sept→déc 2026), inchangée.
--    • CONNU       → fenêtre publique : préavis 7 jours, 120 jours d'horizon,
--                    mêmes jours ouverts que le formulaire public (juillet-août
--                    en ven/sam seulement), lundis d'impro exclus.
--
--  CE QUI NE CHANGE PAS
--  Le concert est créé en statut 'planifie' : aucune diffusion publique, aucun
--  fan-out. Cédric confirme ensuite, comme aujourd'hui. La date reste une
--  PROPOSITION de l'artiste, pas une programmation.
--
--  GARDE-FOU AJOUTÉ — plafond de 2 dates en attente
--  Le jeton circule par courriel : il peut être transféré, ou traîner dans une
--  boîte. Un permanent est un partenaire installé ; un artiste connu, non. On
--  borne donc à 2 le nombre de soirées 'planifie' non encore confirmées qu'un
--  non-permanent peut détenir. Au-delà : refus explicite, il faut que Cédric
--  confirme les précédentes. Un permanent n'est pas concerné (il réserve sa
--  saison d'un coup).
--
--  RESTAURATION — l'ancienne définition est conservée en fin de fichier.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reserver_date_scene(
  p_token text, p_date_show date, p_titre text DEFAULT NULL::text)
 RETURNS concerts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_art public.artistes_scene;
  v_heure_debut time;
  v_dow int;
  v_mois int;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_concert public.concerts;
  v_permanent boolean;
  v_en_attente int;
  v_jours_ouverts int[];
begin
  -- Fiche canonique (suit fusionne_vers comme get_dossier_scene)
  select a2.* into v_art
  from public.artistes_scene a1
  join public.artistes_scene a2 on a2.id = coalesce(a1.fusionne_vers, a1.id)
  where a1.token_depot = p_token
  limit 1;
  if v_art.id is null then raise exception 'token inconnu'; end if;

  v_permanent := coalesce(v_art.permanence, false);

  if v_permanent then
    -- ── PERMANENTS : l'automne leur est réservé (comportement d'origine) ──
    if p_date_show < greatest(v_today, date '2026-09-01') or p_date_show > date '2026-12-31' then
      raise exception 'date hors de la fenêtre automne (sept→déc 2026)';
    end if;
    v_jours_ouverts := array[1,2,4,5,6];
  else
    -- ── ARTISTES CONNUS : même fenêtre que le formulaire public ──
    if p_date_show < v_today + 7 then
      raise exception 'préavis trop court — il faut au moins 7 jours';
    end if;
    if p_date_show > v_today + 120 then
      raise exception 'date trop lointaine — 4 mois maximum';
    end if;
    -- Juillet-août : ven/sam seulement (été). Autres mois : lun/mar/jeu/ven/sam.
    v_mois := extract(month from p_date_show);
    v_jours_ouverts := case when v_mois in (7, 8) then array[5,6] else array[1,2,4,5,6] end;
    -- Saison Impro : les lundis du 25/05 au 24/08 sont pris par la permanence.
    if extract(dow from p_date_show) = 1
       and p_date_show between date '2026-05-25' and date '2026-08-24' then
      raise exception 'ce lundi est pris par la saison Impro';
    end if;
    -- Plafond : 2 soirées en attente de confirmation, pas plus.
    select count(*) into v_en_attente
    from public.concerts c
    join public.concerts_artistes ca on ca.concert_id = c.id
    where ca.artiste_id = v_art.id
      and c.statut = 'planifie'
      and c.date_show >= v_today;
    if v_en_attente >= 2 then
      raise exception 'tu as déjà 2 dates en attente de confirmation — écris-nous pour en ajouter';
    end if;
  end if;

  -- Soirs ouverts (mer et dim toujours fermés)
  v_dow := extract(dow from p_date_show);
  if not (v_dow = any(v_jours_ouverts)) then
    raise exception 'soir non ouvert';
  end if;

  -- Une seule soirée par date
  if exists (select 1 from public.concerts c
              where c.date_show = p_date_show and c.statut in ('planifie','confirme')) then
    raise exception 'date déjà réservée';
  end if;

  v_heure_debut := coalesce(v_art.heure_debut_speciale, time '19:30');
  insert into public.concerts (date_show, heure_debut, heure_fin, heure_soundcheck,
                               type_show, titre_show, statut, source)
  values (
    p_date_show,
    v_heure_debut,
    v_heure_debut + interval '2 hours',
    time '18:30',
    case lower(coalesce(v_art.categorie,'musique'))
      when 'impro' then 'impro' when 'poesie' then 'poesie' else 'concert' end,
    coalesce(nullif(btrim(p_titre), ''), nullif(v_art.titre_set,''), v_art.nom_artiste),
    'planifie',
    'manuel'
  )
  returning * into v_concert;

  insert into public.concerts_artistes (concert_id, artiste_id, ordre)
  values (v_concert.id, v_art.id, 1);

  return v_concert;
end;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
--  RESTAURATION — version d'avant le 2026-07-27 (permanents + automne seulement)
--  À rejouer telle quelle si cette évolution doit être annulée.
-- ═══════════════════════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION public.reserver_date_scene(p_token text, p_date_show date, p_titre text DEFAULT NULL::text)
--  RETURNS concerts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- declare
--   v_art public.artistes_scene; v_heure_debut time; v_dow int;
--   v_today date := (now() at time zone 'America/Toronto')::date; v_concert public.concerts;
-- begin
--   select a2.* into v_art from public.artistes_scene a1
--   join public.artistes_scene a2 on a2.id = coalesce(a1.fusionne_vers, a1.id)
--   where a1.token_depot = p_token limit 1;
--   if v_art.id is null then raise exception 'token inconnu'; end if;
--   if coalesce(v_art.permanence, false) = false then
--     raise exception 'réservation réservée aux artistes permanents'; end if;
--   if p_date_show < greatest(v_today, date '2026-09-01') or p_date_show > date '2026-12-31' then
--     raise exception 'date hors de la fenêtre automne (sept→déc 2026)'; end if;
--   v_dow := extract(dow from p_date_show);
--   if v_dow not in (1,2,4,5,6) then raise exception 'soir non ouvert (mercredi et dimanche fermés)'; end if;
--   if exists (select 1 from public.concerts c where c.date_show = p_date_show and c.statut in ('planifie','confirme'))
--     then raise exception 'date déjà réservée'; end if;
--   v_heure_debut := coalesce(v_art.heure_debut_speciale, time '19:30');
--   insert into public.concerts (date_show, heure_debut, heure_fin, heure_soundcheck, type_show, titre_show, statut, source)
--   values (p_date_show, v_heure_debut, v_heure_debut + interval '2 hours', time '18:30',
--     case lower(coalesce(v_art.categorie,'musique')) when 'impro' then 'impro' when 'poesie' then 'poesie' else 'concert' end,
--     coalesce(nullif(btrim(p_titre), ''), nullif(v_art.titre_set,''), v_art.nom_artiste), 'planifie', 'manuel')
--   returning * into v_concert;
--   insert into public.concerts_artistes (concert_id, artiste_id, ordre) values (v_concert.id, v_art.id, 1);
--   return v_concert;
-- end; $function$;

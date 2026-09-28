CREATE OR REPLACE FUNCTION public.reserver_date_scene(p_token text, p_date_show date, p_titre text DEFAULT NULL::text)
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
  select a2.* into v_art
  from public.artistes_scene a1
  join public.artistes_scene a2 on a2.id = coalesce(a1.fusionne_vers, a1.id)
  where a1.token_depot = p_token
  limit 1;
  if v_art.id is null then raise exception 'token inconnu'; end if;

  v_permanent := coalesce(v_art.permanence, false);

  if v_permanent then
    if p_date_show < greatest(v_today, date '2026-09-01') or p_date_show > date '2026-12-31' then
      raise exception 'date hors de la fenêtre automne (sept→déc 2026)';
    end if;
    v_jours_ouverts := array[1,2,4,5,6];
  else
    if p_date_show < v_today + 7 then
      raise exception 'préavis trop court — il faut au moins 7 jours';
    end if;
    -- Fenêtre ouverte jusqu'à fin mars 2027 (Cédric, 2026-09-28), jamais moins de 120 j.
    if p_date_show > greatest(v_today + 120, date '2027-03-31') then
      raise exception 'date trop lointaine — au-delà de la fenêtre ouverte';
    end if;
    v_mois := extract(month from p_date_show);
    v_jours_ouverts := case when v_mois in (7, 8) then array[5,6] else array[1,2,4,5,6] end;
    if extract(dow from p_date_show) = 1
       and p_date_show between date '2026-05-25' and date '2026-08-24' then
      raise exception 'ce lundi est pris par la saison Impro';
    end if;
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

  v_dow := extract(dow from p_date_show);
  if not (v_dow = any(v_jours_ouverts)) then
    raise exception 'soir non ouvert';
  end if;

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
$function$

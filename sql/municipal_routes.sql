-- Aplicar una vez tras planeación y migraciones 006–009, dentro de una transacción.
begin;
set local search_path = public, extensions;
create table municipalities (
  id text primary key, name text not null
);
insert into municipalities values ('sahuayo', 'Sahuayo');
-- La pertenencia y el permiso de administración se provisionan en el servidor.
create table municipal_members (
  user_id uuid primary key references public.users(id) on delete cascade,
  municipality_id text not null references municipalities(id),
  is_admin boolean not null default false
);
alter table municipal_members enable row level security;
alter table municipalities enable row level security;
revoke all on municipalities, municipal_members from public, anon, authenticated;
grant select on municipalities, municipal_members to authenticated;
create function rl_city() returns text language sql stable security definer set search_path = public as $$
  select m.municipality_id from municipal_members m join users u on u.id=m.user_id
  where m.user_id=auth.uid() and u.role in ('admin','collector','driver')
$$;
create function rl_city_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from municipal_members m join users u on u.id=m.user_id
                where m.user_id=auth.uid() and m.is_admin and u.role='admin')
$$;
create or replace function rl_is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select rl_city_admin()
$$;
create or replace function rl_is_staff() returns boolean language sql stable security definer set search_path=public as $$
  select rl_city() is not null
$$;
alter table users enable row level security;
revoke all on users from anon;
revoke truncate, references, trigger on users from authenticated;
-- Los cambios del titular pasan por la API de perfil, que valida los campos permitidos.
create policy users_direct_update on users as restrictive for update to authenticated
  using(rl_city_admin()) with check(rl_city_admin());
create policy users_direct_insert on users as restrictive for insert to authenticated
  with check(rl_city_admin());
create policy users_direct_delete on users as restrictive for delete to authenticated using(rl_city_admin());
create policy members_read_names on users for select to authenticated using
  (exists(select 1 from municipal_members m where m.user_id=users.id and m.municipality_id=rl_city()));
create policy member_list on municipal_members for select to authenticated using (municipality_id=rl_city());
create policy city_name on municipalities for select to authenticated using (id=rl_city());

alter table routes add column municipality_id text references municipalities(id),
  add column author_id uuid references public.users(id) on delete set null,
  add column service_kind text check (service_kind in ('public','commercial')),
  add column area_kind text check (area_kind in ('urban','rural'));
update routes set municipality_id='sahuayo',
  service_kind=case when route_type in ('commercial','market') then 'commercial' when route_type='residential' then 'public' end,
  area_kind=case when route_type='rural' then 'rural' end;
alter table routes alter municipality_id set default rl_city(), alter municipality_id set not null,
  alter author_id set default auth.uid();
create index municipal_routes_active on routes(municipality_id, is_active, name);

alter table vehicles add column municipality_id text references municipalities(id);
-- Sólo hay certeza de la ciudad de las unidades vinculadas al histórico.
update vehicles v set municipality_id='sahuayo' where exists(select 1 from routes r where r.vehicle_id=v.id);
alter table vehicles alter municipality_id set default rl_city();
alter table vehicles add constraint vehicle_city_pair unique(id, municipality_id);
alter table routes add constraint route_vehicle_same_city foreign key (vehicle_id,municipality_id)
  references vehicles(id,municipality_id);

create function rl_manage_route(rid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from routes where id=rid and municipality_id=rl_city() and (author_id=auth.uid() or rl_city_admin()))
$$;
-- Una política restrictiva limita también las políticas permisivas que pudieran existir.
alter table routes enable row level security;
revoke all on routes, routes_geojson from anon;
revoke delete, truncate, references, trigger on routes from authenticated;
grant select, insert, update on routes to authenticated;
create policy municipal_route_scope on routes as restrictive for all to public
  using (municipality_id=rl_city()) with check (municipality_id=rl_city());
create policy municipal_route_read on routes for select to authenticated using (true);
create policy municipal_route_insert on routes for insert to authenticated with check (author_id=auth.uid());
create policy municipal_route_update on routes for update to authenticated using (author_id=auth.uid() or rl_city_admin());
create policy municipal_route_edit_scope on routes as restrictive for update to authenticated
  using (author_id=auth.uid() or rl_city_admin()) with check (author_id=auth.uid() or rl_city_admin());

create function rl_route_identity() returns trigger language plpgsql set search_path=public as $$
begin
  if auth.uid() is not null then
    if new.municipality_id is distinct from rl_city() or rl_city() is null then
      raise exception 'Municipio no autorizado' using errcode='42501';
    end if;
    if tg_op='INSERT' then
      new.author_id := auth.uid();
    elsif old.municipality_id is distinct from new.municipality_id
       or (old.author_id is distinct from auth.uid() and not rl_city_admin())
       or (old.author_id is distinct from new.author_id and not rl_city_admin()) then
      raise exception 'Solo el autor o el administrador municipal puede modificar la ruta' using errcode='42501';
    end if;
    if new.author_id is not null and not exists(select 1 from municipal_members where user_id=new.author_id and municipality_id=new.municipality_id) then
      raise exception 'El autor debe pertenecer al municipio';
    end if;
  end if;
  if tg_op='UPDATE' and (new.service_kind,new.area_kind) is distinct from (old.service_kind,old.area_kind) then
    if new.service_kind='commercial' and new.route_type not in ('market','commercial') then new.route_type := 'commercial';
    elsif new.service_kind='public' and new.area_kind='rural' then new.route_type := 'rural';
    elsif new.service_kind='public' then new.route_type := 'residential'; end if;
  end if;
  return new;
end $$;
create trigger municipal_route_identity before insert or update on routes for each row execute function rl_route_identity();
create policy route_event_city on route_events as restrictive for all to authenticated
  using (exists(select 1 from routes r where r.id=route_id)) with check (exists(select 1 from routes r where r.id=route_id));

-- Mantiene el contrato GeoJSON existente y añade la clasificación al catálogo municipal.
create view municipal_route_plans with (security_invoker=true) as
  select g.*, r.municipality_id, r.author_id, r.area_kind, r.service_kind,
         (r.author_id=auth.uid() or rl_city_admin()) is true as can_edit
  from routes_geojson g join routes r on r.id=g.id;
revoke all on municipal_route_plans from public, anon, authenticated;
grant select on municipal_route_plans to authenticated, service_role;
create function save_municipal_route(p_plan jsonb, p_service text, p_area text, p_extras jsonb)
returns uuid language plpgsql security invoker set search_path=public,extensions as $$
declare rid uuid; zone geometry; line geometry; origin geometry; destination geometry;
begin
  if rl_city() is null or p_service is null or p_area is null then raise exception 'Se requiere municipio, servicio y zona'; end if;
  if p_plan->>'id' is not null then
    rid := (p_plan->>'id')::uuid;
    zone := st_setsrid(st_geomfromgeojson(p_plan->'zone'),4326);
    line := st_setsrid(st_geomfromgeojson(p_plan->'line'),4326);
    origin := st_setsrid(st_makepoint((p_plan->'start'->>0)::float8,(p_plan->'start'->>1)::float8),4326);
    destination := st_setsrid(st_makepoint((p_plan->'end'->>0)::float8,(p_plan->'end'->>1)::float8),4326);
    if (geometrytype(zone)='POLYGON' and st_isvalid(zone) and geometrytype(line)='LINESTRING'
        and st_isvalid(line) and not st_isempty(line) and st_covers(zone,origin) and st_covers(zone,destination)
        and btrim(p_plan->>'name')<>'' and p_plan->>'color' ~ '^#[0-9A-Fa-f]{6}$') is not true then
      raise exception 'Comprueba el nombre, la zona, los puntos y el recorrido';
    end if;
    update routes set geometry=line, zone_geometry=zone, start_point=origin, end_point=destination,
      name=btrim(p_plan->>'name'), description=p_plan->>'description', vehicle_id=(p_plan->>'vehicle')::uuid,
      color=p_plan->>'color', planning_mode=p_plan->>'mode'
    where id=rid and is_active and updated_at=(p_plan->>'expected')::timestamptz;
    if not found then raise exception 'La ruta cambió o ya no la puedes editar. Vuelve a abrirla.'; end if;
  else
  rid := save_route_plan(p_plan->>'name',(p_plan->>'vehicle')::uuid,p_plan->'zone',p_plan->>'color',
    (p_plan->'start'->>0)::float8,(p_plan->'start'->>1)::float8,(p_plan->'end'->>0)::float8,(p_plan->'end'->>1)::float8,
    p_plan->'line',p_plan->>'mode',p_plan->>'description',p_plan->>'legacy_type');
  end if;
  update routes set service_kind=p_service, area_kind=p_area,
    has_steep_terrain=coalesce((p_extras->>'steep')::boolean,false),
    has_narrow_alleys=coalesce((p_extras->>'narrow')::boolean,false),
    ai_plan=nullif(p_extras->'ai_plan','null'::jsonb) where id=rid;
  perform set_route_learning(rid,p_extras->>'mode',(p_extras->>'learning')::boolean,p_plan->'line',nullif(p_extras->'timeline','null'::jsonb));
  return rid;
end $$;

create table municipal_devices (
  device_key text primary key check (length(btrim(device_key)) between 1 and 100),
  municipality_id text not null default rl_city() references municipalities(id),
  device_type text not null check(length(btrim(device_type)) between 1 and 80),
  model text not null check(length(btrim(model)) between 1 and 100),
  vehicle_id uuid, foreign key(vehicle_id,municipality_id) references vehicles(id,municipality_id)
);
alter table municipal_devices enable row level security;
revoke all on municipal_devices from public, anon, authenticated;
grant select, insert, update, delete on municipal_devices to authenticated;
create policy device_read on municipal_devices for select to authenticated using(municipality_id=rl_city());
create policy device_write on municipal_devices for all to authenticated using(municipality_id=rl_city() and rl_city_admin()) with check(municipality_id=rl_city() and rl_city_admin());

create table municipal_device_fixes (
  device_key text primary key references municipal_devices on delete cascade,
  reported_vehicle uuid not null references vehicles(id), seen_at timestamptz not null,
  location geometry(Point,4326) not null
);
alter table municipal_device_fixes enable row level security;
revoke all on municipal_device_fixes from public, anon, authenticated;
grant select on municipal_device_fixes to authenticated;
create policy device_fix_read on municipal_device_fixes for select to authenticated using
  (exists(select 1 from municipal_devices d where d.device_key=municipal_device_fixes.device_key));
create function record_municipal_fix(p_key text,p_vehicle uuid,p_seen timestamptz,p_lng float8,p_lat float8)
returns void language sql security definer set search_path=public,extensions as $$
  insert into municipal_device_fixes(device_key,reported_vehicle,seen_at,location)
  select d.device_key,v.id,p_seen,st_setsrid(st_makepoint(p_lng,p_lat),4326)
  from municipal_devices d join vehicles v on v.municipality_id=d.municipality_id
  where d.device_key=p_key and v.id=p_vehicle and p_seen<=now()+interval '30 seconds'
    and p_lng between -180 and 180 and p_lat between -90 and 90 and (p_lng<>0 or p_lat<>0)
  on conflict(device_key) do update set reported_vehicle=excluded.reported_vehicle,seen_at=excluded.seen_at,location=excluded.location
  where municipal_device_fixes.seen_at < excluded.seen_at
$$;
revoke all on function record_municipal_fix(text,uuid,timestamptz,float8,float8) from public,anon,authenticated;
grant execute on function record_municipal_fix(text,uuid,timestamptz,float8,float8) to service_role;
create index municipal_route_geography on routes using gist ((geometry::geography)) where is_active;
create view municipal_device_monitor with(security_invoker=true) as
  select d.*, f.seen_at, f.reported_vehicle, matches.names as detected_routes
  from municipal_devices d left join municipal_device_fixes f using(device_key)
  left join lateral (
    select array_agg(r.name order by r.name,r.id) as names from routes r
    where r.is_active and r.municipality_id=d.municipality_id and f.seen_at>=now()-interval '3 minutes'
      and st_dwithin(r.geometry::geography,f.location::geography,35)
  ) matches on true;
revoke all on municipal_device_monitor from public,anon,authenticated;
grant select on municipal_device_monitor to authenticated;


-- Los permisos por ciudad complementan los permisos por operación del panel.
do $$
declare t text; pred text;
begin
  foreach t in array array['vehicles','campaigns','shifts','dump_sites','pickup_schedules','ai_blocked_streets','waste_stats'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    if t <> 'vehicles' then
      execute format('alter table %I add column municipality_id text references municipalities(id)',t);
      execute format('alter table %I alter municipality_id set default rl_city()',t);
    end if;
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on %I from anon',t);
    execute format('revoke truncate, references, trigger on %I from authenticated',t);
    execute format('create policy municipal_scope on %I as restrictive for all to public using (municipality_id=rl_city()) with check (municipality_id=rl_city())',t);
    execute format('create policy municipal_staff_read on %I for select to authenticated using (municipality_id=rl_city())',t);
    execute format('create policy municipal_admin_write on %I for all to authenticated using (rl_city_admin()) with check (rl_city_admin())',t);
    execute format('create policy municipal_admin_insert on %I as restrictive for insert to authenticated with check(rl_city_admin())',t);
    execute format('create policy municipal_admin_update on %I as restrictive for update to authenticated using(rl_city_admin()) with check(rl_city_admin())',t);
    execute format('create policy municipal_admin_delete on %I as restrictive for delete to authenticated using(rl_city_admin())',t);
    execute format('grant select, insert, update, delete on %I to authenticated',t);
  end loop;
  update pickup_schedules s set municipality_id=r.municipality_id from routes r where r.id=s.route_id;
  foreach t in array array['gps_logs','device_telemetry','vehicle_crew','collections','vehicle_load_cycles','vehicle_route_state','daily_service_stats'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    if t='daily_service_stats' then
      pred := 'exists(select 1 from routes r where r.id=route_id)';
    else
      pred := 'exists(select 1 from vehicles v where v.id=vehicle_id)';
    end if;
    if t='collections' then
      pred:=pred||' and (route_id is null or exists(select 1 from routes r where r.id=route_id))';
    end if;
    if t='vehicle_crew' then pred:=pred||' and exists(select 1 from municipal_members m where m.user_id=vehicle_crew.user_id and m.municipality_id=rl_city())'; end if;
    if t='vehicle_route_state' then pred:='('||pred||' or (not rl_is_staff() and route_id=rl_my_route()))'; end if;
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on %I from anon',t);
    execute format('revoke truncate, references, trigger on %I from authenticated',t);
    execute format('create policy municipal_scope on %I as restrictive for all to authenticated using (%s) with check (%s)',t,pred,pred);
    execute format('create policy municipal_staff_read on %I for select to authenticated using (rl_city() is not null)',t);
    if t in ('vehicle_crew','collections') then
      execute format('create policy municipal_admin_write on %I for all to authenticated using (rl_city_admin()) with check (rl_city_admin())',t);
    end if;
  end loop;
end $$;
alter table routes add constraint route_city_pair unique(id,municipality_id);
alter table pickup_schedules add constraint schedule_route_city foreign key(route_id,municipality_id)
  references routes(id,municipality_id);
create policy users_municipal_scope on users as restrictive for all to authenticated
  using(id=auth.uid() or exists(select 1 from municipal_members m where m.user_id=id and m.municipality_id=rl_city())
        or exists(select 1 from routes r where r.id=users.route_id))
  with check(id=auth.uid() or rl_city_admin());
create policy municipal_intent_scope on collection_intents as restrictive for all to authenticated
  using(user_id=auth.uid() or exists(select 1 from routes r where r.id=route_id))
  with check(user_id=auth.uid() or exists(select 1 from routes r where r.id=route_id));
do $$ begin
  if to_regclass('public.reports') is not null then
    alter table reports enable row level security;
    create policy municipal_report_scope on reports as restrictive for all to authenticated
      using(user_id=auth.uid() or exists(select 1 from users u where u.id=user_id and rl_city() is not null))
      with check(user_id=auth.uid() or exists(select 1 from users u where u.id=user_id and rl_city() is not null));
  end if;
end $$;
-- Evita que una llamada administrativa ignore el ámbito del invocante.
alter function save_dump_site(uuid,text,double precision,double precision,integer,jsonb,boolean) security invoker;
alter function delete_dump_site(uuid) security invoker;
alter function save_pickup_schedule(uuid,smallint,text,text,uuid,text,boolean) security invoker;
alter function delete_pickup_schedule(uuid) security invoker;
revoke all on function close_service_day(date), purge_expired_notifications() from public,anon,authenticated;
create or replace function public.set_route_learning(
  p_route_id uuid, p_mode text, p_learning boolean, p_base_route jsonb, p_timeline jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.rl_manage_route(p_route_id) then
    raise exception 'Solo un administrador puede configurar el aprendizaje de rutas';
  end if;
  if p_mode not in ('predefined', 'learning', 'ai') then
    raise exception 'Modo de ruta no válido';
  end if;
  update public.routes
     set route_mode = p_mode,
         learning_enabled = coalesce(p_learning, false),
         base_route = p_base_route,
         timeline = p_timeline,
         learned_at = case when p_mode = 'learning' then now() else learned_at end
   where id = p_route_id;
  if not found then raise exception 'La ruta no existe'; end if;
  if p_mode = 'learning' then
    insert into public.route_events (route_id, kind, message, payload)
    values (p_route_id, 'learned', 'Ruta aprendida del recorrido real del camión.',
            jsonb_build_object('days', p_timeline -> 'days'));
  end if;
end $$;

-- Cambia la ruta activa (ajuste por aprendizaje o rodeo de un bloqueo) y deja el aviso.
-- Si p_expected_updated_at ya no coincide, otra persona la cambió primero: se rechaza.
-- Con la misma p_dedupe_key no se repite el cambio (varios paneles abiertos a la vez).
create or replace function public.apply_route_change(
  p_route_id uuid, p_route_geojson jsonb, p_timeline jsonb, p_kind text, p_message text,
  p_payload jsonb default '{}'::jsonb, p_expected_updated_at timestamptz default null,
  p_dedupe_key text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_updated timestamptz;
  v_vehicle uuid;
  v_route geometry;
  v_id uuid;
begin
  if not public.rl_manage_route(p_route_id) then
    raise exception 'Solo un administrador puede cambiar rutas';
  end if;
  if p_kind not in ('route_changed', 'blockage_reroute') then
    raise exception 'Tipo de cambio no válido';
  end if;

  select updated_at, vehicle_id into v_updated, v_vehicle
    from public.routes where id = p_route_id for update;
  if not found then raise exception 'La ruta no existe'; end if;
  if p_expected_updated_at is not null and v_updated <> p_expected_updated_at then
    raise exception 'La ruta fue modificada por otra persona';
  end if;
  if p_dedupe_key is not null and exists (
    select 1 from public.route_events where route_id = p_route_id and dedupe_key = p_dedupe_key
  ) then
    return null;
  end if;

  v_route := st_force2d(st_setsrid(st_geomfromgeojson(p_route_geojson::text), 4326));
  if st_geometrytype(v_route) <> 'ST_LineString' or not st_isvalid(v_route) then
    raise exception 'La ruta debe ser un LineString válido';
  end if;

  update public.routes
     set geometry = v_route,
         timeline = coalesce(p_timeline, timeline),
         last_change_at = now()
   where id = p_route_id;

  insert into public.route_events (route_id, vehicle_id, kind, message, payload, dedupe_key)
  values (p_route_id, v_vehicle, p_kind, left(p_message, 500), coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  returning id into v_id;
  return v_id;
end $$;

-- Registra un aviso que no cambia la ruta (desvío, bloqueo sin salida).
create or replace function public.log_route_event(
  p_route_id uuid, p_kind text, p_message text,
  p_payload jsonb default '{}'::jsonb, p_dedupe_key text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_vehicle uuid;
begin
  if not exists(select 1 from routes where id=p_route_id and municipality_id=rl_city()) then
    raise exception 'Se necesita una cuenta del personal';
  end if;
  if p_kind not in ('deviation', 'blockage') then
    raise exception 'Tipo de aviso no válido';
  end if;
  select vehicle_id into v_vehicle from public.routes where id = p_route_id;
  if not found then raise exception 'La ruta no existe'; end if;
  insert into public.route_events (route_id, vehicle_id, kind, message, payload, dedupe_key)
  values (p_route_id, v_vehicle, p_kind, left(p_message, 500), coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
  on conflict (route_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;

-- Enciende o apaga el aprendizaje. Al apagarlo se restaura la ruta predeterminada
-- (base_route), que es la que el camión tenía al crearse.
create or replace function public.set_route_learning_enabled(p_route_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_base jsonb;
  v_vehicle uuid;
begin
  if not public.rl_manage_route(p_route_id) then
    raise exception 'Solo un administrador puede cambiar el aprendizaje';
  end if;
  select base_route, vehicle_id into v_base, v_vehicle from public.routes where id = p_route_id for update;
  if not found then raise exception 'La ruta no existe'; end if;

  update public.routes
     set learning_enabled = p_enabled,
         geometry = case when not p_enabled and v_base is not null
                         then st_force2d(st_setsrid(st_geomfromgeojson(v_base::text), 4326))
                         else geometry end,
         last_change_at = case when not p_enabled and v_base is not null then now() else last_change_at end
   where id = p_route_id;

  insert into public.route_events (route_id, vehicle_id, kind, message)
  values (p_route_id, v_vehicle,
          case when p_enabled then 'learning_on' else 'learning_off' end,
          case when p_enabled then 'Aprendizaje activado: la ruta puede ajustarse sola.'
               else 'Aprendizaje apagado: se conserva la ruta predeterminada.' end);
end $$;

create or replace view public.service_survey_live as
select ci.scheduled_date as stat_date,
       ci.route_id,
       r.name as route_name,
       count(*) filter (where ci.will_dispose)::int as will_dispose,
       count(*) filter (where ci.status = 'atendido')::int as served,
       count(*) filter (where ci.status = 'desatendido')::int as unserved,
       count(*) filter (where ci.status = 'sin_confirmar')::int as unconfirmed
from public.collection_intents ci
left join public.routes r on r.id = ci.route_id
where r.municipality_id=public.rl_city()
  and ci.route_id is not null
  and ci.scheduled_date >= (current_date - 30)
group by ci.scheduled_date, ci.route_id, r.name;
revoke all on function save_municipal_route(jsonb,text,text,jsonb) from public,anon;
grant execute on function save_municipal_route(jsonb,text,text,jsonb) to authenticated;
create function record_municipal_fixes(p_fixes jsonb) returns void language sql security invoker set search_path=public as $$
  select record_municipal_fix(f.key,f.vehicle,f.seen,f.lng,f.lat)
  from jsonb_to_recordset(p_fixes) f(key text,vehicle uuid,seen timestamptz,lng float8,lat float8)
$$;
revoke all on function record_municipal_fixes(jsonb) from public,anon,authenticated;
grant execute on function record_municipal_fixes(jsonb) to service_role;
create function municipal_fleet_scope() returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('city',rl_city(),'admin',rl_city_admin(),'vehicles',
    coalesce((select jsonb_agg(v.id) from vehicles v where v.municipality_id=rl_city()
      or exists(select 1 from users u join routes r on r.id=u.route_id where u.id=auth.uid() and u.role::text in ('ciudadano','user','citizen')
                and r.is_active and r.service_kind='public' and r.vehicle_id=v.id)), '[]'::jsonb))
$$;
revoke all on function municipal_fleet_scope() from public,anon;
grant execute on function municipal_fleet_scope() to authenticated;
create or replace function public.rl_assign_route(p_lng double precision, p_lat double precision)
returns table (route_id uuid, fraction double precision, distance_m double precision)
language sql stable security definer set search_path = public, extensions as $$
  with pt as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326) as g),
  cand as (
    select r.id as rid,
           r.geometry as line,
           st_distance(r.geometry::geography, pt.g::geography) as d,
           st_linelocatepoint(r.geometry, pt.g) as f
    from public.routes r, pt
    where r.is_active and r.service_kind='public'
      and r.geometry is not null
      and (
        st_dwithin(r.geometry::geography, pt.g::geography, coalesce(r.notify_radius_m, 150))
        or (r.zone_geometry is not null and st_covers(r.zone_geometry, pt.g))
      )
  )
  select rid,
         case when st_length(line::geography) > 0
              then least(1.0, greatest(0.0,
                     st_length(st_linesubstring(line, 0, f)::geography) / st_length(line::geography)))
              else 0.0 end,
         d
  from cand
  order by d asc
  limit 1
$$;
create or replace function public.rl_can_read_report_photo(p_name text)
returns boolean language sql stable security invoker set search_path=public as $$
  select split_part(p_name,'/',1)=auth.uid()::text or
    (rl_city() is not null and exists(select 1 from users u where u.id::text=split_part(p_name,'/',1)))
$$;
revoke all on function rl_can_read_report_photo(text) from public,anon;
grant execute on function rl_can_read_report_photo(text) to authenticated;
commit;

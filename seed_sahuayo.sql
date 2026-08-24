-- ═══════════════════════════════════════════════════════════════════════
--  RutaLimpia · DATOS DE PRUEBA — Sahuayo de Morelos, Michoacán
--
--  Las CALLES y COORDENADAS son REALES (tomadas de OpenStreetMap):
--    · Calle Insurgentes + Avenida Constitución  → Ruta Centro
--    · Calle Emiliano Zapata                     → Ruta Emiliano Zapata
--    · Calle Cuauhtémoc                          → Ruta Cuauhtémoc Norte
--  La OPERACIÓN (recolecciones, quejas, GPS, toneladas) es SIMULADA.
--
--  Ejecuta este archivo completo en el SQL Editor de Supabase.
--  Es idempotente: puedes correrlo varias veces sin duplicar nada.
--  Al final del archivo hay un bloque para borrar todo lo insertado.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── 0) La cuenta que figurará como autora de las quejas ────────────────
do $$
begin
  if (select id from auth.users where email = 'correo@ejemplo.com') is null then
    raise exception 'No existe el usuario correo@ejemplo.com — cambia el correo en este script.';
  end if;
end $$;


-- ── 1) Conductores ficticios ───────────────────────────────────────────
-- Si public.users.id tiene llave foránea hacia auth.users, este bloque se
-- omite solo y las recolecciones se asignarán a tu propia cuenta.
do $$
begin
  insert into public.users (id, name, role, phone) values
    ('a2000000-0000-4000-8000-000000000001', 'Juan Pérez Alvarado',  'driver', '353-532-0011'),
    ('a2000000-0000-4000-8000-000000000002', 'María López Chávez',   'driver', '353-532-0012'),
    ('a2000000-0000-4000-8000-000000000003', 'Ramón García Neri',    'driver', '353-532-0013'),
    ('a2000000-0000-4000-8000-000000000004', 'Alicia Torres Ruiz',   'driver', '353-532-0014')
  on conflict (id) do update set name = excluded.name, role = excluded.role;
exception
  when foreign_key_violation then
    raise notice 'Conductores ficticios omitidos: public.users.id depende de auth.users.';
end $$;


-- ── 2) Rutas sobre calles reales de Sahuayo ────────────────────────────
-- Nota: distance_km es una columna generada — Postgres la calcula sola a
-- partir de la geometría, por eso no se inserta aquí.
insert into public.routes
  (id, name, description, route_type, geometry,
   has_steep_terrain, has_narrow_alleys, collection_notes, is_active)
values
  ('a1000000-0000-4000-8000-000000000001',
   'Ruta Centro — Colonia Centro',
   'Circuito por Calle Insurgentes y Avenida Constitución, en el primer cuadro de Sahuayo.',
   'commercial',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7227557 20.0569937, -102.7220136 20.0569859, -102.7212920 20.0569408, -102.7208386 20.0569046, -102.7197487 20.0568484, -102.7186084 20.0568134, -102.7175219 20.0567507, -102.7174924 20.0571223, -102.7185802 20.0571872, -102.7197500 20.0572570, -102.7208347 20.0573216, -102.7220238 20.0573926, -102.7227557 20.0569937)'), 4326),
   false, true,
   'Zona comercial de alto tránsito. Recolectar antes de las 08:00 para no bloquear el centro.',
   true),

  ('a1000000-0000-4000-8000-000000000002',
   'Ruta Emiliano Zapata',
   'Corredor sobre Calle Emiliano Zapata, al sur de la ciudad.',
   'residential',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7181995 20.0538986, -102.7182800 20.0518947, -102.7182938 20.0513076, -102.7182968 20.0505825, -102.7183120 20.0497695, -102.7183177 20.0491912, -102.7183185 20.0486210, -102.7183206 20.0476516, -102.7182883 20.0461181)'), 4326),
   false, true,
   'Colonia habitacional. Contenedores en esquinas; calles angostas en el tramo final.',
   true),

  ('a1000000-0000-4000-8000-000000000003',
   'Ruta Cuauhtémoc Norte',
   'Corredor sobre Calle Cuauhtémoc, salida norte de Sahuayo.',
   'residential',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7262436 20.0580924, -102.7261266 20.0589321, -102.7260475 20.0593749, -102.7259679 20.0596657, -102.7257960 20.0604035, -102.7255990 20.0612489, -102.7254152 20.0620128, -102.7252824 20.0625812, -102.7251073 20.0635282)'), 4326),
   true, false,
   'Pendiente pronunciada en el tramo alto; requiere camión con buena tracción.',
   true)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, route_type = excluded.route_type,
  geometry = excluded.geometry,
  has_steep_terrain = excluded.has_steep_terrain, has_narrow_alleys = excluded.has_narrow_alleys,
  collection_notes = excluded.collection_notes, is_active = excluded.is_active;


-- ── 3) Recolecciones de los últimos 7 días ─────────────────────────────
with veh as (select id, row_number() over (order by economic_number) rn from public.vehicles),
     shf as (select id, row_number() over (order by start_time) rn from public.shifts),
     drv as (select id, row_number() over (order by name) rn from public.users where role = 'driver'),
     fallback as (select id from auth.users where email = 'correo@ejemplo.com'),
     src (n, veh_rn, route_id, shift_rn, drv_rn, status, priority, day_offset, reason, notes) as (values
       ( 1, 1, 'a1000000-0000-4000-8000-000000000001'::uuid, 1, 1, 'completed',  'normal', 0, null, 'Recolección sin novedades.'),
       ( 2, 2, 'a1000000-0000-4000-8000-000000000002'::uuid, 1, 2, 'completed',  'normal', 0, null, 'Ruta cubierta al 100%.'),
       ( 3, 3, 'a1000000-0000-4000-8000-000000000003'::uuid, 2, 3, 'incomplete', 'high',   0, 'Falla mecánica', 'Se ponchó una llanta en Calle Cuauhtémoc; se reprogramó el tramo alto.'),
       ( 4, 4, 'a1000000-0000-4000-8000-000000000001'::uuid, 2, 4, 'completed',  'normal', 1, null, 'Retraso de 20 min por bloqueo vial.'),
       ( 5, 1, 'a1000000-0000-4000-8000-000000000002'::uuid, 1, 1, 'completed',  'normal', 1, null, null),
       ( 6, 2, 'a1000000-0000-4000-8000-000000000003'::uuid, 1, 2, 'completed',  'normal', 1, null, null),
       ( 7, 3, 'a1000000-0000-4000-8000-000000000001'::uuid, 2, 3, 'incomplete', 'high',   2, 'Obstrucción de ruta', 'Vehículos mal estacionados impidieron el paso en Av. Constitución.'),
       ( 8, 4, 'a1000000-0000-4000-8000-000000000002'::uuid, 1, 4, 'completed',  'normal', 2, null, null),
       ( 9, 1, 'a1000000-0000-4000-8000-000000000003'::uuid, 1, 1, 'completed',  'normal', 3, null, null),
       (10, 2, 'a1000000-0000-4000-8000-000000000001'::uuid, 2, 2, 'completed',  'normal', 3, null, null),
       (11, 3, 'a1000000-0000-4000-8000-000000000002'::uuid, 1, 3, 'incomplete', 'normal', 4, 'Combustible insuficiente', 'El camión regresó a base antes de terminar la ruta.'),
       (12, 4, 'a1000000-0000-4000-8000-000000000001'::uuid, 1, 4, 'completed',  'normal', 4, null, null),
       (13, 1, 'a1000000-0000-4000-8000-000000000002'::uuid, 2, 1, 'completed',  'normal', 5, null, null),
       (14, 2, 'a1000000-0000-4000-8000-000000000003'::uuid, 1, 2, 'completed',  'normal', 5, null, null),
       (15, 3, 'a1000000-0000-4000-8000-000000000001'::uuid, 1, 3, 'completed',  'normal', 6, null, null),
       (16, 4, 'a1000000-0000-4000-8000-000000000002'::uuid, 2, 4, 'cancelled',  'normal', 6, 'Día festivo', 'No hubo operación.'),
       (17, 1, 'a1000000-0000-4000-8000-000000000001'::uuid, 1, 1, 'pending',    'normal', -1, null, 'Programada para mañana.'),
       (18, 2, 'a1000000-0000-4000-8000-000000000002'::uuid, 2, 2, 'pending',    'normal', -1, null, null)
     )
insert into public.collections
  (id, vehicle_id, route_id, driver_id, shift_id, status, priority,
   scheduled_date, started_at, ended_at, incomplete_reason, notes)
select
  ('a3000000-0000-4000-8000-' || lpad(s.n::text, 12, '0'))::uuid,
  (select id from veh where rn = ((s.veh_rn - 1) % (select count(*) from veh)) + 1),
  s.route_id,
  coalesce(
    (select id from drv where rn = ((s.drv_rn - 1) % greatest((select count(*) from drv), 1)) + 1),
    (select id from fallback)),
  (select id from shf where rn = ((s.shift_rn - 1) % (select count(*) from shf)) + 1),
  s.status, s.priority,
  (current_date - s.day_offset)::date,
  case when s.status = 'pending' then null
       else (current_date - s.day_offset) + time '07:10' end,
  case when s.status in ('completed', 'incomplete') then (current_date - s.day_offset) + time '11:35'
       else null end,
  s.reason, s.notes
from src s
on conflict (id) do update set
  status = excluded.status, priority = excluded.priority,
  scheduled_date = excluded.scheduled_date, started_at = excluded.started_at,
  ended_at = excluded.ended_at, incomplete_reason = excluded.incomplete_reason,
  notes = excluded.notes;


-- ── 4) Quejas ciudadanas ───────────────────────────────────────────────
-- Coordenadas repartidas a lo largo de las tres rutas, más dos quejas
-- lejanas para comprobar el grupo "Fuera de ruta".
insert into public.reports
  (id, user_id, category, description, lat, lng, status, created_at, resolved_at, photo_url)
select
  ('a4000000-0000-4000-8000-' || lpad(v.n::text, 12, '0'))::uuid,
  (select id from auth.users where email = 'correo@ejemplo.com'),
  v.category, v.description, v.lat, v.lng, v.status,
  now() - (v.hours_ago || ' hours')::interval,
  case when v.status = 'resolved' then now() - ((v.hours_ago / 3) || ' hours')::interval else null end,
  v.photo
from (values
  ( 1, 'basura_acumulada', 'Bolsas de basura acumuladas en la esquina desde hace tres días.',            20.056226, -102.723319, 'pending',      9,  'https://picsum.photos/seed/rlq1/480/360'),
  ( 2, 'queja_servicio',   'El contenedor está roto y la basura se sale a la banqueta.',                 20.056000, -102.720809, 'pending',     16,  'https://picsum.photos/seed/rlq2/480/360'),
  ( 3, 'camion_no_paso',   'El camión no pasó en el horario programado esta semana.',                    20.056553, -102.719634, 'resolved',    24,  null),
  ( 4, 'otra',             'Están tirando escombro en el lote baldío de la esquina.',                    20.056767, -102.718936, 'pending',     31,  'https://picsum.photos/seed/rlq4/480/360'),
  ( 5, 'queja_servicio',   'Fuerte mal olor por residuos orgánicos sin recolectar.',                     20.057041, -102.720060, 'in_progress', 38,  'https://picsum.photos/seed/rlq5/480/360'),
  ( 6, 'queja_servicio',   'Los contenedores bloquean el paso peatonal frente a la escuela.',            20.056421, -102.722211, 'resolved',    45,  null),
  ( 7, 'basura_acumulada', 'Se juntó mucha basura afuera del mercado y nadie la recoge.',                20.057713, -102.722997, 'pending',     52,  'https://picsum.photos/seed/rlq7/480/360'),
  ( 8, 'camion_no_paso',   'Llevamos dos semanas sin servicio en esta cuadra.',                          20.053290, -102.719403, 'pending',     12,  'https://picsum.photos/seed/rlq8/480/360'),
  ( 9, 'queja_servicio',   'La tapa del contenedor se rompió y entran perros.',                          20.052293, -102.717886, 'resolved',    27,  'https://picsum.photos/seed/rlq9/480/360'),
  (10, 'otra',             'Olor muy fuerte en la banqueta, parece que se derramó lixiviado.',           20.049542, -102.718065, 'pending',     34,  null),
  (11, 'basura_acumulada', 'Montón de basura en el camellón desde el fin de semana.',                    20.047623, -102.716794, 'in_progress', 41,  'https://picsum.photos/seed/rlq11/480/360'),
  (12, 'otra',             'Tiran bolsas de noche en el terreno de la esquina.',                         20.045655, -102.717141, 'pending',     58,  'https://picsum.photos/seed/rlq12/480/360'),
  (13, 'camion_no_paso',   'El camión pasó de largo sin detenerse en toda la calle.',                    20.057252, -102.727382, 'resolved',    20,  null),
  (14, 'queja_servicio',   'Contenedor en media calle, no pueden pasar los coches.',                     20.060070, -102.726660, 'pending',     29,  'https://picsum.photos/seed/rlq14/480/360'),
  (15, 'basura_acumulada', 'Basura acumulada en la subida, se va rodando cuando llueve.',                20.061428, -102.726621, 'pending',     36,  'https://picsum.photos/seed/rlq15/480/360'),
  (16, 'otra',             'Malos olores cerca del parque desde hace varios días.',                      20.063247, -102.724663, 'pending',     47,  null),
  (90, 'otra',             'Tiradero a cielo abierto en las afueras, junto al camino de terracería.',    20.074200, -102.700500, 'pending',     52,  'https://picsum.photos/seed/rlq90/480/360'),
  (91, 'basura_acumulada', 'Basura en la carretera de salida, fuera de cualquier ruta registrada.',      20.031000, -102.742000, 'pending',     73,  null)
) as v(n, category, description, lat, lng, status, hours_ago, photo)
on conflict (id) do update set
  category = excluded.category, description = excluded.description,
  lat = excluded.lat, lng = excluded.lng, status = excluded.status,
  created_at = excluded.created_at, resolved_at = excluded.resolved_at,
  photo_url = excluded.photo_url;


-- ── 5) Historial GPS — alimenta el botón "Mostrar recorridos" ──────────
-- Los puntos se interpolan directamente sobre la geometría real de la ruta,
-- así que el trazo sigue exactamente las calles de Sahuayo.
with ruta as (select geometry from public.routes where id = 'a1000000-0000-4000-8000-000000000001'),
     cam  as (select id from public.vehicles order by economic_number limit 1),
     col  as (select id from public.collections where id = 'a3000000-0000-4000-8000-000000000001'),
     pasos as (select generate_series(0, 40) as n)
insert into public.gps_logs
  (id, vehicle_id, collection_id, location, accuracy, battery_pct,
   gps_quality, gsm_signal_dbm, timestamp, truck_capacity, event_type)
select
  ('a5000000-0000-4000-8000-' || lpad((p.n + 1)::text, 12, '0'))::uuid,
  (select id from cam),
  (select id from col),
  ST_LineInterpolatePoint((select geometry from ruta), p.n / 40.0),
  round((4 + random() * 6)::numeric, 1),
  (92 - (p.n / 40.0 * 34))::int,
  case when p.n % 9 = 0 then 'fair' else 'good' end,
  (-68 - (p.n % 11) * 3),
  (current_date + time '07:10') + (p.n * interval '3 minutes'),
  case when p.n / 40.0 < 0.20 then 'vacio'
       when p.n / 40.0 < 0.50 then 'algo_lleno'
       when p.n / 40.0 < 0.80 then 'medio'
       else 'lleno' end,
  case when p.n = 0  then 'inicio_ruta'
       when p.n = 40 then 'fin_ruta'
       when p.n % 5 = 0 then 'recoleccion'
       else 'transito' end
from pasos p
on conflict (id) do update set
  location = excluded.location, battery_pct = excluded.battery_pct,
  timestamp = excluded.timestamp, truck_capacity = excluded.truck_capacity,
  event_type = excluded.event_type;


-- ── 6) Toneladas recolectadas (gráfica de línea del dashboard) ─────────
insert into public.waste_stats (id, date, tons_collected, is_high_season, notes)
select
  ('a6000000-0000-4000-8000-' || lpad((g + 1)::text, 12, '0'))::uuid,
  (current_date - g)::date,
  round((14 + sin(g) * 4 + (g % 3) * 1.7)::numeric, 2),
  extract(month from current_date - g) in (12, 4),
  case when extract(dow from current_date - g) = 0 then 'Domingo: operación reducida' else null end
from generate_series(0, 13) g
on conflict (date) do update set
  tons_collected = excluded.tons_collected,
  is_high_season = excluded.is_high_season,
  notes          = excluded.notes;

commit;


-- ═══════════════════════════════════════════════════════════════════════
--  Verificación
-- ═══════════════════════════════════════════════════════════════════════
select 'rutas'         as tabla, count(*) from public.routes
union all select 'recolecciones', count(*) from public.collections
union all select 'quejas',        count(*) from public.reports
union all select 'gps_logs',      count(*) from public.gps_logs
union all select 'waste_stats',   count(*) from public.waste_stats
union all select 'conductores',   count(*) from public.users where role = 'driver';


-- ═══════════════════════════════════════════════════════════════════════
--  ¿Quieres borrar TODO lo que insertó este script? Ejecuta solo esto:
-- ═══════════════════════════════════════════════════════════════════════
-- delete from public.gps_logs    where id::text like 'a5000000-%';
-- delete from public.collections where id::text like 'a3000000-%';
-- delete from public.reports     where id::text like 'a4000000-%';
-- delete from public.waste_stats where id::text like 'a6000000-%';
-- delete from public.routes      where id::text like 'a1000000-%';
-- delete from public.users       where id::text like 'a2000000-%';

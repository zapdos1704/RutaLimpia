-- ===================================================================
--  RutaLimpia - RUTAS POR CAMION + CUADRILLAS (Sahuayo de Morelos)
--  Las calles y coordenadas son reales (OpenStreetMap).
--  La operacion es simulada.
--  Ejecuta este archivo COMPLETO en el SQL Editor de Supabase.
--  Es idempotente: puedes correrlo varias veces.
-- ===================================================================

begin;

-- -- 1) Politicas RLS que faltaban -----------------------------------
-- Sin esto la app no puede leer toneladas ni dar de alta camiones.
drop policy if exists "auth_select_waste_stats" on public.waste_stats;
create policy "auth_select_waste_stats" on public.waste_stats
  for select to authenticated using (true);

drop policy if exists "auth_write_vehicles" on public.vehicles;
create policy "auth_write_vehicles" on public.vehicles
  for all to authenticated using (true) with check (true);

alter table public.vehicle_crew enable row level security;
drop policy if exists "auth_write_vehicle_crew" on public.vehicle_crew;
create policy "auth_write_vehicle_crew" on public.vehicle_crew
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_write_routes" on public.routes;
create policy "auth_write_routes" on public.routes
  for all to authenticated using (true) with check (true);


-- -- 2) Personal de cuadrilla -----------------------------------------
-- public.users.id depende de auth.users, asi que NO se pueden inventar
-- usuarios nuevos por SQL. Se reutilizan las cuentas de prueba
-- (test_*@example.com) que ya existian, dandoles nombre y rol reales.
-- Las cuentas "edgar" y las de administrador NO se tocan.
with candidatos as (
  select u.id, row_number() over (order by u.created_at) rn
  from public.users u
  join auth.users a on a.id = u.id
  where a.email like 'test%@example.com'
),
nombres (rn, nombre, rol) as (values
  (1, 'Juan Perez Alvarado', 'driver'),
  (2, 'Maria Lopez Chavez', 'driver'),
  (3, 'Ramon Garcia Neri', 'driver'),
  (4, 'Alicia Torres Ruiz', 'driver'),
  (5, 'Sergio Villasenor Gil', 'driver'),
  (6, 'Miguel Angel Cortes', 'collector'),
  (7, 'Rosa Elena Nunez', 'collector'),
  (8, 'Pedro Sandoval Rios', 'collector'),
  (9, 'Javier Mendoza Lara', 'collector'),
  (10, 'Luis Fernando Ochoa', 'collector')
)
update public.users u
set name = n.nombre, role = n.rol
from candidatos c
join nombres n on n.rn = c.rn
where u.id = c.id;


-- -- 3) Rutas: una por camion, sobre calles reales --------------------
insert into public.routes
  (id, name, description, route_type, geometry,
   has_steep_terrain, has_narrow_alleys, collection_notes, is_active)
values
  ('a1000000-0000-4000-8000-000000000001', 'Ruta Centro', 'Primer cuadro: Calle Insurgentes y Avenida Constitucion.', 'commercial',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7227557 20.0569937, -102.7220136 20.0569859, -102.7212920 20.0569408, -102.7208386 20.0569046, -102.7197487 20.0568484, -102.7186084 20.0568134, -102.7175219 20.0567507, -102.7174924 20.0571223, -102.7185802 20.0571872, -102.7197500 20.0572570, -102.7208347 20.0573216, -102.7220238 20.0573926, -102.7227557 20.0569937)'), 4326),
   false, true, 'Zona comercial de alto transito. Recolectar antes de las 08:00.', true),
  ('a1000000-0000-4000-8000-000000000003', 'Ruta Norte', 'Calle Cuauhtemoc y Calle Jose L. Licea, salida norte.', 'residential',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7262436 20.0580924, -102.7261266 20.0589321, -102.7260475 20.0593749, -102.7259679 20.0596657, -102.7257960 20.0604035, -102.7255990 20.0612489, -102.7254152 20.0620128, -102.7252824 20.0625812, -102.7251073 20.0635282, -102.7240839 20.0654833, -102.7241243 20.0649811, -102.7241722 20.0643930, -102.7243188 20.0634834, -102.7244920 20.0625264, -102.7247023 20.0616072, -102.7247414 20.0610372, -102.7262436 20.0580924)'), 4326),
   true, false, 'Pendiente pronunciada en el tramo alto; requiere buena traccion.', true),
  ('a1000000-0000-4000-8000-000000000002', 'Ruta Sur', 'Calle Jose Maria Morelos y Calle Francisco Ruiz Sanchez.', 'residential',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7222513 20.0479520, -102.7220089 20.0488937, -102.7218857 20.0494640, -102.7217774 20.0499529, -102.7217175 20.0502269, -102.7216214 20.0508139, -102.7215218 20.0514329, -102.7213734 20.0522327, -102.7212991 20.0525551, -102.7183185 20.0486210, -102.7188694 20.0486247, -102.7193679 20.0486280, -102.7197582 20.0486306, -102.7199988 20.0486587, -102.7210682 20.0487837, -102.7215513 20.0488402, -102.7220089 20.0488937, -102.7228793 20.0490370, -102.7231814 20.0491553, -102.7235998 20.0493192, -102.7242677 20.0495808, -102.7243573 20.0496158, -102.7249133 20.0498336, -102.7255831 20.0500959, -102.7222513 20.0479520)'), 4326),
   false, true, 'Colonia habitacional. Contenedores en esquinas; calles angostas.', true),
  ('a1000000-0000-4000-8000-000000000004', 'Ruta Oriente', 'Calle Gustavo Diaz Ordaz y Calle Panama.', 'market',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7165372 20.0552393, -102.7165363 20.0553037, -102.7163535 20.0552341, -102.7163525 20.0552994, -102.7150263 20.0552234, -102.7150228 20.0552959, -102.7139017 20.0551534, -102.7138948 20.0552209, -102.7127726 20.0550546, -102.7127720 20.0551257, -102.7116824 20.0549816, -102.7116764 20.0550462, -102.7109218 20.0549176, -102.7109159 20.0549885, -102.7098115 20.0548339, -102.7098071 20.0548920, -102.7086637 20.0547567, -102.7086618 20.0548170, -102.7075528 20.0546617, -102.7075484 20.0547207, -102.7070115 20.0546782, -102.7065356 20.0546312, -102.7060480 20.0545668, -102.7060050 20.0552348, -102.7065021 20.0553180, -102.7069790 20.0553609, -102.7075372 20.0553963, -102.7086006 20.0554692, -102.7097416 20.0555480, -102.7108605 20.0556480, -102.7116000 20.0556856, -102.7127149 20.0557875, -102.7138491 20.0558691, -102.7150112 20.0559348, -102.7165372 20.0552393)'), 4326),
   false, false, 'Cercana al mercado: alto volumen de residuos organicos.', true),
  ('a1000000-0000-4000-8000-000000000005', 'Ruta Poniente', 'Avenida Ignacio Zaragoza y Calle Pedro Moreno.', 'residential',
   ST_SetSRID(ST_GeomFromText('LINESTRING(-102.7334391 20.0556837, -102.7329512 20.0556848, -102.7315679 20.0557079, -102.7298673 20.0557739, -102.7285463 20.0558204, -102.7274801 20.0558553, -102.7262036 20.0558662, -102.7253331 20.0559132, -102.7242440 20.0559668, -102.7234158 20.0559695, -102.7233735 20.0552620, -102.7242004 20.0552596, -102.7254262 20.0552560, -102.7261924 20.0552537, -102.7274311 20.0552481, -102.7285328 20.0552468, -102.7297986 20.0552431, -102.7315528 20.0552380, -102.7329573 20.0552338, -102.7334496 20.0552324, -102.7334391 20.0556837)'), 4326),
   false, false, 'Avenida amplia, permite compactador grande.', true)

on conflict (id) do update set
  name = excluded.name, description = excluded.description,
  route_type = excluded.route_type, geometry = excluded.geometry,
  has_steep_terrain = excluded.has_steep_terrain,
  has_narrow_alleys = excluded.has_narrow_alleys,
  collection_notes = excluded.collection_notes, is_active = excluded.is_active;


-- -- 4) Cuadrilla de cada camion (1 conductor + 1 ayudante) -----------
delete from public.vehicle_crew
where vehicle_id in (select id from public.vehicles);

-- users.role usa 'collector', pero vehicle_crew.crew_role solo acepta
-- 'driver' | 'employee', por eso se traduce aqui.
insert into public.vehicle_crew (vehicle_id, user_id, crew_role, is_active)
select v.id, u.id,
       case when u.role = 'driver' then 'driver' else 'employee' end,
       true
from (values
  ('CAM-01', 'Juan Perez Alvarado'),
  ('CAM-01', 'Miguel Angel Cortes'),
  ('VH-001', 'Maria Lopez Chavez'),
  ('VH-001', 'Rosa Elena Nunez'),
  ('VH-002', 'Ramon Garcia Neri'),
  ('VH-002', 'Pedro Sandoval Rios'),
  ('VH-003', 'Alicia Torres Ruiz'),
  ('VH-003', 'Javier Mendoza Lara'),
  ('VH-004', 'Sergio Villasenor Gil'),
  ('VH-004', 'Luis Fernando Ochoa')
     ) as asign(economico, persona)
join public.vehicles v on v.economic_number = asign.economico
join public.users    u on u.name            = asign.persona;


-- -- 5) Reubicar cada camion sobre SU ruta ----------------------------
update public.device_telemetry t
set location  = ST_LineInterpolatePoint(r.geometry, 0.35),
    timestamp = now()
from public.vehicles v
join (values
  ('CAM-01', 'a1000000-0000-4000-8000-000000000001'::uuid),
  ('VH-001', 'a1000000-0000-4000-8000-000000000003'::uuid),
  ('VH-002', 'a1000000-0000-4000-8000-000000000002'::uuid),
  ('VH-003', 'a1000000-0000-4000-8000-000000000004'::uuid),
  ('VH-004', 'a1000000-0000-4000-8000-000000000005'::uuid)
     ) as m(economico, route_id) on m.economico = v.economic_number
join public.routes r on r.id = m.route_id
where t.vehicle_id = v.id;


-- -- 6) Recoleccion de hoy: vincula cada camion con su ruta -----------
insert into public.collections
  (id, vehicle_id, route_id, driver_id, shift_id, status, priority,
   scheduled_date, started_at, notes)
select
  ('a7000000-0000-4000-8000-' || lpad(row_number() over (order by v.economic_number)::text, 12, '0'))::uuid,
  v.id, m.route_id,
  (select cu.user_id from public.vehicle_crew cu
    where cu.vehicle_id = v.id and cu.crew_role = 'driver' limit 1),
  (select id from public.shifts order by start_time limit 1),
  'in_progress', 'normal', current_date,
  current_date + time '07:00',
  'Ruta en curso.'
from (values
  ('CAM-01', 'a1000000-0000-4000-8000-000000000001'::uuid),
  ('VH-001', 'a1000000-0000-4000-8000-000000000003'::uuid),
  ('VH-002', 'a1000000-0000-4000-8000-000000000002'::uuid),
  ('VH-003', 'a1000000-0000-4000-8000-000000000004'::uuid),
  ('VH-004', 'a1000000-0000-4000-8000-000000000005'::uuid)
     ) as m(economico, route_id)
join public.vehicles v on v.economic_number = m.economico
on conflict (id) do update set
  route_id = excluded.route_id, driver_id = excluded.driver_id,
  status = excluded.status, scheduled_date = excluded.scheduled_date;

commit;


-- ===================================================================
--  Verificacion
-- ===================================================================
select v.economic_number as camion,
       r.name            as ruta,
       round(r.distance_km::numeric, 2) as km,
       (select u.name from public.vehicle_crew c
          join public.users u on u.id = c.user_id
         where c.vehicle_id = v.id and c.crew_role = 'driver' limit 1) as conductor,
       (select count(*) from public.vehicle_crew c
         where c.vehicle_id = v.id and c.crew_role = 'collector')      as ayudantes
from public.vehicles v
left join public.collections col
       on col.vehicle_id = v.id and col.scheduled_date = current_date
left join public.routes r on r.id = col.route_id
order by v.economic_number;

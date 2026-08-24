-- ═══════════════════════════════════════════════════════════════
-- RutaLimpia — Permitir eliminar camiones desde el panel
--
-- Ejecutar en Supabase → SQL Editor.
-- Cada bloque es independiente: aplica solo el que necesites.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────
-- 1. DIAGNÓSTICO — ¿qué está bloqueando el borrado?
-- ───────────────────────────────────────────────────────────────

-- 1.a Llaves foráneas que apuntan a vehicles, y qué hacen al borrar
--     ('a' = NO ACTION → bloquea; 'c' = CASCADE; 'n' = SET NULL)
SELECT
  con.conname                              AS restriccion,
  src.relname                              AS tabla_que_apunta,
  att.attname                              AS columna,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION (bloquea el borrado)'
    WHEN 'r' THEN 'RESTRICT (bloquea el borrado)'
    WHEN 'c' THEN 'CASCADE (borra en cadena)'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END                                      AS al_borrar
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
WHERE con.contype = 'f' AND tgt.relname = 'vehicles'
ORDER BY src.relname;

-- 1.b Políticas RLS de TODAS las tablas que intervienen en el borrado.
--     Ojo: una política con cmd = 'ALL' ya incluye DELETE (para DELETE solo
--     cuenta la columna qual / USING; with_check no aplica).
--     El borrado forzado necesita DELETE en las cinco tablas.
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('vehicles','vehicle_crew','collections','gps_logs','device_telemetry')
ORDER BY tablename, cmd;

-- 1.c Resumen: ¿qué tablas NO tienen forma de borrar para 'authenticated'?
SELECT t.tablename,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = t.tablename
           AND p.cmd IN ('ALL','DELETE')
           AND ('authenticated' = ANY (p.roles::text[]) OR 'public' = ANY (p.roles::text[]))
       ) THEN '✅ puede borrar' ELSE '❌ SIN política de DELETE' END AS delete_permitido
FROM (VALUES ('vehicles'),('vehicle_crew'),('collections'),('gps_logs'),('device_telemetry'))
     AS t(tablename);


-- ───────────────────────────────────────────────────────────────
-- 2. PERMISOS — solo para las tablas que el bloque 1.c marcó con ❌
--
--    ⚠️ vehicles YA tiene la política `auth_write_vehicles` con
--       cmd = ALL, y ALL incluye DELETE. NO necesita nada más.
--
--    Postgres no tiene CREATE POLICY IF NOT EXISTS, así que cada
--    bloque hace DROP ... IF EXISTS primero: se puede re-ejecutar
--    sin el error 42710 ("policy already exists").
--
--    Ejecuta SOLO los bloques de las tablas que te falten.
-- ───────────────────────────────────────────────────────────────

-- ── 2.a  Opción RECOMENDADA: solo los administradores pueden borrar ──
--     Aprovecha users.role, que ya existe en tu esquema. Evita que un
--     conductor con sesión iniciada pueda borrar historial de operación.

-- vehicle_crew
DROP POLICY IF EXISTS "admin puede borrar cuadrilla" ON public.vehicle_crew;
CREATE POLICY "admin puede borrar cuadrilla" ON public.vehicle_crew
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- device_telemetry
DROP POLICY IF EXISTS "admin puede borrar telemetria" ON public.device_telemetry;
CREATE POLICY "admin puede borrar telemetria" ON public.device_telemetry
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- gps_logs
DROP POLICY IF EXISTS "admin puede borrar gps_logs" ON public.gps_logs;
CREATE POLICY "admin puede borrar gps_logs" ON public.gps_logs
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- collections  ⚠️ historial de operación: piénsalo dos veces
DROP POLICY IF EXISTS "admin puede borrar recolecciones" ON public.collections;
CREATE POLICY "admin puede borrar recolecciones" ON public.collections
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));


-- ── 2.b  Variante abierta: cualquier usuario autenticado ──
--     Más simple, pero si tus conductores inician sesión en la app
--     también podrán borrar. Descomenta solo si es lo que quieres.

-- DROP POLICY IF EXISTS "authenticated puede borrar cuadrilla" ON public.vehicle_crew;
-- CREATE POLICY "authenticated puede borrar cuadrilla" ON public.vehicle_crew
--   FOR DELETE TO authenticated USING (true);

-- DROP POLICY IF EXISTS "authenticated puede borrar telemetria" ON public.device_telemetry;
-- CREATE POLICY "authenticated puede borrar telemetria" ON public.device_telemetry
--   FOR DELETE TO authenticated USING (true);

-- DROP POLICY IF EXISTS "authenticated puede borrar gps_logs" ON public.gps_logs;
-- CREATE POLICY "authenticated puede borrar gps_logs" ON public.gps_logs
--   FOR DELETE TO authenticated USING (true);

-- DROP POLICY IF EXISTS "authenticated puede borrar recolecciones" ON public.collections;
-- CREATE POLICY "authenticated puede borrar recolecciones" ON public.collections
--   FOR DELETE TO authenticated USING (true);


-- ── 2.c  Limpieza ──
--     Si en un intento anterior creaste la política de vehicles, es
--     redundante con auth_write_vehicles (las permisivas se suman con
--     OR, así que no rompe nada). Descomenta para quitarla:

-- DROP POLICY IF EXISTS "authenticated puede borrar vehiculos" ON public.vehicles;


-- ───────────────────────────────────────────────────────────────
-- 3. LLAVES FORÁNEAS — si el panel dice "todavía hay registros
--    en <tabla> que apuntan a este camión"
--
--    OPCIÓN A (recomendada): borrado en cadena solo para los datos
--    del dispositivo. Al borrar el camión se van con él su
--    telemetría y su rastreo GPS, que no sirven de nada sin él.
--
--    ⚠️ CASCADE es irreversible: borrar un camión borrará esas
--    filas sin volver a preguntar. Aplícalo a conciencia.
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.device_telemetry
  DROP CONSTRAINT IF EXISTS device_telemetry_vehicle_id_fkey,
  ADD  CONSTRAINT device_telemetry_vehicle_id_fkey
       FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;

ALTER TABLE public.gps_logs
  DROP CONSTRAINT IF EXISTS gps_logs_vehicle_id_fkey,
  ADD  CONSTRAINT gps_logs_vehicle_id_fkey
       FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;

ALTER TABLE public.vehicle_crew
  DROP CONSTRAINT IF EXISTS vehicle_crew_vehicle_id_fkey,
  ADD  CONSTRAINT vehicle_crew_vehicle_id_fkey
       FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


-- ───────────────────────────────────────────────────────────────
-- 3.b  collections — DECIDE TÚ
--
--     Aquí vive el historial de operación (qué ruta se hizo, quién,
--     cuándo, si quedó incompleta). Tres caminos:
--
--     · No hacer nada  → un camión con recolecciones NUNCA se podrá
--                        borrar. Para sacarlo de circulación usa
--                        "Dar de baja" en el panel. Es lo más sano
--                        si te importan los reportes históricos.
--
--     · SET NULL       → conserva la recolección pero pierde el dato
--                        de qué camión la hizo. Requiere que la
--                        columna acepte NULL (ver abajo).
--
--     · CASCADE        → al borrar el camión desaparecen también sus
--                        recolecciones. Los reportes de meses
--                        anteriores cambiarán.
--
--     Descomenta SOLO el que quieras.
-- ───────────────────────────────────────────────────────────────

-- -- SET NULL (conserva la recolección, olvida el camión):
-- ALTER TABLE public.collections ALTER COLUMN vehicle_id DROP NOT NULL;
-- ALTER TABLE public.collections
--   DROP CONSTRAINT IF EXISTS collections_vehicle_id_fkey,
--   ADD  CONSTRAINT collections_vehicle_id_fkey
--        FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- -- CASCADE (borra también el historial de recolecciones):
-- ALTER TABLE public.collections
--   DROP CONSTRAINT IF EXISTS collections_vehicle_id_fkey,
--   ADD  CONSTRAINT collections_vehicle_id_fkey
--        FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


-- ───────────────────────────────────────────────────────────────
-- NOTA sobre los nombres de las restricciones
-- Los ALTER de arriba asumen el nombre por omisión de Postgres
-- (<tabla>_<columna>_fkey). Si la consulta 1.a te devuelve otros
-- nombres, sustitúyelos en los DROP CONSTRAINT.
-- ───────────────────────────────────────────────────────────────

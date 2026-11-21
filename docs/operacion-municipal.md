# Operación municipal de RutaLimpia

## Qué puede hacer cada persona

En **Mapa en vivo → Rutas y dispositivos**, el personal de Sahuayo puede consultar las rutas de su ciudad. El autor puede crearlas, modificar sus datos y su trazo y archivarlas. El administrador municipal también puede gestionar las rutas de su equipo y asignar autor a las históricas. Archivar retira la ruta de la operación y conserva su relación con jornadas anteriores. Las cuentas ciudadanas acceden por la aplicación ciudadana.

El **servicio** distingue recolección comercial y recolección para el público general. La **zona** distingue urbana y rural. Una ruta comercial puede ser rural. El catálogo agrupa las rutas por zona y permite completar la clasificación histórica que faltaba.

El administrador registra cada dispositivo con su identificador físico, tipo, modelo y camión previsto. El monitor muestra el camión que transmite y contrasta el GPS con los trazos activos del municipio. Si el equipo de Centro circula por Norte, el monitor muestra Norte al recibir una posición válida a 35 m o menos del trazo. Si varias rutas comparten calle, muestra las coincidencias. Una posición de más de tres minutos caduca y un mensaje antiguo no sustituye a uno más reciente. El panel consulta los cambios cada diez segundos. Para identificar el camión físico tras mover un equipo hay que actualizar el identificador de vehículo que comunica el transmisor. La detección geográfica funciona independientemente del camión previsto. Los 35 m y tres minutos son valores iniciales para contrastar en campo.

## Revisión por interfaz

| Interfaz | Operaciones disponibles | Alcance |
| --- | --- | --- |
| Acceso municipal | Iniciar y cerrar sesión, consultar perfil | Requiere cuenta de personal y pertenencia municipal. |
| Mapa y rutas | Crear, ver, cambiar datos, redibujar, archivar | Todo el equipo municipal consulta. Escriben el autor y el administrador. |
| Dispositivos | Registrar, consultar, editar, eliminar, ver ruta detectada | El administrador gestiona el catálogo. El equipo municipal consulta el monitor. |
| Camiones | Alta, consulta, cambios operativos, tripulación y baja | La ficha distingue los cambios de estado y la gestión de registros con historial. |
| Tiraderos y horarios | Crear, consultar, cambiar y eliminar | Administración municipal para cambios. |
| Campañas | Crear, consultar detalle, editar y eliminar | El personal consulta. El administrador puede editar fechas y estado, cancelar una campaña o eliminarla desde su detalle. |
| Incidencias | Registrar, consultar, marcar como resuelta | El cierre conserva la recolección. El portal carece de eliminación de la incidencia. |
| Quejas | Registro ciudadano, consulta y actualización de estado en el portal | El portal conserva la queja y su resolución. |
| Bloqueos de calle | La base y los módulos de datos admiten registrar, consultar y retirar bloqueos | La versión publicada del asistente de IA oculta la herramienta de marcado. |
| Dashboard | Consultar indicadores de flota y actividad | Las modificaciones se hacen en las pantallas de origen. |

La migración limita por municipio los registros consultados por el portal. Durante una verificación de despliegue hay que probar tanto la página como la API con sesiones de personal distintas. Las claves de servicio de Supabase tienen más privilegios que los usuarios y deben permanecer en el servidor. [Seguridad por fila de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Cómo llevarlo al piloto de Sahuayo

1. Restaurar una copia reciente de la base en preproducción. Guardar las versiones desplegadas de web, servicios, Worker y modelos. Verificar que se puede restaurar la copia.
2. Sobre el esquema de la aplicación, comprobar la migración de planeación `appMappWeb/supabase/migrations/20260918_route_planning.sql` y las migraciones 006 a 009 de `rutalimpia-ai-service/docs/sql`. Aplicar una vez `Web/RutaLimpia/sql/municipal_routes.sql`. Su transacción migra las rutas históricas a Sahuayo. Los vehículos vinculados a ellas y los horarios vinculados a rutas también heredan el municipio.
3. Aprovisionar cuentas verificadas en `municipal_members` desde el servidor o desde el administrador SQL. Para un administrador se requieren tanto el rol `admin` de su perfil como `is_admin=true`. Revisar los vehículos, campañas, turnos, bloqueos, tiraderos, horarios y estadísticas que aún tengan `municipality_id is null`. Asignarlos con el inventario validado por el municipio. Un registro sin ciudad queda fuera del portal.
4. Compilar y desplegar juntos el gateway, el servidor principal y el puente MQTT. Generar el portal con `npm ci` y `npm run build` en `Web/RutaLimpia` y publicar la salida `.site-build`. Verificar la portada pública en `/` y el acceso municipal en `/acceso.html`.
5. Registrar dos dispositivos por su clave física y probar el firmware del ESP32 en una unidad. Recorrer una calle exclusiva de Norte, otra compartida y un tramo rural. Comprobar que el monitor muestra el cambio, las coincidencias y la pérdida de señal. Registrar hora GPS y hora del cambio en pantalla. Contrastar también la ruta que aparece al ciudadano, el estado de jornada y sus notificaciones, que tienen sus propios flujos.
6. Probar con autor, compañero, administrador local, administrador de otra ciudad y ciudadano. Crear una ruta comercial rural, modificar su trazo, asignar el histórico a una cuenta y archivar la ruta de prueba. Comprobar campañas, horarios, tiraderos y reportes. Los ensayos de escritura deben hacerse con datos de prueba.
7. Antes de abrir al equipo completo, medir uso de memoria, retraso GPS, errores de autorización, fallos de trabajo de IA y restauración de respaldos. Si la aplicación falla, cerrar el acceso municipal y restituir las versiones compatibles con el esquema. Para revertir la migración, ensayar la restauración en otra base y reconciliar las escrituras posteriores al respaldo.

Ejemplo de alta desde un cliente SQL de confianza con la variable enlazada `:usuario_verificado`. Comprobar que se insertó una fila. Para conductores y recolectores usar su rol verificado y `false`.

```sql
insert into public.municipal_members (user_id, municipality_id, is_admin)
select id, 'sahuayo', true
from public.users
where id = :usuario_verificado and role = 'admin';
```

## IA en la nube y aprendizaje tras cada jornada

Una opción compatible con el backend actual es una máquina de Oracle Compute dedicada a la IA. Dimensionarla con una prueba que incluya planeación y entrenamiento al mismo tiempo. El servicio necesita FastAPI, acceso al motor de rutas OSRM y mapas viales del territorio que se atenderá. Para cada municipio, configurar una instancia y su propio volumen de modelos. [Oracle Compute](https://docs.oracle.com/en-us/iaas/Content/Compute/Concepts/computeoverview.htm)

1. En la VM, preparar los datos viales y de elevación del municipio y una instancia accesible de OSRM. Configurar la red externa `AI_DOCKER_NETWORK`, el origen autorizado del portal y los valores del archivo de entorno descritos en `rutalimpia-ai-service/DEPLOY.md`. Configurar `SUPABASE_URL`, `SUPABASE_KEY`, `AI_MUNICIPALITY_ID=sahuayo`, `AI_API_KEY` y `TUNNEL_PROOF_KEY` en el servidor.
2. En `rutalimpia-ai-service`, ejecutar `docker compose --env-file .env -f docker-compose.ai.yml up -d --build`. Servir `127.0.0.1:8000` mediante un proxy HTTPS del host. Configurar el Worker con `AI_CLOUD_ORIGIN`, el mismo `AI_MUNICIPALITY_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AI_API_KEY`, `TUNNEL_PROOF_KEY`, los orígenes autorizados en `ALLOWED_ORIGINS` y el resumen SHA-256 de la clave del servicio en `AI_KEY_SHA256`. Probar la sesión municipal y una planeación completa a través del Worker.
3. En Linux, instalar `deploy/rutalimpia-training.cron` en `/etc/cron.d/rutalimpia-training` como root con modo 0644. Verificar que cron y `flock` están disponibles. La tarea comprueba los cierres cada 15 minutos, procesa cada recolección completada, evita duplicados y guarda su avance en el volumen. En la primera ejecución revisa las últimas 24 horas. Después de una interrupción retoma desde el avance guardado, con un día de solapamiento para sincronización tardía. Se puede comprobar en el momento con `docker exec rutalimpia_ai python -m training.after_shift`.
4. Consultar `/app/models/candidates/sahuayo/<versión>/evaluation.json`. Se omiten datos simulados y recorridos con menos de 30 posiciones. Se requieren al menos tres recorridos de entrenamiento y dos posteriores para evaluación. Se contrasta el error absoluto medio de velocidad con el modelo activo. Un resultado `field_review` identifica un candidato para piloto. `keep_active` conserva la referencia y `insufficient_real_trips` identifica falta de datos.
5. Antes de activar un candidato, comparar el resultado en campo, respaldar el modelo vigente y reemplazar el archivo activo con un renombrado atómico en el mismo volumen. Reiniciar el servicio, verificar una inferencia y conservar la versión previa para reversión. Respaldar el volumen y el cursor del proceso.

## Qué calidad demuestra la IA

En las cinco zonas del archivo `rutalimpia-ai-service/docs/benchmarks/nuevo_50.json`, la versión nueva calculó recorridos de 6,28 a 10,23 km, frente a 14,84 a 18,73 km en la anterior. Registró cero vueltas en U. La cobertura directa en camión quedó entre 68,5 % y 78,8 %. Las calles omitidas quedaron como máximo a entre 74 y 116 m del trazo según la zona. Esa distancia geométrica debe contrastarse con el acceso peatonal real y con los domicilios atendidos.

Para el piloto, comparar por zona urbana y rural el error de llegada en minutos, domicilios atendidos, calles omitidas, kilómetros reales y falsos avisos de cambio de ruta. Medirlos sobre jornadas posteriores al entrenamiento y contrastar con la ruta decidida por el operador. Las métricas de anomalías obtenidas con datos sintéticos requieren validación con incidencias etiquetadas en campo. [Validación temporal de modelos en scikit-learn](https://scikit-learn.org/stable/modules/cross_validation.html)

## Instrucción para repetir la aceptación

> Con datos de preproducción, usa dos operadores de Sahuayo, su administrador, un administrador de otra ciudad y una cuenta ciudadana. Crea una ruta comercial rural y una pública urbana. Para cada cuenta registra qué rutas puede ver, cambiar y archivar desde el portal y desde la API. Asigna el autor de una ruta histórica. Transmite posiciones del mismo dispositivo sobre una ruta distinta de la prevista, una calle compartida y un tramo sin señal. Registra ruta prevista, coincidencias y hora de la última posición. Cierra dos recolecciones antes del siguiente ciclo de entrenamiento. Comprueba el informe por cierre, la repetición sin duplicados y la versión activa. Entrega una tabla con resultado esperado, observado y evidencia. Marca las pruebas que requieran camión o datos reales.

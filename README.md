# 🚛 RutaLimpia

Sistema web de gestión de recolección de residuos en tiempo real para el municipio de **Sahuayo de Morelos, Michoacán**. Permite monitorear la flota de camiones, administrar rutas, gestionar campañas especiales y registrar incidencias desde cualquier dispositivo.

---

## ✨ Funcionalidades

### 🔐 Autenticación
- Inicio de sesión con correo y contraseña
- Registro de nuevos usuarios con validación en tiempo real y medidor de fortaleza de contraseña
- Recuperación de contraseña por correo electrónico
- Mapa interactivo de fondo (Sahuayo de Morelos) en la pantalla de login

### 📊 Dashboard
- 5 KPIs en tiempo real: recolecciones completadas, vehículos activos, toneladas, rutas incompletas y campañas activas
- Gráficas: línea de tendencia, donas de estado de flota y tipos de ruta, barras por turno, barras de rendimiento por conductor, gauges de telemetría y mapa de calor semanal
- Las tarjetas crecen con su contenido (ninguna gráfica queda recortada) y la gráfica de
  línea se redibuja a escala 1:1 con el ancho real disponible
- Filtros de período: Diario / Semanal / Mensual
- Sidebar con búsqueda y filtrado de vehículos en tiempo real

### 🗺️ Mapa en vivo
- Mapa interactivo con **MapLibre GL + MapTiler** centrado en Sahuayo de Morelos
- Marcadores de vehículos con color por estado (activo, avería, inactivo)
- Visualización de rutas reales sobre calles del municipio (Ruta Centro, Ruta Norte, Ruta Sur-Oriente)
- Panel de detalle por vehículo con gauges de combustible, capacidad y % de ruta completada
- Recorridos históricos reales trazados desde `gps_logs`

#### ⏸️ Incidencias del dispositivo
El ESP32 reporta cinco eventos (`inicio_pausa`, `fin_pausa`, `fin_pausa_auto_movimiento`,
`bloqueo_ruta`, `reinicio_movimiento`). La base solo guarda eventos sueltos, así que el
estado actual se **deriva** recorriéndolos en orden (`events.js`):

- **Alerta de camión pausado**: franja superior con los camiones en pausa o con bloqueo
  de ruta vigente, y marcador con anillo intermitente e insignia sobre el mapa
- **Filtros por tipo de incidencia**: pausa, bloqueo de ruta, reinicio de movimiento,
  fin de pausa, batería baja, señal GPS débil y avería — con conteo por tipo
- **Panel de eventos**: bitácora completa de todo lo que reportan los camiones, con
  filtro por tipo; al hacer clic el mapa vuela a la ubicación del evento
- **Eventos por camión** dentro del panel de detalle

#### 🤖 Nueva ruta (manual y automática)
- Alta de rutas reales en la tabla `routes`
- Trazo automático a partir de las **calles reales de OpenStreetMap** (Overpass),
  delimitando **por camión** (su zona habitual según el histórico GPS) o **por área
  dibujada sobre el mapa**
- Preparado para conectar el modelo de IA cuando exista: se captura la URL del servicio
  desde la misma pantalla, sin tocar código. Mientras tanto el trazo lo genera una
  heurística local, siempre etiquetada como tal — ver **[AI_RUTAS.md](AI_RUTAS.md)**

### 📣 Campañas
- Listado de campañas con filtros por estado (activa, planificada, completada)
- Barra de progreso por campaña
- Modal de creación de nueva campaña con tipo, descripción, fechas, días y horario
- Metadatos: vehículos asignados, días de operación y rango de fechas

### ⚠️ Incidencias
- Registro de incidencias por vehículo con tipo, descripción, ubicación y evidencia fotográfica
- Filtro por prioridad: alta, en atención, resuelta
- Búsqueda en tiempo real por nombre, ruta, vehículo o descripción
- Acción de "Marcar resuelta" directamente desde la lista
- Estadísticas rápidas: incidencias de alta prioridad, en atención, resueltas hoy y total del mes

### 🔔 Sistema global
- Panel de notificaciones accesible desde cualquier página
- Panel de ajustes con toggles (modo oscuro, notificaciones, intervalo GPS, idioma)
- Panel de perfil de usuario con opción de cerrar sesión
- Toast de confirmación automático (2.5 s) para todas las acciones

---

## 🛠️ Tecnologías

| Capa | Tecnología |
|------|------------|
| Estructura | HTML5 semántico |
| Estilos | CSS3 con variables (design tokens), sin frameworks |
| Lógica | JavaScript vanilla (ES6+) |
| Mapas | [MapLibre GL JS 4](https://maplibre.org/) + MapTiler |
| Calles / grafo vial | [OpenStreetMap](https://www.openstreetmap.org/) vía Overpass API |
| Tipografía | [Montserrat](https://fonts.google.com/specimen/Montserrat) (Google Fonts) |
| Diseño base | Figma (paleta y bocetos originales del cliente) |

> No hay dependencias de build, npm ni bundler. El proyecto funciona abriendo los archivos directamente en el navegador.

---

## 📁 Estructura del proyecto

```
rutalimpia/
├── page.html          # Login / Registro / Recuperar contraseña
├── page-1.html        # Mapa en vivo (Leaflet)
├── page-4.html        # Dashboard
├── page-5.html        # Campañas
├── page-6.html        # Incidencias
│
├── page-8.html        # Quejas ciudadanas
├── page-9.html        # Camiones (flota, cuadrillas, rutas asignadas)
│
├── shared.css         # Design tokens, topbar, sidebar, bottom nav, modales, paneles
├── shared.js          # Topbar, bottom nav, paneles (notif / ajustes / perfil), toast
├── db.js              # Acceso a Supabase (consultas, altas, sesión, notificaciones)
├── fleet-ui.js        # Formulario compartido de alta de camión
├── events.js          # Vocabulario de eventos del dispositivo y estado derivado
├── ai-routing.js      # Calles de OpenStreetMap + cliente del servicio de IA de rutas
│
└── AI_RUTAS.md        # Contrato del servicio de IA de rutas (aún por desplegar)
```

---

## 🎨 Paleta de colores

| Token | Hex | Uso |
|-------|-----|-----|
| `--bg-topbar` | `#1e40af` | Topbar |
| `--bg-sidebar` | `#1e3a8a` | Sidebar y bottom nav |
| `--bg-base` | `#080f1e` | Fondo global del contenido |
| `--bg-surface` | `#111827` | Cards y paneles |
| `--green` | `#22c55e` | Acciones principales y estado activo |
| `--green-light` | `#4ade80` | Valores positivos y acento verde |
| `--red` | `#ef4444` | Alertas y errores |
| `--yellow` | `#f59e0b` | Advertencias |

---

## 📱 Responsive

El sistema está diseñado para funcionar en desktop y móvil:

- **Desktop (≥ 769 px):** topbar con navegación completa + sidebar lateral izquierdo
- **Mobile (≤ 768 px):** topbar compacto + bottom navigation bar con indicador de página activa. El sidebar se oculta.

---

## 🚀 Cómo ejecutar localmente

No se requiere instalación. Solo clona el repositorio y abre el archivo de inicio:

```bash
git clone https://github.com/tu-usuario/rutalimpia.git
cd rutalimpia
```

Luego abre `page.html` en tu navegador preferido.

> **Nota:** el mapa en vivo (`page-1.html`) requiere conexión a internet para cargar los tiles de OpenStreetMap.

---

## 🌐 Deploy

El proyecto está preparado para desplegarse como contenedor en **Google Cloud Run**:

1. Agrega un `Dockerfile` con un servidor estático (por ejemplo `nginx:alpine`)
2. Conecta el repositorio a **Cloud Build** con un trigger en la rama `main`
3. Cada `git push` dispara el build y despliega automáticamente en Cloud Run

```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
```

---

## 🗺️ Flujo de navegación

```
page.html (Login)
    │
    └─── page-4.html (Dashboard)
              ├─── page-1.html (Mapa en vivo)
              ├─── page-5.html (Campañas)
              └─── page-6.html (Incidencias)
```

Desde cualquier página se puede acceder a:
- 🔔 Panel de notificaciones
- ⚙️ Panel de ajustes
- 👤 Panel de perfil / cerrar sesión

---

## 🗄️ Base de datos (Supabase / PostgreSQL)

El esquema de base de datos incluye las siguientes tablas principales:

| Tabla | Descripción |
|-------|-------------|
| `users` | Administradores y conductores (roles: `admin`, `driver`) |
| `vehicles` | Flota de camiones con tipo, capacidad y estado |
| `routes` | Rutas con geometría PostGIS y tipo de zona |
| `shifts` | Turnos de operación (mañana, tarde, noche) |
| `collections` | Recolecciones — tabla central que relaciona vehículo, ruta, conductor y turno |
| `campaigns` | Campañas especiales de recolección |
| `gps_logs` | Historial de ubicaciones GPS por vehículo |
| `device_telemetry` | Estado en tiempo real del dispositivo GPS (batería, señal, capacidad) |
| `waste_stats` | Estadísticas diarias de toneladas recolectadas |

---

## 👥 Equipo

Desarrollado para el municipio de **Sahuayo de Morelos, Michoacán, México**.

Diseño UI/UX en Figma · Frontend en HTML/CSS/JS vanilla · Mapas con Leaflet + OpenStreetMap

---

## 📄 Licencia

Este proyecto es de uso interno municipal. Todos los derechos reservados © 2026 RutaLimpia.

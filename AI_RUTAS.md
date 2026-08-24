# Rutas sugeridas por IA — contrato del servicio

> **Estado:** el modelo todavía no existe. La web ya está preparada: en cuanto el
> servicio esté desplegado, se captura su URL en
> **Mapa en vivo → Nueva ruta → Automática (IA) → Servicio de IA** y empieza a
> usarse. No hay que tocar código.

Mientras no haya servicio, la web usa un **trazado heurístico local**
(vecino más cercano sobre las calles reales de OpenStreetMap). La interfaz
siempre indica quién generó el trazo — `IA` o `Heurística local` — para que
nadie confunda una cosa con la otra.

---

## Flujo en la aplicación

```
1. El usuario elige el alcance
   ├── Por camión           → el área sale del histórico GPS de ese camión
   └── Por área delimitada  → el usuario dibuja un recuadro sobre el mapa

2. "Obtener calles"
   → Overpass / OpenStreetMap devuelve todas las vías transitables del recuadro
   → se muestran: nº de calles, km totales, nombres

3. "Sugerir ruta"
   → si hay servicio de IA configurado → POST al servicio (contrato de abajo)
   → si no → trazado heurístico local, claramente etiquetado

4. Vista previa sobre el mapa → "Guardar ruta" → tabla `routes`
```

## Origen de las calles

Consulta Overpass que emite la web (solo se envía el recuadro, nada del usuario):

```
[out:json][timeout:30];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)$"]["area"!~"yes"](sur,oeste,norte,este);
out geom;
```

Endpoint por defecto: `https://overpass-api.de/api/interpreter`.
El proyecto ya tiene un Overpass propio en `mapOverPass/docker-compose.yaml`
(puerto `12345`); se puede seleccionar desde el mismo modal y evita los
límites de uso del servidor público.

---

## Contrato HTTP del servicio de IA

`POST <endpoint>` · `Content-Type: application/json`
· `Authorization: Bearer <clave>` (opcional, solo si se capturó una clave)

### Petición

```jsonc
{
  "version": 1,
  "generated_at": "2026-08-24T07:15:00.000Z",
  "area": {
    "bbox": { "south": 20.041, "west": -102.741, "north": 20.072, "east": -102.703 },
    "area_km2": 12.84
  },
  "depot": { "lng": -102.7224, "lat": 20.0572 },   // punto de arranque (null si no aplica)
  "vehicle": {                                      // null cuando el alcance es por área
    "id": "uuid",
    "economic_number": "VH-003",
    "capacity_tons": 10,
    "type": "compactor"
  },
  "constraints": {
    "max_distance_km": 18,
    "avoid_narrow_alleys": false,
    "avoid_steep_terrain": false,
    "route_type": "residential"
  },
  "streets": [
    {
      "id": 123456789,
      "name": "Av. Juárez",
      "highway": "residential",
      "oneway": false,
      "length_km": 0.412,
      "coordinates": [[-102.7241, 20.0570], [-102.7233, 20.0574]]   // [lng, lat]
    }
  ]
}
```

### Respuesta esperada

```jsonc
{
  "coordinates": [[-102.7241, 20.0570], [-102.7233, 20.0574]],  // [lng, lat], mínimo 2
  "name": "Ruta sugerida — Zona Centro",   // opcional
  "distance_km": 14.7,                      // opcional (si falta, la web la calcula)
  "notes": "Evita Av. Morelos por bloqueo reportado",  // opcional
  "model": "vrp-ortools-v1"                 // opcional, se muestra en la interfaz
}
```

Cualquier código HTTP distinto de 2xx, o una respuesta sin `coordinates`
válido, se muestra como error y **no** se cae en silencio a la heurística: la
web avisa para que quede claro que el modelo falló.

---

## Notas de implementación para el servicio

- Las coordenadas van siempre en orden **GeoJSON `[lng, lat]`**, igual que
  PostGIS y MapLibre. No invertir.
- `streets` puede traer cientos de vías; conviene aceptar cuerpos grandes
  (varios MB) o paginar en una versión posterior del contrato (`version`).
- Los módulos del prototipo que encajan aquí son el **módulo 3 (VRP)** para el
  ordenamiento de calles y el **módulo 1 (clustering)** para segmentar el área
  antes de resolver.
- El backend NestJS ya tiene un punto de enganche para IA en
  `apps/main-server/src/ai-analysis/ai-analysis.service.ts`; si el servicio se
  publica detrás de ese backend, la URL a capturar aquí es la del endpoint que
  lo exponga.

## Dónde se guarda la configuración

En `localStorage` del navegador, por usuario:

| Clave | Contenido |
|---|---|
| `rl_ai_routing_endpoint` | URL del servicio de IA |
| `rl_ai_routing_key` | Clave `Bearer` opcional |
| `rl_overpass_endpoint` | Overpass a usar (público o local) |

Al ser configuración por navegador, cada operador puede apuntar a un entorno
distinto (pruebas / producción) sin redesplegar la web.

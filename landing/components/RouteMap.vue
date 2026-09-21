<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { GRID, MAP_CENTER, routeCoordinates, routePosition, homeCoordinate } from '../model.mjs';
const props = defineProps<{ progress: number; incident: boolean; connected: boolean }>();
const host = ref<HTMLDivElement>();
const size = ref({ w: 600, h: 400 });
let observer: ResizeObserver | undefined;

// Mismo encuadre que tenía el mapa anterior (zoom 14.75): píxeles por grado en el centro. 1 unidad del SVG = 1 px.
const PX_PER_DEG_LNG = 512 * 2 ** 14.75 / 360;
const PX_PER_DEG_LAT = PX_PER_DEG_LNG / Math.cos(MAP_CENTER[1] * Math.PI / 180);
const px = (coordinates: number[]) => [size.value.w / 2 + (coordinates[0] - MAP_CENTER[0]) * PX_PER_DEG_LNG, size.value.h / 2 - (coordinates[1] - MAP_CENTER[1]) * PX_PER_DEG_LAT];
const one = (value: number) => Math.round(value * 10) / 10;
const line = (points: number[][]) => points.map((coordinates, index) => { const [x, y] = px(coordinates); return `${index ? 'L' : 'M'}${one(x)} ${one(y)}`; }).join(' ');

// Las calles: 10 horizontales y 10 verticales. El recorrido del camión (model.mjs) sólo usa esquinas de estas líneas.
const streets = computed(() => {
  const lines: number[][][] = [];
  for (let i = 0; i < 10; i++) { const lat = GRID.lat0 + i * GRID.latStep; lines.push([[GRID.lng0 - .002, lat], [GRID.lng1 + .002, lat]]); }
  for (let i = 0; i < 10; i++) { const lng = GRID.lng0 + i * GRID.lngStep; lines.push([[lng, GRID.lat0 - .003], [lng, GRID.lat1 + .007]]); }
  return lines.map(line).join(' ');
});
const route = computed(() => line(routeCoordinates));
const home = computed(() => px(homeCoordinate));
const truck = computed(() => px(routePosition(props.progress)));

onMounted(() => {
  if (!host.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(entries => {
    const box = entries[0].contentRect;
    const w = Math.round(box.width), h = Math.round(box.height);
    if (w > 0 && h > 0 && (w !== size.value.w || h !== size.value.h)) size.value = { w, h };
  });
  observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div ref="host" class="route-map" role="img" :aria-label="`Mapa de demostración. Unidad RT-04: ${incident ? 'incidencia' : connected ? 'conectada' : 'sin conexión'}. Avance ${Math.round(progress*100)} por ciento.`">
    <svg class="map-fallback" :viewBox="`0 0 ${size.w} ${size.h}`" aria-hidden="true">
      <rect :width="size.w" :height="size.h" fill="#0b3372"/>
      <path :d="streets" fill="none" stroke="#2c60a3" stroke-width="14"/>
      <path :d="streets" fill="none" stroke="#154382" stroke-width="11"/>
      <path :d="route" fill="none" stroke="#90de00" stroke-opacity=".19" stroke-width="15"/>
      <path :d="route" fill="none" stroke="#b8f53a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" :stroke-opacity="connected ? .9 : .12"/>
      <circle :cx="home[0]" :cy="home[1]" r="16" fill="#00b8ff" fill-opacity=".12"/>
      <circle :cx="home[0]" :cy="home[1]" r="5" fill="#00b8ff" stroke="#c8f5ff" stroke-width="2"/>
      <circle :cx="truck[0]" :cy="truck[1]" r="21" fill="#39ff88" fill-opacity=".12"/>
      <circle :cx="truck[0]" :cy="truck[1]" r="8" :fill="incident ? '#ff6060' : '#39ff88'" stroke="#effff5" stroke-width="3"/>
    </svg>
    <div class="map-label"><span class="status-dot"></span> SAHUAYO · CENTRO</div>
    <span class="map-street street-one">AV. CONSTITUCIÓN</span><span class="map-street street-two">CENTRO</span>
    <div class="map-key"><span><i class="green-dot"></i> RT-04</span><span><i class="blue-dot"></i> Tu casa</span></div>
    <small class="map-caption">Mapa conceptual · recorrido simulado</small>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
const props = withDefaults(defineProps<{ connected?: boolean; compact?: boolean; routeProgress?: number }>(), { connected: true, compact: false, routeProgress: .42 });
const sceneId=useId();
const routePoints=[[161,397],[336,489],[468,419],[337,351],[513,259],[690,351],[602,397],[777,489]];
const routePath='M 161 397 L 336 489 L 468 419 L 337 351 L 513 259 L 690 351 L 602 397 L 777 489';
// Sólo el camión se mueve: el resto de la ciudad va dentro de `v-once`, se dibuja una vez y Vue ya no lo revisa.
const truckAt=(progress:number)=>{const p=Math.max(0,Math.min(1,progress))*(routePoints.length-1);const i=Math.min(Math.floor(p),routePoints.length-2);return {x:routePoints[i][0]+(routePoints[i+1][0]-routePoints[i][0])*(p-i),y:routePoints[i][1]+(routePoints[i+1][1]-routePoints[i][1])*(p-i)};};
const truck=computed(()=>truckAt(props.routeProgress));
const truckRing=ref<SVGEllipseElement>();
const truckBody=ref<SVGGElement>();
/** Mueve el camión escribiendo directo en el SVG (sin que Vue vuelva a calcular nada). Lo usa el héroe en cada cuadro. */
function setProgress(value:number){const t=truckAt(value);truckRing.value?.setAttribute('cx',String(t.x));truckRing.value?.setAttribute('cy',String(t.y));truckBody.value?.setAttribute('transform',`translate(${t.x-16},${t.y-27})`);}
defineExpose({setProgress});
const blocks = Array.from({ length: 81 }, (_, i) => {
  const row = Math.floor(i / 9), col = i % 9;
  const height = 12 + ((row * 17 + col * 23) % 38);
  return { x: 470 + (col - row) * 44, y: 155 + (col + row) * 23, height, park: (row + col * 3) % 11 === 0 };
});
</script>

<template>
  <svg class="city-scene" :class="{ connected, compact }" viewBox="0 0 1000 700" role="img" :aria-label="connected?'Ilustración de una ciudad con rutas y un camión conectado':'Ilustración de una ciudad sin información de rutas'">
    <g v-once>
      <defs>
        <radialGradient :id="`${sceneId}-halo`"><stop stop-color="#00d8e2" stop-opacity=".6"/><stop offset="1" stop-color="#0048e2" stop-opacity="0"/></radialGradient>
        <radialGradient :id="`${sceneId}-shadow`"><stop stop-color="#002977" stop-opacity=".55"/><stop offset="1" stop-color="#002977" stop-opacity="0"/></radialGradient>
        <linearGradient :id="`${sceneId}-roof`" x2="1" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#b6eeff"/></linearGradient>
        <linearGradient :id="`${sceneId}-road`"><stop stop-color="#90de00"/><stop offset=".5" stop-color="#c6ff4b"/><stop offset="1" stop-color="#00ecff"/></linearGradient>
      </defs>
      <ellipse cx="510" cy="415" rx="480" ry="310" :fill="`url(#${sceneId}-halo)`"/>
      <ellipse cx="486" cy="612" rx="440" ry="70" :fill="`url(#${sceneId}-shadow)`"/>
      <g opacity=".2" fill="none" stroke="#719d89" stroke-width=".5">
        <path v-for="n in 13" :key="'a'+n" :d="`M ${460-n*44} ${102+n*23} l 615 322`"/>
        <path v-for="n in 13" :key="'b'+n" :d="`M ${460+n*44} ${102+n*23} l -615 322`"/>
      </g>
      <path d="M 468 138 L 884 355 L 486 567 L 70 349 Z" fill="#1277b6" stroke="#49c4ee"/>
      <path d="M70 349 L486 567 L884 355 V371 L486 585 L70 366 Z" fill="#073b99" stroke="#1a6dd0"/>
      <g v-for="(block,i) in blocks" :key="i" :transform="`translate(${block.x},${block.y})`">
        <template v-if="!block.park">
          <path :d="`M -31 0 L 0 16 L 0 ${16-block.height} L -31 ${-block.height} Z`" fill="#6fb9e3" stroke="#bde7fa" stroke-width=".7"/>
          <path :d="`M 0 16 L 30 0 L 30 ${-block.height} L 0 ${16-block.height} Z`" fill="#267cba" stroke="#5daddb" stroke-width=".7"/>
          <path :d="`M -31 ${-block.height} L 0 ${-16-block.height} L 30 ${-block.height} L 0 ${16-block.height} Z`" :fill="i%13===0?'#90de00':`url(#${sceneId}-roof)`" stroke="#e4faff" stroke-width=".7"/>
          <path v-if="i%3===0" :d="`M -24 ${-block.height+9} l 17 9 m -17 -2 l 17 9`" stroke="#0048b0" stroke-opacity=".5" stroke-width="2"/>
          <path v-if="i%4===0" :d="`M 5 ${-block.height+15} l 19 -10`" stroke="#daf7ff" stroke-opacity=".65" stroke-width="2"/>
        </template>
        <g v-else><path d="M -30 0 L 0 -16 L 30 0 L 0 16 Z" fill="#009d00"/><path d="M -8 -4 v -15 m 20 20 v -17" stroke="#126d29" stroke-width="5"/><circle cx="-8" cy="-24" r="9" fill="#90de00"/><circle cx="12" cy="-17" r="7" fill="#b7f538"/></g>
      </g>
      <g class="connected-route" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path :d="routePath" stroke="#90de00" stroke-width="24" opacity=".14"/>
        <path :d="routePath" stroke="#90de00" stroke-width="13" opacity=".26"/>
        <path :d="routePath" :stroke="`url(#${sceneId}-road)`" stroke-width="4"/>
        <path class="route-dashes" :d="routePath" stroke="#e0ffec" stroke-width="3" stroke-dasharray="4 70"/>
      </g>
    </g>
    <g class="connected-route" fill="none" stroke-linecap="round" stroke-linejoin="round"><ellipse ref="truckRing" :cx="truck.x" :cy="truck.y" rx="24" ry="12" stroke="#d3ff6a" opacity=".9"/></g>
    <g ref="truckBody" :transform="`translate(${truck.x-16},${truck.y-27})`">
      <path d="M -18 -4 L 4 -16 L 35 0 L 13 13 Z" fill="#bbff31"/><path d="M -18 -4 v 18 l 31 17 V 13 Z" fill="#009d00"/><path d="M 13 13 L 35 0 V 18 L 13 31 Z" fill="#80d000"/>
      <path d="M -29 4 L -18 -2 V 14 L -6 20 L -6 31 L -29 19 Z" fill="#d9ece0"/><path d="M -27 6 L -20 2 V 11 L -27 15 Z" fill="#174134"/>
      <ellipse cx="-21" cy="23" rx="5" ry="7" fill="#040e09"/><ellipse cx="5" cy="35" rx="5" ry="7" fill="#040e09"/>
    </g>
    <g v-once class="connected-route city-annotation" font-family="Inter, sans-serif">
      <path d="M 488 383 V 306 H 564" fill="none" stroke="#39ff88" stroke-opacity=".65"/>
      <rect x="557" y="267" width="145" height="62" rx="8" fill="#073c91" stroke="#72cff0"/>
      <circle cx="573" cy="286" r="3" fill="#39ff88"/><text x="584" y="290" fill="#d8eddf" font-size="11">RT-04 · EN RUTA</text><text x="571" y="312" fill="#88a293" font-size="10">GPS CONECTADO</text>
      <path d="M 328 486 v 58 h -57" fill="none" stroke="#00b8ff" stroke-opacity=".55"/><text x="170" y="548" fill="#7ca6a2" font-size="10" letter-spacing="2">RUTA CENTRO</text>
      <circle cx="690" cy="351" r="5" fill="#39ff88"/><path d="M 690 342 v -43" stroke="#39ff88" stroke-opacity=".4"/><circle cx="690" cy="292" r="10" stroke="#39ff88"/><path d="m 686 292 3 3 5 -6" stroke="#39ff88"/>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue';
import { Truck, UserRound, Building2, ArrowUpRight, ArrowRight, Check, Navigation, Radio, Server, Route, Bell, AlertTriangle, RotateCcw, Play, Pause, MapPin } from 'lucide-vue-next';
import RouteMap from './RouteMap.vue';
const CoverageChart = defineAsyncComponent(() => import('./CoverageChart.vue'));
const props = defineProps<{ reducedMotion: boolean; paused: boolean; technical: boolean }>();
const role = ref('operator');
const status = ref('idle');
const connectedSteps = ref(0);
const progress = ref(0);
const incident = ref(false);
const prepared = ref(false);
const manualPause = ref(false);
const autoRole = ref(true);
const inView = ref(false);
const root = ref<HTMLElement>();
const logs = ref<string[]>([]);
let timer: ReturnType<typeof setInterval>;
let observer: IntersectionObserver;
const roles = [{id:'operator',label:'Operador',icon:Truck},{id:'citizen',label:'Ciudadano',icon:UserRound},{id:'municipality',label:'Municipio',icon:Building2}];
const checks = [{label:'GPS',icon:Navigation},{label:'Red móvil',icon:Radio},{label:'Servidor RutaLimpia',icon:Server},{label:'Ruta cargada',icon:Route},{label:'Telemetría',icon:MapPin}];
const connected = computed(() => status.value === 'running' || status.value === 'finished');
const distance = computed(()=> progress.value < .25 ? '2.4 km' : progress.value < .45 ? '1.7 km' : progress.value < .65 ? '950 m' : progress.value < .85 ? '430 m' : 'A tu calle');
const notice = computed(()=>progress.value>=.3);
const eta = computed(()=>Math.max(1,Math.round(10-progress.value*10)));
const percent = computed(()=>Math.round(progress.value*100));
const remaining = computed(()=>Math.round((1-progress.value)*173));
function log(text: string) { logs.value.unshift(`${new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} · ${text}`); }
function reset() { status.value='idle';connectedSteps.value=0;progress.value=0;incident.value=false;prepared.value=false;logs.value=[];role.value='operator';autoRole.value=true;manualPause.value=false; }
function start() { reset();status.value='connecting'; if(props.reducedMotion){connectedSteps.value=5;status.value='running';log('RT-04 inició Ruta Centro.');} }
function advance(amount=.025) {
  if(incident.value || status.value!=='running')return;
  progress.value=Math.min(1,progress.value+amount);
  if(autoRole.value)role.value=progress.value>=.65?'municipality':progress.value>=.3?'citizen':'operator';
  if(progress.value===1){status.value='finished';log('Ruta completada. 31 puntos atendidos.');}
}
function selectRole(id: string) { role.value=id;autoRole.value=false; }
function reportIncident() { incident.value=true;log('RT-04 reportó una incidencia. Unidad detenida.'); }
function resolveIncident() { incident.value=false;log('Incidencia resuelta. Ruta reanudada.'); }
onMounted(()=>{
  observer=new IntersectionObserver(entries=>{inView.value=entries[0].isIntersecting;},{threshold:.1});
  if(root.value)observer.observe(root.value);
  let halfTick=false;
  timer=setInterval(()=>{
    if(!inView.value || document.hidden || props.paused || manualPause.value)return;
    if(status.value==='connecting'){connectedSteps.value++;if(connectedSteps.value===5){status.value='running';log('RT-04 inició Ruta Centro.');}return;}
    halfTick=!halfTick;
    if(halfTick && !props.reducedMotion)advance();
  },500);
});
onBeforeUnmount(()=>{clearInterval(timer);observer?.disconnect();});
</script>
<template>
  <div ref="root" class="demo-shell">
    <div class="demo-top"><div class="role-tabs" role="group" aria-label="Elige tu perspectiva"><button v-for="item in roles" :key="item.id" :aria-pressed="role===item.id" :class="{active:role===item.id}" @click="selectRole(item.id)"><component :is="item.icon" :size="16"/><span>{{ item.label }}</span></button></div><span class="demo-badge">DEMO INTERACTIVA</span></div>
    <div class="demo-grid">
      <div class="demo-controls">
        <template v-if="role==='operator'">
          <span class="mono-label">01 / EN EL ASIENTO DEL OPERADOR</span><h3>Tu turno.<br>Inicia la ruta.</h3><p>Un toque conecta la unidad con toda la ciudad.</p>
          <div class="unit-summary"><Truck :size="23"/><div><b>RT-04</b><small>Ruta Centro · Turno matutino</small></div><span>07:12</span></div>
          <ul class="connection-checks"><li v-for="(item,i) in checks" :key="item.label"><span><component :is="item.icon" :size="15"/>{{ item.label }}</span><b :class="{online:connectedSteps>i}"><Check v-if="connectedSteps>i" :size="13"/>{{ connectedSteps>i?'Conectado':'En espera' }}</b></li></ul>
          <button v-if="status==='idle'" class="btn btn-primary full" @click="start"><Play :size="16"/> Iniciar ruta <ArrowRight :size="18"/></button>
          <div v-else class="route-status" role="status"><span class="status-dot"></span>{{ status==='connecting'?'Conectando la unidad…':status==='finished'?'Ruta completada':'Ruta iniciada' }}</div>
        </template>
        <template v-else-if="role==='citizen'">
          <span class="mono-label">02 / DEL LADO DE TU CASA</span><h3>Tu mañana.<br>Sin adivinar.</h3><p>{{ technical?'El motor utiliza ubicación y progreso de ruta para estimar el tiempo de llegada.':'Sigue el recorrido y prepara tus residuos cuando el camión se acerque.' }}</p>
          <div class="citizen-notice" :class="{received:notice}" aria-live="polite"><div><span class="notice-icon"><Bell :size="19"/></span><b>RUTALIMPIA {{ notice?'ESTÁ CERCA':'TE AVISA' }}</b></div><p>{{ notice?'El camión llegará aproximadamente en:':connected?'La unidad está en camino. Te avisaremos cuando se acerque.':'Inicia la ruta para recibir un aviso de ejemplo.' }}</p><strong>{{ notice ? (incident?'En pausa':status==='finished'?'LLEGÓ':`${eta} MIN`) : '— MIN' }}</strong><button class="btn btn-primary full" :disabled="!notice||prepared" @click="prepared=true">{{ prepared?'Residuos listos': 'Preparar residuos' }}<Check v-if="prepared" :size="16"/></button></div>
          <small class="quiet">Aviso dentro de esta demo. No activa notificaciones en tu dispositivo.</small>
        </template>
        <template v-else>
          <span class="mono-label">03 / UNA CIUDAD EN TU PANTALLA</span><h3>Decide con<br>el panorama completo.</h3>
          <div class="fleet-strip"><button v-for="(unit,i) in ['RT-01','RT-02','RT-03','RT-04','RT-05']" :key="unit" :class="{selected:unit==='RT-04'}" @click="unit==='RT-04' ? undefined : log(`${unit}: ${['en ruta','detenido','finalizado','en ruta','incidencia'][i]} (ejemplo).`)"><Truck :size="16"/><b>{{ unit }}</b><span :class="{amber:i===1,red:i===4}">{{ unit==='RT-04'?(incident?'Incidencia':status==='finished'?'Finalizado':connected?'En ruta':'En espera'):['En ruta','Detenido','Finalizado','','Incidencia'][i] }}</span></button></div>
          <div class="municipal-kpis"><div><strong>{{ percent }}<small>%</small></strong><span>Ruta completada</span></div><div><strong>{{ Math.round(progress*31) }}<small>/31</small></strong><span>Puntos atendidos</span></div><div><strong>{{ remaining }}</strong><span>Min. restantes</span></div><div><strong>{{ incident?1:0 }}</strong><span>Incidencia activa</span></div></div>
          <button v-if="!incident" class="btn btn-incident full" :disabled="!connected||status==='finished'" @click="reportIncident"><AlertTriangle :size="16"/>Simular incidencia</button><button v-else class="btn btn-outline full" @click="resolveIncident"><Check :size="16"/>Resolver y reanudar</button>
        </template>
      </div>
      <div class="demo-map-panel">
        <div class="map-toolbar"><span><i :class="['status-dot',{offline:!connected}]"></i>{{ incident?'RT-04 · UNIDAD DETENIDA':status==='finished'?'RT-04 · RUTA COMPLETADA':connected?'RT-04 · SEÑAL RECIBIDA':'RT-04 · LISTA PARA SALIR' }}</span><span>{{ !incident&&status==='running'?'24':'0' }} km/h</span></div>
        <RouteMap :progress="progress" :connected="connected" :incident="incident"/>
        <div v-if="incident" class="incident-banner" role="alert"><AlertTriangle :size="18"/><span><b>RT-04 reportó una incidencia</b>La unidad se detuvo. Evento registrado en bitácora.</span></div>
        <div class="map-bottom"><div><small>{{ role==='citizen'?'DISTANCIA A TU CASA':'UNIDAD CONECTADA' }}</small><strong>{{ role==='citizen'?distance:'RT-04 / Ruta Centro' }}</strong></div><div class="telemetry-bars" aria-hidden="true"><i v-for="n in 14" :key="n" :style="{height:`${8+(n*7)%22}px`,opacity:connected?1:.25}"></i></div></div>
        <div v-if="role==='municipality'" class="log-chart"><div class="event-log"><span class="mono-label">BITÁCORA DE ESTA DEMO</span><ol v-if="logs.length" aria-live="polite"><li v-for="(entry,i) in logs.slice(0,3)" :key="i">{{ entry }}</li></ol><p v-else>Los eventos aparecerán al iniciar la ruta.</p></div><div><span class="mono-label">COBERTURA · EJEMPLO</span><CoverageChart/></div></div>
      </div>
    </div>
    <div class="demo-footer"><span><span class="status-dot"></span> Datos simulados · explora sin registrarte</span><div><button v-if="connected&&status!=='finished'" class="text-btn" :disabled="incident" @click="advance(.15)">Avanzar recorrido <ArrowRight :size="14"/></button><button v-if="status==='running'&&!reducedMotion" class="icon-btn" :aria-label="manualPause?'Reanudar simulación':'Pausar simulación'" @click="manualPause=!manualPause"><Play v-if="manualPause" :size="15"/><Pause v-else :size="15"/></button><button class="text-btn" @click="reset"><RotateCcw :size="14"/>Reiniciar</button></div></div>
    <div v-if="status==='idle'&&role!=='operator'" class="demo-start-hint"><button class="text-btn" @click="start">Iniciar la ruta de demostración <ArrowUpRight :size="16"/></button></div>
  </div>
</template>

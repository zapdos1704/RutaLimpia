<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { ArrowUpRight, ArrowRight, ArrowDown, Truck, Radio, Navigation, Cpu, Server, Database, Bell, Building2, UserRound, Route, Clock3, Check, Menu, X, Pause, Play, MoveUpRight, Globe2, MapPin, Leaf, Plus, ChevronRight } from 'lucide-vue-next';
import CityScene from './components/CityScene.vue';
import CinematicHero from './components/CinematicHero.vue';
import logoUrl from './assets/rutalimpia-logo.png';
import DemoExperience from './components/DemoExperience.vue';
import FleetCalculator from './components/FleetCalculator.vue';

const technical = ref(false);
const menuOpen = ref(false);
const reducedMotion = ref(false);
const paused = ref(false);
const activated = ref(false);
const architectureOpen = ref(false);
const selectedNode = ref(0);
const scale = ref(0);
const progressBar = ref<HTMLElement>();
let sceneObserver: IntersectionObserver | undefined;
let motionQuery: MediaQueryList;
let animationContext: { revert: () => void } | undefined;
let disposed = false;
let scrollFrame = 0;
const nodes = [
  {name:'Camión',icon:Truck,simple:'La unidad recorre su ruta y genera información mientras trabaja.',tech:'El vehículo es la fuente física de ubicación, movimiento y eventos operativos.'},
  {name:'Dispositivo IoT',icon:Cpu,simple:'Un pequeño dispositivo acompaña al camión durante toda la jornada.',tech:'El ESP32 integra señales del módulo GPS y eventos del dispositivo para construir la telemetría.'},
  {name:'GPS + red móvil',icon:Radio,simple:'Sabemos dónde está el camión y enviamos esa información.',tech:'Las coordenadas GPS de la unidad se transmiten mediante conectividad móvil hacia la API de RutaLimpia.'},
  {name:'API RutaLimpia',icon:Server,simple:'Recibimos los datos en un punto de entrada común.',tech:'La API recibe y valida los mensajes de la unidad antes de enviarlos a los servicios del sistema.'},
  {name:'Servidor + datos',icon:Database,simple:'Guardamos lo que pasó para poder consultarlo después.',tech:'Los servicios y la base de datos conservan la ubicación, los recorridos y la bitácora de eventos.'},
  {name:'Procesamiento',icon:Navigation,simple:'Calculamos cuándo llegará y qué ocurre en la ruta.',tech:'Procesamos ubicación, recorrido y progreso de ruta para estimar el tiempo aproximado de llegada.'},
  {name:'Apps + dashboard',icon:Building2,simple:'Cada persona recibe la información que necesita para actuar.',tech:'App operador en Kotlin, dashboard web en Vue y experiencia ciudadana consumen los datos del ecosistema. Mapas con MapLibre.'},
  {name:'Notificaciones',icon:Bell,simple:'Avisamos al ciudadano cuando el servicio se aproxima.',tech:'El motor de avisos utiliza el contexto de ruta para comunicar una estimación de llegada, sujeta a las condiciones de operación.'},
];
const scales=[{label:'Sahuayo',title:'Una ciudad es el comienzo.',number:'01',unit:'municipio',copy:'Sahuayo, Michoacán. Caso inicial con 8 unidades consideradas.',market:'$131,040',scope:'estimados durante el primer año'}, {label:'Michoacán',title:'El siguiente paso está cerca.',number:'15',unit:'municipios',copy:'Mercado atendible estimado en Michoacán, bajo el perfil objetivo.',market:'≈ $1.97 M',scope:'MXN estimados durante el primer año'}, {label:'México',title:'Una idea que conecta al país.',number:'≈400',unit:'municipios',copy:'Mercado objetivo estimado en México, bajo los supuestos actuales.',market:'≈ $52.4 M',scope:'MXN estimados durante el primer año'}];
const scaleInfo=computed(()=>scales[scale.value]);
function syncMotion(){ reducedMotion.value=motionQuery.matches; }
function togglePause(){paused.value=!paused.value;}
// Nada reactivo por cada cuadro de scroll: la barra se mueve directo, sin re-render de Vue.
function onScroll(){ if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{const total=document.documentElement.scrollHeight-window.innerHeight;const p=total>0?window.scrollY/total:0;if(progressBar.value)progressBar.value.style.transform=`scaleX(${p})`;scrollFrame=0;}); }
async function setupAnimation(){
  const [{gsap},{ScrollTrigger}]=await Promise.all([import('gsap'),import('gsap/ScrollTrigger')]);
  if(disposed||paused.value)return;
  gsap.registerPlugin(ScrollTrigger);
  const mm=gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)',()=>{
    gsap.utils.toArray<HTMLElement>('.reveal').forEach(el=>gsap.from(el,{y:24,opacity:.35,duration:.75,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 94%',once:true}}));
    gsap.fromTo('.data-flow-line',{scaleX:0},{scaleX:1,ease:'none',scrollTrigger:{trigger:'.connection-section',start:'top 80%',end:'center center',scrub:1}});
  });
  animationContext=mm;
}
onMounted(()=>{
  motionQuery=matchMedia('(prefers-reduced-motion: reduce)');syncMotion();motionQuery.addEventListener('change',syncMotion);
  window.addEventListener('scroll',onScroll,{passive:true});
  // Las ilustraciones que no se ven no animan sus puntos de ruta (evita repintar SVG fuera de pantalla).
  sceneObserver=new IntersectionObserver(entries=>entries.forEach(e=>e.target.toggleAttribute('data-off',!e.isIntersecting)),{rootMargin:'120px'});
  document.querySelectorAll('.city-scene').forEach(el=>sceneObserver?.observe(el));
  void setupAnimation();
});
onBeforeUnmount(()=>{disposed=true;motionQuery?.removeEventListener('change',syncMotion);window.removeEventListener('scroll',onScroll);cancelAnimationFrame(scrollFrame);sceneObserver?.disconnect();animationContext?.revert();});
watch(paused, value => { animationContext?.revert();animationContext=undefined;if(!value)void setupAnimation(); });
</script>

<template>
  <div class="landing" :class="{'motion-paused':paused,'reduce-motion':reducedMotion}">
    <a class="skip-link" href="#contenido">Saltar al contenido</a>
    <header class="site-header"><div class="nav-container"><a class="brand" href="#inicio" aria-label="RutaLimpia, inicio"><img class="brand-logo" :src="logoUrl" alt="" width="47" height="44">ruta<span>limpia</span><i></i></a><nav :class="{open:menuOpen}" aria-label="Navegación principal"><a href="#experiencia" @click="menuOpen=false">La experiencia</a><a href="#ecosistema" @click="menuOpen=false">Ecosistema</a><a href="#municipio" @click="menuOpen=false">Para tu municipio</a></nav><div class="header-actions"><button class="menu-toggle icon-btn" :aria-expanded="menuOpen" aria-label="Abrir o cerrar menú" @click="menuOpen=!menuOpen"><X v-if="menuOpen" :size="21"/><Menu v-else :size="21"/></button></div></div><div ref="progressBar" class="reading-progress" style="transform:scaleX(0)"></div></header>
    <main id="contenido">
      <CinematicHero :paused="paused" :reduced-motion="reducedMotion" @pause="togglePause"/>

      <div class="capability-strip"><div class="container"><span><Navigation :size="16"/>GEOLOCALIZACIÓN</span><i></i><span><Cpu :size="16"/>INTERNET DE LAS COSAS</span><i></i><span><Bell :size="16"/>AVISOS ANTICIPADOS</span><i></i><span><Building2 :size="16"/>INTELIGENCIA MUNICIPAL</span></div></div>

      <section id="la-historia" class="story-intro section container"><div class="story-time reveal"><span class="mono-label">UNA MAÑANA CUALQUIERA</span><div>07<span>:</span>12<small>A.M.</small></div><p>La ciudad ya está en movimiento.</p></div><div class="story-problem reveal"><span class="section-index">01 — EL PUNTO CIEGO</span><h2>El camión pasará.<br><span>El problema es que<br>tú no lo sabes.</span></h2><p>Residuos esperando afuera. Recorridos sin visibilidad. Personas que no saben cuándo salir.</p><a class="inline-link" href="#experiencia">¿Y si tu ciudad pudiera avisarte antes? <ArrowDown :size="17"/></a></div></section>

      <section id="experiencia" class="experience-section section"><div class="container"><div class="section-heading reveal"><div><span class="section-index">02 — NO LO IMAGINES. ACTÍVALO.</span><h2>Una ruta.<br><span>Tres formas de vivirla.</span></h2></div><p>Siéntate al volante, recibe el aviso y mira la ciudad desde el municipio. Todo empieza contigo.</p></div><DemoExperience :technical="technical" :reduced-motion="reducedMotion" :paused="paused"/></div></section>

      <section id="ecosistema" class="connection-section section container"><div class="section-heading reveal"><div><span class="section-index">03 — LA RUTA DEL DATO</span><h2>Un camión dejó de ser<br><span>un punto ciego.</span></h2></div><div class="explanation-switch"><span>Elige cómo te lo contamos</span><div role="group" aria-label="Nivel de explicación"><button :aria-pressed="!technical" :class="{active:!technical}" @click="technical=false">Simple</button><button :aria-pressed="technical" :class="{active:technical}" @click="technical=true">Técnico</button></div></div></div><p class="flow-description">{{ technical?'Las coordenadas GPS viajan por la red móvil a la API. El servidor conserva los eventos y procesa el recorrido para informar a cada perfil.':'El camión comparte dónde está. RutaLimpia convierte esa señal en información útil para quien conduce, quien espera y quien coordina.' }}</p><div class="data-flow"><div class="data-flow-line" aria-hidden="true"></div><div v-for="(node,i) in [nodes[0],nodes[1],nodes[2],nodes[3],nodes[5],nodes[6]]" :key="node.name" class="flow-node"><span class="flow-icon"><component :is="node.icon" :size="23"/></span><b>{{ technical?node.name:['Camión','Dispositivo','Conexión','RutaLimpia','Información','Personas'][i] }}</b><small>{{ ['EN MOVIMIENTO','CAPTURA','TRANSMITE','RECIBE','INTERPRETA','ACTÚAN'][i] }}</small></div></div><div class="data-packet"><span><i class="status-dot"></i> PAQUETE DE EJEMPLO</span><code>UNIT RT-04</code><code>LAT 20.0590</code><code>LON -102.7193</code><code>SPEED 24 km/h</code></div><div class="signal-benefits"><span><Check :size="14"/>Dónde está</span><span><Check :size="14"/>Qué ruta realiza</span><span><Check :size="14"/>Cuándo se aproxima</span><span><Check :size="14"/>Qué incidencias ocurren</span><span><Check :size="14"/>Qué zonas atendió</span></div></section>

      <section class="activate-section section" :class="{activated}"><div class="container activate-layout"><div class="activate-copy reveal"><span class="section-index">04 — UNA CIUDAD, DOS REALIDADES</span><h2 v-if="!activated">La ciudad se mueve.<br><span>Conecta lo que pasa.</span></h2><h2 v-else>La misma ciudad.<br><em>Ahora, conectada.</em></h2><p>{{ activated?'Las rutas son visibles. Los eventos tienen contexto. Los ciudadanos reciben avisos. La información llega a quien puede actuar.':'Los camiones están trabajando. Pero sin información centralizada, lo que ocurre en las calles sigue siendo una incógnita.' }}</p><button class="btn" :class="activated?'btn-outline':'btn-primary'" :aria-pressed="activated" @click="activated=!activated"><Radio :size="18"/>{{ activated?'Volver a ver sin conexión':'Activar RutaLimpia' }}<ArrowUpRight :size="18"/></button><div class="activation-status" role="status">{{ activated?'Ciudad conectada · simulación activada':'Sin RutaLimpia · simulación' }}</div></div><div class="activate-city"><CityScene :connected="activated" compact/><div class="city-metrics"><div v-for="(item,i) in ['UBICACIÓN','COBERTURA','INCIDENCIAS','LLEGADA','HISTORIAL']" :key="item"><span>{{ item }}</span><b :class="{online:activated}">{{ activated?['GPS activo','24 / 31 puntos','Centralizadas','≈ 6 min','Disponible'][i]:'?' }}</b></div></div></div></div></section>

      <section id="impacto" class="impact-section section container"><span class="section-index">05 — MÁS INFORMACIÓN. MEJORES DECISIONES.</span><h2 class="reveal">No se trata solo de saber<br><span>dónde está un camión.</span></h2><div class="impact-grid"><article v-for="(item,i) in [{icon:UserRound,title:'Tu tiempo importa.',role:'CIUDADANO',copy:'Más certidumbre sobre la llegada del servicio. Menos tiempo pendiente del sonido del camión.'},{icon:Truck,title:'Una ruta más clara.',role:'OPERADOR',copy:'Recorridos y actividades digitalizados. Eventos de la jornada con seguimiento.'},{icon:Building2,title:'El panorama completo.',role:'MUNICIPIO',copy:'Información centralizada para supervisar la flota, identificar incidencias y coordinar la operación.'},{icon:Leaf,title:'Aprender para mejorar.',role:'CIUDAD',copy:'Históricos de cobertura y recorridos para planificar el servicio con información.'}]" :key="item.role" class="reveal"><div><component :is="item.icon" :size="24"/><span>0{{ i+1 }}</span></div><small>{{ item.role }}</small><h3>{{ item.title }}</h3><p>{{ item.copy }}</p></article></div><div class="environment-note"><Leaf :size="22"/><p>Una ciudad más limpia empieza por una ciudad que sabe qué está pasando.<small>Beneficios potenciales y medibles: tiempo de residuos expuestos, recorridos incompletos y cobertura histórica. Sin promesas de reducción ambiental que no se hayan demostrado.</small></p></div></section>

      <section id="municipio" class="pricing-section section"><div class="container"><div class="section-heading reveal"><div><span class="section-index">06 — LLEVÉMOSLO A TU MUNICIPIO</span><h2>Conectar tu ciudad<br><span>empieza con un número.</span></h2></div><p>Implementación de <b>$5,700 MXN</b> y suscripción de <b>$890 MXN al mes</b>, por camión. Explora tu escenario.</p></div><FleetCalculator/></div></section>

      <section class="scale-section section container"><div class="scale-copy"><span class="section-index">07 — DE UNA RUTA A TODO UN PAÍS</span><h2>{{ scaleInfo.title }}</h2><div class="scale-tabs" role="group" aria-label="Escala del proyecto"><button v-for="(item,i) in scales" :key="item.label" :class="{active:scale===i}" :aria-pressed="scale===i" @click="scale=i">{{ item.label }}<ChevronRight :size="15"/></button></div><p>{{ scaleInfo.copy }}</p><div class="market-number"><b>{{ scaleInfo.market }}</b><span>{{ scaleInfo.scope }}</span></div><small class="quiet">Estimaciones internas basadas en municipios con el perfil objetivo y un supuesto promedio de 8 unidades por municipio. Incluyen implementación y 12 meses de suscripción; no representan un tamaño oficial de mercado.</small></div><div class="scale-visual" :class="`scale-${scale}`" aria-live="polite"><div class="scale-rings" aria-hidden="true"><i></i><i></i><i></i><i></i><span v-for="n in 15" :key="n" :style="{transform:`rotate(${n*137.5}deg) translateX(${35+(n%5)*25}px)`}"></span></div><Globe2 :size="270" :stroke-width=".35" aria-hidden="true"/><div><b>{{ scaleInfo.number }}</b><span>{{ scaleInfo.unit }}</span></div><small>DE MICHOACÁN HACIA MÉXICO</small></div></section>

      <section id="arquitectura" class="architecture-section container"><button class="architecture-toggle" :aria-expanded="architectureOpen" aria-controls="architecture-content" @click="architectureOpen=!architectureOpen"><span><Cpu :size="21"/><span>¿Quieres saber qué ocurre detrás?<small>Explora la arquitectura del ecosistema.</small></span></span><span>{{ architectureOpen?'Cerrar arquitectura':'Ver arquitectura' }}<X v-if="architectureOpen" :size="19"/><Plus v-else :size="19"/></span></button><div v-if="architectureOpen" id="architecture-content" class="architecture-content"><div class="architecture-nodes" role="group" aria-label="Componentes del ecosistema"><button v-for="(node,i) in nodes" :key="node.name" :aria-pressed="selectedNode===i" :class="{active:selectedNode===i}" @click="selectedNode=i"><component :is="node.icon" :size="22"/><b>{{ node.name }}</b><small>0{{ i+1 }}</small></button></div><div class="architecture-detail" aria-live="polite"><span class="mono-label">{{ technical?'MODO TÉCNICO':'EXPLICADO SIMPLE' }}</span><h3>{{ nodes[selectedNode].name }}</h3><p>{{ technical?nodes[selectedNode].tech:nodes[selectedNode].simple }}</p><button class="text-btn" @click="technical=!technical">{{ technical?'Explicar en simple':'Ver detalle técnico' }}<ArrowRight :size="14"/></button></div></div></section>

      <section class="final-section section container"><div class="final-route" aria-hidden="true"><span></span><Truck :size="30"/><span></span></div><span class="section-index">UN CAMIÓN. UNA RUTA. UN CIUDADANO AVISADO A TIEMPO.</span><h2 class="reveal">De recolectar residuos<br>a <em>conectar ciudades.</em></h2><p>De recolectar residuos a conectar ciudades.<br>Así es como cada pieza encaja.</p><div class="final-actions"><a class="btn btn-primary" href="#municipio">Implementar en mi municipio <ArrowUpRight :size="19"/></a><a class="btn btn-outline" href="#arquitectura" @click="architectureOpen=true">Conocer la tecnología</a></div></section>
    </main>
    <footer class="site-footer container"><a class="brand" href="#inicio"><img class="brand-logo" :src="logoUrl" alt="" width="47" height="44">ruta<span>limpia</span><i></i></a><p>Tu ciudad, 10 minutos antes.<small>© {{ new Date().getFullYear() }} RutaLimpia · Michoacán, México</small></p></footer>
  </div>
</template>

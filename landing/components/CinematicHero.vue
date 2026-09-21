<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { ArrowUpRight, ArrowDown, Bell, Check, Pause, Play, Radio, MapPin, Navigation } from 'lucide-vue-next';
import CityScene from './CityScene.vue';
import logoUrl from '../assets/rutalimpia-logo.png';
import { heroMedia } from '../media';
const props=defineProps<{paused:boolean;reducedMotion:boolean}>();
defineEmits<{pause:[]}>();
const root=ref<HTMLElement>();
const film=ref<HTMLElement>();
const city=ref<InstanceType<typeof CityScene>>();
const chapter=ref(0);
const opening=ref(true);
const videoFailed=ref(false);
const video=ref<HTMLVideoElement>();
const videoAllowed=ref(false);
const videoSrc=ref('');
const chapters=['La ciudad despierta','La ruta se conecta','El aviso llega a ti'];
const details=[{icon:MapPin,label:'RUTA CENTRO',value:'07:12 A.M.'},{icon:Radio,label:'UNIDAD RT-04',value:'GPS conectado'},{icon:Bell,label:'TU CAMIÓN ESTÁ CERCA',value:'≈ 6 minutos'}];
let observer:IntersectionObserver;
let disposed=false;
let frame=0;
let introFrame=0;
let introElapsed=0;
let introLastTime=0;
let introFloor=0;
let inView=true;
// El avance de la escena NO es reactivo: se escribe directo en los pocos elementos que lo usan. Así Vue no vuelve a calcular
// el héroe en cada cuadro de scroll y el navegador no recalcula el estilo de ~1,800 nodos (la variable no se hereda, ver brand.css).
let consumers:HTMLElement[]=[];
let tracks:HTMLElement[]=[];
let lastText='';
function setProgress(value:number){
  const text=String(Math.round(value*1000)/1000);
  if(text===lastText)return;
  lastText=text;
  for(const el of consumers)el.style.setProperty('--film-progress',text);
  tracks.forEach((el,i)=>{el.style.transform=`scaleX(${Math.min(1,Math.max(0,value*3-i))})`;});
  city.value?.setProgress(.27+value*.63);
  const next=value<.34?0:value<.69?1:2;
  if(next!==chapter.value)chapter.value=next;
}
function update(){
  frame=0;
  if(!root.value||props.paused||props.reducedMotion)return;
  const headerHeight=window.innerWidth<681?68:78;
  const distance=root.value.offsetHeight-(window.innerHeight-headerHeight);
  if(distance<=0)return;
  const scroll=Math.max(0,Math.min(1,(-root.value.getBoundingClientRect().top+headerHeight)/distance));
  if(scroll>.005){opening.value=false;cancelAnimationFrame(introFrame);}
  setProgress(introFloor+(1-introFloor)*scroll);
}
function playOpening(time:number){
  const delta=introLastTime?Math.min(80,time-introLastTime):0;
  introLastTime=time;
  if(!opening.value||disposed)return;
  if(props.reducedMotion){opening.value=false;return;}
  if(!props.paused&&!document.hidden&&inView){
    introElapsed=Math.min(8000,introElapsed+delta);
    introFloor=.28*(introElapsed/8000);
    setProgress(introFloor);
    if(introElapsed===8000)opening.value=false;
  }
  if(opening.value)introFrame=requestAnimationFrame(playOpening);
}
function onScroll(){if(!frame)frame=requestAnimationFrame(update);}
function seek(value:number){
  opening.value=false;introFloor=0;cancelAnimationFrame(introFrame);
  setProgress(value);
  if(!root.value||props.reducedMotion||props.paused)return;
  const headerHeight=window.innerWidth<681?68:78;
  const distance=Math.max(1,root.value.offsetHeight-(window.innerHeight-headerHeight));
  window.scrollTo({top:window.scrollY+root.value.getBoundingClientRect().top-headerHeight+value*distance,behavior:'smooth'});
}
function syncVideo(){
  const network=(navigator as Navigator & {connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  videoAllowed.value=!!heroMedia.video&&!props.reducedMotion&&!network?.saveData&&!['slow-2g','2g'].includes(network?.effectiveType||'');
  videoSrc.value=window.innerWidth<768?(heroMedia.mobileVideo||heroMedia.video):heroMedia.video;
  if(props.paused||props.reducedMotion||document.hidden||!inView)video.value?.pause();else video.value?.play().catch(()=>{});
}
onMounted(()=>{
  consumers=Array.from(film.value?.querySelectorAll<HTMLElement>('.sun-halo,.cinema-camera,.film-telemetry,.hero-notification')||[]);
  tracks=Array.from(film.value?.querySelectorAll<HTMLElement>('.film-chapter-track i')||[]);
  syncVideo();update();
  introFrame=requestAnimationFrame(playOpening);
  window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);
  document.addEventListener('visibilitychange',syncVideo);
  observer=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;syncVideo();});if(root.value)observer.observe(root.value);
});
watch(()=>[props.paused,props.reducedMotion],()=>{if(!disposed){syncVideo();update();}});
onBeforeUnmount(()=>{disposed=true;cancelAnimationFrame(frame);cancelAnimationFrame(introFrame);observer?.disconnect();window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);document.removeEventListener('visibilitychange',syncVideo);});
</script>
<template>
  <section id="inicio" ref="root" class="hero-sequence" :class="{'static-film':reducedMotion}">
    <div ref="film" class="hero cinematic-hero" :class="`chapter-${chapter}`">
      <video v-if="videoAllowed&&!videoFailed" ref="video" class="hero-video" :src="videoSrc" :poster="heroMedia.poster||undefined" autoplay muted loop playsinline preload="none" aria-hidden="true" @error="videoFailed=true"></video>
      <div class="film-sky" aria-hidden="true"><div class="sun-halo"></div><div class="sky-orbit orbit-one"></div><div class="sky-orbit orbit-two"></div><div class="film-cloud cloud-one"></div><div class="film-cloud cloud-two"></div></div>
      <div class="film-horizon" aria-hidden="true"><span v-for="n in 22" :key="n" :style="{height:`${30+(n*19)%100}px`,width:`${25+(n*11)%28}px`}"></span></div>
      <div class="hero-city cinema-camera" aria-hidden="true"><CityScene ref="city" :route-progress=".27"/></div>
      <div class="container hero-content"><div class="eyebrow"><span class="status-dot"></span> TU CIUDAD TIENE ALGO QUE DECIRTE.</div><div class="film-title-stage"><Transition name="film-title" mode="out-in"><div :key="chapter"><span class="film-scene-label">0{{ chapter+1 }} / {{ chapters[chapter] }}</span><h1 v-if="chapter===0">Tu ciudad,<br><em>10 minutos</em><br>antes.</h1><h1 v-else-if="chapter===1">Cada ruta<br>tiene una<br><em>historia.</em></h1><h1 v-else>Tu mañana.<br>Ahora con<br><em>tiempo.</em></h1><p class="hero-description">{{ chapter===0?'El camión va hacia tu calle.':chapter===1?'Ubicación, movimiento y conexión.':'Un aviso. Una cosa menos de qué preocuparte.' }}<br><b>{{ chapter===0?'Esta vez, tú ya lo sabes.':chapter===1?'La ciudad empieza a hablar.':'El servicio llega. Tú ya estás listo.' }}</b></p></div></Transition></div><div class="hero-buttons"><a class="btn btn-primary" href="#experiencia">Probar RutaLimpia <ArrowUpRight :size="20"/></a><a class="hero-secondary" href="#ecosistema">Descubrir el ecosistema <ArrowDown :size="16"/></a></div><p class="hero-caption">No te vamos a explicar RutaLimpia. <span>Pruébalo.</span></p></div>
      <div class="film-coordinate"><Navigation :size="14"/><span>20.0590° N<br>102.7193° W</span><i></i></div>
      <div class="film-telemetry"><component :is="details[chapter].icon" :size="18"/><span><small>{{ details[chapter].label }}</small><b>{{ details[chapter].value }}</b></span><span class="telemetry-signal"><i></i><i></i><i></i><i></i></span></div>
      <div class="hero-notification" :class="{'notification-delivered':chapter===2}"><span class="notice-icon"><img :src="logoUrl" alt="" width="34" height="32"></span><div><div><b>RUTALIMPIA</b><span>ahora · demo</span></div><p>{{ chapter===2?'Es tu momento. Ya casi llegamos.':'Tu camión está cerca.' }}</p><small>{{ chapter===2?'Prepara tus residuos. Llegará en ≈ 6 min.':'Tienes tiempo. Llegará en ≈ 10 min.' }}</small></div><span class="notification-check"><Check :size="15"/></span></div>
      <div class="film-player container"><div class="film-player-top"><span><i class="status-dot"></i>{{ opening?'INTRODUCCIÓN AUTOMÁTICA':'AHORA TÚ CONTROLAS EL RECORRIDO' }}</span><button class="motion-toggle" :aria-pressed="paused" @click="$emit('pause')"><Play v-if="paused" :size="13"/><Pause v-else :size="13"/>{{ paused?'Reanudar':'Pausar' }} movimiento</button></div><div class="film-chapters" role="group" aria-label="Escenas de la introducción"><button v-for="(label,i) in chapters" :key="label" :aria-pressed="chapter===i" :class="{active:chapter===i,complete:chapter>i}" @click="seek([0,.4,.78][i])"><span class="film-chapter-track"><i style="transform:scaleX(0)"></i></span><b>0{{ i+1 }} <span>{{ label }}</span></b></button></div><a class="film-scroll" href="#experiencia">SIGUE EL RECORRIDO CON TU SCROLL <ArrowDown :size="13"/></a></div>
    </div>
  </section>
</template>

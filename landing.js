const storyScenes=[
  {kicker:'01 · COMIENZA EL RECORRIDO',title:'Todo inicia<br>en la calle.',copy:'El camión inicia su ruta. Desde ese momento, RutaLimpia acompaña el recorrido y hace visible lo que antes no se podía ver.',facts:['Ruta asignada','Unidad identificada']},
  {kicker:'02 · CAPTURA EN MOVIMIENTO',title:'El dispositivo<br>observa la ruta.',copy:'GPS y conectividad registran posición, trayectoria y señales operativas mientras la unidad avanza por la ciudad.',facts:['Ubicación GPS','Trayectoria','Eventos de unidad']},
  {kicker:'03 · TELEMETRÍA SEGURA',title:'La señal se vuelve<br>información.',copy:'Los datos llegan al backend, se validan y se ordenan para construir un historial consultable de cada unidad y recorrido.',facts:['Recepción de datos','Validación','Historial operativo']},
  {kicker:'04 · MICROSERVICIO INTELIGENTE',title:'La información<br>encuentra patrones.',copy:'El microservicio apoya el ruteo, la zonificación y la detección de anomalías para producir recomendaciones que el equipo puede revisar.',facts:['Ruteo','Zonificación','Anomalías']},
  {kicker:'05 · DOS EXPERIENCIAS',title:'Un dato.<br>Dos formas de actuar.',copy:'Administración coordina la flota y la ciudadanía consulta el servicio. Cada perfil recibe únicamente la información que necesita.',facts:['Panel administrativo','Experiencia ciudadana']},
  {kicker:'06 · RESPUESTA OPERATIVA',title:'La incidencia<br>llega a quien actúa.',copy:'Una detención, desvío o reporte se convierte en una alerta con contexto, prioridad y seguimiento hasta su atención.',facts:['Detección','Notificación','Seguimiento']}
];
const storySection=document.querySelector('.scroll-story');
const storyFilm=document.querySelector('.story-film');
const storyCopy=document.querySelector('.story-copy');
const storyVisual=document.querySelector('.story-visual');
const storyDots=[...document.querySelectorAll('.story-dot')];
let currentStoryScene=-1;
let storyFrame=0;
let storyChangeToken=0;

function setStoryScene(index){
  if(index===currentStoryScene)return;
  currentStoryScene=index;
  const scene=storyScenes[index];
  const token=++storyChangeToken;
  storyFilm.dataset.scene=String(index);
  storyCopy.classList.add('is-changing');
  window.setTimeout(()=>{
    if(token!==storyChangeToken)return;
    document.querySelector('#story-kicker').textContent=scene.kicker;
    document.querySelector('#story-title').innerHTML=scene.title;
    document.querySelector('#story-copy').textContent=scene.copy;
    document.querySelector('#story-facts').innerHTML=scene.facts.map(fact=>`<span>${fact}</span>`).join('');
    document.querySelector('#story-index').textContent=String(index+1).padStart(2,'0');
    storyDots.forEach((dot,dotIndex)=>{
      const selected=dotIndex===index;
      dot.classList.toggle('active',selected);
      dot.setAttribute('aria-selected',String(selected));
    });
    storyCopy.classList.remove('is-changing');
  },90);
}

function updateStory(){
  storyFrame=0;
  if(!storySection)return;
  const start=storySection.offsetTop;
  const distance=Math.max(1,storySection.offsetHeight-window.innerHeight);
  const progress=Math.min(1,Math.max(0,(window.scrollY-start)/distance));
  const scaled=progress*storyScenes.length;
  const scene=Math.min(storyScenes.length-1,Math.floor(scaled));
  const sceneProgress=scene===storyScenes.length-1&&progress===1?1:scaled-scene;
  const travelX=Math.min(230,(storyVisual?.offsetWidth||600)*.37);
  const travelY=Math.min(125,(storyVisual?.offsetHeight||500)*.25);
  storyFilm.style.setProperty('--scene-p',sceneProgress.toFixed(3));
  storyFilm.style.setProperty('--route-draw',scene===0?sceneProgress.toFixed(3):'1');
  storyFilm.style.setProperty('--route-offset',String(scene===0?820*(1-sceneProgress):0));
  storyFilm.style.setProperty('--truck-x',`${travelX*(scene===0?sceneProgress:1)}px`);
  storyFilm.style.setProperty('--truck-y',`${-travelY*(scene===0?sceneProgress:1)}px`);
  document.querySelector('#story-progress-bar').style.width=`${(progress*100).toFixed(2)}%`;
  setStoryScene(scene);
}

function requestStoryUpdate(){if(!storyFrame)storyFrame=requestAnimationFrame(updateStory)}
window.addEventListener('scroll',requestStoryUpdate,{passive:true});
window.addEventListener('resize',requestStoryUpdate);
storyDots.forEach(dot=>dot.addEventListener('click',()=>{
  const index=Number(dot.dataset.storyGoto);
  const distance=storySection.offsetHeight-window.innerHeight;
  const target=storySection.offsetTop+(index/storyScenes.length)*distance+2;
  window.scrollTo({top:target,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}));
document.querySelectorAll('a[href="#como-funciona"]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();
  window.scrollTo({top:storySection.offsetTop+2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}));
updateStory();
const personas={admin:{title:'Decidir con contexto.',text:'Monitorea rutas, vehículos e incidencias desde un tablero diseñado para priorizar y actuar a tiempo.',items:['Flota y rutas en vivo','Alertas con prioridad clara','Historial para planear mejor']},citizen:{title:'Saber cuándo y participar.',text:'Consulta el avance del servicio, recibe información útil y reporta una incidencia desde una experiencia simple.',items:['Consulta de ruta cercana','Información clara del servicio','Reporte con ubicación y evidencia']}};
document.querySelectorAll('.persona-tab').forEach(btn=>btn.addEventListener('click',()=>{const p=personas[btn.dataset.persona];document.querySelectorAll('.persona-tab').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-selected','false')});btn.classList.add('active');btn.setAttribute('aria-selected','true');document.querySelector('#persona-text').innerHTML=`<h3>${p.title}</h3><p>${p.text}</p><ul>${p.items.map(x=>`<li>${x}</li>`).join('')}</ul>`;document.querySelector('#persona-screen').classList.toggle('citizen-mode',btn.dataset.persona==='citizen');}));
const incidents=[['ALTA PRIORIDAD','Hace 4 min','Ruta con posible retraso','La unidad 04 presenta una detención prolongada. El sistema recomienda validar el evento.','Ruta Norte · Unidad 04'],['EN ATENCIÓN','Hace 12 min','Reporte ciudadano recibido','Se registró un punto con residuos acumulados. El equipo puede asignar seguimiento.','Col. Centro · Reporte 28'],['INFORMATIVA','Hace 19 min','Desvío detectado en recorrido','La unidad tomó una ruta alternativa. El evento queda disponible para revisión operativa.','Ruta Sur · Unidad 02']];let incidentIndex=0;function showIncident(){const i=incidents[incidentIndex];['incident-priority','incident-time','incident-title','incident-desc','incident-route'].forEach((id,n)=>document.getElementById(id).textContent=i[n]);}document.querySelector('#next-incident').addEventListener('click',()=>{incidentIndex=(incidentIndex+1)%incidents.length;showIncident()});document.querySelector('#resolve-incident').addEventListener('click',e=>{e.currentTarget.textContent='Atendida ✓';e.currentTarget.disabled=true;});
const menu=document.querySelector('.menu-btn'),links=document.querySelector('.nav-links');menu?.addEventListener('click',()=>{const open=links.classList.toggle('open');menu.setAttribute('aria-expanded',open);});links?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>links.classList.remove('open')));
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}}),{threshold:.12});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import type { Chart } from 'chart.js';
const canvas = ref<HTMLCanvasElement>();
let chart: Chart | undefined;
let disposed = false;
onMounted(async () => {
  const { Chart: ChartJS, BarController, BarElement, CategoryScale, LinearScale } = await import('chart.js');
  if(disposed || !canvas.value)return;
  ChartJS.register(BarController,BarElement,CategoryScale,LinearScale);
  chart = new ChartJS(canvas.value, {type:'bar',data:{labels:['L','M','M','J','V','S'],datasets:[{data:[65,78,72,88,81,94],backgroundColor:['#255b3c','#255b3c','#255b3c','#255b3c','#255b3c','#39ff88'],borderRadius:3,barThickness:13}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:'#94a79b'},border:{display:false}},y:{display:false,min:0,max:100}}}});
});
onBeforeUnmount(()=>{disposed=true;chart?.destroy();});
</script>
<template><div class="coverage-chart"><canvas ref="canvas" role="img" aria-label="Cobertura ilustrativa de lunes a sábado: 65, 78, 72, 88, 81 y 94 por ciento."></canvas></div></template>

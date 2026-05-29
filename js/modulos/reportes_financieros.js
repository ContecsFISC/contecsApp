import { db } from "../core/firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

function formatMoney(v){return '$' + Number(v||0).toFixed(2)}

function sampleData(){
  // Keep a small fallback set in case Firestore isn't available
  const ventas = [{items:[{nombre:'Camiseta',cantidad:80,precioUnitario:15,costoUnitario:7}],total:1200,utilidadTotal:640,creadoEn:'2026-05-01'}];
  const compras = [{items:[{nombre:'Camiseta',cantidad:100,precioUnitario:7}],total:700,creadoEn:'2025-12-20'}];
  const merma = [];
  return {ventas,compras,merma};
}

async function fetchFromFirestore(){
  try{
    const ventasSnap = await getDocs(collection(db,'ventas'));
    const comprasSnap = await getDocs(collection(db,'compras'));
    const mermaSnap = await getDocs(collection(db,'mermas'));
    const productosSnap = await getDocs(collection(db,'productos'));

    const ventas = ventasSnap.docs.map(d=>({id:d.id,...d.data()}));
    const compras = comprasSnap.docs.map(d=>({id:d.id,...d.data()}));
    const merma = mermaSnap.docs.map(d=>({id:d.id,...d.data()}));
    const productos = productosSnap.docs.map(d=>({id:d.id,...d.data()}));
    return {ventas,compras,merma,productos};
  }catch(e){
    console.warn('Firestore no disponible, usando datos de ejemplo',e);
    const s = sampleData();
    s.productos = [];
    return s;
  }
}

function groupByProductFromVentas(ventas){
  const map = new Map();
  ventas.forEach(v=>{
    const items = Array.isArray(v.items) ? v.items : [];
    items.forEach(it=>{
      const key = it.productoId || it.nombre;
      if(!map.has(key)) map.set(key,{name:it.nombre,units:0,revenue:0,cost:0});
      const cur = map.get(key);
      const cantidad = Number(it.cantidad||0);
      const revenue = Number(it.precioUnitario||it.precio||0) * cantidad;
      const cost = Number(it.costoUnitario||it.costo||0) * cantidad;
      cur.units += cantidad;
      cur.revenue += revenue;
      cur.cost += cost;
    });
  });
  return Array.from(map.entries()).map(([id,vals])=>({id,...vals}));
}

function monthlyTotalsFromDocs(records, field='total'){
  const now = new Date();
  const months=[];
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({year:d.getFullYear(),month:d.getMonth(),value:0});
  }
  records.forEach(r=>{
    const d = r.creadoEn && r.creadoEn.toDate ? r.creadoEn.toDate() : new Date(r.creadoEn || r.date || Date.now());
    months.forEach(m=>{if(d.getFullYear()===m.year && d.getMonth()===m.month){ m.value += Number(r[field]||0); }});
  });
  return months.map(m=>m.value);
}
export default async function initReportes(){
  const {ventas,compras,merma,productos} = await fetchFromFirestore();

  const ventasTotal = ventas.reduce((s,v)=>s + Number(v.total||0),0);
  const comprasTotal = compras.reduce((s,c)=>s + Number(c.total||0),0);
  // Perdidas: sumar merma tipo sin_vender costo * cantidad o totalPerdida si existe
  let perdidas = 0;
  merma.forEach(m=>{
    if (Array.isArray(m.items)) {
      m.items.forEach(it=>{
        const tipo = String(it.tipo||it.tipoLinea||'').toLowerCase();
        if (tipo === 'sin_vender' || tipo === 'sin_vendida') {
          perdidas += Number(it.costoUnitario||it.costo||0) * Number(it.cantidad||0);
        }
      });
    }
    if (m.totalPerdida) perdidas += Number(m.totalPerdida||0);
  });

  const ganancia = ventasTotal - comprasTotal - perdidas;

  document.getElementById('ventasTotal').innerText = formatMoney(ventasTotal);
  document.getElementById('comprasTotal').innerText = formatMoney(comprasTotal);
  document.getElementById('gananciaTotal').innerText = formatMoney(Math.max(ganancia,0));
  document.getElementById('perdidasTotal').innerText = formatMoney(perdidas);

  // Top productos
  const grouped = groupByProductFromVentas(ventas);
  grouped.sort((a,b)=>b.revenue - a.revenue);
  const top = grouped.slice(0,6);
  const topTable = document.getElementById('topTable');
  topTable.innerHTML = '';
  top.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="padding:6px 0">${p.name}</td><td>${p.units}</td><td>${formatMoney(p.revenue)}</td>`;
    topTable.appendChild(tr);
  });

  // Productos en riesgo: baja venta o margen bajo o exceso de stock
  // use productos list for stock info if available
  const productosMap = new Map((productos||[]).map(p=>[p.id,p]));

  const risk = grouped.filter(p=>{
    const bajaVentas = p.units < 20;
    const margenBajo = (p.revenue - p.cost) < (p.revenue*0.1);
    const prod = productosMap.get(p.id) || productosMap.get(p.name);
    const excesoStock = prod ? (Number(prod.stock||0) > Math.max(50, p.units*2)) : false;
    return bajaVentas || margenBajo || excesoStock;
  });
  const riskTable = document.getElementById('riskTable');
  riskTable.innerHTML = '';
  risk.forEach(p=>{
    const motivo = p.units < 20 ? 'Baja ventas' : 'Margen bajo';
    const accion = p.units < 20 ? 'Considerar bajar precio o promoción' : 'Revisar coste/precio';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="padding:6px 0">${p.name}</td><td>${motivo}</td><td>${accion}</td>`;
    riskTable.appendChild(tr);
  });

  // Charts
  const mesesVentas = monthlyTotalsFromDocs(ventas,'total');
  const mesesCompras = monthlyTotalsFromDocs(compras,'total');

  const ctx1 = document.getElementById('ventasComprasChart').getContext('2d');
  new Chart(ctx1,{
    type:'line',
    data:{
      labels: mesesVentas.map((_,i)=>{const d=new Date();d.setMonth(d.getMonth()-5+i);return d.toLocaleString('es-ES',{month:'short'});} ),
      datasets:[{label:'Ventas',data:mesesVentas,borderColor:'#36a2eb',backgroundColor:'rgba(54,162,235,0.15)',tension:0.2},{label:'Compras',data:mesesCompras,borderColor:'#ff6384',backgroundColor:'rgba(255,99,132,0.12)',tension:0.2}]
    },
    options:{responsive:true,plugins:{legend:{position:'bottom'}}}
  });

  const ctx2 = document.getElementById('topProductsChart').getContext('2d');
  new Chart(ctx2,{type:'bar',data:{labels:top.map(t=>t.name),datasets:[{label:'Ingresos',data:top.map(t=>t.revenue),backgroundColor:'#4caf50'}]},options:{responsive:true,plugins:{legend:{display:false}}}});
}

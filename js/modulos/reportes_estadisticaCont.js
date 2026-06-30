import { db } from "../core/firebase-config.js";
import {
  collection, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const Chart = window.Chart;

const VERDE = ["#00722e","#00a044","#00c854","#39d97a","#6ee49a",
               "#a1edbb","#c8f5d8","#5fd49a","#a8e6c0","#e0fce9"];

export default async function init() {
  try {
    await Promise.all([
      cargarEstadisticasActividades(),
      cargarEstadisticasVoluntarios(),
    ]);
  } finally {
    document.getElementById("spinner-global").style.display      = "none";
    document.getElementById("contenido-estadisticas").style.display = "block";
  }
}

// ═══════════════════════════════════════════════════════════
// SECCIÓN 1: Conferencias y Talleres
// ═══════════════════════════════════════════════════════════

async function cargarEstadisticasActividades() {
  const [cpSnap, icSnap] = await Promise.all([
    getDocs(query(collection(db, "checkpoints"), orderBy("dia"))),
    getDocs(collection(db, "inscripciones_checkpoint")),
  ]);

  const checkpoints = cpSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Contar asistencias por checkpointId
  const asistPor = {};
  icSnap.docs.forEach(d => {
    const { checkpointId } = d.data();
    if (checkpointId) asistPor[checkpointId] = (asistPor[checkpointId] || 0) + 1;
  });

  const enriched = checkpoints.map(cp => ({
    ...cp,
    asistentes: asistPor[cp.id] || 0,
  })).sort((a, b) => b.asistentes - a.asistentes);

  const totalActividades = enriched.length;
  const totalAsistencias = enriched.reduce((s, c) => s + c.asistentes, 0);
  const masVisitada      = enriched[0];
  const promedio         = totalActividades ? Math.round(totalAsistencias / totalActividades) : 0;
  const totalHoras       = enriched.reduce((s, c) => s + (calcHorasNum(c.horaInicio, c.horaFin) || 0), 0);

  set("stat-total-actividades", totalActividades);
  set("stat-total-asistencias", totalAsistencias);
  set("stat-mas-visitada",      (masVisitada?.titulo || masVisitada?.nombre || "—").slice(0, 40));
  set("stat-mas-visitada-num",  masVisitada ? `${masVisitada.asistentes} asistentes` : "");
  set("stat-promedio-asis",     promedio);
  set("stat-horas-congreso",    totalHoras ? `${totalHoras}h` : "—");

  // Gráfico: Top 10 más visitadas (barra horizontal)
  const top10 = enriched.slice(0, 10);
  new Chart(document.getElementById("topActividadesChart"), {
    type: "bar",
    data: {
      labels: top10.map(c => truncate(c.titulo || c.nombre || "—", 32)),
      datasets: [{
        label: "Asistentes",
        data: top10.map(c => c.asistentes),
        backgroundColor: VERDE[1],
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });

  // Gráfico: Distribución por tipo (dona)
  const tiposCount = {};
  enriched.forEach(c => {
    const t = capitalize(c.tipo || "otro");
    tiposCount[t] = (tiposCount[t] || 0) + 1;
  });
  new Chart(document.getElementById("tipoActividadChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(tiposCount),
      datasets: [{
        data: Object.values(tiposCount),
        backgroundColor: VERDE.slice(0, Object.keys(tiposCount).length),
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { font: { size: 12 } } } },
    },
  });

  // Tabla de actividades
  const maxAsis = enriched[0]?.asistentes || 1;
  const tbody = document.getElementById("actividadesTableBody");
  tbody.innerHTML = enriched.map((c, i) => {
    const cupos = c.cupos || 0;
    const pct   = cupos ? Math.min(Math.round(c.asistentes / cupos * 100), 100) : null;
    const horas = calcHorasNum(c.horaInicio, c.horaFin);
    const tipoBadge = badgeTipo(c.tipo);
    const barW  = maxAsis ? Math.round(c.asistentes / maxAsis * 100) : 0;
    return `<tr>
      <td style="color:var(--gris-medio);font-size:12px">${i + 1}</td>
      <td>
        <strong>${c.titulo || c.nombre || "—"}</strong>
        ${c.eventoNombre ? `<br><small style="color:var(--gris-medio)">${c.eventoNombre}</small>` : ""}
      </td>
      <td><span class="badge-tipo ${tipoBadge}">${capitalize(c.tipo || "—")}</span></td>
      <td style="white-space:nowrap;font-size:12px">${fmtDiaCorto(c.dia)}</td>
      <td style="font-size:12px">${c.exponente || "—"}</td>
      <td style="text-align:center;font-weight:700;color:var(--verde-oscuro)">${c.asistentes}</td>
      <td style="text-align:center;color:var(--gris-medio)">${cupos || "—"}</td>
      <td>
        ${pct !== null
          ? `<div class="pct-bar">
               <div class="pct-bar-bg"><div class="pct-bar-inner" style="width:${pct}%"></div></div>
               <span style="font-size:11px;color:var(--gris-medio);min-width:30px">${pct}%</span>
             </div>`
          : '<span style="color:var(--gris-medio)">—</span>'}
      </td>
      <td style="text-align:center;color:var(--gris-medio)">${horas ? horas + "h" : "—"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--gris-medio)">Sin actividades registradas.</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// SECCIÓN 2: Voluntarios
// ═══════════════════════════════════════════════════════════

async function cargarEstadisticasVoluntarios() {
  const [volSnap, actSnap, asistSnap] = await Promise.all([
    getDocs(collection(db, "voluntarios")),
    getDocs(query(collection(db, "actividades_voluntarios"), orderBy("creadoEn", "desc"))),
    getDocs(collection(db, "asistencias_voluntarios")),
  ]);

  const voluntarios = volSnap.docs.map(d => ({ id: d.id, ...d.data(), _docId: d.id }));
  const actividades = actSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const asistencias = asistSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Participaciones por voluntario
  const partPor = {};
  asistencias.forEach(a => {
    if (a.voluntarioId) partPor[a.voluntarioId] = (partPor[a.voluntarioId] || 0) + 1;
  });

  // Horas por actividad
  const horasActPor = {};
  asistencias.forEach(a => {
    if (a.actividadId) horasActPor[a.actividadId] = (horasActPor[a.actividadId] || 0) + (a.horasGanadas || 0);
  });

  const totalVol    = voluntarios.length;
  const totalHoras  = voluntarios.reduce((s, v) => s + (v.totalHoras || 0), 0);
  const promHoras   = totalVol ? (totalHoras / totalVol) : 0;
  const totalPart   = asistencias.length;
  // Actividades que tuvieron al menos una asistencia
  const actsConVol  = new Set(asistencias.map(a => a.actividadId).filter(Boolean)).size;

  set("stat-total-voluntarios",    totalVol);
  set("stat-horas-voluntarios",    totalHoras.toFixed(1) + "h");
  set("stat-prom-horas-vol",       promHoras.toFixed(1) + "h");
  set("stat-total-acts-vol",       actsConVol);
  set("stat-total-participaciones", totalPart);

  // Gráfico: Top 10 voluntarios por horas
  const topVol = [...voluntarios]
    .sort((a, b) => (b.totalHoras || 0) - (a.totalHoras || 0))
    .slice(0, 10);
  new Chart(document.getElementById("topVoluntariosChart"), {
    type: "bar",
    data: {
      labels: topVol.map(v => truncate(nombreVol(v), 22)),
      datasets: [{
        label: "Horas",
        data: topVol.map(v => +(v.totalHoras || 0).toFixed(2)),
        backgroundColor: VERDE[2],
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "Horas" } },
        y: { ticks: { font: { size: 11 } } },
      },
    },
  });

  // Gráfico: Horas por actividad (solo actividades con horas)
  const actsConHoras = actividades
    .filter(a => horasActPor[a.id])
    .sort((a, b) => (horasActPor[b.id] || 0) - (horasActPor[a.id] || 0))
    .slice(0, 12);
  new Chart(document.getElementById("horasActividadChart"), {
    type: "bar",
    data: {
      labels: actsConHoras.map(a => truncate(a.nombre || "—", 20)),
      datasets: [{
        label: "Horas totales",
        data: actsConHoras.map(a => +(horasActPor[a.id] || 0).toFixed(2)),
        backgroundColor: VERDE[0],
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Horas" } },
        x: { ticks: { font: { size: 10 }, maxRotation: 35 } },
      },
    },
  });

  // Tabla de voluntarios
  const maxHoras  = topVol[0]?.totalHoras || 1;
  const sortedVol = [...voluntarios].sort((a, b) => (b.totalHoras || 0) - (a.totalHoras || 0));
  const tbody = document.getElementById("voluntariosTableBody");
  tbody.innerHTML = sortedVol.map((v, i) => {
    const horas  = +(v.totalHoras || 0).toFixed(2);
    const partic = partPor[v._docId] || 0;
    const barW   = maxHoras ? Math.round(horas / maxHoras * 100) : 0;
    return `<tr>
      <td style="color:var(--gris-medio);font-size:12px">${i + 1}</td>
      <td><strong>${nombreVol(v)}</strong></td>
      <td style="font-size:12px;color:var(--gris-medio)">${v.cedula || "—"}</td>
      <td style="text-align:center;font-weight:700;color:var(--verde-oscuro)">${horas}h</td>
      <td style="text-align:center;color:var(--gris-medio)">${partic}</td>
      <td>
        <div class="pct-bar">
          <div class="pct-bar-bg"><div class="pct-bar-inner" style="width:${barW}%"></div></div>
          <span style="font-size:11px;color:var(--gris-medio);min-width:34px">${horas}h</span>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">Sin voluntarios registrados.</td></tr>`;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function calcHorasNum(ini, fin) {
  if (!ini || !fin) return null;
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const diff  = toMin(fin) - toMin(ini);
  return diff > 0 ? Math.round(diff / 60 * 2) / 2 : null;
}

function fmtDiaCorto(fechaStr) {
  if (!fechaStr) return "—";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-PA", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

function truncate(s, max) {
  return s && s.length > max ? s.slice(0, max) + "…" : (s || "—");
}

const DIACRITICOS_RE = new RegExp("[̀-ͯ]", "g");
const normalizarParaComparar = s => s.toLowerCase().normalize("NFD").replace(DIACRITICOS_RE, "");

function nombreVol(v) {
  const nombre   = (v.nombre || "").trim();
  const apellido = (v.apellido || "").trim();
  if (!apellido) return nombre || "—";

  const nombreWords   = nombre.split(/\s+/);
  const apellidoWords = apellido.split(/\s+/);
  const maxSolape = Math.min(nombreWords.length, apellidoWords.length);
  let solape = 0;
  for (let i = maxSolape; i >= 1; i--) {
    const colaNombre     = nombreWords.slice(-i).map(normalizarParaComparar).join(" ");
    const cabezaApellido = apellidoWords.slice(0, i).map(normalizarParaComparar).join(" ");
    if (colaNombre === cabezaApellido) { solape = i; break; }
  }
  const restante = apellidoWords.slice(solape).join(" ");
  return restante ? `${nombre} ${restante}` : (nombre || "—");
}

function badgeTipo(tipo) {
  if (!tipo) return "";
  const t = tipo.toLowerCase();
  if (t === "taller")     return "badge-taller";
  if (t === "gira")       return "badge-gira";
  if (t === "ponencia" || t === "conferencia") return "badge-ponencia";
  return "";
}

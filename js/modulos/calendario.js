import { db } from "../core/firebase-config.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual, esperarSesionLista } from "../core/auth.js";
import { usuarioPuedeVerReunion, usuarioPuedeGestionarMinuta } from "./reuniones-utils.js";

const el = id => document.getElementById(id);
let usuarioActual = null;

let actividades = [], giras = [], ventas = [], reuniones = [], asignaciones = [];
let mesActual   = new Date();
let filtroActivo = "todos";

const DIAS  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function fmtFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA");
}

// ─── Carga ────────────────────────────────────────────────────────────────────
async function leerColeccion(nombre) {
  try {
    const snap = await getDocs(collection(db, nombre));
    return snap.docs;
  } catch (e) {
    console.error(`Error cargando ${nombre}:`, e.message);
    return [];
  }
}

async function cargarEventos() {
  const [docsAct, docsGira, docsVenta, docsReu, docsAsig] = await Promise.all([
    leerColeccion("actividades_voluntarios"),
    leerColeccion("giras_voluntarios"),
    leerColeccion("actividades_ventas"),
    leerColeccion("reuniones"),
    leerColeccion("asignaciones_voluntarios"),
  ]);

  const porFecha = (a, b) => {
    const fa = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha || 0);
    const fb = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha || 0);
    return fa - fb;
  };

  actividades  = docsAct.map(d  => ({ id: d.id, ...d.data(), tipo: "actividad" })).sort(porFecha);
  giras        = docsGira.map(d => ({ id: d.id, ...d.data(), tipo: "gira"      })).sort(porFecha);
  ventas       = docsVenta.map(d => ({ id: d.id, ...d.data(), tipo: "venta"    })).sort(porFecha);
  reuniones    = docsReu.map(d => ({ id: d.id, ...d.data(), tipo: "reunion", fecha: d.data().fechaInicio }))
    .filter(r => usuarioPuedeVerReunion(r, usuarioActual))
    .sort(porFecha);
  asignaciones = docsAsig.map(d => ({ id: d.id, ...d.data() }));

  renderCalendario();
}

function getEventosFiltrados() {
  const todos = [...actividades, ...giras, ...ventas, ...reuniones];
  return filtroActivo === "todos" ? todos : todos.filter(e => e.tipo === filtroActivo);
}

// ─── Render calendario ───────────────────────────────────────────────────────
function renderCalendario() {
  const año = mesActual.getFullYear();
  const mes = mesActual.getMonth();
  el("cal-titulo").textContent = `${MESES[mes]} ${año}`;

  const eventos = getEventosFiltrados();

  // Agrupar por día
  const mapaEvt = {};
  eventos.forEach(e => {
    if (!e.fecha) return;
    const d = e.fecha.toDate ? e.fecha.toDate() : new Date(e.fecha);
    if (d.getFullYear() !== año || d.getMonth() !== mes) return;
    const dia = d.getDate();
    (mapaEvt[dia] = mapaEvt[dia] || []).push(e);
  });

  const primerDia  = new Date(año, mes, 1).getDay();
  const diasEnMes  = new Date(año, mes + 1, 0).getDate();
  const hoy        = new Date();
  const esEsteMes  = hoy.getFullYear() === año && hoy.getMonth() === mes;

  let html = DIAS.map(d => `<div class="cal-day-name">${d}</div>`).join("");

  // Celdas vacías antes del primer día
  for (let i = 0; i < primerDia; i++) html += `<div class="cal-day otro-mes"></div>`;

  for (let dia = 1; dia <= diasEnMes; dia++) {
    const esHoy  = esEsteMes && hoy.getDate() === dia;
    const evts   = mapaEvt[dia] || [];
    const MAX    = 3;
    const visibles = evts.slice(0, MAX);
    const extras   = evts.length - MAX;

    const ICONOS = { actividad: "🎯", gira: "🚌", venta: "💰", reunion: "🗓️" };
    const evtsHtml = visibles.map(e => {
      const ico = ICONOS[e.tipo] || "📌";
      const nombre = e.tipo === "reunion" ? e.titulo : e.nombre;
      return `<span class="cal-evento evt-${e.tipo}" data-id="${e.id}" data-tipo="${e.tipo}">${ico} ${nombre}</span>`;
    }).join("");

    const masHtml = extras > 0
      ? `<div class="cal-mas" data-dia="${dia}" data-anio="${año}" data-mes="${mes}">+${extras} más…</div>`
      : "";

    html += `<div class="cal-day${esHoy ? " hoy" : ""}">
      <div class="cal-day-num">${dia}${esHoy ? `<small style="color:#1a56db;font-size:10px;margin-left:4px;">hoy</small>` : ""}</div>
      ${evtsHtml}${masHtml}
    </div>`;
  }

  el("cal-grid").innerHTML = html;
}

function fmtHora(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

// ─── Detalle de una reunión ───────────────────────────────────────────────────
function verDetalleReunion(e) {
  const cfg = { label: "Reunión", ico: "🗓️", color: "#1a56db", bg: "#eef2ff", border: "#a5b4fc" };
  const lugarHtml = e.esVirtual
    ? `Virtual — <a href="${e.linkVirtual}" target="_blank" rel="noopener">${e.linkVirtual}</a>`
    : (e.lugar || "—");
  const minutaLink = usuarioPuedeGestionarMinuta(usuarioActual)
    ? `<div style="margin-top:14px;"><a href="../admin/minutaReunion.html?id=${e.id}" style="font-size:13px;font-weight:700;color:${cfg.color};">📋 Minuta de la reunión →</a></div>`
    : "";

  el("modal-detalle-contenido").innerHTML = `
    <div style="display:inline-flex;align-items:center;gap:8px;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;margin-bottom:14px;">
      ${cfg.ico} ${cfg.label}
    </div>
    <div style="font-size:18px;font-weight:700;color:var(--gris-titulo);margin-bottom:4px;">${e.titulo}</div>
    ${e.agenda ? `<p style="font-size:13px;color:var(--gris-medio);margin-bottom:12px;">${e.agenda}</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;font-size:13px;">
      <div><strong style="color:${cfg.color};">Fecha</strong><br/>${fmtFecha(e.fechaInicio)}</div>
      <div><strong style="color:${cfg.color};">Hora</strong><br/>${fmtHora(e.fechaInicio)} – ${fmtHora(e.fechaFin)}</div>
      <div style="grid-column:1/-1;"><strong style="color:${cfg.color};">Lugar</strong><br/>${lugarHtml}</div>
    </div>
    ${minutaLink}
  `;
  el("modal-detalle").classList.add("open");
}

// ─── Detalle de un evento ─────────────────────────────────────────────────────
function verDetalle(id, tipo) {
  if (tipo === "reunion") {
    const e = reuniones.find(x => x.id === id);
    if (e) verDetalleReunion(e);
    return;
  }

  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const e = fuente.find(x => x.id === id);
  if (!e) return;

  const cfg = {
    actividad: { label:"Actividad", ico:"🎯", color:"var(--verde-oscuro)", bg:"var(--verde-fondo)", border:"var(--verde-claro)" },
    gira:      { label:"Gira",      ico:"🚌", color:"#856404",             bg:"#fff3cd",            border:"#ffc107" },
    venta:     { label:"Venta",     ico:"💰", color:"#c81e1e",             bg:"#fde8e8",            border:"#f05252" },
  }[tipo];

  const turnos = (e.turnos || []).map(t =>
    `<span style="font-size:12px;background:${cfg.bg};color:${cfg.color};padding:3px 8px;border-radius:8px;display:inline-block;margin:2px;border:1px solid ${cfg.border};">${t.nombre} ${t.horaInicio}–${t.horaFin}</span>`
  ).join("") || `<span style="color:var(--gris-medio);font-size:13px;">Sin turnos definidos</span>`;

  const req       = e.voluntariosReq || 0;
  const asignados = asignaciones.filter(a => a.eventoId === id && a.tipo === tipo).length;
  const volColor  = req === 0 ? "var(--gris-medio)"
                  : asignados >= req               ? "#166534"
                  : asignados < req / 2            ? "#c81e1e"
                  :                                  "#854d0e";
  const volTexto  = req > 0 ? `${asignados} / ${req}` : "—";

  el("modal-detalle-contenido").innerHTML = `
    <div style="display:inline-flex;align-items:center;gap:8px;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;margin-bottom:14px;">
      ${cfg.ico} ${cfg.label}
    </div>
    <div style="font-size:18px;font-weight:700;color:var(--gris-titulo);margin-bottom:4px;">${e.nombre}</div>
    ${e.descripcion ? `<p style="font-size:13px;color:var(--gris-medio);margin-bottom:12px;">${e.descripcion}</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;font-size:13px;">
      <div><strong style="color:${cfg.color};">Fecha</strong><br/>${fmtFecha(e.fecha)}</div>
      <div><strong style="color:${cfg.color};">Lugar</strong><br/>${e.lugar || "—"}</div>
      <div><strong style="color:${cfg.color};">Voluntarios</strong><br/>
        <span style="font-weight:700;font-size:15px;color:${volColor};">${volTexto}</span>
        ${req > 0 ? `<span style="font-size:11px;color:var(--gris-medio);margin-left:4px;">${asignados >= req ? "✓ completo" : `faltan ${req - asignados}`}</span>` : ""}
      </div>
      <div><strong style="color:${cfg.color};">Estado</strong><br/>
        <span style="font-size:12px;background:${e.activo ? cfg.bg : "#f8f9fa"};color:${e.activo ? cfg.color : "var(--gris-medio)"};padding:2px 10px;border-radius:12px;border:1px solid ${e.activo ? cfg.border : "var(--gris-borde)"};">
          ${e.activo ? "Activo" : "Inactivo"}
        </span>
      </div>
    </div>
    ${e.colaboracion  ? `<div style="font-size:13px;margin-bottom:10px;"><strong style="color:${cfg.color};">Colaboración</strong><br/>${e.colaboracion}</div>` : ""}
    ${e.responsables  ? `<div style="font-size:13px;margin-bottom:10px;"><strong style="color:${cfg.color};">Responsables</strong><br/>${e.responsables}</div>` : ""}
    <div style="font-size:13px;"><strong style="color:${cfg.color};">Turnos</strong><br/><div style="margin-top:6px;">${turnos}</div></div>
  `;
  el("modal-detalle").classList.add("open");
};

// ─── Ver todos los eventos de un día ─────────────────────────────────────────
function verDia(dia, año, mes) {
  const fecha = new Date(año, mes, dia).toLocaleDateString("es-PA", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const evts  = getEventosFiltrados().filter(e => {
    if (!e.fecha) return false;
    const d = e.fecha.toDate ? e.fecha.toDate() : new Date(e.fecha);
    return d.getFullYear() === año && d.getMonth() === mes && d.getDate() === dia;
  });

  el("modal-detalle-contenido").innerHTML = `
    <div style="font-size:16px;font-weight:700;color:var(--gris-titulo);margin-bottom:16px;text-transform:capitalize;">${fecha}</div>
    ${evts.map(e => {
      const cfg = {
        actividad: { ico:"🎯", color:"var(--verde-oscuro)", bg:"var(--verde-fondo)" },
        gira:      { ico:"🚌", color:"#856404",             bg:"#fff3cd" },
        venta:     { ico:"💰", color:"#c81e1e",             bg:"#fde8e8" },
        reunion:   { ico:"🗓️", color:"#1a56db",             bg:"#eef2ff" },
      }[e.tipo];
      const nombre = e.tipo === "reunion" ? e.titulo : e.nombre;
      return `<div style="background:${cfg.bg};color:${cfg.color};border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;"
        data-id="${e.id}" data-tipo="${e.tipo}">
        <div style="font-weight:700;font-size:14px;">${cfg.ico} ${nombre}</div>
        ${e.tipo !== "reunion" && e.lugar ? `<div style="font-size:12px;margin-top:4px;">📍 ${e.lugar}</div>` : ""}
        ${e.voluntariosReq ? `<div style="font-size:12px;margin-top:2px;">👥 ${e.voluntariosReq} voluntarios requeridos</div>` : ""}
      </div>`;
    }).join("")}
  `;
  el("modal-detalle").classList.add("open");
};

// ─── Navegación ───────────────────────────────────────────────────────────────
el("btn-prev").addEventListener("click", () => {
  mesActual = new Date(mesActual.getFullYear(), mesActual.getMonth() - 1, 1);
  renderCalendario();
});
el("btn-next").addEventListener("click", () => {
  mesActual = new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 1);
  renderCalendario();
});

// ─── Filtros ──────────────────────────────────────────────────────────────────
document.querySelectorAll(".filtro-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    filtroActivo = btn.dataset.filtro;
    document.querySelectorAll(".filtro-btn").forEach(b => {
      b.className = "filtro-btn";
    });
    btn.classList.add(`filtro-${filtroActivo}`);
    renderCalendario();
  });
});

// ─── Event delegation: grid del calendario ────────────────────────────────────
el("cal-grid").addEventListener("click", (ev) => {
  const evento = ev.target.closest("[data-id][data-tipo]");
  if (evento) { verDetalle(evento.dataset.id, evento.dataset.tipo); return; }
  const mas = ev.target.closest("[data-dia]");
  if (mas) verDia(+mas.dataset.dia, +mas.dataset.anio, +mas.dataset.mes);
});

// ─── Event delegation: lista de un día dentro del modal ───────────────────────
el("modal-detalle-contenido").addEventListener("click", (ev) => {
  const evento = ev.target.closest("[data-id][data-tipo]");
  if (evento) verDetalle(evento.dataset.id, evento.dataset.tipo);
});

// ─── Modal ────────────────────────────────────────────────────────────────────
el("modal-detalle-close").addEventListener("click", () => el("modal-detalle").classList.remove("open"));
el("modal-detalle").addEventListener("click", e => { if (e.target === el("modal-detalle")) el("modal-detalle").classList.remove("open"); });

// ─── Init ─────────────────────────────────────────────────────────────────────
// Espera a que auth.js confirme la sesión y termine de poblar sessionStorage
// antes de leer el usuario actual — evita que el filtro de visibilidad de
// reuniones descarte todo por leer un usuario vacío en una pestaña recién abierta.
(async () => {
  await esperarSesionLista();
  usuarioActual = getUsuarioActual();
  cargarEventos();
})();

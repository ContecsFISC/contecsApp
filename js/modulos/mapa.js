// =============================================
// CONTECS — Mapa del evento
// =============================================
// Integra la guía de salones (planos del Edificio 3) con Gestión de Eventos:
//   - Los salones (nombre, rótulo, capacidad) vienen de la colección `salones`.
//   - Las actividades son los checkpoints del evento, ubicados por `salonId`.
//   - Los asientos ocupados salen de las entradas de hoy (asistencias_congreso)
//     con la misma regla que la permanencia: alguien deja su asiento al entrar
//     a otra actividad o cuando un rol autorizado lo libera.
// La maqueta 3D vive en mapa3d.js; si no hay WebGL se usa la vista 2D.

import { app, db } from "../core/firebase-config.js";
import {
  collection, getDocs, onSnapshot, orderBy, query, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import { escaparAtributo, escaparHtml } from "../core/seguridad.js";
import { esperarSesionLista, usuarioTienePermiso } from "../core/auth.js";
import { PLANOS } from "../data/planos-edificio3.js";
import {
  enPanama, enCurso, estaCancelado, estaOperativo, minutosDeHora, ocupacionActual,
} from "../core/permanencia.js";
import {
  TIPOS_PROGRAMABLES, etiquetaSalon, nombrePiso, nombreSalon, rotuloSalon, salonDeCheckpoint,
} from "../core/agenda-salones.js";
import { escucharSalones, guardarSalon } from "../core/salones-firestore.js";
import { crearVista3D } from "./mapa3d.js";

const el = id => document.getElementById(id);
const h = escaparHtml;
const ejecutarOperacionQr = httpsCallable(getFunctions(app, "us-central1"), "ejecutarOperacionQr");
const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TIPOS = {
  congreso:    { nombre: "Acceso al congreso", color: "#00722e" },
  conferencia: { nombre: "Conferencia",        color: "#1565c0" },
  taller:      { nombre: "Taller",             color: "#e65100" },
  workshop:    { nombre: "Workshop",           color: "#ef6c00" },
  gira:        { nombre: "Gira",               color: "#283593" },
  panel:       { nombre: "Panel",              color: "#6a1b9a" },
  otro:        { nombre: "Otra actividad",     color: "#546e7a" },
};
const tipoDe = cp => TIPOS[cp?.tipo] || TIPOS.otro;
const COLOR_FIN = "#9aa3ad";
const COLOR_CANCELADO = "#e57373";
const MAX_ASIENTOS_DIBUJADOS = 600;

// Todos los espacios del plano por id.
const ESPACIOS = new Map(PLANOS.flatMap(p => p.espacios.map(e => [e.id, { ...e, piso: p.id }])));

const S = {
  salones: {}, eventos: [], evento: null, checkpoints: [], asistencias: [],
  dia: null, piso: PLANOS[0]?.id, sel: null, vista: "3d", gestor: false, liberar: false,
};
let vista3d = null;
let cancelarCheckpoints = null;
let cancelarAsistencias = null;
let estados = new Map();

// ─── Utilidades ─────────────────────────────────────────────────────────────
function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  clearTimeout(alerta.t);
  alerta.t = setTimeout(() => div.classList.remove("show"), 5000);
}

const fechaPanama = valor => {
  if (!valor) return null;
  const d = valor.toDate ? valor.toDate() : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : enPanama(d).dia;
};

function diasDelEvento(ev) {
  if (Array.isArray(ev?.diasEvento) && ev.diasEvento.length) return ev.diasEvento.map(d => d.fecha).filter(Boolean).sort();
  const ini = fechaPanama(ev?.fechaInicio);
  const fin = fechaPanama(ev?.fechaFin) || ini;
  if (!ini) return [];
  const dias = [];
  for (let d = new Date(`${ini}T12:00:00Z`); d.toISOString().slice(0, 10) <= fin && dias.length < 31; d.setUTCDate(d.getUTCDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
}

function etiquetaDia(dia) {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-PA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

const horaDe = ts => {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit", timeZone: "America/Panama" }) : "—";
};

// Un checkpoint terminó si su día pasó o ya pasó su hora de fin.
function terminado(cp, ahora) {
  if (!cp.dia) return false;
  if (cp.dia < ahora.dia) return true;
  if (cp.dia > ahora.dia) return false;
  const fin = minutosDeHora(cp.horaFin);
  return fin != null && ahora.minutos >= fin;
}

// ─── Estado de cada salón ───────────────────────────────────────────────────
function checkpointsPorSalon() {
  const mapa = new Map();
  for (const cp of S.checkpoints) {
    if (cp.dia !== S.dia) continue;
    const id = salonDeCheckpoint(cp, S.salones);
    if (!id || !ESPACIOS.has(id)) continue;
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push(cp);
  }
  mapa.forEach(lista => lista.sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || "")));
  return mapa;
}

function calcularEstados() {
  const ahora = enPanama();
  const ocupacion = ocupacionActual(S.asistencias, S.checkpoints);
  const porSalon = checkpointsPorSalon();
  const resultado = new Map();

  for (const [id, esp] of ESPACIOS) {
    if (!TIPOS_PROGRAMABLES.has(esp.t)) continue;
    const salon = S.salones[id];
    const cps = porSalon.get(id) || [];
    const activos = cps.filter(estaOperativo);
    const vivo = activos.find(cp => enCurso(cp, ahora));
    const rotulo = salon || cps.length ? rotuloSalon(id, salon) : null;
    let est;
    if (vivo) {
      const ocupados = ocupacion.get(vivo.id)?.length || 0;
      const capacidad = salon?.capacidad || 0;
      est = {
        estado: "vivo", color: tipoDe(vivo).color, rotulo,
        ratio: capacidad ? ocupados / capacidad : ocupados ? 0.5 : 0.03,
        chip: capacidad ? `EN VIVO · ${ocupados}/${capacidad}` : `EN VIVO · ${ocupados}`,
        titulo: `${nombreSalon(id, salon)}: ${vivo.nombre}`, vivo, ocupados, capacidad,
      };
    } else if (activos.length) {
      const pendientes = activos.filter(cp => !terminado(cp, ahora));
      est = pendientes.length
        ? { estado: "programado", color: tipoDe(pendientes[0]).color, rotulo, chip: pendientes[0].horaInicio || "", titulo: `${nombreSalon(id, salon)}: ${pendientes[0].nombre}` }
        : { estado: "finalizado", color: COLOR_FIN, rotulo, titulo: nombreSalon(id, salon) };
    } else if (cps.length) {
      est = { estado: "cancelado", color: COLOR_CANCELADO, rotulo, chip: "Cancelada", titulo: nombreSalon(id, salon) };
    } else {
      est = { estado: "libre", rotulo, titulo: nombreSalon(id, salon) };
    }
    resultado.set(id, est);
  }
  return resultado;
}

// ─── Render general ─────────────────────────────────────────────────────────
function render() {
  estados = calcularEstados();
  // Lo que se le pasa a la maqueta no lleva objetos de Firestore.
  const paraVista = new Map([...estados].map(([id, e]) => [id, {
    estado: e.estado, color: e.color, ratio: e.ratio, rotulo: e.rotulo, chip: e.chip, titulo: e.titulo,
  }]));
  vista3d?.actualizar(paraVista);
  if (S.vista === "2d") render2D();
  renderReloj();
  renderPanel();
}

function renderReloj() {
  const ahora = new Date();
  const enVivo = [...estados.values()].filter(e => e.estado === "vivo").length;
  el("reloj").classList.toggle("sin-vivo", !enVivo);
  el("reloj-texto").textContent = `${ahora.toLocaleString("es-PA", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Panama" })} · ${
    enVivo ? `${enVivo} en vivo` : S.dia === enPanama().dia ? "nada en vivo" : etiquetaDia(S.dia || enPanama().dia)}`;
}

function renderLeyenda() {
  const fila = (color, texto) => `<span><i style="background:${color}"></i>${h(texto)}</span>`;
  el("leyenda").innerHTML = [
    fila("#f7faf8", "Libre"),
    ...["conferencia", "taller", "panel", "congreso"].map(t => fila(TIPOS[t].color, TIPOS[t].nombre)),
    fila(COLOR_FIN, "Ya terminó"),
    fila(COLOR_CANCELADO, "Cancelada"),
    `<span style="margin-top:2px;color:var(--gris-medio)">En vivo: el cristal se llena con los asientos ocupados</span>`,
  ].join("");
}

// ─── Controles: evento, día, piso, vista ────────────────────────────────────
function renderDias() {
  const dias = diasDelEvento(S.evento);
  const hoy = enPanama().dia;
  el("dias").innerHTML = dias.length
    ? dias.map(d => `<button class="chip-btn" type="button" data-dia="${d}" aria-pressed="${d === S.dia}">${h(d === hoy ? "Hoy" : etiquetaDia(d))}</button>`).join("")
    : `<span class="chip-btn" aria-disabled="true">Sin días</span>`;
}

function renderPisos() {
  el("pisos").innerHTML = PLANOS.map(p =>
    `<button class="chip-btn" type="button" data-piso="${escaparAtributo(p.id)}" aria-pressed="${p.id === S.piso}">${h(p.nombre.replace(" piso", ""))}</button>`).join("");
}

el("dias").addEventListener("click", e => {
  const btn = e.target.closest("[data-dia]");
  if (!btn || btn.dataset.dia === S.dia) return;
  S.dia = btn.dataset.dia;
  renderDias();
  escucharAsistencias();
  render();
});

el("pisos").addEventListener("click", e => {
  const btn = e.target.closest("[data-piso]");
  if (btn) cambiarPiso(btn.dataset.piso);
});

function cambiarPiso(piso) {
  if (piso === S.piso) return;
  S.piso = piso;
  if (S.sel && ESPACIOS.get(S.sel)?.piso !== piso) cerrarPanel();
  renderPisos();
  vista3d?.mostrarPiso(piso);
  if (S.vista === "2d") { v2d = null; render2D(); }
}

el("btn-3d").addEventListener("click", () => cambiarVista("3d"));
el("btn-2d").addEventListener("click", () => cambiarVista("2d"));
el("btn-encuadre").addEventListener("click", () => {
  if (S.vista === "3d") vista3d?.reencuadrar();
  else { v2d = null; render2D(); }
});

function cambiarVista(vista) {
  if (vista === "3d" && !vista3d) { alerta("aviso", "Este equipo no puede mostrar la maqueta 3D; se usa la vista 2D."); vista = "2d"; }
  S.vista = vista;
  el("btn-3d").setAttribute("aria-pressed", String(vista === "3d"));
  el("btn-2d").setAttribute("aria-pressed", String(vista === "2d"));
  el("vista2d").classList.toggle("activa", vista === "2d");
  document.querySelectorAll(".mapa3d-lienzo, .mapa3d-etiquetas").forEach(n => { n.style.display = vista === "3d" ? "" : "none"; });
  vista3d?.pausar(vista !== "3d");
  if (vista === "2d") render2D();
}

el("sel-evento").addEventListener("change", () => {
  S.evento = S.eventos.find(ev => ev.id === el("sel-evento").value) || null;
  elegirDiaInicial();
  renderDias();
  escucharCheckpoints();
  escucharAsistencias();
});

function elegirDiaInicial() {
  const dias = diasDelEvento(S.evento);
  const hoy = enPanama().dia;
  S.dia = dias.includes(hoy) ? hoy : dias.find(d => d >= hoy) || dias[0] || hoy;
}

// ─── Vista 2D ───────────────────────────────────────────────────────────────
let v2d = null; // viewBox actual
function render2D() {
  const piso = PLANOS.find(p => p.id === S.piso);
  if (!piso) return;
  v2d ||= { x: 0, y: 0, w: piso.ancho, h: piso.alto };
  const textoSobre = color => {
    const m = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (!m) return false;
    const v = parseInt(m[1], 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) < 150;
  };
  el("vista2d").innerHTML = `<svg viewBox="${v2d.x} ${v2d.y} ${v2d.w} ${v2d.h}" role="img" aria-label="Plano del ${h(piso.nombre.toLowerCase())}">
    <image href="${piso.imagen}" width="${piso.ancho}" height="${piso.alto}" opacity="0.6"/>
    ${piso.espacios.map(e => {
      const prog = TIPOS_PROGRAMABLES.has(e.t);
      const est = estados.get(e.id);
      const relleno = !prog ? "rgba(0,0,0,0.05)" : est?.color || "rgba(255,255,255,0.75)";
      const opacidad = est?.estado === "vivo" ? 0.9 : est?.estado === "programado" ? 0.6 : 0.75;
      return `<polygon class="esp${prog ? " prog" : ""}${e.id === S.sel ? " sel" : ""}${est?.estado === "vivo" ? " vivo" : ""}" points="${e.p}" data-id="${escaparAtributo(e.id)}" fill="${relleno}" fill-opacity="${opacidad}"><title>${h(est?.titulo || "")}</title></polygon>`;
    }).join("")}
    ${piso.espacios.filter(e => estados.get(e.id)?.rotulo).map(e => {
      const est = estados.get(e.id);
      const texto = est.estado === "vivo" ? `${est.rotulo} · ${est.ocupados}${est.capacidad ? `/${est.capacidad}` : ""}` : est.rotulo;
      return `<text x="${e.l[0]}" y="${e.l[1]}" class="${est.color && textoSobre(est.color) && est.estado !== "programado" ? "claro" : ""}" font-size="${Math.max(e.fs, 10)}">${h(texto)}</text>`;
    }).join("")}
  </svg>`;
}

// Arrastrar mueve, la rueda acerca; un toque sin arrastre elige el salón.
(() => {
  const caja = el("vista2d");
  let arrastre = null;
  caja.addEventListener("pointerdown", e => {
    arrastre = { x: e.clientX, y: e.clientY, v: { ...v2d }, movio: false };
    caja.setPointerCapture(e.pointerId);
  });
  caja.addEventListener("pointermove", e => {
    if (!arrastre || !v2d) return;
    const r = caja.getBoundingClientRect();
    const escala = Math.max(v2d.w / r.width, v2d.h / r.height);
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (Math.hypot(dx, dy) > 5) arrastre.movio = true;
    if (!arrastre.movio) return;
    v2d.x = arrastre.v.x - dx * escala;
    v2d.y = arrastre.v.y - dy * escala;
    caja.querySelector("svg")?.setAttribute("viewBox", `${v2d.x} ${v2d.y} ${v2d.w} ${v2d.h}`);
  });
  caja.addEventListener("pointerup", e => {
    const movio = arrastre?.movio;
    arrastre = null;
    if (movio) return;
    const pol = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("polygon.prog");
    elegirSalon(pol ? pol.dataset.id : null);
  });
  caja.addEventListener("wheel", e => {
    if (!v2d) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const piso = PLANOS.find(p => p.id === S.piso);
    const w = Math.min(piso.ancho * 1.5, Math.max(piso.ancho / 8, v2d.w * factor));
    const ratio = w / v2d.w;
    v2d.x += (v2d.w - w) / 2;
    v2d.y += (v2d.h - v2d.h * ratio) / 2;
    v2d.w = w;
    v2d.h *= ratio;
    caja.querySelector("svg")?.setAttribute("viewBox", `${v2d.x} ${v2d.y} ${v2d.w} ${v2d.h}`);
  }, { passive: false });
})();

// ─── Panel del salón ────────────────────────────────────────────────────────
function elegirSalon(id) {
  if (!id || !ESPACIOS.has(id) || !TIPOS_PROGRAMABLES.has(ESPACIOS.get(id).t)) { cerrarPanel(); return; }
  // Al abrir un salón, sus asientos se llenan desde cero (efecto de entrada).
  if (id !== S.sel) [...asientosPrevios.keys()].filter(k => k.startsWith(`${id}|`)).forEach(k => asientosPrevios.delete(k));
  S.sel = id;
  const piso = ESPACIOS.get(id).piso;
  if (piso !== S.piso) cambiarPiso(piso);
  vista3d?.seleccionar(id);
  el("panel-salon").classList.add("abierto");
  el("panel-salon").setAttribute("aria-hidden", "false");
  renderPanel();
  if (S.vista === "2d") render2D();
}

function cerrarPanel() {
  S.sel = null;
  vista3d?.seleccionar(null);
  el("panel-salon").classList.remove("abierto");
  el("panel-salon").setAttribute("aria-hidden", "true");
  if (S.vista === "2d") render2D();
}

el("panel-cerrar").addEventListener("click", cerrarPanel);
document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarPanel(); });

// Asientos ya pintados por salón/actividad: solo se animan los que se llenan
// desde el último repintado (si no, cada actualización haría parpadear todo).
const asientosPrevios = new Map();

function htmlAsientos(capacidad, ocupados, color, clave = "") {
  if (!capacidad) return `<p class="vacio-mapa">Configura la capacidad del salón para ver sus asientos.</p>`;
  const porAsiento = Math.ceil(capacidad / MAX_ASIENTOS_DIBUJADOS);
  const total = Math.ceil(capacidad / porAsiento);
  const llenos = Math.min(total, Math.ceil(ocupados / porAsiento));
  const previos = Math.min(asientosPrevios.get(clave) ?? 0, llenos);
  asientosPrevios.set(clave, llenos);
  const asientos = Array.from({ length: total }, (_, i) => {
    if (i < previos) return `<span class="asiento ocupado"></span>`;
    if (i < llenos) return `<span class="asiento por-llenar" style="transition-delay:${reducido ? 0 : Math.min((i - previos) * 18, 900)}ms;"></span>`;
    return `<span class="asiento"></span>`;
  }).join("");
  return `<div class="asientos" style="--c:${color}" role="img" aria-label="${ocupados} de ${capacidad} asientos ocupados">${asientos}</div>
    ${porAsiento > 1 ? `<p class="asientos-nota">Cada cuadro representa ${porAsiento} asientos.</p>` : ""}`;
}

function renderPanel() {
  if (!S.sel) return;
  const id = S.sel;
  const esp = ESPACIOS.get(id);
  const salon = S.salones[id];
  const est = estados.get(id) || {};
  const cps = checkpointsPorSalon().get(id) || [];
  const ahora = enPanama();

  el("panel-rotulo").textContent = rotuloSalon(id, salon);
  el("panel-nombre").textContent = nombreSalon(id, salon);
  el("panel-meta").textContent = [
    nombrePiso(esp.piso),
    salon?.capacidad ? `Capacidad: ${salon.capacidad} personas` : "Sin capacidad configurada",
  ].join(" · ");

  const bloques = [];
  if (est.estado === "vivo") {
    const cp = est.vivo;
    const capacidad = est.capacidad;
    const libres = capacidad ? Math.max(0, capacidad - est.ocupados) : null;
    const pct = capacidad ? Math.min(100, Math.round(est.ocupados / capacidad * 100)) : 0;
    const presentes = (ocupacionActual(S.asistencias, S.checkpoints).get(cp.id) || [])
      .sort((a, b) => (b.marcadoEn?.toMillis?.() || 0) - (a.marcadoEn?.toMillis?.() || 0));
    bloques.push(`<section class="bloque">
      <h3>En vivo ahora</h3>
      <div class="vivo-titulo"><span class="badge-vivo">EN VIVO</span>${h(cp.nombre || "Actividad")}</div>
      <div class="panel-meta">${h(tipoDe(cp).nombre)} · ${h(cp.horaInicio || "")}–${h(cp.horaFin || "")}${cp.exponente ? ` · ${h(cp.exponente)}` : ""}</div>
      <div class="contadores">
        <div class="contador"><b>${est.ocupados}</b><span>Ocupados</span></div>
        <div class="contador libres"><b>${libres ?? "—"}</b><span>Disponibles</span></div>
        <div class="contador"><b>${capacidad || "—"}</b><span>Capacidad</span></div>
      </div>
      <div class="barra-ocup${pct >= 100 ? " llena" : ""}"><div style="width:${pct}%"></div></div>
      ${htmlAsientos(capacidad, est.ocupados, est.color, `${id}|${cp.id}`)}
      ${S.liberar ? `<h3 style="margin-top:12px;">Personas en el salón (${presentes.length})</h3>
        ${presentes.length ? `<ul class="presentes">${presentes.map(a => `<li>
          <span>${h(a.participanteNombre || a.participanteCodigo || "Participante")}<br><small>Entró ${h(horaDe(a.marcadoEn))}</small></span>
          <button class="btn-liberar" type="button" data-liberar="${escaparAtributo(`${a.participanteColeccion || "participantes"}|${a.participanteId}|${a.checkpointId}`)}">Liberar asiento</button>
        </li>`).join("")}</ul>` : `<p class="vacio-mapa">Todavía no hay entradas registradas.</p>`}` : ""}
    </section>`);
  } else if (salon?.capacidad) {
    bloques.push(`<section class="bloque">
      <h3>Asientos</h3>
      <p class="vacio-mapa" style="margin:0 0 10px;">${est.estado === "programado" ? `Sin actividad en este momento. La próxima empieza a las ${h(est.chip || "—")}.` : "Sin actividad en este momento."}</p>
      ${htmlAsientos(salon.capacidad, 0, "#00722e", `${id}|libre`)}
    </section>`);
  }

  bloques.push(`<section class="bloque">
    <h3>Actividades · ${h(S.dia === ahora.dia ? "hoy" : etiquetaDia(S.dia))}</h3>
    ${cps.length ? `<ul class="acts">${cps.map(cp => {
      const cancelada = estaCancelado(cp);
      const vivo = !cancelada && enCurso(cp, ahora);
      const fin = !cancelada && !vivo && terminado(cp, ahora);
      return `<li class="${cancelada ? "cancelada" : ""}${fin ? " fin" : ""}" style="--c:${cancelada ? COLOR_CANCELADO : fin ? COLOR_FIN : tipoDe(cp).color}">
        <span class="hora">${h(cp.horaInicio || "—")}<br>${h(cp.horaFin || "")}</span>
        <span><span class="titulo">${h(cp.nombre || "Actividad")}${vivo ? `<span class="estado-act vivo">EN VIVO</span>` : ""}${cancelada ? `<span class="estado-act cancelada">Cancelada</span>` : ""}${cp.activo === false ? `<span class="estado-act cancelada">Desactivada</span>` : ""}</span>
        <span class="det">${h(tipoDe(cp).nombre)}${cp.titulo ? ` · ${h(cp.titulo)}` : ""}${cp.exponente ? ` · ${h(cp.exponente)}` : ""}</span></span>
      </li>`;
    }).join("")}</ul>` : `<p class="vacio-mapa">No hay actividades en este salón ese día.</p>`}
  </section>`);

  if (S.gestor) {
    bloques.push(`<section class="bloque">
      <h3>Configurar salón</h3>
      <form class="form-salon" id="form-salon" novalidate>
        <label>Nombre que verán los asistentes<input id="fs-nombre" maxlength="100" value="${escaparAtributo(salon?.nombre || "")}" placeholder="${escaparAtributo(nombreSalon(id))}"/></label>
        <div class="fila">
          <label>Rótulo en el plano<input id="fs-rotulo" maxlength="7" value="${escaparAtributo(salon?.rotulo || "")}" placeholder="${escaparAtributo(esp.n || "")}"/></label>
          <label>Capacidad<input id="fs-capacidad" type="number" min="1" inputmode="numeric" value="${escaparAtributo(salon?.capacidad || "")}"/></label>
        </div>
        <button class="btn btn-primary btn-sm" type="submit">Guardar salón</button>
      </form>
    </section>`);
  }

  // No se repinta el formulario mientras alguien escribe en él.
  const activo = document.activeElement;
  if (activo?.closest?.("#form-salon")) {
    const cuerpo = el("panel-cuerpo");
    const form = el("form-salon").closest(".bloque");
    const temp = document.createElement("div");
    temp.innerHTML = bloques.slice(0, -1).join("");
    [...cuerpo.children].forEach(n => { if (n !== form) n.remove(); });
    cuerpo.prepend(...temp.children);
  } else {
    el("panel-cuerpo").innerHTML = bloques.join("");
  }
  // Los asientos nuevos se pintan en el cuadro siguiente para que se vea cómo se llenan.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el("panel-cuerpo").querySelectorAll(".asiento.por-llenar").forEach(a => a.classList.replace("por-llenar", "ocupado"));
  }));
}

el("panel-cuerpo").addEventListener("submit", async e => {
  if (e.target.id !== "form-salon") return;
  e.preventDefault();
  const id = S.sel;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await guardarSalon({
      espacioId: id,
      nombre: el("fs-nombre").value.trim() || el("fs-nombre").placeholder,
      rotulo: el("fs-rotulo").value.trim(),
      capacidad: parseInt(el("fs-capacidad").value),
    });
    document.activeElement?.blur?.();
    alerta("success", "Salón guardado.");
  } catch (err) {
    alerta("error", err.message);
  } finally {
    btn.disabled = false;
  }
});

el("panel-cuerpo").addEventListener("click", async e => {
  const btn = e.target.closest("[data-liberar]");
  if (!btn || !S.liberar) return;
  const [coleccion, participanteId, checkpointId] = btn.dataset.liberar.split("|");
  const nombre = btn.closest("li")?.querySelector("span")?.firstChild?.textContent || "esta persona";
  if (!confirm(`¿Liberar el asiento de ${nombre}? Se registra que salió ahora y deja de contar su tiempo en esta actividad.`)) return;
  btn.disabled = true;
  btn.textContent = "Liberando…";
  try {
    await ejecutarOperacionQr({ tipo: "liberar_asiento", participanteId, checkpointId, coleccion });
    alerta("success", `Asiento de ${nombre} liberado.`);
  } catch (err) {
    alerta("error", err.message || "No se pudo liberar el asiento.");
    btn.disabled = false;
    btn.textContent = "Liberar asiento";
  }
});

// ─── Datos en vivo ──────────────────────────────────────────────────────────
function escucharCheckpoints() {
  cancelarCheckpoints?.();
  S.checkpoints = [];
  if (!S.evento) { render(); return; }
  cancelarCheckpoints = onSnapshot(
    query(collection(db, "checkpoints"), where("eventoId", "==", S.evento.id)),
    snap => { S.checkpoints = snap.docs.map(d => ({ id: d.id, ...d.data() })); render(); },
    e => { console.error("Mapa: checkpoints:", e); alerta("error", "No se pudieron cargar las actividades."); },
  );
}

// Los asientos solo importan "en ese momento": se escuchan las entradas de
// hoy y solo cuando se mira el día de hoy.
function escucharAsistencias() {
  cancelarAsistencias?.();
  cancelarAsistencias = null;
  S.asistencias = [];
  if (!S.evento || S.dia !== enPanama().dia) { render(); return; }
  cancelarAsistencias = onSnapshot(
    query(collection(db, "asistencias_congreso"), where("checkpointDia", "==", S.dia)),
    snap => {
      S.asistencias = snap.docs.map(d => d.data()).filter(a => a.eventoId === S.evento?.id);
      render();
    },
    e => { console.error("Mapa: asistencias:", e); alerta("error", "No se pudieron cargar los asientos ocupados."); },
  );
}

async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc")));
  S.eventos = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(estaOperativo);
  const hoy = enPanama().dia;
  // Primero el evento de hoy; si no, el próximo; si no, el más reciente.
  S.evento = S.eventos.find(ev => diasDelEvento(ev).includes(hoy))
    || [...S.eventos].filter(ev => (diasDelEvento(ev)[0] || "") >= hoy).sort((a, b) => diasDelEvento(a)[0].localeCompare(diasDelEvento(b)[0]))[0]
    || S.eventos[0] || null;
  el("sel-evento").innerHTML = S.eventos.length
    ? S.eventos.map(ev => `<option value="${escaparAtributo(ev.id)}">${h(ev.nombre || "Evento")}</option>`).join("")
    : `<option value="">Sin eventos activos</option>`;
  if (S.evento) el("sel-evento").value = S.evento.id;
  elegirDiaInicial();
  renderDias();
  escucharCheckpoints();
  escucharAsistencias();
}

// ─── Inicio ─────────────────────────────────────────────────────────────────
function ajustarAlto() {
  document.documentElement.style.setProperty("--alto-topbar", `${el("topbar").offsetHeight}px`);
}
window.addEventListener("resize", ajustarAlto);
ajustarAlto();

async function iniciar() {
  await esperarSesionLista();
  S.gestor = usuarioTienePermiso("gestionar_inscripciones");
  S.liberar = usuarioTienePermiso("liberar_asiento");
  renderLeyenda();
  renderPisos();

  vista3d = await crearVista3D(el("escenario-mapa"), { planos: PLANOS, alElegir: elegirSalon, reducido });
  el("cargando-mapa").hidden = true;
  if (vista3d) {
    vista3d.mostrarPiso(S.piso);
    cambiarVista("3d");
  } else {
    el("btn-3d").disabled = true;
    cambiarVista("2d");
  }

  escucharSalones(salones => { S.salones = salones; render(); }, e => console.error("Mapa: salones:", e));
  await cargarEventos();

  // ?salon=3-73 abre ese salón (enlace desde Gestión de Eventos → Salones).
  const pedido = new URLSearchParams(location.search).get("salon");
  if (pedido && ESPACIOS.has(pedido)) setTimeout(() => elegirSalon(pedido), reducido ? 0 : 1500);

  // Lo "en vivo" cambia con la hora: se recalcula cada 30 s.
  setInterval(() => {
    if (S.dia && S.evento && cancelarAsistencias === null && S.dia === enPanama().dia) escucharAsistencias();
    render();
  }, 30000);
}

iniciar().catch(e => {
  console.error("Mapa del evento:", e);
  el("cargando-mapa").textContent = "No se pudo cargar el mapa. Recarga la página.";
});
window.addEventListener("pagehide", () => { cancelarCheckpoints?.(); cancelarAsistencias?.(); vista3d?.destruir(); });

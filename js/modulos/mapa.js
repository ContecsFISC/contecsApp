// =============================================
// CONTECS — Mapa del evento
// =============================================
// Integra la guía de salones (planos del Edificio 3) con Gestión de Eventos:
//   - Los salones (nombre, rótulo, capacidad) vienen de la colección `salones`.
//   - Las actividades son los checkpoints del evento, ubicados por `salonId`.
//   - Los asientos ocupados salen de las entradas de hoy (asistencias_congreso)
//     con la misma regla que la permanencia: alguien deja su asiento al entrar
//     a otra actividad o cuando un rol autorizado lo libera.
//   - También salen las actividades de voluntariado a las que se les eligió
//     un salón (voluntariado/actividades.html), sin asientos: no pasan por
//     Lectura QR.
//   - El panel muestra la agenda del evento (como la guía de salones) o el
//     detalle de un salón; tocar una actividad la ubica en el mapa.
// La maqueta 3D vive en mapa3d.js; si no hay WebGL se usa la vista 2D.
//
// Modo público (public/mapa.html, el QR del congreso; <body data-publico="1">):
// sin iniciar sesión. Los datos vienen de la Cloud Function mapaPublico
// (agenda, salones y asientos ocupados en conteos, sin nombres) y no hay nada
// del staff: ni configurar salones, ni liberar asientos, ni voluntariado.

import { app, db } from "../core/firebase-config.js";
import {
  collection, getDocs, onSnapshot, orderBy, query, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import { escaparAtributo, escaparHtml } from "../core/seguridad.js";
import { aplicarPermisosDom, esperarSesionLista, getUsuarioActual, usuarioTienePermiso } from "../core/auth.js";
import { PLANOS } from "../data/planos-edificio3.js";
import {
  enPanama, enCurso, estaCancelado, estaOperativo, minutosDeHora, ocupacionActual,
} from "../core/permanencia.js";
import {
  ROTULO_MAX, TIPOS_PROGRAMABLES, esSalonCafe, etiquetaSalon, letraRotulo, nombrePiso, nombreSalon, rotuloSalon, salonDeCheckpoint,
} from "../core/agenda-salones.js";
import { escucharSalones, guardarSalon } from "../core/salones-firestore.js";
import { crearVista3D } from "./mapa3d.js?v=20261017.2";

const el = id => document.getElementById(id);
const PUBLICO = document.body.dataset.publico === "1";
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
  voluntariado: { nombre: "Voluntariado",      color: "#00897b" },
  otro:        { nombre: "Otra actividad",     color: "#546e7a" },
};
const tipoDe = cp => TIPOS[cp?.tipo] || TIPOS.otro;
const COLOR_FIN = "#9aa3ad";
const COLOR_CANCELADO = "#e57373";
const MAX_ASIENTOS_DIBUJADOS = 600;

// ─── Charla en curso: verde al empezar, amarillo a la mitad, rojo al final ──
// Los últimos MINUTOS_CIERRE el salón queda en rojo: está por terminar y
// esperando a la siguiente.
const MINUTOS_CIERRE = 10;
const RGB_VERDE = [22, 163, 74];
const RGB_AMARILLO = [234, 179, 8];
const RGB_NARANJA = [234, 88, 12];
const RGB_ROJO = [220, 38, 38];
const hex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mezclar = (a, b, p) => a.map((v, i) => v + (b[i] - v) * p);

function avanceCharla(cp, ahora) {
  const ini = minutosDeHora(cp.horaInicio);
  const fin = minutosDeHora(cp.horaFin);
  if (ini == null || fin == null || fin <= ini) return null;
  const restan = fin - ahora.minutos;
  const p = Math.max(0, Math.min(1, (ahora.minutos - ini) / Math.max(1, fin - ini - MINUTOS_CIERRE)));
  const cierre = restan <= MINUTOS_CIERRE;
  const color = cierre ? hex(RGB_ROJO)
    : p < 0.5 ? hex(mezclar(RGB_VERDE, RGB_AMARILLO, p * 2))
      : hex(mezclar(RGB_AMARILLO, RGB_NARANJA, (p - 0.5) * 2));
  return { color, restan: Math.max(0, restan), pct: Math.round(Math.max(0, Math.min(1, (ahora.minutos - ini) / (fin - ini))) * 100), cierre };
}

// Fotos y logos: una URL completa o una ruta del sitio (img/charlas/...).
const RAIZ_SITIO = new URL("../../", import.meta.url);
function imagenDe(ruta) {
  const r = String(ruta || "").trim();
  if (!r) return "";
  if (/^https:\/\//i.test(r)) return r;
  if (/^[a-z]+:/i.test(r)) return ""; // ni http ni data: ni javascript:
  return new URL(r.replace(/^\/+/, ""), RAIZ_SITIO).href;
}
const iniciales = nombre => String(nombre || "").split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "?";
const temasDe = cp => (Array.isArray(cp?.temas) ? cp.temas.filter(t => typeof t === "string" && t.trim()).map(t => t.trim()) : []);

// Todos los espacios del plano por id.
const ESPACIOS = new Map(PLANOS.flatMap(p => p.espacios.map(e => [e.id, { ...e, piso: p.id }])));

// Punto del marcador "Estás aquí" dentro del espacio: centrado y a media
// distancia del borde inferior, para no tapar la etiqueta del salón.
function puntoAqui(esp) {
  const [x1, y1, x2, y2] = esp.b;
  return [(x1 + x2) / 2, (y1 + y2) / 2 + (y2 - y1) / 4];
}

const S = {
  salones: {}, eventos: [], evento: null, checkpoints: [], asistencias: [], voluntariado: [],
  dia: null, piso: PLANOS[0]?.id, sel: null, vista: "3d", gestor: false, liberar: false,
  // ?aqui=<espacio>: dónde está quien escaneó el QR pegado en el edificio.
  aqui: null,
  // Modo público: todas las actividades publicadas y asientos ocupados por checkpoint.
  todosCheckpoints: [], ocupacionPublica: {},
  // Panel: "cerrado", "agenda" o "salon". destacado = actividad elegida en la agenda.
  panel: "cerrado", destacado: null,
  filtro: { tipo: "todo", tema: "todo", dia: "todo", ahora: false, ocultarFin: false, q: [] },
  // checkpointId -> asientos apartados por reserva (reservas_conteo / mapaPublico).
  reservas: {},
  // Pantalla grande del congreso (rol Modelado): sin barra y vuelve sola al inicio.
  kiosco: false,
};
const FILTRO_VACIO = () => ({ tipo: "todo", tema: "todo", dia: "todo", ahora: false, ocultarFin: false, q: [] });
let vista3d = null;
let cancelarCheckpoints = null;
let cancelarAsistencias = null;
let cancelarVoluntariado = null;
let cancelarReservas = null;
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
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
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

// ─── Actividades de voluntariado con salón ──────────────────────────────────
// Se convierten a la forma de un checkpoint (dia, horaInicio, horaFin,
// salonId) para usar la misma agenda y los mismos estados. Su horario es el
// de la actividad o, si no tiene, el de sus turnos; sin ninguno, todo el día.
function actividadVoluntariado(a) {
  const turnos = (a.turnos || []).filter(t => minutosDeHora(t.horaInicio) != null && minutosDeHora(t.horaFin) != null);
  return {
    id: `vol:${a.id}`, origen: "voluntariado", tipo: "voluntariado",
    nombre: a.nombre, titulo: a.area || "", salonId: a.salonId, salon: a.lugar || "",
    dia: fechaPanama(a.fecha),
    horaInicio: a.horaInicio || turnos.map(t => t.horaInicio).sort()[0] || null,
    horaFin: a.horaFin || turnos.map(t => t.horaFin).sort().at(-1) || null,
    activo: a.activo,
  };
}

// Las de voluntariado cuentan desde hoy en adelante, o si caen en un día del
// evento (las pasadas no tienen nada que mostrar en el mapa).
function voluntariadoVisible() {
  const hoy = enPanama().dia;
  const diasEvento = diasDelEvento(S.evento);
  return S.voluntariado.filter(a => a.dia && (a.dia >= hoy || diasEvento.includes(a.dia)));
}

// Todo lo que muestra el mapa: checkpoints del evento + voluntariado.
const actividadesMapa = () => [...S.checkpoints, ...voluntariadoVisible()];

// Días del selector: los del evento y los de las actividades de voluntariado.
function diasDelMapa() {
  return [...new Set([...diasDelEvento(S.evento), ...voluntariadoVisible().map(a => a.dia)])].sort();
}

// ─── Estado de cada salón ───────────────────────────────────────────────────
function checkpointsPorSalon() {
  const mapa = new Map();
  for (const cp of actividadesMapa()) {
    if (cp.dia !== S.dia) continue;
    const id = salonDeCheckpoint(cp, S.salones);
    if (!id || !ESPACIOS.has(id)) continue;
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push(cp);
  }
  mapa.forEach(lista => lista.sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || "")));
  return mapa;
}

// asistencias_congreso lleva cédula y correo: solo la leen quienes pueden
// (puedeVerAsistenciasCongreso() en firestore.rules). El resto ve los asientos
// con los conteos de mapaPublico, igual que el mapa público.
function puedeVerPresentes() {
  return ["ver_participantes", "gestionar_inscripciones", "lectura_qr", "ver_estadisticas_congreso", "liberar_asiento"]
    .some(usuarioTienePermiso);
}

// checkpointId -> personas dentro ahora. En modo público (o sin permiso para
// ver quién entró) llega contado.
function ocupadosPorCheckpoint() {
  if (PUBLICO || !S.verPresentes) return new Map(Object.entries(S.ocupacionPublica || {}));
  return new Map([...ocupacionActual(S.asistencias, S.checkpoints)].map(([id, lista]) => [id, lista.length]));
}

function calcularEstados() {
  const ahora = enPanama();
  const ocupacion = ocupadosPorCheckpoint();
  const porSalon = checkpointsPorSalon();
  const coinciden = salonesQueCoinciden(ahora);
  const resultado = new Map();

  for (const [id, esp] of ESPACIOS) {
    if (!TIPOS_PROGRAMABLES.has(esp.t)) continue;
    const salon = S.salones[id];
    const cps = porSalon.get(id) || [];
    const activos = cps.filter(estaOperativo);
    const vivo = activos.find(cp => !cp.origen && enCurso(cp, ahora)) || activos.find(cp => enCurso(cp, ahora));
    const rotulo = salon || cps.length ? rotuloSalon(id, salon) : null;
    let est;
    if (vivo?.origen === "voluntariado") {
      est = {
        estado: "vivo", color: tipoDe(vivo).color, rotulo, ratio: 0.35,
        chip: "EN VIVO · Voluntariado", titulo: `${nombreSalon(id, salon)}: ${vivo.nombre}`, vivo,
      };
    } else if (vivo) {
      const ocupados = ocupacion.get(vivo.id) || 0;
      const capacidad = salon?.capacidad || 0;
      // El color dice cuánto lleva la charla (no el tipo): verde, amarillo, rojo.
      const avance = avanceCharla(vivo, ahora);
      const etiqueta = avance?.cierre ? "POR TERMINAR" : "EN VIVO";
      est = {
        estado: "vivo", color: avance?.color || tipoDe(vivo).color, rotulo,
        ratio: capacidad ? ocupados / capacidad : ocupados ? 0.5 : 0.03,
        chip: capacidad ? `${etiqueta} · ${ocupados}/${capacidad}` : `${etiqueta} · ${ocupados}`,
        titulo: `${nombreSalon(id, salon)}: ${vivo.nombre}`, vivo, ocupados, capacidad, avance,
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
    const lobby = enLobby(id);
    if (lobby) {
      est.icono = lobby.icono;
      est.titulo = `${est.titulo} · ${lobby.texto}`;
    } else if (esSalonCafe(salon)) est.icono = "cafe";
    if (coinciden) {
      est.atenuado = !coinciden.has(id);
      est.resaltado = coinciden.has(id);
    }
    resultado.set(id, est);
  }
  return resultado;
}

// Con filtros en la agenda (tema, tipo, búsqueda...), los salones del día del
// mapa que tienen alguna actividad que coincide; null sin filtros.
function salonesQueCoinciden(ahora) {
  if (!filtrosActivos()) return null;
  const ids = new Set();
  for (const cp of actividadesMapa()) {
    if (cp.dia !== S.dia || !coincideFiltro(cp, ahora)) continue;
    const id = lugarDe(cp);
    if (id) ids.add(id);
  }
  return ids;
}

// ─── Render general ─────────────────────────────────────────────────────────
// Lo que llega en vivo (cada escaneo del congreso, reservas...) se junta: el
// mapa se recalcula como mucho una vez cada RENDER_VIVO_MS, no una vez por
// escaneo (con cientos de entradas por minuto trababa el equipo).
const RENDER_VIVO_MS = 1500;
let ultimoRender = 0;
let renderPendiente = null;
function renderPronto() {
  if (renderPendiente) return;
  const espera = Math.max(0, RENDER_VIVO_MS - (performance.now() - ultimoRender));
  renderPendiente = setTimeout(() => { renderPendiente = null; render(); }, espera);
}

function render() {
  ultimoRender = performance.now();
  if (renderPendiente) { clearTimeout(renderPendiente); renderPendiente = null; }
  estados = calcularEstados();
  // Lo que se le pasa a la maqueta no lleva objetos de Firestore.
  const paraVista = new Map([...estados].map(([id, e]) => [id, {
    estado: e.estado, color: e.color, ratio: e.ratio, rotulo: e.rotulo, chip: e.chip, titulo: e.titulo, icono: e.icono,
    atenuado: e.atenuado, resaltado: e.resaltado,
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
    ...["conferencia", "taller", "panel", "congreso", ...(PUBLICO ? [] : ["voluntariado"])].map(t => fila(TIPOS[t].color, TIPOS[t].nombre)),
    fila(COLOR_FIN, "Ya terminó"),
    fila(COLOR_CANCELADO, "Cancelada"),
    `<span style="margin-top:4px;font-weight:700">En vivo</span>`,
    `<span><i style="background:linear-gradient(90deg,${hex(RGB_VERDE)},${hex(RGB_AMARILLO)},${hex(RGB_NARANJA)})"></i>Empezando → a la mitad</span>`,
    fila(hex(RGB_ROJO), `Últimos ${MINUTOS_CIERRE} min`),
    `<span style="color:var(--gris-medio)">El cristal se llena con los asientos ocupados</span>`,
  ].join("");
}

// ─── Controles: evento, día, piso, vista ────────────────────────────────────
function renderDias() {
  const dias = diasDelMapa();
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
  if (S.sel && ESPACIOS.get(S.sel)?.piso !== piso) esAncho() ? volverAgenda() : cerrarPanel();
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

// "Mi ubicación": lleva al piso del QR; si ya está en él, acerca al marcador.
el("btn-aqui")?.addEventListener("click", () => {
  const aqui = ESPACIOS.get(S.aqui);
  if (!aqui) return;
  if (aqui.piso !== S.piso) { cambiarPiso(aqui.piso); return; }
  if (S.vista === "3d") { vista3d?.enfocarAqui(); return; }
  const piso = PLANOS.find(p => p.id === aqui.piso);
  const w = piso.ancho / 3, alto = w * piso.alto / piso.ancho;
  const [x, y] = puntoAqui(aqui);
  v2d = { x: x - w / 2, y: y - alto / 2, w, h: alto };
  render2D();
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

// "Gestionar actividades" abre Gestión de Evento en el evento que se ve.
function actualizarEnlaceGestion() {
  if (!el("btn-gestionar")) return;
  el("btn-gestionar").href = S.evento ? `inscripciones.html?evento=${encodeURIComponent(S.evento.id)}` : "inscripciones.html";
}

el("sel-evento").addEventListener("change", () => {
  S.evento = S.eventos.find(ev => ev.id === el("sel-evento").value) || null;
  S.filtro.dia = "todo";
  actualizarEnlaceGestion();
  elegirDiaInicial();
  renderDias();
  if (PUBLICO) {
    S.checkpoints = S.todosCheckpoints.filter(cp => cp.eventoId === S.evento?.id);
    render();
    return;
  }
  escucharCheckpoints();
  escucharAsistencias();
});

function elegirDiaInicial() {
  const dias = diasDelMapa();
  const hoy = enPanama().dia;
  S.dia = dias.includes(hoy) ? hoy : dias.find(d => d >= hoy) || dias[0] || hoy;
}

// ─── Vista 2D ───────────────────────────────────────────────────────────────
// Señal de baño (hombre | mujer) que va encima de cada baño, en 3D (mapa3d.js) y en 2D.
const ICONO_BANO = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect width="24" height="24" rx="5" fill="#1565c0"/>
  <g fill="#fff">
    <circle cx="7" cy="5" r="2"/><rect x="4.6" y="7.8" width="4.8" height="7" rx="1.2"/><rect x="5.1" y="13.5" width="3.8" height="7" rx="0.8"/>
    <rect x="11.4" y="3.5" width="1.2" height="17" rx="0.6" opacity="0.8"/>
    <circle cx="17" cy="5" r="2"/><path d="M17 7.8c-1.1 0-1.7.6-2 1.6L13.4 16h7.2L19 9.4c-.3-1-.9-1.6-2-1.6z"/><rect x="15.4" y="15.5" width="3.2" height="5" rx="0.8"/>
  </g>
</svg>`;

// Taza de café para los salones de coffee break (esSalonCafe), encima del
// rótulo en 2D y dentro de la etiqueta en 3D.
const ICONO_CAFE = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect width="24" height="24" rx="6" fill="#7a4428"/>
  <rect width="24" height="12" rx="6" fill="#ffffff" opacity="0.08"/>
  <g fill="none" stroke="#ffe2bd" stroke-width="1.4" stroke-linecap="round">
    <path d="M9 3.4c-1 1 1 1.9 0 2.9s1 1.9 0 2.9"/><path d="M12.6 3.4c-1 1 1 1.9 0 2.9s1 1.9 0 2.9"/>
  </g>
  <path fill="#fff" d="M4.8 11h11.4v3.6a4.6 4.6 0 0 1-4.6 4.6H9.4a4.6 4.6 0 0 1-4.6-4.6z"/>
  <path fill="none" stroke="#fff" stroke-width="1.7" d="M16.2 12.3h1.1a2.1 2.1 0 0 1 0 4.2h-1.6"/>
  <rect x="3.6" y="19.8" width="13.8" height="1.5" rx="0.75" fill="#ffe2bd"/>
</svg>`;

// Stand de patrocinadores: toldo a rayas sobre un mostrador.
const ICONO_PATROCINADORES = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect width="24" height="24" rx="6" fill="#9a6a12"/>
  <rect width="24" height="12" rx="6" fill="#ffffff" opacity="0.08"/>
  <path fill="#fff" d="M4 5h16l1 4H3z"/>
  <path fill="#f6c453" d="M7.2 5h3.2l-.4 4H6.4zM13.6 5h3.2l.8 4h-3.2z"/>
  <path fill="#fff" d="M3 9h18v.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" opacity="0.85"/>
  <rect x="5" y="11.8" width="1.4" height="5" fill="#fff"/><rect x="17.6" y="11.8" width="1.4" height="5" fill="#fff"/>
  <rect x="4" y="16.4" width="16" height="4.2" rx="1" fill="#fff"/>
  <circle cx="12" cy="18.5" r="1.3" fill="#f6c453"/>
</svg>`;

// Feria de infografías: hoja con gráfico de barras y de torta.
const ICONO_INFOGRAFIAS = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect width="24" height="24" rx="6" fill="#6a3d9a"/>
  <rect width="24" height="12" rx="6" fill="#ffffff" opacity="0.08"/>
  <rect x="5" y="3.5" width="14" height="17" rx="1.6" fill="#fff"/>
  <circle cx="12" cy="9" r="3.4" fill="#6a3d9a"/>
  <path fill="#f2a541" d="M12 9V5.6A3.4 3.4 0 0 1 15.4 9z"/>
  <rect x="7.2" y="14.8" width="2" height="3.6" rx="0.4" fill="#f2a541"/>
  <rect x="10.6" y="12.6" width="2" height="5.8" rx="0.4" fill="#6a3d9a"/>
  <rect x="14" y="13.8" width="2" height="4.6" rx="0.4" fill="#2bb3a3"/>
</svg>`;

// Feria de pósters: póster sobre un caballete.
const ICONO_POSTERS = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect width="24" height="24" rx="6" fill="#00727a"/>
  <rect width="24" height="12" rx="6" fill="#ffffff" opacity="0.08"/>
  <g stroke="#fff" stroke-width="1.5" stroke-linecap="round"><path d="M12 2.8v2M8.6 16.6 6.4 21.2M15.4 16.6l2.2 4.6M12 16.6v4"/></g>
  <rect x="5" y="4.6" width="14" height="12" rx="1.2" fill="#fff"/>
  <rect x="7" y="6.6" width="10" height="2" rx="0.6" fill="#00727a"/>
  <rect x="7" y="9.8" width="4.4" height="4.8" rx="0.6" fill="#7fd6cf"/>
  <rect x="12.6" y="9.8" width="4.4" height="1.2" rx="0.6" fill="#9bb5b7"/>
  <rect x="12.6" y="12" width="4.4" height="1.2" rx="0.6" fill="#9bb5b7"/>
  <rect x="12.6" y="14.1" width="3" height="0.5" rx="0.25" fill="#9bb5b7"/>
</svg>`;

const ICONOS = { cafe: ICONO_CAFE, patrocinadores: ICONO_PATROCINADORES, infografias: ICONO_INFOGRAFIAS, posters: ICONO_POSTERS };

// Lo que hay en los lobbies durante el congreso (todo el día, sin checkpoint):
// lleva su icono encima, como la taza del coffee break.
const EN_LOBBY = {
  "2-1": [{ dias: ["2026-10-19", "2026-10-20"], icono: "patrocinadores", texto: "Stand de patrocinadores" }],
  "3-1": [
    { dias: ["2026-10-19"], icono: "infografias", texto: "Feria de infografías" },
    { dias: ["2026-10-20"], icono: "posters", texto: "Feria de pósters" },
  ],
};
const enLobby = id => (EN_LOBBY[id] || []).find(x => x.dias.includes(S.dia)) || null;

let v2d = null; // viewBox actual
function render2D() {
  const piso = PLANOS.find(p => p.id === S.piso);
  if (!piso) return;
  v2d ||= { x: 0, y: 0, w: piso.ancho, h: piso.alto };
  const aqui = ESPACIOS.get(S.aqui);
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
      const opacidad = est?.atenuado ? 0.18 : est?.estado === "vivo" ? 0.9 : est?.estado === "programado" ? 0.6 : 0.75;
      return `<polygon class="esp${prog ? " prog" : ""}${e.id === S.sel ? " sel" : ""}${est?.estado === "vivo" ? " vivo" : ""}" points="${e.p}" data-id="${escaparAtributo(e.id)}" fill="${relleno}" fill-opacity="${opacidad}"><title>${h(est?.titulo || "")}</title></polygon>`;
    }).join("")}
    ${piso.espacios.filter(e => estados.get(e.id)?.rotulo).map(e => {
      const est = estados.get(e.id);
      const texto = est.estado === "vivo" ? `${est.rotulo} · ${est.ocupados}${est.capacidad ? `/${est.capacidad}` : ""}` : est.rotulo;
      return `<text x="${e.l[0]}" y="${e.l[1]}" class="${est.color && textoSobre(est.color) && est.estado !== "programado" ? "claro" : ""}" font-size="${letraRotulo(e, texto, 10)}">${h(texto)}</text>`;
    }).join("")}
    ${piso.espacios.filter(e => ICONOS[estados.get(e.id)?.icono]).map(e => {
      // Encima del rótulo, sin salirse del espacio.
      const est = estados.get(e.id);
      const lado = Math.min(26, (e.b[2] - e.b[0]) * 0.45, (e.b[3] - e.b[1]) * 0.4);
      const y = Math.max(e.b[1] + 2, e.l[1] - letraRotulo(e, est.rotulo || "", 10) / 2 - 4 - lado);
      return ICONOS[est.icono].replace("<svg ", `<svg class="icono2d" x="${e.l[0] - lado / 2}" y="${y}" width="${lado}" height="${lado}" `);
    }).join("")}
    ${piso.espacios.filter(e => e.t === "bano").map(e => {
      const [x, y] = e.l || [(e.b[0] + e.b[2]) / 2, (e.b[1] + e.b[3]) / 2];
      return ICONO_BANO.replace("<svg ", `<svg class="bano2d" x="${x - 11}" y="${y - 11}" width="22" height="22" `);
    }).join("")}
    ${aqui?.piso === piso.id ? `<g class="aqui2d" transform="translate(${puntoAqui(aqui).join(" ")})">
      <circle class="onda" r="16"/><circle class="centro" r="9"/><text y="26">Estás aquí</text>
    </g>` : ""}
  </svg>`;
}

// Un dedo (o el ratón) mueve, dos dedos pellizcan para acercar, la rueda
// acerca; un toque sin arrastre elige el salón.
(() => {
  const caja = el("vista2d");
  const dedos = new Map(); // pointerId -> { x, y }
  let arrastre = null;
  let pinza = null;
  let multitoque = false; // el gesto usó dos dedos: al soltar no es un toque
  const pintar = () => caja.querySelector("svg")?.setAttribute("viewBox", `${v2d.x} ${v2d.y} ${v2d.w} ${v2d.h}`);
  const anchoValido = w => {
    const piso = PLANOS.find(p => p.id === S.piso);
    return Math.min(piso.ancho * 1.5, Math.max(piso.ancho / 8, w));
  };
  // Con preserveAspectRatio por defecto (xMidYMid meet) el centro de la caja
  // coincide con el centro del viewBox; escala = unidades SVG por píxel.
  const escalaDe = (v, r) => Math.max(v.w / r.width, v.h / r.height);
  const iniciarArrastre = (x, y) => { arrastre = { x, y, v: { ...v2d }, movio: false }; };
  const iniciarPinza = () => {
    const [a, b] = [...dedos.values()];
    const r = caja.getBoundingClientRect();
    const v = { ...v2d };
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const esc = escalaDe(v, r);
    pinza = {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1, v,
      ax: v.x + v.w / 2 + (mx - r.left - r.width / 2) * esc,
      ay: v.y + v.h / 2 + (my - r.top - r.height / 2) * esc,
    };
    arrastre = null;
    multitoque = true;
  };

  caja.addEventListener("pointerdown", e => {
    if (!v2d) return;
    caja.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dedos.size === 1) { multitoque = false; iniciarArrastre(e.clientX, e.clientY); }
    else if (dedos.size === 2) iniciarPinza();
  });
  caja.addEventListener("pointermove", e => {
    if (!v2d || !dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = caja.getBoundingClientRect();
    if (pinza && dedos.size >= 2) {
      const [a, b] = [...dedos.values()];
      const w = anchoValido(pinza.v.w * pinza.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1));
      const h2 = pinza.v.h * w / pinza.v.w;
      const esc = escalaDe({ w, h: h2 }, r);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // El punto del plano que quedó entre los dedos los sigue.
      v2d.x = pinza.ax - w / 2 - (mx - r.left - r.width / 2) * esc;
      v2d.y = pinza.ay - h2 / 2 - (my - r.top - r.height / 2) * esc;
      v2d.w = w;
      v2d.h = h2;
      pintar();
      return;
    }
    if (!arrastre) return;
    const escala = escalaDe(v2d, r);
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (Math.hypot(dx, dy) > 5) arrastre.movio = true;
    if (!arrastre.movio) return;
    v2d.x = arrastre.v.x - dx * escala;
    v2d.y = arrastre.v.y - dy * escala;
    pintar();
  });
  const soltar = e => {
    if (!dedos.delete(e.pointerId)) return;
    if (dedos.size >= 2) { iniciarPinza(); return; }
    if (dedos.size === 1) {
      // Queda un dedo: sigue moviendo desde donde está, sin saltos.
      pinza = null;
      const [p] = dedos.values();
      iniciarArrastre(p.x, p.y);
      arrastre.movio = true;
      return;
    }
    const tocar = e.type === "pointerup" && !multitoque && arrastre && !arrastre.movio;
    arrastre = null;
    pinza = null;
    if (!tocar) return;
    const pol = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("polygon.prog");
    elegirSalon(pol ? pol.dataset.id : null);
  };
  caja.addEventListener("pointerup", soltar);
  caja.addEventListener("pointercancel", soltar);
  caja.addEventListener("wheel", e => {
    if (!v2d) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const w = anchoValido(v2d.w * factor);
    const ratio = w / v2d.w;
    v2d.x += (v2d.w - w) / 2;
    v2d.y += (v2d.h - v2d.h * ratio) / 2;
    v2d.w = w;
    v2d.h *= ratio;
    pintar();
  }, { passive: false });
})();

// ─── Panel: agenda del evento y detalle del salón ───────────────────────────
// Como la guía de salones (Guia-congreso): la agenda lista todas las
// actividades del evento, con filtros y búsqueda; tocar una lleva a su salón
// en el mapa. Tocar un salón muestra su detalle con todas sus actividades.
const esAncho = () => window.matchMedia("(min-width: 1100px)").matches;
const normalizar = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function mostrarPanel(vista) {
  const cambio = vista !== S.panel;
  S.panel = vista;
  const abierto = vista !== "cerrado";
  el("panel-salon").classList.toggle("abierto", abierto);
  el("panel-salon").setAttribute("aria-hidden", String(!abierto));
  el("mapa-app").classList.toggle("con-panel", abierto);
  el("btn-agenda").setAttribute("aria-pressed", String(vista === "agenda"));
  el("cab-agenda").hidden = vista !== "agenda";
  el("cab-salon").hidden = vista !== "salon";
  renderPanel();
  if (cambio) el("panel-cuerpo").scrollTop = 0;
}

function elegirSalon(id, { destacar = null } = {}) {
  if (!id || !ESPACIOS.has(id) || !TIPOS_PROGRAMABLES.has(ESPACIOS.get(id).t)) {
    // Tocar fuera de un salón: en pantalla ancha vuelve a la agenda; en
    // celular cierra la hoja para dejar ver el mapa.
    if (S.panel === "salon") esAncho() ? volverAgenda() : cerrarPanel();
    return;
  }
  // Al abrir un salón, sus asientos se llenan desde cero (efecto de entrada).
  if (id !== S.sel) [...asientosPrevios.keys()].filter(k => k.startsWith(`${id}|`)).forEach(k => asientosPrevios.delete(k));
  const otro = id !== S.sel;
  S.sel = id;
  S.destacado = destacar;
  const piso = ESPACIOS.get(id).piso;
  if (piso !== S.piso) cambiarPiso(piso);
  vista3d?.seleccionar(id);
  mostrarPanel("salon");
  if (otro) el("panel-cuerpo").scrollTop = 0;
  if (S.vista === "2d") render2D();
  // Solo se desplaza el panel (scrollIntoView movía también la página entera).
  const destacada = destacar && el("panel-cuerpo").querySelector(".act-btn.destacada");
  if (destacada) {
    const cuerpo = el("panel-cuerpo");
    cuerpo.scrollTop += destacada.getBoundingClientRect().top - cuerpo.getBoundingClientRect().top - 12;
  }
}

function soltarSalon() {
  S.sel = null;
  S.destacado = null;
  vista3d?.seleccionar(null);
  if (S.vista === "2d") render2D();
}

function cerrarPanel() {
  soltarSalon();
  mostrarPanel("cerrado");
}

function volverAgenda() {
  soltarSalon();
  mostrarPanel("agenda");
}

el("panel-cerrar").addEventListener("click", cerrarPanel);
el("panel-volver").addEventListener("click", volverAgenda);
el("btn-agenda").addEventListener("click", () => (S.panel === "agenda" ? cerrarPanel() : volverAgenda()));
document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarPanel(); });

// ─── Actividades (agenda y salón) ───────────────────────────────────────────
function estadoActividad(cp, ahora) {
  if (estaCancelado(cp)) return "cancelada";
  if (cp.activo === false) return "desactivada";
  if (enCurso(cp, ahora)) return "vivo";
  if (terminado(cp, ahora)) return "fin";
  return "programada";
}

// Salón del plano de una actividad, o null si no tiene o está fuera del plano.
function lugarDe(cp) {
  const id = salonDeCheckpoint(cp, S.salones);
  return id && ESPACIOS.has(id) ? id : null;
}

const claveTipo = cp => (TIPOS[cp.tipo] ? cp.tipo : "otro");

const ordenarActividades = lista => [...lista].sort((a, b) =>
  (a.dia || "9999").localeCompare(b.dia || "9999")
  || (a.horaInicio || "").localeCompare(b.horaInicio || "")
  || (a.nombre || "").localeCompare(b.nombre || ""));

function etiquetaDiaLarga(dia) {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-PA", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}


// "Título" sin duplicar las comillas si ya vienen escritas.
const entreComillas = texto => {
  const limpio = String(texto || "").trim().replace(/^["“”«]+|["“”»]+$/g, "").trim();
  return limpio ? `"${limpio}"` : "";
};

function htmlActividad(cp, ahora, { conSalon = true } = {}) {
  const est = estadoActividad(cp, ahora);
  const tipo = tipoDe(cp);
  const color = est === "cancelada" || est === "desactivada" ? COLOR_CANCELADO : est === "fin" ? COLOR_FIN : tipo.color;
  const id = lugarDe(cp);
  const marca = {
    vivo: `<span class="estado-act vivo">EN VIVO</span>`,
    cancelada: `<span class="estado-act cancelada">Cancelada</span>`,
    desactivada: `<span class="estado-act cancelada">Desactivada</span>`,
    fin: `<span class="estado-act fin">Finalizada</span>`,
  }[est] || "";
  const lugar = id
    ? `${nombreSalon(id, S.salones[id])} · ${nombrePiso(ESPACIOS.get(id).piso).toLowerCase()}`
    : cp.salon ? `${cp.salon} (fuera del plano)` : "Sin salón asignado";
  // El título formal va entre comillas; en voluntariado ese campo es el área.
  const titulo = cp.origen === "voluntariado" ? cp.titulo : entreComillas(cp.titulo);
  const quien = [cp.exponente, cp.empresa].filter(Boolean).join(" · ");
  const apartados = S.reservas[cp.id] || 0;
  const detalles = [titulo, quien, conSalon ? lugar : null, apartados && est !== "fin" ? `${apartados} ${apartados === 1 ? "asiento apartado" : "asientos apartados"}` : null].filter(Boolean);
  const clases = ["act-btn", est === "fin" ? "fin" : "", est === "cancelada" ? "cancelada" : "", id ? "" : "sin-salon",
    cp.id === S.destacado ? "destacada" : ""].filter(Boolean).join(" ");
  return `<li class="con-btn"><button type="button" class="${clases}" data-cp="${escaparAtributo(cp.id)}" style="--c:${color}">
    <span class="hora">${h(cp.horaInicio || "—")}<br>${h(cp.horaFin || "")}</span>
    <span><span class="tipo">${h(tipo.nombre)}</span>${marca}
      <span class="titulo" style="display:block">${h(cp.nombre || "Actividad")}</span>
      ${detalles.map(d => `<span class="det">${h(d)}</span>`).join("")}</span>
  </button></li>`;
}

// Actividades agrupadas por día, con el día que muestra el mapa marcado.
function htmlPorDia(lista, ahora, opciones) {
  const grupos = new Map();
  lista.forEach(cp => {
    const dia = cp.dia || "";
    if (!grupos.has(dia)) grupos.set(dia, []);
    grupos.get(dia).push(cp);
  });
  return [...grupos].map(([dia, cps]) => `<section class="agenda-dia">
    <h3>${dia ? h(dia === ahora.dia ? "Hoy" : etiquetaDiaLarga(dia)) : "Sin día asignado"}${dia === ahora.dia ? `<small>${h(etiquetaDiaLarga(dia))}</small>` : ""}${
      dia && dia === S.dia ? `<span class="en-mapa">En el mapa</span>` : ""}</h3>
    <ul class="acts">${cps.map(cp => htmlActividad(cp, ahora, opciones)).join("")}</ul>
  </section>`).join("");
}

// ─── Agenda ─────────────────────────────────────────────────────────────────
// El día de la agenda no cuenta como filtro para el mapa (el mapa ya muestra un día).
const filtrosActivos = () => S.filtro.tipo !== "todo" || S.filtro.tema !== "todo" || S.filtro.ahora || S.filtro.ocultarFin || S.filtro.q.length > 0;

function coincideFiltro(cp, ahora) {
  const f = S.filtro;
  if (f.tipo !== "todo" && claveTipo(cp) !== f.tipo) return false;
  if (f.tema !== "todo" && !temasDe(cp).some(t => normalizar(t) === normalizar(f.tema))) return false;
  if (f.dia !== "todo" && cp.dia !== f.dia) return false;
  const est = estadoActividad(cp, ahora);
  if (f.ahora && est !== "vivo") return false;
  if (f.ocultarFin && est === "fin") return false;
  if (f.q.length) {
    const id = lugarDe(cp);
    const texto = normalizar([
      cp.nombre, cp.titulo, cp.exponente, cp.empresa, cp.descripcion, ...temasDe(cp), tipoDe(cp).nombre,
      id ? `${nombreSalon(id, S.salones[id])} salon ${rotuloSalon(id, S.salones[id])}` : cp.salon,
    ].join(" "));
    if (!f.q.every(t => texto.includes(t))) return false;
  }
  return true;
}

function renderFiltrosAgenda(ahora) {
  const f = S.filtro;
  const todas = actividadesMapa();
  const tipos = Object.keys(TIPOS).filter(t => todas.some(cp => claveTipo(cp) === t));
  const dias = [...new Set(todas.map(cp => cp.dia).filter(Boolean))].sort();
  const chip = (grupo, valor, texto, color, activo) =>
    `<button type="button" class="chip" data-grupo="${grupo}" data-valor="${escaparAtributo(valor)}" aria-pressed="${activo}">${
      color ? `<i style="--c:${color}"></i>` : ""}${h(texto)}</button>`;
  let html = chip("tipo", "todo", "Todo", null, f.tipo === "todo")
    + tipos.map(t => chip("tipo", t, TIPOS[t].nombre, TIPOS[t].color, f.tipo === t)).join("");
  // Temas: charlas relacionadas aunque sean de distintos exponentes. Al elegir
  // uno, el mapa resalta sus salones y deja tenues los demás.
  const temas = [...new Map(todas.flatMap(temasDe).map(t => [normalizar(t), t])).values()]
    .sort((a, b) => a.localeCompare(b, "es"));
  if (temas.length) {
    html += `<span class="sep" aria-hidden="true"></span>` + chip("tema", "todo", "Todos los temas", null, f.tema === "todo")
      + temas.map(t => chip("tema", t, t, null, normalizar(f.tema) === normalizar(t))).join("");
  }
  if (dias.length > 1) {
    html += `<span class="sep" aria-hidden="true"></span>` + chip("dia", "todo", "Todos los días", null, f.dia === "todo")
      + dias.map(d => chip("dia", d, d === ahora.dia ? "Hoy" : etiquetaDia(d), null, f.dia === d)).join("");
  }
  html += `<span class="sep" aria-hidden="true"></span>`
    + chip("ahora", "1", "En curso ahora", null, f.ahora)
    + chip("ocultarFin", "1", "Ocultar finalizadas", null, f.ocultarFin);
  // El repintado no debe quitarle el foco a quien usa el teclado.
  const enfocado = document.activeElement?.closest?.("#agenda-filtros [data-grupo]");
  const clave = enfocado ? `[data-grupo="${enfocado.dataset.grupo}"][data-valor="${CSS.escape(enfocado.dataset.valor)}"]` : null;
  el("agenda-filtros").innerHTML = html;
  if (clave) el("agenda-filtros").querySelector(clave)?.focus();
}

function renderAgenda() {
  const ahora = enPanama();
  const todas = actividadesMapa();
  const total = todas.length;
  el("agenda-titulo").textContent = S.evento?.nombre || "Actividades";
  el("agenda-meta").textContent = total ? `${total} ${total === 1 ? "actividad" : "actividades"} en el programa` : "";
  renderFiltrosAgenda(ahora);

  const lista = ordenarActividades(todas.filter(cp => coincideFiltro(cp, ahora)));
  let html;
  if (!total) html = `<p class="vacio-mapa">${S.evento ? "Este evento todavía no tiene actividades." : "No hay eventos activos."}</p>`;
  else if (!lista.length) {
    html = `<div class="vacio-mapa"><p>Ninguna actividad coincide con lo que elegiste.</p>
      <button type="button" class="btn btn-outline btn-sm" data-accion="limpiar">Quitar filtros y búsqueda</button></div>`;
  } else {
    html = `<p class="agenda-resumen">${lista.length} ${lista.length === 1 ? "actividad" : "actividades"}${
      filtrosActivos() ? " con los filtros elegidos" : ""}. Toca una para verla en el mapa.</p>${htmlPorDia(lista, ahora)}`;
  }
  const cuerpo = el("panel-cuerpo");
  const scroll = cuerpo.scrollTop;
  cuerpo.innerHTML = html;
  cuerpo.scrollTop = scroll;
}

el("agenda-filtros").addEventListener("click", e => {
  const b = e.target.closest("[data-grupo]");
  if (!b) return;
  const { grupo, valor } = b.dataset;
  if (grupo === "ahora" || grupo === "ocultarFin") S.filtro[grupo] = !S.filtro[grupo];
  else S.filtro[grupo] = valor;
  // Elegir un día en la agenda también lo muestra en el mapa.
  if (grupo === "dia" && valor !== "todo" && valor !== S.dia && diasDelMapa().includes(valor)) {
    S.dia = valor;
    renderDias();
    escucharAsistencias();
  }
  render(); // el mapa resalta los salones que coinciden
});

// Un tema de la ficha filtra la agenda y el mapa por ese tema.
function filtrarPorTema(tema) {
  S.filtro = { ...FILTRO_VACIO(), tema };
  el("agenda-buscar").value = "";
  volverAgenda();
  render();
}

let tBusqueda = null;
el("agenda-buscar").addEventListener("input", () => {
  clearTimeout(tBusqueda);
  tBusqueda = setTimeout(() => {
    S.filtro.q = normalizar(el("agenda-buscar").value).split(/\s+/).filter(Boolean);
    el("panel-cuerpo").scrollTop = 0;
    render();
  }, 160);
});

// Tocar una actividad (en la agenda o en un salón) la muestra en el mapa: su
// salón, su piso y su día.
el("panel-cuerpo").addEventListener("click", e => {
  if (e.target.closest("[data-accion='limpiar']")) {
    S.filtro = FILTRO_VACIO();
    el("agenda-buscar").value = "";
    render();
    return;
  }
  const tema = e.target.closest("[data-tema]");
  if (tema) { filtrarPorTema(tema.dataset.tema); return; }
  const btn = e.target.closest("[data-cp]");
  if (!btn) return;
  const cp = actividadesMapa().find(x => x.id === btn.dataset.cp);
  if (!cp) return;
  const id = lugarDe(cp);
  if (!id) {
    alerta("aviso", cp.salon
      ? `"${cp.nombre || "Esta actividad"}" está en ${cp.salon}, que no es un salón del plano.`
      : `"${cp.nombre || "Esta actividad"}" no tiene salón asignado.`);
    return;
  }
  if (cp.dia && cp.dia !== S.dia && diasDelMapa().includes(cp.dia)) {
    S.dia = cp.dia;
    renderDias();
    escucharAsistencias();
  }
  elegirSalon(id, { destacar: cp.id });
});

// ─── Detalle del salón ──────────────────────────────────────────────────────
// Asientos ya pintados por salón/actividad: solo se animan los que se llenan
// desde el último repintado (si no, cada actualización haría parpadear todo).
const asientosPrevios = new Map();

// `apartados`: asientos reservados desde el perfil. Los que aún no entraron
// se dibujan punteados después de los ocupados (aproximado: no se sabe si
// quien entró había reservado).
function htmlAsientos(capacidad, ocupados, color, clave = "", apartados = 0) {
  if (!capacidad) return `<p class="vacio-mapa">Configura la capacidad del salón para ver sus asientos.</p>`;
  const porAsiento = Math.ceil(capacidad / MAX_ASIENTOS_DIBUJADOS);
  const total = Math.ceil(capacidad / porAsiento);
  const llenos = Math.min(total, Math.ceil(ocupados / porAsiento));
  const reservados = Math.min(total - llenos, Math.ceil(Math.max(0, apartados - ocupados) / porAsiento));
  const previos = Math.min(asientosPrevios.get(clave) ?? 0, llenos);
  asientosPrevios.set(clave, llenos);
  const asientos = Array.from({ length: total }, (_, i) => {
    if (i < previos) return `<span class="asiento ocupado"></span>`;
    if (i < llenos) return `<span class="asiento por-llenar" style="transition-delay:${reducido ? 0 : Math.min((i - previos) * 18, 900)}ms;"></span>`;
    if (i < llenos + reservados) return `<span class="asiento apartado"></span>`;
    return `<span class="asiento"></span>`;
  }).join("");
  return `<div class="asientos" style="--c:${color}" role="img" aria-label="${ocupados} de ${capacidad} asientos ocupados${apartados ? `, ${apartados} apartados` : ""}">${asientos}</div>
    ${apartados ? `<div class="leyenda-asientos" style="--c:${color}"><span><i class="o"></i>Ocupado</span><span><i class="a"></i>Apartado (reservó y aún no entra)</span><span><i class="l"></i>Libre</span></div>` : ""}
    ${porAsiento > 1 ? `<p class="asientos-nota">Cada cuadro representa ${porAsiento} asientos.</p>` : ""}`;
}

// Ficha de una charla: foto del exponente, empresa con su logo, descripción
// y temas (tocar un tema filtra el mapa por charlas relacionadas).
function htmlFicha(cp) {
  const foto = imagenDe(cp.fotoExponente);
  const logo = imagenDe(cp.logoEmpresa);
  const temas = temasDe(cp);
  if (!cp.exponente && !cp.empresa && !cp.descripcion && !foto && !logo && !temas.length) return "";
  const retrato = foto
    ? `<img class="ficha-foto" src="${escaparAtributo(foto)}" alt="${escaparAtributo(cp.exponente ? `Foto de ${cp.exponente}` : "Exponente")}" loading="lazy" decoding="async" width="64" height="64"/>`
    : cp.exponente ? `<span class="ficha-foto iniciales" aria-hidden="true">${h(iniciales(cp.exponente))}</span>` : "";
  return `<div class="ficha">
    <div class="ficha-personas">
      ${retrato}
      <div class="ficha-quien">
        ${cp.exponente ? `<div class="ficha-exponente">${h(cp.exponente)}</div>` : ""}
        ${cp.empresa ? `<div class="ficha-empresa">${h(cp.empresa)}</div>` : ""}
      </div>
      ${logo ? `<img class="ficha-logo" src="${escaparAtributo(logo)}" alt="${escaparAtributo(cp.empresa ? `Logo de ${cp.empresa}` : "Logo")}" loading="lazy" decoding="async"/>` : ""}
    </div>
    ${cp.descripcion ? `<p class="ficha-desc">${h(cp.descripcion)}</p>` : ""}
    ${temas.length ? `<div class="ficha-temas" aria-label="Temas">${temas.map(t => `<button type="button" data-tema="${escaparAtributo(t)}">${h(t)}</button>`).join("")}</div>` : ""}
  </div>`;
}

function htmlAvance(avance, cp) {
  if (!avance) return "";
  const texto = avance.cierre ? `Termina en ${avance.restan} min · esperando la siguiente` : `Quedan ${avance.restan} min`;
  return `<div class="progreso-charla" style="--c:${avance.color}">
    <div class="barra"><div style="width:${avance.pct}%"></div></div>
    <div class="txt"><span>${h(cp.horaInicio || "")} – ${h(cp.horaFin || "")}</span><b>${h(texto)}</b></div>
  </div>`;
}

function renderPanel() {
  if (S.panel === "agenda") renderAgenda();
  else if (S.panel === "salon" && S.sel) renderSalon();
}

function renderSalon() {
  const id = S.sel;
  const esp = ESPACIOS.get(id);
  const salon = S.salones[id];
  const est = estados.get(id) || {};
  const ahora = enPanama();

  el("panel-rotulo").textContent = rotuloSalon(id, salon);
  el("panel-nombre").textContent = nombreSalon(id, salon);
  const aqui = ESPACIOS.get(S.aqui);
  el("panel-meta").textContent = [
    nombrePiso(esp.piso),
    enLobby(id)?.texto,
    salon?.capacidad ? `Capacidad: ${salon.capacidad} personas` : "Sin capacidad configurada",
    aqui && aqui.piso !== esp.piso ? `Estás en el ${nombrePiso(aqui.piso).toLowerCase()}` : "",
  ].filter(Boolean).join(" · ");

  const bloques = [];
  if (est.estado === "vivo" && est.vivo.origen === "voluntariado") {
    const cp = est.vivo;
    bloques.push(`<section class="bloque">
      <h3>En vivo ahora</h3>
      <div class="vivo-titulo"><span class="badge-vivo">EN VIVO</span>${h(cp.nombre || "Actividad")}</div>
      <div class="panel-meta">Voluntariado${cp.titulo ? ` · ${h(cp.titulo)}` : ""}${cp.horaInicio ? ` · ${h(cp.horaInicio)}–${h(cp.horaFin || "")}` : ""}</div>
      <p class="vacio-mapa" style="margin:10px 0 0;">Las actividades de voluntariado no registran entradas, así que no hay conteo de asientos.</p>
    </section>`);
  } else if (est.estado === "vivo") {
    const cp = est.vivo;
    const capacidad = est.capacidad;
    const libres = capacidad ? Math.max(0, capacidad - est.ocupados) : null;
    const pct = capacidad ? Math.min(100, Math.round(est.ocupados / capacidad * 100)) : 0;
    const presentes = (ocupacionActual(S.asistencias, S.checkpoints).get(cp.id) || [])
      .sort((a, b) => (b.marcadoEn?.toMillis?.() || 0) - (a.marcadoEn?.toMillis?.() || 0));
    const apartados = S.reservas[cp.id] || 0;
    bloques.push(`<section class="bloque">
      <h3>En vivo ahora</h3>
      <div class="vivo-titulo"><span class="badge-vivo" style="background:${est.color}">${est.avance?.cierre ? "POR TERMINAR" : "EN VIVO"}</span>${h(cp.titulo ? entreComillas(cp.titulo) : cp.nombre || "Actividad")}</div>
      <div class="panel-meta">${h(tipoDe(cp).nombre)}${cp.titulo ? ` · ${h(cp.nombre || "")}` : ""}</div>
      ${htmlAvance(est.avance, cp)}
      ${htmlFicha(cp)}
      <div class="contadores${apartados ? " cuatro" : ""}">
        <div class="contador"><b>${est.ocupados}</b><span>Ocupados</span></div>
        ${apartados ? `<div class="contador"><b>${apartados}</b><span>Reservaron</span></div>` : ""}
        <div class="contador libres"><b>${libres ?? "—"}</b><span>Disponibles</span></div>
        <div class="contador"><b>${capacidad || "—"}</b><span>Capacidad</span></div>
      </div>
      <div class="barra-ocup${pct >= 100 ? " llena" : ""}"><div style="width:${pct}%"></div></div>
      ${htmlAsientos(capacidad, est.ocupados, est.color, `${id}|${cp.id}`, apartados)}
      ${S.liberar ? `<h3 style="margin-top:12px;">Personas en el salón (${presentes.length})</h3>
        ${presentes.length ? `<ul class="presentes">${presentes.map(a => `<li>
          <span>${h(a.participanteNombre || a.participanteCodigo || "Participante")}<br><small>Entró ${h(horaDe(a.marcadoEn))}</small></span>
          <button class="btn-liberar" type="button" data-liberar="${escaparAtributo(`${a.participanteColeccion || "participantes"}|${a.participanteId}|${a.checkpointId}`)}">Liberar asiento</button>
        </li>`).join("")}</ul>` : `<p class="vacio-mapa">Todavía no hay entradas registradas.</p>`}` : ""}
    </section>`);
  } else {
    // Sin nada en curso: la próxima charla de hoy en este salón, con su ficha
    // y los asientos que ya se apartaron para ella.
    const proxima = ordenarActividades(actividadesMapa().filter(cp =>
      lugarDe(cp) === id && cp.dia === S.dia && estaOperativo(cp) && !terminado(cp, ahora)))[0];
    const apartados = proxima ? S.reservas[proxima.id] || 0 : 0;
    if (proxima || salon?.capacidad) {
      bloques.push(`<section class="bloque">
        <h3>${proxima ? "Próxima en este salón" : "Asientos"}</h3>
        ${proxima ? `<div class="vivo-titulo" style="font-size:15px">${h(proxima.titulo ? entreComillas(proxima.titulo) : proxima.nombre || "Actividad")}</div>
          <div class="panel-meta">${h(tipoDe(proxima).nombre)} · ${h(proxima.horaInicio || "")}–${h(proxima.horaFin || "")}${apartados ? ` · ${apartados} ${apartados === 1 ? "reserva" : "reservas"}` : ""}</div>
          ${htmlFicha(proxima)}` : `<p class="vacio-mapa" style="margin:0 0 10px;">Sin actividad en este momento.</p>`}
        ${salon?.capacidad ? `<div style="margin-top:12px">${htmlAsientos(salon.capacidad, 0, proxima ? tipoDe(proxima).color : "#00722e", `${id}|libre`, apartados)}</div>` : ""}
      </section>`);
    }
  }

  // Todas las actividades del salón en el evento, por día (como la guía).
  const delSalon = ordenarActividades(actividadesMapa().filter(cp => lugarDe(cp) === id));
  bloques.push(`<section class="bloque">
    <h3>Actividades del salón</h3>
    ${delSalon.length ? htmlPorDia(delSalon, ahora, { conSalon: false }) : `<p class="vacio-mapa">No hay actividades programadas en este salón.</p>`}
  </section>`);

  if (S.gestor) {
    bloques.push(`<section class="bloque">
      <h3>Configurar salón</h3>
      <form class="form-salon" id="form-salon" novalidate>
        <label>Nombre que verán los asistentes<input id="fs-nombre" maxlength="100" value="${escaparAtributo(salon?.nombre || "")}" placeholder="${escaparAtributo(nombreSalon(id))}"/></label>
        <div class="fila">
          <label>Rótulo en el plano<input id="fs-rotulo" maxlength="${ROTULO_MAX}" value="${escaparAtributo(salon?.rotulo || "")}" placeholder="${escaparAtributo(esp.n || "")}"/></label>
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
  if (PUBLICO) { render(); return; }
  cancelarCheckpoints?.();
  S.checkpoints = [];
  if (!S.evento) { render(); return; }
  cancelarCheckpoints = onSnapshot(
    query(collection(db, "checkpoints"), where("eventoId", "==", S.evento.id)),
    snap => { S.checkpoints = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderPronto(); },
    e => {
      // Un error corta la suscripción: se vuelve a abrir sola (si no, el mapa
      // quedaría congelado horas sin avisar).
      console.error("Mapa: checkpoints (se reintenta):", e);
      cancelarCheckpoints = null;
      const evento = S.evento?.id;
      setTimeout(() => { if (!cancelarCheckpoints && S.evento?.id === evento) escucharCheckpoints(); }, 15000);
    },
  );
}

// Asientos apartados por charla (functions/charlas.js). Solo conteos.
function escucharReservas() {
  return onSnapshot(collection(db, "reservas_conteo"), snap => {
    S.reservas = Object.fromEntries(snap.docs.map(d => [d.id, Number(d.data().reservados || 0)]).filter(([, n]) => n > 0));
    renderPronto();
  }, e => {
    console.warn("Mapa: reservas (se reintenta):", e);
    setTimeout(() => { cancelarReservas = escucharReservas(); }, 30000);
  });
}

// Actividades de voluntariado con salón, de cualquier fecha (voluntariadoVisible
// decide cuáles se muestran). Las desactivadas no salen.
function escucharVoluntariado() {
  return onSnapshot(collection(db, "actividades_voluntarios"), snap => {
    S.voluntariado = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.salonId && a.activo !== false)
      .map(actividadVoluntariado);
    if (!S.dia) elegirDiaInicial();
    renderDias();
    renderPronto();
  }, e => {
    console.error("Mapa: voluntariado (se reintenta):", e);
    setTimeout(() => { cancelarVoluntariado = escucharVoluntariado(); }, 30000);
  });
}

// Los asientos solo importan "en ese momento": se escuchan las entradas de
// hoy y solo cuando se mira el día de hoy.
function escucharAsistencias() {
  if (PUBLICO) { render(); return; }
  cancelarAsistencias?.();
  cancelarAsistencias = null;
  S.asistencias = [];
  if (!S.evento || S.dia !== enPanama().dia) { render(); return; }
  if (!S.verPresentes) {
    const leer = () => leerMapaPublico()
      .then(({ data }) => { S.ocupacionPublica = data.ocupacion || {}; render(); })
      .catch(e => console.error("Mapa: ocupación:", e));
    leer();
    const reloj = setInterval(leer, 30000);
    cancelarAsistencias = () => clearInterval(reloj);
    return;
  }
  cancelarAsistencias = onSnapshot(
    query(collection(db, "asistencias_congreso"), where("checkpointDia", "==", S.dia)),
    snap => {
      S.asistencias = snap.docs.map(d => d.data()).filter(a => a.eventoId === S.evento?.id);
      renderPronto();
    },
    e => {
      // Al quedar en null, el reloj de 30 s la vuelve a abrir sola.
      console.error("Mapa: asistencias (se reintenta):", e);
      cancelarAsistencias = null;
    },
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
  actualizarEnlaceGestion();
  elegirDiaInicial();
  renderDias();
  escucharCheckpoints();
  escucharAsistencias();
}

// ─── Modo público ───────────────────────────────────────────────────────────
// mapaPublico devuelve todo ya filtrado (y lo cachea unos segundos para todos).
const leerMapaPublico = httpsCallable(getFunctions(app, "us-central1"), "mapaPublico");

async function cargarPublico() {
  const { data } = await leerMapaPublico();
  const primeraVez = !S.eventos.length;
  S.salones = data.salones || {};
  S.eventos = (data.eventos || []).filter(estaOperativo);
  S.todosCheckpoints = data.checkpoints || [];
  S.ocupacionPublica = data.ocupacion || {};
  S.reservas = data.reservas || {};
  if (primeraVez || !S.eventos.some(ev => ev.id === S.evento?.id)) {
    const hoy = enPanama().dia;
    S.evento = S.eventos.find(ev => diasDelEvento(ev).includes(hoy))
      || [...S.eventos].filter(ev => (diasDelEvento(ev)[0] || "") >= hoy).sort((a, b) => diasDelEvento(a)[0].localeCompare(diasDelEvento(b)[0]))[0]
      || S.eventos[0] || null;
    el("sel-evento").innerHTML = S.eventos.length
      ? S.eventos.map(ev => `<option value="${escaparAtributo(ev.id)}">${h(ev.nombre || "Evento")}</option>`).join("")
      : `<option value="">Sin eventos publicados</option>`;
    if (S.evento) el("sel-evento").value = S.evento.id;
    elegirDiaInicial();
    renderDias();
  }
  S.checkpoints = S.todosCheckpoints.filter(cp => cp.eventoId === S.evento?.id);
  render();
}

// ─── Inicio ─────────────────────────────────────────────────────────────────
function ajustarAlto() {
  document.documentElement.style.setProperty("--alto-topbar", `${el("topbar").offsetHeight}px`);
}
window.addEventListener("resize", ajustarAlto);
ajustarAlto();

// Pantalla grande del congreso (rol Modelado): la usa mucha gente seguida.
// Tras un rato sin tocarla vuelve sola a la vista general, sin filtros.
const INACTIVIDAD_KIOSCO_MS = 90 * 1000;

// Recargar sin internet deja la página de error del navegador y la pantalla
// muerta: antes se comprueba que respondan este sitio y la librería 3D.
async function recargarSiEsSeguro() {
  try {
    const [pagina, libreria] = await Promise.all([
      fetch(location.href, { method: "HEAD", cache: "no-store" }),
      fetch("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", { method: "HEAD", cache: "no-store" }),
    ]);
    if (pagina.ok && libreria.ok) { location.reload(); return; }
  } catch (_) { /* sin red */ }
  setTimeout(() => void recargarSiEsSeguro(), 60 * 1000);
}

// La GPU perdió el contexto 3D: se sigue en 2D y se recarga en cuanto se pueda.
function alPerderContexto3D() {
  vista3d = null;
  el("btn-3d").disabled = true;
  cambiarVista("2d");
  setTimeout(() => void recargarSiEsSeguro(), 5000);
}
// Encendida 48 h: cada 6 h, si nadie la toca hace 3 min, se recarga sola para
// empezar con la memoria limpia (la sesión de Firebase se conserva).
const RECARGA_KIOSCO_MS = 6 * 60 * 60 * 1000;
function iniciarKiosco() {
  let espera = null;
  let ultimoToque = Date.now();
  const abiertaDesde = Date.now();
  const reiniciar = () => {
    S.filtro = FILTRO_VACIO();
    el("agenda-buscar").value = "";
    // Vuelve a "hoy" si alguien dejó otro día elegido.
    const hoy = enPanama().dia;
    if (S.dia !== hoy && diasDelMapa().includes(hoy)) {
      S.dia = hoy;
      renderDias();
      escucharAsistencias();
    }
    if (esAncho()) volverAgenda(); else cerrarPanel();
    vista3d?.reencuadrar();
    render();
  };
  const tocar = () => {
    ultimoToque = Date.now();
    clearTimeout(espera);
    espera = setTimeout(reiniciar, INACTIVIDAD_KIOSCO_MS);
  };
  ["pointerdown", "keydown", "wheel"].forEach(tipo => document.addEventListener(tipo, tocar, { passive: true }));
  tocar();
  setInterval(() => {
    if (Date.now() - abiertaDesde > RECARGA_KIOSCO_MS && Date.now() - ultimoToque > 3 * 60 * 1000) void recargarSiEsSeguro();
  }, 5 * 60 * 1000);
  // Pantalla táctil pública: sin zoom de la página, menú contextual ni selección.
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("gesturestart", e => e.preventDefault());
  document.addEventListener("dblclick", e => e.preventDefault());
}

async function iniciar() {
  if (!PUBLICO) {
    await esperarSesionLista();
    S.kiosco = getUsuarioActual().rol === "modelado";
    document.body.classList.toggle("kiosco", S.kiosco);
    ajustarAlto();
    S.gestor = usuarioTienePermiso("evento_salones");
    S.liberar = usuarioTienePermiso("liberar_asiento");
    S.verPresentes = puedeVerPresentes();
    aplicarPermisosDom();
  }
  // ?aqui=2-1 (QR "Estás aquí"): el mapa abre en ese piso con el marcador.
  const aqui = new URLSearchParams(location.search).get("aqui");
  if (aqui && ESPACIOS.has(aqui)) {
    S.aqui = aqui;
    S.piso = ESPACIOS.get(aqui).piso;
    if (el("btn-aqui")) el("btn-aqui").hidden = false;
  }
  renderLeyenda();
  renderPisos();

  vista3d = await crearVista3D(el("escenario-mapa"), {
    planos: PLANOS, alElegir: elegirSalon, reducido, iconoBano: ICONO_BANO, iconos: ICONOS,
    alPerderContexto: alPerderContexto3D,
  });
  el("cargando-mapa").hidden = true;
  if (vista3d) {
    if (S.aqui) vista3d.marcarAqui(ESPACIOS.get(S.aqui).piso, puntoAqui(ESPACIOS.get(S.aqui)));
    vista3d.mostrarPiso(S.piso);
    cambiarVista("3d");
  } else {
    el("btn-3d").disabled = true;
    cambiarVista("2d");
  }

  if (PUBLICO) {
    await cargarPublico();
    // Asientos y "en vivo" al día cada 30 s.
    setInterval(() => cargarPublico().catch(e => console.error("Mapa público:", e)), 30000);
  } else {
    escucharSalones(salones => { S.salones = salones; render(); }, e => console.error("Mapa: salones:", e));
    await cargarEventos();
    cancelarVoluntariado = escucharVoluntariado();
    cancelarReservas = escucharReservas();
  }
  if (S.kiosco) iniciarKiosco();

  // ?salon=3-73 abre ese salón (enlace desde Gestión de Eventos → Salones).
  const pedido = new URLSearchParams(location.search).get("salon");
  if (pedido && ESPACIOS.has(pedido)) setTimeout(() => elegirSalon(pedido), reducido ? 0 : 1500);
  // En pantalla ancha la agenda queda abierta al lado, como en la guía.
  else if (esAncho()) volverAgenda();

  // Lo "en vivo" cambia con la hora: se recalcula cada 30 s. A medianoche, si
  // se estaba mirando "hoy", el mapa pasa solo al día nuevo (la pantalla
  // grande pasa la noche encendida).
  let hoyVisto = enPanama().dia;
  setInterval(() => {
    const hoy = enPanama().dia;
    if (hoy !== hoyVisto) {
      if (S.dia === hoyVisto && diasDelMapa().includes(hoy)) {
        S.dia = hoy;
        renderDias();
        escucharAsistencias();
      }
      hoyVisto = hoy;
    }
    if (!PUBLICO && S.dia && S.evento && cancelarAsistencias === null && S.dia === hoy) escucharAsistencias();
    render();
  }, 30000);
}

iniciar().catch(e => {
  console.error("Mapa del evento:", e);
  el("cargando-mapa").textContent = "No se pudo cargar el mapa. Recarga la página.";
});
window.addEventListener("pagehide", () => { cancelarCheckpoints?.(); cancelarAsistencias?.(); cancelarVoluntariado?.(); cancelarReservas?.(); vista3d?.destruir(); });

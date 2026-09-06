import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";
import { tienePermiso } from "../core/permisos.js";
import {
  listarParticipantesParaGiras,
  notificarParticipantesGira,
  notificarNoSeleccionadosGira,
} from "../core/participantes-api.js";
import { parsearListaCorreos } from "../core/correos.js";
import { iconoImg, estrellasImg } from "../core/iconos.js";
import {
  escaparAtributo,
  escaparHtml,
  neutralizarFormulaHoja,
} from "../core/seguridad.js";

const el  = id => document.getElementById(id);

// Desplaza hasta un elemento dejando espacio para el topbar fijo,
// para que el titulo y el primer campo del formulario queden visibles.
function scrollAElemento(id, margenExtra = 16) {
  const destino = el(id);
  if (!destino) return;
  requestAnimationFrame(() => {
    const topbar = document.querySelector(".topbar");
    const alturaTopbar = topbar ? topbar.getBoundingClientRect().height : 0;
    const y = destino.getBoundingClientRect().top + window.pageYOffset - alturaTopbar - margenExtra;
    window.scrollTo({ top: Math.max(y, 0), behavior: "smooth" });
  });
}
const h = escaparHtml;
const QRCode = window.QRCode;
const Papa   = window.Papa;

// XLSX se resuelve al usarlo, no al cargar el modulo: giras.html ya no carga
// xlsx.full.min.js (930 KB) porque no exporta hojas de calculo. Capturarlo en
// una const al importar dejaria `undefined` en esa pagina y romperia cualquier
// llamada futura; asi cada export lo pide en el momento y falla con un mensaje
// claro si la pagina anfitriona no incluyo la libreria.
function xlsx() {
  const lib = window.XLSX;
  if (!lib) {
    throw new Error("La libreria de Excel no esta disponible en esta pagina.");
  }
  return lib;
}

const DIACRITICOS_RE = new RegExp("[̀-ͯ]", "g");
const normalizarParaComparar = s => String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICOS_RE, "");

function filasSegurasHoja(filas) {
  return filas.map(fila => Object.fromEntries(
    Object.entries(fila).map(([clave, valor]) => [
      clave,
      typeof valor === "string" ? neutralizarFormulaHoja(valor) : valor,
    ])
  ));
}

function nombreCompletoVol(v) {
  const nombre   = (v?.nombre || "").trim();
  const apellido = (v?.apellido || "").trim();
  if (!apellido) return nombre;

  const nombreWords   = nombre.split(/\s+/);
  const apellidoWords = apellido.split(/\s+/);
  const maxSolape = Math.min(nombreWords.length, apellidoWords.length);
  let solape = 0;
  for (let i = maxSolape; i >= 1; i--) {
    const colaNombre    = nombreWords.slice(-i).map(normalizarParaComparar).join(" ");
    const cabezaApellido = apellidoWords.slice(0, i).map(normalizarParaComparar).join(" ");
    if (colaNombre === cabezaApellido) { solape = i; break; }
  }
  const restante = apellidoWords.slice(solape).join(" ");
  return restante ? `${nombre} ${restante}` : nombre;
}

let actividades       = [];
let giras             = [];
let ventas            = [];
let voluntarios       = [];
let voluntarioQRActual = null;
let asignaciones      = [];
let columnasArchivo   = [];
let filasArchivo      = [];
let asistenciasCache  = [];
let editandoActividadId = null;
let editandoGiraId      = null;
let filtroHorarioVol  = "";
let solicitudesActividad = [];

// Selector de participantes para giras (lista mínima vía listarParticipantesParaGiras)
let participantesGiraCache = [];
let participantesGiraCargados = false;
let participantesGiraSeleccionados = []; // [{id, nombre, cedula, codigo, categoria}]
// El mismo sheet sirve para las dos listas. Esto dice a cuál está apuntando.
let destinoSeleccionGira = "participantes"; // "participantes" | "noSeleccionados"

// Los ids ya elegidos en la lista a la que apunta el sheet. La de no
// seleccionados mezcla participantes inscritos y correos sueltos; aquí solo
// cuentan los primeros, que son los que el selector puede marcar.
function idsDestinoGira() {
  return destinoSeleccionGira === "noSeleccionados" ?
    new Set(noSeleccionados.filter(p => p.id).map(p => p.id)) :
    new Set(participantesGiraSeleccionados.map(p => p.id));
}

function conteoDestinoGira() {
  return destinoSeleccionGira === "noSeleccionados" ?
    noSeleccionados.filter(p => p.id).length :
    participantesGiraSeleccionados.length;
}

const CATEGORIA_LABELS_GIRA = {
  estudiante_utp: "Est. UTP", estudiante_externo: "Est. Externo",
  academico_utp: "Académico UTP", academico_externo: "Académico Externo",
  profesional: "Profesional", autor: "Autor", otros: "Otro", colegio: "Colegio",
};

const HORARIOS = [
  { valor: "Diurno",     label: "Diurno (7:50 am – 12:00 pm)",    inicio: "07:50", fin: "12:00", kw: ["diurno","matutino","mañana","7:50"] },
  { valor: "Vespertino", label: "Vespertino (12:50 pm – 5:00 pm)", inicio: "12:50", fin: "17:00", kw: ["vespertino","tarde","12:50"] },
  { valor: "Nocturno",   label: "Nocturno (5:50 pm – 10:00 pm)",   inicio: "17:50", fin: "22:00", kw: ["nocturno","noche","5:50"] },
];

function normalizarHorario(texto) {
  if (!texto) return "";
  const t = String(texto).toLowerCase();
  for (const h of HORARIOS) {
    if (h.kw.some(k => t.includes(k))) return h.valor;
  }
  return texto;
}

function minutosDeHora(hh_mm) {
  if (!hh_mm) return 0;
  const [h, m] = String(hh_mm).replace(/[^\d:]/g, "").split(":");
  return (parseInt(h) || 0) * 60 + (parseInt(m) || 0);
}

function hayConflictoHorario(horarioVol, horaInicioTurno, horaFinTurno) {
  if (!horarioVol || !horaInicioTurno || !horaFinTurno) return false;
  const cfg = HORARIOS.find(h => h.valor === horarioVol);
  if (!cfg) return false;
  const claseStart = minutosDeHora(cfg.inicio);
  const claseEnd   = minutosDeHora(cfg.fin);
  const turnoStart = minutosDeHora(horaInicioTurno);
  const turnoEnd   = minutosDeHora(horaFinTurno);
  return turnoStart < claseEnd && claseStart < turnoEnd;
}

const usuario = getUsuarioActual();

// ─── Alerta + Toast fijo ──────────────────────────────────────────────────────
function mostrarAlerta(tipo, msg, duracion = 5000) {
  const div = el("alerta-global");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  if (duracion > 0) setTimeout(() => div.classList.remove("show"), duracion);

  // Toast fijo en esquina superior derecha (visible independiente del scroll)
  let contenedor = document.getElementById("toast-voluntarios");
  if (!contenedor) {
    contenedor = document.createElement("div");
    contenedor.id = "toast-voluntarios";
    contenedor.style.cssText = "position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none;";
    document.body.appendChild(contenedor);
  }
  const colores = {
    success: { bg:"#f0fdf4", color:"#166534", border:"#22c55e" },
    error:   { bg:"#fef2f2", color:"#991b1b", border:"#ef4444" },
    warning: { bg:"#fefce8", color:"#854d0e", border:"#eab308" },
  };
  const c = colores[tipo] || colores.success;
  const toast = document.createElement("div");
  toast.style.cssText = `background:${c.bg};color:${c.color};border-left:4px solid ${c.border};border-radius:8px;padding:12px 16px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.15);opacity:1;transition:opacity 0.3s;`;
  toast.textContent = msg;
  contenedor.appendChild(toast);
  if (duracion > 0) {
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 320); }, duracion);
  }
}

function fmtFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA");
}

function fmtHora(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

// Convierte "HH:MM" (24h, valor crudo de <input type="time">) a 12h legible.
function fmtHora12(horaStr) {
  if (!horaStr || typeof horaStr !== "string") return "—";
  const [hh, mm] = horaStr.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return "—";
  const periodo = hh < 12 ? "a.m." : "p.m.";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${periodo}`;
}

// ─── TABS ────────────────────────────────────────────────────────────────────
const TAB_PERMISOS = {
  "tab-actividades":  "gestionar_actividades",
  "tab-giras":        "gestionar_giras",
  "tab-voluntariado": "gestionar_voluntarios",
  "tab-importar":     "gestionar_voluntarios",
  "tab-voluntarios":  "gestionar_voluntarios",
  "tab-asistencias":  "gestionar_voluntarios",
};

function aplicarPermisosTab() {
  let primerVisible = null;
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const permiso = TAB_PERMISOS[btn.dataset.tab];
    const acceso  = !permiso || tienePermiso(usuario.rol, permiso);
    btn.style.display = acceso ? "" : "none";
    if (acceso && !primerVisible) primerVisible = btn.dataset.tab;
  });

  // Si el tab activo quedó oculto, activar el primero visible
  const btnActivo = document.querySelector(".tab-btn.active");
  if (btnActivo && btnActivo.style.display === "none" && primerVisible) {
    btnActivo.classList.remove("active");
    el(btnActivo.dataset.tab)?.classList.remove("active");
    document.querySelector(`[data-tab="${primerVisible}"]`)?.classList.add("active");
    el(primerVisible)?.classList.add("active");
  }
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tab-voluntarios")  renderVoluntarios();
    if (btn.dataset.tab === "tab-asistencias")  cargarAsistencias();
    if (btn.dataset.tab === "tab-voluntariado") iniciarTabVoluntariado();
  });
});

aplicarPermisosTab();

// ════════════════════════════════════════════════════════════
// ACTIVIDADES
// ════════════════════════════════════════════════════════════

async function cargarActividades() {
  try {
    const snap = await getDocs(query(collection(db, "actividades_voluntarios"), orderBy("creadoEn", "desc")));
    actividades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    actividades = [];
  }
  renderTablaActividades();
  renderSelectorActividades();
  renderFiltroActividades();
}

function renderSelectorActividades() {
  const sel = el("sel-actividad");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Selecciona una actividad —</option>`;
  actividades.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `${a.nombre} (${fmtFecha(a.fecha)})`;
    sel.appendChild(opt);
  });
}

function renderFiltroActividades() {
  const sel = el("filtro-actividad");
  if (!sel) return;
  sel.innerHTML = `<option value="">Todas las actividades</option>`;
  actividades.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.nombre;
    sel.appendChild(opt);
  });
}

function renderTablaActividades() {
  const tb = el("tabla-actividades-body");
  if (!tb) return;
  if (!actividades.length) {
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--gris-medio)">Sin actividades registradas. Crea la primera usando el formulario.</td></tr>`;
    return;
  }
  tb.innerHTML = actividades.map(a => `
    <tr>
      <td class="celda-titulo" data-label="Nombre">
        <span>
          <strong>${h(a.nombre)}</strong>
          ${a.descripcion ? `<br/><small style="color:var(--gris-medio)">${h(a.descripcion)}</small>` : ""}
          ${a.colaboracion ? `<br/><small style="color:var(--gris-medio)">${iconoImg("manos")} ${h(a.colaboracion)}</small>` : ""}
        </span>
      </td>
      <td data-label="Fecha">${fmtFecha(a.fecha)}</td>
      <td data-label="Tipo">${h(a.area || "—")}</td>
      <td data-label="Lugar">${h(a.lugar || "—")}</td>
      <td data-label="Vol. req." style="text-align:center;">${a.voluntariosReq ? `<strong style="color:var(--verde-oscuro)">${a.voluntariosReq}</strong>` : "—"}</td>
      <td data-label="Cupo" style="text-align:center;">${a.area === "Taller" && a.cupo ? `<strong style="color:#1a56db;">${a.cupo}</strong>` : "—"}</td>
      <td data-label="Turnos">
        <span>${(a.turnos || []).map(t => `<span style="font-size:11px;background:var(--verde-fondo);color:var(--verde-oscuro);padding:2px 6px;border-radius:8px;display:inline-block;margin:1px;">${h(t.nombre)} ${h(t.horaInicio)}–${h(t.horaFin)}</span>`).join("") || "—"}</span>
      </td>
      <td data-label="Estado">
        <span style="font-size:12px;background:${a.activo ? "var(--verde-fondo)" : "#f8f9fa"};color:${a.activo ? "var(--verde-oscuro)" : "var(--gris-medio)"};padding:2px 8px;border-radius:12px;">
          ${a.activo ? "Activa" : "Inactiva"}
        </span>
      </td>
      <td class="celda-acciones">
        <button class="btn btn-outline btn-sm" onclick="editarActividad('${escaparAtributo(a.id)}')" style="width:auto;margin-right:4px" title="Editar">${iconoImg("editar")}<span class="solo-movil"> Editar</span></button>
        <button onclick="toggleActividad('${escaparAtributo(a.id)}',${!!a.activo})" style="background:${a.activo?"var(--rojo)":"var(--verde-claro)"};color:#fff;border:none;border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px;">
          ${a.activo ? "Desactivar" : "Activar"}
        </button>
        <button onclick="eliminarActividad('${escaparAtributo(a.id)}')"
          style="background:#6b7280;color:#fff;border:none;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;margin-left:2px;" title="Eliminar">${iconoImg("eliminar")}<span class="solo-movil"> Eliminar</span></button>
      </td>
    </tr>`).join("");
}


el("btn-guardar-actividad")?.addEventListener("click", async () => {
  const nombre = el("act-nombre").value.trim();
  const desc   = el("act-descripcion").value.trim();
  const fecha  = el("act-fecha").value;
  const area   = el("act-area").value;
  if (!nombre || !fecha || !area) { mostrarAlerta("error", "Nombre, fecha y tipo son obligatorios."); return; }

  const data = {
    nombre, descripcion: desc,
    fecha: new Date(fecha + "T12:00:00"),
    area,
    lugar:          el("act-lugar").value.trim(),
    voluntariosReq: parseInt(el("act-voluntarios-req").value) || 0,
    cupo:           area === "Taller" ? (parseInt(el("act-cupo").value) || null) : null,
    colaboracion:   el("act-colaboracion").value.trim(),
    activo: true,
    actualizadoEn: serverTimestamp(),
  };

  el("btn-guardar-actividad").disabled = true;
  el("btn-guardar-actividad").textContent = "Guardando...";
  try {
    if (editandoActividadId) {
      await updateDoc(doc(db, "actividades_voluntarios", editandoActividadId), data);
      mostrarAlerta("success", "Actividad actualizada.");
    } else {
      data.creadoEn  = serverTimestamp();
      data.creadoPor = auth.currentUser?.uid || "";
      data.turnos    = [];
      await addDoc(collection(db, "actividades_voluntarios"), data);
      mostrarAlerta("success", "Actividad creada correctamente.");
    }
    limpiarFormActividad();
    await cargarActividades();
  } catch (e) {
    mostrarAlerta("error", "Error al guardar: " + e.message);
  }
  el("btn-guardar-actividad").disabled = false;
  el("btn-guardar-actividad").textContent = "Guardar actividad";
});

function limpiarFormActividad() {
  el("act-nombre").value = el("act-descripcion").value = el("act-fecha").value = "";
  el("act-area").value = "";
  el("act-lugar").value = "";
  el("act-voluntarios-req").value = "";
  el("act-cupo").value = "";
  el("act-cupo-group").style.display = "none";
  el("act-colaboracion").value = "";
  editandoActividadId = null;
  el("form-actividad-titulo").textContent = "Crear nueva actividad";
  el("btn-cancelar-actividad").style.display = "none";
}

window.editarActividad = function(id) {
  const a = actividades.find(x => x.id === id);
  if (!a) return;
  editandoActividadId = id;
  el("act-nombre").value          = a.nombre || "";
  el("act-descripcion").value     = a.descripcion || "";
  el("act-area").value            = a.area || "";
  el("act-lugar").value           = a.lugar || "";
  el("act-voluntarios-req").value = a.voluntariosReq || "";
  el("act-cupo").value            = a.cupo || "";
  el("act-cupo-group").style.display = a.area === "Taller" ? "block" : "none";
  el("act-colaboracion").value    = a.colaboracion || "";
  if (a.fecha) {
    const d = a.fecha.toDate ? a.fecha.toDate() : new Date(a.fecha);
    el("act-fecha").value = d.toISOString().split("T")[0];
  }
  el("form-actividad-titulo").textContent = "Editar actividad";
  el("btn-cancelar-actividad").style.display = "inline-flex";
  activarTab("tab-actividades");
  scrollAElemento("form-actividad-titulo");
};

window.toggleActividad = async function(id, estadoActual) {
  try {
    await updateDoc(doc(db, "actividades_voluntarios", id), { activo: !estadoActual, actualizadoEn: serverTimestamp() });
    await cargarActividades();
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

window.eliminarActividad = async function(id) {
  const nombre = actividades.find(a => a.id === id)?.nombre || "esta actividad";
  if (!confirm(`¿Eliminar la actividad "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "actividades_voluntarios", id));
    actividades = actividades.filter(a => a.id !== id);
    renderTablaActividades();
    renderSelectorActividades();
    renderFiltroActividades();
    mostrarAlerta("success", "Actividad eliminada.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

el("btn-cancelar-actividad")?.addEventListener("click", limpiarFormActividad);

// ─── AUTOCOMPLETE: SOLICITUDES DE ACTIVIDAD ───────────────────────────────────
async function cargarSolicitudesAutocomplete() {
  try {
    const snap = await getDocs(collection(db, "solicitudes_actividad"));
    solicitudesActividad = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    solicitudesActividad = [];
  }
}

(function iniciarAutocompleteSolicitud() {
  const input = el("act-nombre");
  if (!input) return;

  const dropdown = document.createElement("div");
  dropdown.id = "act-nombre-suggestions";
  dropdown.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1.5px solid #bbf7d0;border-radius:10px;box-shadow:0 6px 24px rgba(4,82,35,0.13);max-height:260px;overflow-y:auto;display:none;";
  document.body.appendChild(dropdown);

  function posicionar() {
    const r = input.getBoundingClientRect();
    dropdown.style.top   = (r.bottom + 2) + "px";
    dropdown.style.left  = r.left + "px";
    dropdown.style.width = r.width + "px";
  }

  function renderSugerencias(texto) {
    if (!texto) { dropdown.style.display = "none"; return; }
    const lower = texto.toLowerCase();
    const matches = solicitudesActividad.filter(s =>
      s.nombreActividad && s.nombreActividad.toLowerCase().includes(lower)
    ).slice(0, 8);
    if (!matches.length) { dropdown.style.display = "none"; return; }

    dropdown.innerHTML = "";
    matches.forEach(s => {
      const item = document.createElement("div");
      item.className = "act-sug-item";
      item.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0fdf4;font-size:14px;";
      item.innerHTML = `
        <span style="flex:1;color:#1f2937;">${h(s.nombreActividad)}</span>
        <span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 9px;border-radius:10px;white-space:nowrap;font-weight:600;border:1px solid #6ee7b7;">Solicitada</span>`;
      item.addEventListener("mouseenter", () => { item.style.background = "#f0fdf4"; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        autorellenarDesdeSolicitud(s);
        dropdown.style.display = "none";
      });
      dropdown.appendChild(item);
    });

    posicionar();
    dropdown.style.display = "block";
  }

  input.addEventListener("input",  e => renderSugerencias(e.target.value.trim()));
  input.addEventListener("focus",  e => { if (e.target.value.trim()) renderSugerencias(e.target.value.trim()); });
  input.addEventListener("blur",   () => setTimeout(() => { dropdown.style.display = "none"; }, 160));
  window.addEventListener("scroll", () => { dropdown.style.display = "none"; }, true);
})();

function autorellenarDesdeSolicitud(sol) {
  el("act-nombre").value      = sol.nombreActividad || "";
  el("act-descripcion").value = sol.descripcion     || "";
  if (sol.fecha) el("act-fecha").value = sol.fecha;

  const selArea = el("act-area");
  if (sol.tiposActividad?.length) {
    const primero = sol.tiposActividad[0];
    for (const opt of selArea.options) {
      if (opt.value === primero || opt.text === primero) { selArea.value = opt.value; break; }
    }
    selArea.dispatchEvent(new Event("change"));
  }

  el("act-lugar").value = sol.lugar || "";

  if (sol.instituciones?.length) {
    el("act-colaboracion").value = sol.instituciones.map(i => i.nombre).filter(Boolean).join(", ");
  } else if (sol.procedencia) {
    el("act-colaboracion").value = sol.procedencia;
  }
}

el("act-area")?.addEventListener("change", () => {
  const isTaller = el("act-area").value === "Taller";
  el("act-cupo-group").style.display = isTaller ? "block" : "none";
  if (!isTaller) el("act-cupo").value = "";
});

// ════════════════════════════════════════════════════════════
// IMPORTAR CSV / EXCEL
// ════════════════════════════════════════════════════════════

const CAMPOS_VOL = [
  { key: "id",      label: "ID",                              requerido: true,  kw: ["id"] },
  { key: "nombre",      label: "Nombre",                          requerido: true,  kw: ["nombre","name"] },
  { key: "apellido",    label: "Apellido",                        requerido: true,  kw: ["apellido","lastname","surname"] },
  { key: "telefono",    label: "Teléfono",                        requerido: false, kw: ["telefono","teléfono","phone","celular","movil"] },
  { key: "correo",      label: "Correo electrónico",              requerido: false, kw: ["correo","email","mail"] },
  { key: "carrera",     label: "Carrera",                         requerido: false, kw: ["carrera","program","facultad"] },
  { key: "anio",        label: "Año de carrera",                  requerido: false, kw: ["año","anio","year","semestre"] },
  { key: "motivacion",  label: "¿Por qué deseas ser voluntario?", requerido: false, kw: ["deseas ser voluntario","por qué deseas","motivo"] },
  { key: "experiencia", label: "Experiencia previa",              requerido: false, kw: ["experiencia","comités","asociaciones"] },
  { key: "horario",     label: "Horario de clases",               requerido: false, kw: ["horario","asiste","clases"] },
  { key: "habilidad",   label: "Habilidad destacada",             requerido: false, kw: ["habilidad","domines","habilidad específica"] },
];

const uploadZone = el("upload-zone");
if (uploadZone) {
  uploadZone.addEventListener("click", () => el("input-archivo").click());
  uploadZone.addEventListener("dragover",  e => { e.preventDefault(); uploadZone.classList.add("dragover"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
  uploadZone.addEventListener("drop", e => {
    e.preventDefault(); uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0]);
  });
  el("input-archivo")?.addEventListener("change", e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });
}

function procesarArchivo(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: r => { columnasArchivo = r.meta.fields || []; filasArchivo = r.data; mostrarMapeo(); },
    });
  } else if (["xlsx","xls"].includes(ext)) {
    const reader = new FileReader();
    reader.onload = e2 => {
      const wb   = xlsx().read(e2.target.result, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = xlsx().utils.sheet_to_json(ws, { header: 1 });
      if (!data.length) return;
      columnasArchivo = data[0].map(String);
      filasArchivo    = data.slice(1).map(row =>
        Object.fromEntries(columnasArchivo.map((h, i) => [h, row[i] ?? ""]))
      );
      mostrarMapeo();
    };
    reader.readAsArrayBuffer(file);
  } else {
    mostrarAlerta("error", "Formato no soportado. Usa CSV o Excel (.xlsx, .xls).");
  }
}

function detectarCol(campo) {
  return columnasArchivo.find(c => campo.kw.some(k => c.toLowerCase().includes(k))) || "";
}

function mostrarMapeo() {
  el("mapeo-tbody").innerHTML = CAMPOS_VOL.map(campo => {
    const det = detectarCol(campo);
    const ind = det ? "" : (campo.requerido ? iconoImg("advertencia") : "—");
    return `<tr>
      <td><strong>${ind} ${campo.label}${campo.requerido ? ' <span style="color:#dc3545">*</span>' : ""}</strong></td>
      <td>
        <select id="map-${campo.key}">
          <option value="">— No incluir —</option>
          ${columnasArchivo.map(c => `<option value="${escaparAtributo(c)}"${c === det ? " selected" : ""}>${h(c)}</option>`).join("")}
        </select>
      </td>
    </tr>`;
  }).join("");
  el("mapeo-section").style.display = "block";
}

el("btn-preview-importar")?.addEventListener("click", () => {
  const mapeo = CAMPOS_VOL.map(c => ({ key: c.key, label: c.label, col: el(`map-${c.key}`)?.value })).filter(m => m.col);
  el("preview-thead").innerHTML = `<tr>${mapeo.map(m => `<th>${h(m.label)}</th>`).join("")}</tr>`;
  el("preview-tbody").innerHTML = filasArchivo.slice(0, 5).map(row =>
    `<tr>${mapeo.map(m => `<td>${h(row[m.col] ?? "—")}</td>`).join("")}</tr>`
  ).join("");
  el("preview-resumen").textContent = `${filasArchivo.length} filas encontradas en el archivo.`;
  el("modal-preview").classList.add("open");
});

el("btn-confirmar-importar")?.addEventListener("click", async () => {
  const nombreCol = el("map-nombre")?.value;
  if (!nombreCol) { mostrarAlerta("error", "El campo 'Nombre' es obligatorio en el mapeo."); return; }

  const mapeo = Object.fromEntries(CAMPOS_VOL.map(c => [c.key, el(`map-${c.key}`)?.value || ""]));
  const filas  = filasArchivo.filter(r => r[mapeo.nombre]?.toString().trim());

  el("importar-progreso").style.display = "block";
  el("btn-confirmar-importar").disabled = true;

  let importados = 0, omitidos = 0;
  for (const fila of filas) {
    const id = mapeo.id ? fila[mapeo.id]?.toString().trim() : "";
    if (id) {
      const existe = await getDocs(query(collection(db, "voluntarios"), where("id", "==", id)));
      if (!existe.empty) { omitidos++; continue; }
    }
    await addDoc(collection(db, "voluntarios"), {
      nombre:      fila[mapeo.nombre]?.toString().trim() || "",
      apellido:    fila[mapeo.apellido]?.toString().trim() || "",
      id:      fila[mapeo.id]?.toString().trim() || "",
      correo:      fila[mapeo.correo]?.toString().trim() || "",
      telefono:    fila[mapeo.telefono]?.toString().trim() || "",
      carrera:     fila[mapeo.carrera]?.toString().trim() || "",
      anio:        fila[mapeo.anio]?.toString().trim() || "",
      motivacion:  fila[mapeo.motivacion]?.toString().trim() || "",
      experiencia: fila[mapeo.experiencia]?.toString().trim() || "",
      horario:     normalizarHorario(fila[mapeo.horario]?.toString().trim() || ""),
      habilidad:   fila[mapeo.habilidad]?.toString().trim() || "",
      totalHoras:  0,
      importadoDeArchivo: new Date().toISOString(),
      creadoEn:    serverTimestamp(),
    });
    importados++;
    el("importar-progreso").textContent = `Importando... ${importados} de ${filas.length}`;
  }

  el("importar-progreso").textContent = `Listo: ${importados} importados${omitidos ? `, ${omitidos} duplicados omitidos` : ""}.`;
  el("btn-confirmar-importar").disabled = false;
  mostrarAlerta("success", `${importados} voluntarios importados.`);
  await cargarVoluntarios();
});

el("modal-preview-close")?.addEventListener("click", () => el("modal-preview").classList.remove("open"));

// ════════════════════════════════════════════════════════════
// VOLUNTARIOS
// ════════════════════════════════════════════════════════════

async function cargarVoluntarios() {
  const spVol = el("voluntarios-spinner");
  if (spVol) spVol.style.display = "flex";
  try {
    const snap = await getDocs(query(collection(db, "voluntarios"), orderBy("creadoEn", "desc")));
    voluntarios = snap.docs.map(d => ({ id: d.id, ...d.data(), _docId: d.id }));
  } catch {
    voluntarios = [];
  }
  if (spVol) spVol.style.display = "none";
  renderVoluntarios();
  actualizarStats();
}

function actualizarStats() {
  const totalH = voluntarios.reduce((s, v) => s + (v.totalHoras || 0), 0);
  if (el("stat-total"))  el("stat-total").textContent  = voluntarios.length;
  if (el("stat-horas"))  el("stat-horas").textContent  = totalH.toFixed(1) + "h";
}

const HORARIO_CFG = {
  "Diurno":     { bg: "#eff6ff", color: "#1e40af", icono: "" },
  "Vespertino": { bg: "#fff7ed", color: "#9a3412", icono: "" },
  "Nocturno":   { bg: "#1e1b4b", color: "#c7d2fe", icono: "" },
};

function renderVoluntarios(filtro = "") {
  const tb = el("tabla-voluntarios-body");
  if (!tb) return;
  let lista = voluntarios;
  if (filtro)         lista = lista.filter(v =>
    String(v.nombre || "").toLowerCase().includes(filtro) ||
    String(v.apellido || "").toLowerCase().includes(filtro) ||
    String(v.id || "").toLowerCase().includes(filtro)
  );
  if (filtroHorarioVol) lista = lista.filter(v => v.horario === filtroHorarioVol);

  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">${filtro || filtroHorarioVol ? "Sin coincidencias" : "Sin voluntarios registrados"}</td></tr>`;
    return;
  }

  tb.innerHTML = lista.map(v => {
    const hCfg = HORARIO_CFG[v.horario];
    const horarioBadge = hCfg
      ? `<span style="font-size:11px;background:${hCfg.bg};color:${hCfg.color};padding:3px 9px;border-radius:12px;white-space:nowrap;font-weight:600;">${h(hCfg.icono)} ${h(v.horario)}</span>`
      : `<span style="color:var(--gris-medio);font-size:12px;">—</span>`;

    const nombreCompleto = nombreCompletoVol(v);
    return `<tr>
      <td>
        <strong>${h(nombreCompleto)}</strong>
        ${v.correo ? `<br/><small style="color:var(--gris-medio)">${h(v.correo)}</small>` : ""}
        ${v.anio   ? `<br/><small style="color:var(--gris-medio)">Año ${h(v.anio)}</small>` : ""}
      </td>
      <td>${h(v.id || "—")}</td>
      <td>${h(v.carrera || "—")}</td>
      <td>${horarioBadge}</td>
      <td><span class="horas-badge">${(v.totalHoras || 0).toFixed(2)}h</span></td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="verQR('${escaparAtributo(v.id)}')" style="width:auto;margin-right:4px" title="Ver QR del voluntario">Ver QR</button>
        <button onclick="eliminarVoluntario('${escaparAtributo(v._docId)}')"
          style="background:#dc3545;color:#fff;border:none;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;" title="Eliminar">${iconoImg("eliminar")}</button>
      </td>
    </tr>`;
  }).join("");
}

window.eliminarVoluntario = async function(id) {
  const voluntario = voluntarios.find(v => v._docId === id);
  const nombre = voluntario ? nombreCompletoVol(voluntario) : "este voluntario";
  if (!confirm(`¿Eliminar al voluntario "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "voluntarios", id));
    voluntarios = voluntarios.filter(v => v._docId !== id);
    renderVoluntarios(el("buscar-voluntario")?.value.toLowerCase().trim() || "");
    actualizarStats();
    mostrarAlerta("success", "Voluntario eliminado.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

el("buscar-voluntario")?.addEventListener("input", e => renderVoluntarios(e.target.value.toLowerCase().trim()));
el("filtro-horario-vol")?.addEventListener("change", e => { filtroHorarioVol = e.target.value; renderVoluntarios(el("buscar-voluntario")?.value.toLowerCase().trim() || ""); });

// ── QR ────────────────────────────────────────────────────────────────────────
window.verQR = function(id) {
  const v = voluntarios.find(x => x.id === id);
  if (!v) return;
  voluntarioQRActual = v;
  el("qr-modal-nombre").textContent = nombreCompletoVol(v);
  el("qr-modal-info").textContent   = `ID: ${id}`;
  const wrap = el("qr-canvas-wrap");
  wrap.innerHTML = "";
  new QRCode(wrap, {
    text:         id,
    width:        200,
    height:       200,
    colorDark:    "#045223",
    colorLight:   "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });
  el("modal-qr").classList.add("open");
};

el("modal-qr-close")?.addEventListener("click", () => el("modal-qr").classList.remove("open"));

el("btn-descargar-qr")?.addEventListener("click", async () => {
  if (!voluntarioQRActual) return;
  const btn = el("btn-descargar-qr");
  btn.disabled = true;
  btn.textContent = "Generando…";

  const node   = el("qr-canvas-wrap").querySelector("canvas") || el("qr-canvas-wrap").querySelector("img");
  const qrURL  = node?.tagName === "CANVAS" ? node.toDataURL("image/png") : (node?.src || "");
  const canvas = await dibujarCarnet(voluntarioQRActual, qrURL);
  const blob   = await new Promise(res => canvas.toBlob(res, "image/png"));
  const url    = URL.createObjectURL(blob);
  const link   = document.createElement("a");
  const slug   = nombreCompletoVol(voluntarioQRActual).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]/g, "");
  link.href     = url;
  link.download = `carnet_${slug}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  btn.disabled = false;
  btn.textContent = "Descargar";
});

el("btn-copiar-qr")?.addEventListener("click", async () => {
  const img = el("qr-canvas-wrap").querySelector("img") || el("qr-canvas-wrap").querySelector("canvas");
  if (!img) return;
  try {
    const blob = await (await fetch(img.tagName === "CANVAS" ? img.toDataURL() : img.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    mostrarAlerta("success", "QR copiado al portapapeles.");
  } catch {
    mostrarAlerta("warning", "No se pudo copiar. Usa el botón de descarga.");
  }
});

// ── EXPORTAR VOLUNTARIOS EXCEL ────────────────────────────────────────────────
el("btn-exportar-excel")?.addEventListener("click", () => {
  if (!voluntarios.length) { mostrarAlerta("warning", "No hay voluntarios para exportar."); return; }
  const filas = voluntarios.map(v => ({
    "ID":           v.id || "",
    "Nombre":       v.nombre,
    "Apellido":     v.apellido || "",
    "Teléfono":     v.telefono || "",
    "Correo":       v.correo || "",
    "Carrera":      v.carrera || "",
    "Año":          v.anio || "",
    "¿Por qué deseas ser voluntario?": v.motivacion || "",
    "Experiencia previa":              v.experiencia || "",
    "Horario de clases":               v.horario || "",
    "Habilidad destacada":             v.habilidad || "",
    "Horas ganadas": +(v.totalHoras || 0).toFixed(2),
  }));
  const ws = xlsx().utils.json_to_sheet(filasSegurasHoja(filas));
  const wb = xlsx().utils.book_new();
  xlsx().utils.book_append_sheet(wb, ws, "Voluntarios");
  xlsx().writeFile(wb, `voluntarios_contecs_${new Date().toISOString().split("T")[0]}.xlsx`);
});

// ── EXPORTAR CARNETS QR (ZIP de PNGs) ─────────────────────────────────────────
function generarQRDataURL(text, size) {
  return new Promise(resolve => {
    const tmp = document.createElement("div");
    tmp.style.cssText = "position:fixed;left:-9999px;top:-9999px;visibility:hidden;";
    document.body.appendChild(tmp);
    new QRCode(tmp, {
      text: text || "sin-id",
      width: size, height: size,
      colorDark: "#045223", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
    });
    setTimeout(() => {
      const node = tmp.querySelector("canvas") || tmp.querySelector("img");
      const url  = node?.tagName === "CANVAS" ? node.toDataURL("image/png") : (node?.src || "");
      document.body.removeChild(tmp);
      resolve(url);
    }, 80);
  });
}

function cargarImagen(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fitTextSize(ctx, text, maxWidth, startSize) {
  let size = startSize;
  ctx.font = `bold ${size}px Arial`;
  while (ctx.measureText(text).width > maxWidth && size > 10) {
    size--;
    ctx.font = `bold ${size}px Arial`;
  }
}

function truncarTexto(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(t + "…").width > maxWidth && t.length > 0) t = t.slice(0, -1);
  return t + "…";
}

async function dibujarCarnet(v, qrDataURL) {
  const W = 370, H = 500;
  const canvas = document.createElement("canvas");
  canvas.width  = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  // Fondo blanco
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Clip redondeado
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 16);
  ctx.clip();

  // Header gradiente
  const grad = ctx.createLinearGradient(0, 0, W, 145);
  grad.addColorStop(0, "#045223");
  grad.addColorStop(1, "#1a7a3d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 145);

  // "C O N T E C S"
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("C O N T E C S", W / 2, 42);

  // "2026"
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "12px Arial";
  ctx.fillText("2026", W / 2, 65);

  // Badge "Voluntario"
  const badgeLabel = "Voluntario";
  ctx.font = "bold 12px Arial";
  const bw = ctx.measureText(badgeLabel).width + 36;
  const bx = W / 2 - bw / 2, by = 80, bh = 28;
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(badgeLabel, W / 2, by + bh / 2 + 1);

  // Cuerpo blanco
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 145, W, H - 165);

  const maxW = W - 36;
  const nombre = nombreCompletoVol(v).toUpperCase();

  // Nombre
  ctx.fillStyle = "#045223";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitTextSize(ctx, nombre, maxW, 17);
  ctx.fillText(nombre, W / 2, 175);

  // Correo
  ctx.fillStyle = "#555555";
  ctx.font = "12px Arial";
  ctx.fillText(truncarTexto(ctx, v.correo || "—", maxW), W / 2, 202);

  // Carrera
  ctx.fillText(truncarTexto(ctx, v.carrera || "—", maxW), W / 2, 224);

  // QR
  if (qrDataURL) {
    try {
      const qrImg = await cargarImagen(qrDataURL);
      const qrSize = 168;
      ctx.drawImage(qrImg, (W - qrSize) / 2, 242, qrSize, qrSize);
    } catch { /* sin QR */ }
  }

  // Footer
  ctx.fillStyle = "#f0fdf4";
  ctx.fillRect(0, 435, W, H - 435);
  ctx.fillStyle = "#dcfce7";
  ctx.fillRect(0, 435, W, 1);
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CONTECS 2026  ·  Voluntariado", W / 2, 467);

  ctx.restore();
  return canvas;
}

el("btn-exportar-qr")?.addEventListener("click", async () => {
  const JSZip = window.JSZip;
  if (!JSZip) { mostrarAlerta("error", "Librería JSZip no disponible."); return; }

  let lista = [...voluntarios];
  const textoBusqueda = el("buscar-voluntario")?.value.toLowerCase().trim() || "";
  if (textoBusqueda) {
    lista = lista.filter(v =>
      v.nombre.toLowerCase().includes(textoBusqueda) ||
      (v.apellido || "").toLowerCase().includes(textoBusqueda) ||
      (v.id || "").toLowerCase().includes(textoBusqueda)
    );
  }
  if (filtroHorarioVol) lista = lista.filter(v => v.horario === filtroHorarioVol);

  if (!lista.length) { mostrarAlerta("warning", "No hay voluntarios para exportar."); return; }

  const btn = el("btn-exportar-qr");
  btn.disabled = true;
  btn.textContent = `Generando 0/${lista.length}…`;

  const zip     = new JSZip();
  const carpeta = zip.folder("carnets_voluntarios");

  for (let i = 0; i < lista.length; i++) {
    const v = lista[i];
    btn.textContent = `Generando ${i + 1}/${lista.length}…`;
    const qrURL  = await generarQRDataURL(v.id, 168);
    const canvas = await dibujarCarnet(v, qrURL);
    const blob   = await new Promise(res => canvas.toBlob(res, "image/png"));
    const slug   = nombreCompletoVol(v)
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]/g, "");
    carpeta.file(`${String(i + 1).padStart(3, "0")}_${slug}.png`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const url  = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = `carnets_voluntarios_${new Date().toISOString().split("T")[0]}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  btn.disabled = false;
  btn.textContent = "Exportar QR";
  mostrarAlerta("success", `ZIP con ${lista.length} carnet${lista.length !== 1 ? "s" : ""} descargado. ¡Listo para distribuir!`);
});

// ════════════════════════════════════════════════════════════
// ASISTENCIAS
// ════════════════════════════════════════════════════════════

async function cargarAsistencias() {
  const actividadId = el("filtro-actividad")?.value || "";
  const turnoId     = el("filtro-turno")?.value || "";
  const spAsist = el("asistencias-spinner");
  if (spAsist) spAsist.style.display = "flex";

  try {
    let q = actividadId
      ? query(collection(db, "asistencias_voluntarios"), where("actividadId", "==", actividadId), orderBy("creadoEn", "desc"))
      : query(collection(db, "asistencias_voluntarios"), orderBy("creadoEn", "desc"));
    const snap = await getDocs(q);
    asistenciasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (turnoId) asistenciasCache = asistenciasCache.filter(a => a.turnoId === turnoId);
  } catch {
    asistenciasCache = [];
  }
  renderTablaAsistencias(asistenciasCache);
  if (spAsist) spAsist.style.display = "none";
}

  const ESTRELLAS = { 1: estrellasImg(1), 2: estrellasImg(2), 3: estrellasImg(3), 4: estrellasImg(4), 5: estrellasImg(5) };
const ETIQUETAS = { 1: "Necesita mejora", 2: "Regular", 3: "Bueno", 4: "Muy bueno", 5: "Excelente" };

function resolverAsistencia(a) {
  const vol   = voluntarios.find(v => v._docId === a.voluntarioId);
  const act   = actividades.find(x => x.id === a.actividadId);
  const turno = act?.turnos?.find(t => t.id === a.turnoId);
  return {
    nomVol:   vol?.nombre   || "—",
    nomAct:   act?.nombre   || "—",
    nomTurno: turno?.nombre || "—",
    area:     act?.area     || "",
  };
}

function renderTablaAsistencias(lista) {
  const tb = el("tabla-asistencias-body");
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gris-medio)">Sin asistencias registradas</td></tr>`;
    return;
  }
  tb.innerHTML = lista.map(a => {
    const { nomVol, nomAct, nomTurno } = resolverAsistencia(a);
    return `
    <tr>
      <td><strong>${h(nomVol)}</strong></td>
      <td>${h(nomAct)}</td>
      <td>${h(nomTurno)}</td>
      <td>${fmtHora(a.horaEntrada)}</td>
      <td>${a.horaSalida ? fmtHora(a.horaSalida) : '<span style="color:var(--verde-claro);font-weight:600">En curso</span>'}</td>
      <td><span class="horas-badge">${a.horasGanadas != null ? a.horasGanadas.toFixed(2) + "h" : "—"}</span></td>
      <td title="${escaparAtributo(ETIQUETAS[a.calificacion] || "Sin calificar")}">${ESTRELLAS[a.calificacion] || "—"}</td>
    </tr>`;
  }).join("");
}

el("filtro-actividad")?.addEventListener("change", async () => {
  const actId    = el("filtro-actividad").value;
  const selTurno = el("filtro-turno");
  selTurno.innerHTML = `<option value="">Todos los turnos</option>`;
  if (actId) {
    const a = actividades.find(x => x.id === actId);
    (a?.turnos || []).forEach(t => {
      const opt = document.createElement("option");
      opt.value       = t.id;
      opt.textContent = `${t.nombre} (${t.horaInicio}–${t.horaFin})`;
      selTurno.appendChild(opt);
    });
  }
  await cargarAsistencias();
});

el("filtro-turno")?.addEventListener("change", cargarAsistencias);

el("btn-exportar-asistencias")?.addEventListener("click", () => {
  if (!asistenciasCache.length) { mostrarAlerta("warning", "No hay asistencias para exportar."); return; }
  const filas = asistenciasCache.map(a => {
    const { nomVol, nomAct, nomTurno, area } = resolverAsistencia(a);
    return {
      "Voluntario":    nomVol,
      "Actividad":     nomAct,
      "Turno":         nomTurno,
      "Hora entrada":  fmtHora(a.horaEntrada),
      "Hora salida":   a.horaSalida ? fmtHora(a.horaSalida) : "En curso",
      "Horas ganadas": a.horasGanadas != null ? +a.horasGanadas.toFixed(2) : "",
      "Calificación":  a.calificacion ? ETIQUETAS[a.calificacion] : "Sin calificar",
      "Área":          area,
    };
  });
  const ws = xlsx().utils.json_to_sheet(filasSegurasHoja(filas));
  const wb = xlsx().utils.book_new();
  xlsx().utils.book_append_sheet(wb, ws, "Asistencias");
  xlsx().writeFile(wb, `asistencias_voluntarios_${new Date().toISOString().split("T")[0]}.xlsx`);
});

// ─── Utilidad tab ─────────────────────────────────────────────────────────────
function activarTab(tabId) {
  const btns = document.querySelectorAll(".tab-btn");
  if (!btns.length) return;
  btns.forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === tabId));
}

// ════════════════════════════════════════════════════════════
// GIRAS
// ════════════════════════════════════════════════════════════

async function cargarGiras() {
  try {
    const snap = await getDocs(query(collection(db, "giras_voluntarios"), orderBy("creadoEn", "desc")));
    giras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { giras = []; }
  renderTablaGiras();
}

// Resuelve el estado de pago de cada participante de una gira. Se prefiere el
// dato en vivo del selector (`participantesGiraCache`) sobre el que quedo
// guardado en el documento, para que un pago aprobado despues de crear la gira
// se refleje sin tener que volver a editarla.
function participantesGiraConEstado(gira) {
  return (gira.participantes || []).map(p => {
    const vivo = participantesGiraCache.find(x => x.id === p.id);
    return {
      id: p.id,
      nombre: p.nombre || "",
      codigo: p.codigo || "",
      aprobado: vivo ? vivo.pagoAprobado === true : p.pagoAprobado === true,
    };
  });
}

// Alterna el desglose de participantes de una tarjeta de gira.
window.toggleParticipantesGira = function(id) {
  el(`participantes-gira-${id}`)?.classList.toggle("abierta");
};

function renderTablaGiras() {
  const tb = el("tabla-giras-body");
  if (!tb) return;
  if (!giras.length) {
    tb.innerHTML = `<div style="text-align:center;color:var(--gris-medio);padding:18px 0;">Sin giras registradas. Crea la primera usando el formulario.</div>`;
    return;
  }
  tb.innerHTML = giras.map(g => {
    const listaParticipantes = participantesGiraConEstado(g);
    const noSeleccionados  = Array.isArray(g.noSeleccionados) ? g.noSeleccionados : [];
    const numParticipantes = listaParticipantes.length;
    const numNotificados   = (g.notificados   || []).length;
    const numNotifNoSel    = (g.notificadosNoSeleccionados || []).length;
    // El correo solo puede salir si hay a quién y hay qué decir.
    // Compatibilidad: las giras guardadas con el formato viejo traen un motivo
    // suelto en vez de `motivosAviso`.
    const motivosGira = (Array.isArray(g.motivosAviso) && g.motivosAviso.length) ?
      g.motivosAviso :
      (String(g.motivoNoSeleccionados || "").trim() ?
        [{id: "principal", titulo: g.motivoNoSeleccionados, mensaje: g.mensajeNoSeleccionados}] : []);
    const idsMotivo = new Set(motivosGira.map(m => m.id));
    const conMotivo = noSeleccionados.filter(p =>
      idsMotivo.has(p.motivoId) || (!p.motivoId && motivosGira.length === 1));
    const sinMotivo = noSeleccionados.length - conMotivo.length;
    const listoParaAvisar = conMotivo.length > 0;

    const metaBadges = [
      g.descripcion
        ? `<span style="display:block;width:100%;font-size:11.5px;color:var(--gris-medio);line-height:1.4;">${h(g.descripcion)}</span>`
        : "",
      g.colaboracion
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#f5f5f7;color:var(--gris-medio);padding:2px 8px;border-radius:8px;">${h(g.colaboracion)}</span>`
        : "",
      numParticipantes
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;background:#fff3cd;color:#856404;padding:3px 8px;border-radius:8px;">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
             ${numParticipantes} participante${numParticipantes === 1 ? "" : "s"}
           </span>`
        : "",
      noSeleccionados.length
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;background:#fdf3e6;color:#8e4b10;padding:3px 8px;border-radius:8px;">
             ${noSeleccionados.length} NO SELECCIONADO${noSeleccionados.length === 1 ? "" : "S"}
           </span>`
        : "",
      sinMotivo
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;background:#fdecea;color:#a93226;padding:3px 8px;border-radius:8px;">
             ${sinMotivo} sin motivo asignado
           </span>`
        : "",
      numNotifNoSel
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#f3ece2;color:#6b4a1c;padding:3px 8px;border-radius:8px;">
             ${numNotifNoSel} avisado${numNotifNoSel === 1 ? "" : "s"}
           </span>`
        : "",
      numNotificados
        ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;background:#e9f6ee;color:#1a7a3f;padding:3px 8px;border-radius:8px;">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
             ${numNotificados} notificado${numNotificados === 1 ? "" : "s"}
           </span>`
        : "",
    ].filter(Boolean).join(" ");

    const filas = [
      ["Fecha", fmtFecha(g.fecha)],
      g.hora ? ["Hora", h(fmtHora12(g.hora))] : null,
      g.lugarEncuentro ? ["Lugar de encuentro", h(g.lugarEncuentro)] : null,
      ["Tipo", h(g.area || "—")],
      ["Lugar", h(g.lugar || "—")],
      g.coordinador?.nombre ? ["Coordinador", `${h(g.coordinador.nombre)}${g.coordinador.tipo ? ` (${g.coordinador.tipo === "profesor" ? "Profesor" : "Staff"})` : ""}`] : null,
      g.coordinador?.telefono ? ["Tel. coordinador", h(g.coordinador.telefono)] : null,
      ["Voluntarios req.", g.voluntariosReq ? `<strong style="color:#856404">${g.voluntariosReq}</strong>` : "—"],
      ["Cupo", g.cupo ? `<strong style="color:#1a56db;">${g.cupo}</strong>` : "—"],
      (g.turnos || []).length
        ? ["Turnos", (g.turnos || []).map(t => `<span style="font-size:11px;background:#fff3cd;color:#856404;padding:2px 6px;border-radius:8px;display:inline-block;margin:1px;">${h(t.nombre)} ${h(t.horaInicio)}–${h(t.horaFin)}</span>`).join("")]
        : null,
    ].filter(Boolean);

    return `
    <div class="gira-card">
      <div class="gira-card-top">
        <div>
          <strong class="gira-card-nombre">${h(g.nombre)}</strong>
          <div class="gira-card-badges">${metaBadges}</div>
        </div>
        <span class="gira-estado" style="background:${g.activo ? "#fff3cd" : "#f8f9fa"};color:${g.activo ? "#856404" : "var(--gris-medio)"};">
          ${g.activo ? "Activa" : "Inactiva"}
        </span>
      </div>

      <div class="gira-card-datos">
        ${filas.map(([label, valor]) => `
          <div class="gira-fila">
            <span class="gf-label">${label}</span>
            <span class="gf-valor">${valor}</span>
          </div>`).join("")}
      </div>

      ${numParticipantes || noSeleccionados.length ? `
      <div class="gira-participantes${noSeleccionados.length ? " abierta" : ""}" id="participantes-gira-${escaparAtributo(g.id)}">
        <div class="gira-participantes-titulo" onclick="toggleParticipantesGira('${escaparAtributo(g.id)}')">
          <span>Participantes (${numParticipantes})</span>
          <svg class="gp-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="gira-participantes-lista">
          ${listaParticipantes.map(p => `
          <div class="gp-item">
            <span class="gp-nombre">${h(p.nombre || "(sin nombre)")}${p.codigo ? ` <span class="gp-codigo">${h(p.codigo)}</span>` : ""}</span>
            <span class="gp-estado incluido">Va a la gira${p.aprobado ? "" : " · sin pago aprobado"}</span>
          </div>`).join("")}
          ${noSeleccionados.map(p => {
            const m = motivosGira.find(x => x.id === p.motivoId) ||
              (!p.motivoId && motivosGira.length === 1 ? motivosGira[0] : null);
            return `
          <div class="gp-item">
            <span class="gp-nombre">${h(p.nombre || p.correo || "(sin nombre)")}${
              p.codigo ? ` <span class="gp-codigo">${h(p.codigo)}</span>` :
              p.correo && p.nombre ? ` <span class="gp-codigo">${h(p.correo)}</span>` : ""}${
              p.id ? "" : ` <span class="gp-codigo">no inscrito</span>`}</span>
            <span class="gp-estado ${m ? "no-incluido" : "sin-motivo-badge"}">${
              m ? h(m.titulo || "Sin título") : "SIN MOTIVO ASIGNADO"}</span>
          </div>`;}).join("")}
        </div>
      </div>` : ""}

      <div class="gira-card-acciones acciones-gira">
        <button class="btn-fila editar" onclick="editarGira('${escaparAtributo(g.id)}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="btn-fila notificar" onclick="notificarGira('${escaparAtributo(g.id)}')" id="btn-notificar-${escaparAtributo(g.id)}"
          ${(g.participantes || []).length ? "" : "disabled"}
          title="Notificar participantes por correo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          Notificar
        </button>
        <button class="btn-fila notificar-no" onclick="notificarNoSeleccionados('${escaparAtributo(g.id)}')" id="btn-notificar-no-${escaparAtributo(g.id)}"
          ${listoParaAvisar ? "" : "disabled"}
          title="${listoParaAvisar ?
            `Enviar a ${conMotivo.length} persona(s) el correo de su motivo` :
            "Edita la gira: añade no seleccionados, define motivos y asígnaselos, y guarda"}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Notificar no seleccionados${conMotivo.length ? ` (${conMotivo.length})` : ""}
        </button>
        <button class="btn-fila ${g.activo ? "desactivar" : "activar"}" onclick="toggleGira('${escaparAtributo(g.id)}',${!!g.activo})" title="${g.activo ? "Desactivar" : "Activar"}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
          ${g.activo ? "Desactivar" : "Activar"}
        </button>
        <button class="btn-fila eliminar" onclick="eliminarGira('${escaparAtributo(g.id)}')" title="Eliminar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Eliminar
        </button>
      </div>
    </div>`;
  }).join("");
}

// ── SELECTOR DE PARTICIPANTES (cascada + búsqueda) ──────────────────────────
// Esta lista puede traer miles de participantes del congreso. La version
// anterior reconstruia el innerHTML completo y volvia a colgar un listener por
// fila en cada tecla del buscador y en cada clic de seleccion, lo que en movil
// se sentia como medio segundo de bloqueo por pulsacion. Ahora:
//   1. la lista se precarga en segundo plano al abrir la pagina,
//   2. cada participante trae su texto de busqueda ya normalizado,
//   3. se pinta por lotes (scroll infinito dentro del sheet),
//   4. hay un unico listener delegado en el contenedor, y
//   5. seleccionar a alguien repinta solo su fila, no la lista entera.
const LOTE_PARTICIPANTES = 60;

let participantesGiraPromesa = null;   // dedupe de cargas concurrentes
let participantesGiraFiltrados = [];   // resultado del filtro actual
let participantesGiraVisibles = 0;     // cuantas filas hay pintadas ya
let temporizadorBusquedaGira = null;

// Texto unico contra el que se busca (sin tildes y en minusculas), calculado
// una sola vez por participante en vez de en cada tecla.
function prepararParticipanteGira(p) {
  p._buscar = normalizarParaComparar(
    [p.nombre, p.cedula, p.codigo].filter(Boolean).join(" ")
  );
  return p;
}

async function asegurarParticipantesGiraCargados() {
  if (participantesGiraCargados) return;
  if (!participantesGiraPromesa) {
    participantesGiraPromesa = listarParticipantesParaGiras()
      .then(lista => {
        participantesGiraCache = (lista || []).map(prepararParticipanteGira);
        participantesGiraCargados = true;
      })
      .catch(e => {
        // Se limpia la promesa para que un reintento del staff vuelva a pedirla.
        participantesGiraPromesa = null;
        throw e;
      });
  }
  try {
    await participantesGiraPromesa;
  } catch (e) {
    const lista = el("lista-participantes-gira");
    if (lista) lista.innerHTML = `<div style="text-align:center;padding:24px;color:var(--rojo);font-size:13px;">${h(e.message)}</div>`;
    const contador = el("sheet-part-contador");
    if (contador) contador.textContent = "No se pudo cargar";
    throw e;
  }
}

// Precarga silenciosa: si falla no se avisa nada, el staff lo reintentara al
// abrir el selector y ahi si vera el error.
function precalentarParticipantesGira() {
  asegurarParticipantesGiraCargados()
    // Las tarjetas ya se pintaron con el `pagoAprobado` guardado en cada gira;
    // al llegar el cache se repintan con el estado real de hoy.
    .then(() => { if (giras.length) renderTablaGiras(); })
    .catch(() => {});
}

// Un participante seleccionado cuyo pago no esta aprobado sigue en la lista de
// la gira, pero se marca como NO INCLUIDO. Es una etiqueta informativa para el
// staff y para los correos; el check-in por QR no la consulta (ver
// marcarCheckpointGira en functions/operaciones-qr.js).
function estaAprobadoParaGira(p) {
  return p?.pagoAprobado === true;
}

function filaParticipanteGira(p, seleccionado) {
  const meta = [p.codigo, CATEGORIA_LABELS_GIRA[p.categoria] || p.categoria, p.cedula]
    .filter(Boolean).join(" · ");
  const aprobado = estaAprobadoParaGira(p);
  const clasePago = aprobado ? "aprobado" : "no-incluido";
  const textoPago = aprobado
    ? "Pago aprobado"
    : `Pago sin aprobar<span class="pill-no-incluido">NO INCLUIDO EN LA GIRA</span>`;
  const check = seleccionado
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : "";
  return `
      <div class="part-item ${seleccionado ? "selected" : ""}" data-id="${escaparAtributo(p.id)}">
        <div class="part-item-check">${check}</div>
        <div class="part-item-info">
          <div class="part-item-nombre">${h(p.nombre || "(sin nombre)")}</div>
          <div class="part-item-meta">${h(meta || "—")}</div>
          <div class="part-item-pago ${clasePago}">${textoPago}</div>
        </div>
      </div>`;
}

function actualizarContadorParticipantesGira() {
  const contador = el("sheet-part-contador");
  if (!contador) return;
  const total = participantesGiraFiltrados.length;
  const sel   = conteoDestinoGira();
  const mostrando = total > participantesGiraVisibles
    ? `${participantesGiraVisibles} de ${total}`
    : String(total);
  contador.textContent = `${mostrando} participante${total === 1 ? "" : "s"} · ${sel} seleccionado${sel === 1 ? "" : "s"}`;
}

// Pinta el siguiente lote al final de la lista, sin tocar lo ya renderizado.
function pintarLoteParticipantesGira() {
  const lista = el("lista-participantes-gira");
  if (!lista) return;
  const idsSeleccionados = idsDestinoGira();
  const siguiente = participantesGiraFiltrados.slice(
    participantesGiraVisibles,
    participantesGiraVisibles + LOTE_PARTICIPANTES,
  );
  if (!siguiente.length) return;

  el("btn-mas-participantes-gira")?.remove();
  lista.insertAdjacentHTML(
    "beforeend",
    siguiente.map(p => filaParticipanteGira(p, idsSeleccionados.has(p.id))).join(""),
  );
  participantesGiraVisibles += siguiente.length;

  const faltan = participantesGiraFiltrados.length - participantesGiraVisibles;
  if (faltan > 0) {
    lista.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="sheet-part-mas" id="btn-mas-participantes-gira">Mostrar ${Math.min(faltan, LOTE_PARTICIPANTES)} más (quedan ${faltan})</button>`,
    );
  }
  actualizarContadorParticipantesGira();
}

function renderListaParticipantesGira() {
  const lista = el("lista-participantes-gira");
  if (!lista) return;
  const termino = normalizarParaComparar(el("buscar-participante-gira")?.value || "").trim();

  participantesGiraFiltrados = termino
    ? participantesGiraCache.filter(p => (p._buscar || "").includes(termino))
    : participantesGiraCache;

  lista.innerHTML = "";
  participantesGiraVisibles = 0;

  if (participantesGiraFiltrados.length === 0) {
    lista.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gris-medio);font-size:13px;">No hay participantes que coincidan con tu búsqueda.</div>`;
    actualizarContadorParticipantesGira();
    return;
  }
  lista.scrollTop = 0;
  pintarLoteParticipantesGira();
}

// Repinta una sola fila tras seleccionarla/deseleccionarla. Si el participante
// no esta en el lote visible (p. ej. se quito desde un chip) simplemente no hay
// nada que actualizar en pantalla.
function actualizarFilaParticipanteGira(id) {
  const fila = el("lista-participantes-gira")
    ?.querySelector(`.part-item[data-id="${CSS.escape(id)}"]`);
  if (!fila) return;
  const seleccionado = idsDestinoGira().has(id);
  fila.classList.toggle("selected", seleccionado);
  const check = fila.querySelector(".part-item-check");
  if (check) {
    check.innerHTML = seleccionado
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : "";
  }
}

function toggleParticipanteGira(id) {
  const yaEsta = idsDestinoGira().has(id);
  if (destinoSeleccionGira === "noSeleccionados") {
    if (yaEsta) {
      noSeleccionados = noSeleccionados.filter(p => p.id !== id);
    } else {
      const p = participantesGiraCache.find(x => x.id === id);
      // Con un solo motivo definido se asigna solo: es el caso comun.
      if (p) noSeleccionados.push({
        origen: "participante",
        id: p.id, nombre: p.nombre || "", codigo: p.codigo || "", cedula: p.cedula || "",
        pagoAprobado: p.pagoAprobado === true,
        motivoId: motivosAviso.length === 1 ? motivosAviso[0].id : "",
        nota: "",
      });
    }
    renderNoSeleccionados();
    renderMotivos();
  } else {
    if (yaEsta) {
      participantesGiraSeleccionados = participantesGiraSeleccionados.filter(p => p.id !== id);
    } else {
      const p = participantesGiraCache.find(x => x.id === id);
      if (p) participantesGiraSeleccionados.push(p);
    }
    renderChipsParticipantesGira();
    avisarParticipantesEnAmbasListas();
  }
  actualizarFilaParticipanteGira(id);
  actualizarContadorParticipantesGira();
}

function renderChipsParticipantesGira() {
  const cont  = el("gira-participantes-chips");
  const vacio = el("gira-participantes-vacio");
  if (!cont) return;
  if (participantesGiraSeleccionados.length === 0) {
    cont.innerHTML = "";
    if (vacio) vacio.style.display = "block";
    return;
  }
  if (vacio) vacio.style.display = "none";
  cont.innerHTML = participantesGiraSeleccionados.map(p => {
    const aviso = estaAprobadoParaGira(p)
      ? ""
      : ` <span title="Pago sin aprobar — quedará marcado como NO INCLUIDO EN LA GIRA" style="color:#a93226;font-weight:800;">●</span>`;
    return `
    <span class="chip-participante" data-id="${escaparAtributo(p.id)}">
      ${h(p.nombre || "(sin nombre)")}${aviso}
      <button type="button" title="Quitar" data-quitar="${escaparAtributo(p.id)}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg></button>
    </span>`;
  }).join("");
}

// ── NO SELECCIONADOS: motivos + personas ────────────────────────────────────
// El texto del correo se escribe una vez por MOTIVO, no por persona: con 30
// personas sin cupo, escribirlo 30 veces no es viable. Cada persona apunta a un
// motivo y, si su caso lo necesita, lleva ademas una nota individual.
//
// Dos clases de entrada conviven en la misma lista:
//   - participante inscrito -> tiene `id` (documento en /participantes)
//   - correo suelto         -> tiene `correo` (aplico sin estar inscrito)
let motivosAviso = [];              // [{id, titulo, mensaje}]
let noSeleccionados = [];           // [{id|correo, nombre, codigo, motivoId, nota}]
let marcadosLote = new Set();       // claves marcadas para asignacion en lote

let contadorMotivo = 0;
function nuevoIdMotivo() {
  contadorMotivo += 1;
  return `m${Date.now().toString(36)}${contadorMotivo}`;
}

// Identifica una entrada sin ambiguedad: por id si es participante, por correo
// si es suelto. Debe coincidir con claveNoSeleccionado en functions/index.js.
function claveNoSel(e) {
  if (e?.id) return e.id;
  const c = String(e?.correo || "").trim().toLowerCase();
  return c ? `correo:${c}` : null;
}

function esAprobadoNoSel(e) {
  return e?.pagoAprobado === true;
}

// ── Motivos ─────────────────────────────────────────────────────────────────
function renderMotivos() {
  const cont = el("gira-motivos-lista");
  if (!cont) return;
  if (!motivosAviso.length) {
    cont.innerHTML = `<div class="nota-no-sel">Todavía no hay motivos. Añade al menos uno para poder avisar.</div>`;
  } else {
    cont.innerHTML = motivosAviso.map((m, i) => {
      const usados = noSeleccionados.filter(p => p.motivoId === m.id).length;
      return `
      <div class="motivo-card" data-motivo="${escaparAtributo(m.id)}">
        <div class="motivo-card-top">
          <input type="text" maxlength="120" data-campo="titulo" data-motivo="${escaparAtributo(m.id)}"
                 placeholder="Motivo ${i + 1} — ej. Cupo lleno" value="${escaparAtributo(m.titulo || "")}"/>
          <button type="button" class="motivo-borrar" data-borrar-motivo="${escaparAtributo(m.id)}" title="Eliminar motivo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
          </button>
        </div>
        <textarea rows="4" maxlength="4000" data-campo="mensaje" data-motivo="${escaparAtributo(m.id)}"
                  placeholder="Texto del correo para este motivo. Deja una línea en blanco entre párrafos.">${h(m.mensaje || "")}</textarea>
        <div class="motivo-meta">${usados} persona${usados === 1 ? "" : "s"} con este motivo${(m.mensaje || "").length ? ` · ${(m.mensaje || "").length}/4000` : ""}</div>
      </div>`;
    }).join("");
  }
  renderSelectoresMotivo();
}

el("gira-motivos-lista")?.addEventListener("input", (ev) => {
  const campo = ev.target.dataset?.campo;
  const id = ev.target.dataset?.motivo;
  if (!campo || !id) return;
  const m = motivosAviso.find(x => x.id === id);
  if (!m) return;
  m[campo] = ev.target.value;
  // Solo se refresca el contador de caracteres: repintar entero aqui haria
  // perder el foco y la posicion del cursor mientras se escribe.
  const meta = ev.target.closest(".motivo-card")?.querySelector(".motivo-meta");
  if (meta && campo === "mensaje") {
    const usados = noSeleccionados.filter(p => p.motivoId === id).length;
    meta.textContent = `${usados} persona${usados === 1 ? "" : "s"} con este motivo` +
      (m.mensaje.length ? ` · ${m.mensaje.length}/4000` : "");
  }
  if (campo === "titulo") renderSelectoresMotivo();
});

el("gira-motivos-lista")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-borrar-motivo]");
  if (!btn) return;
  const id = btn.dataset.borrarMotivo;
  const usados = noSeleccionados.filter(p => p.motivoId === id).length;
  if (usados && !confirm(
    `${usados} persona(s) tienen este motivo asignado. Si lo eliminas se quedan sin motivo y no recibirán correo hasta que les asignes otro.\n\n¿Eliminar de todos modos?`
  )) return;
  motivosAviso = motivosAviso.filter(m => m.id !== id);
  noSeleccionados.forEach(p => { if (p.motivoId === id) p.motivoId = ""; });
  renderMotivos();
  renderNoSeleccionados();
});

el("btn-agregar-motivo")?.addEventListener("click", () => {
  motivosAviso.push({ id: nuevoIdMotivo(), titulo: "", mensaje: "" });
  renderMotivos();
  el("gira-motivos-lista")?.querySelector(".motivo-card:last-child input")?.focus();
});

function opcionesMotivo(seleccionado) {
  const vacia = `<option value="">— Sin motivo —</option>`;
  return vacia + motivosAviso.map((m, i) =>
    `<option value="${escaparAtributo(m.id)}"${m.id === seleccionado ? " selected" : ""}>${h(m.titulo || `Motivo ${i + 1}`)}</option>`
  ).join("");
}

// Repinta los desplegables sin tocar el resto de la fila (nota, marcado).
function renderSelectoresMotivo() {
  el("gira-nosel-lista")?.querySelectorAll("select[data-motivo-de]").forEach(sel => {
    const actual = sel.value;
    sel.innerHTML = opcionesMotivo(actual);
    sel.classList.toggle("sin-motivo", !sel.value);
  });
  const lote = el("gira-lote-motivo");
  if (lote) lote.innerHTML = opcionesMotivo(lote.value);
}

// ── Personas ────────────────────────────────────────────────────────────────
function renderNoSeleccionados() {
  const cont  = el("gira-nosel-lista");
  const vacio = el("gira-nosel-vacio");
  if (!cont) return;

  if (vacio) vacio.style.display = noSeleccionados.length ? "none" : "block";
  cont.innerHTML = noSeleccionados.map(p => {
    const clave = claveNoSel(p);
    const quien = p.id ?
      `<strong>${h(p.nombre || "(sin nombre)")}</strong> <span>${h(p.codigo || "")}${esAprobadoNoSel(p) ? "" : " · pago sin aprobar"}</span>` :
      `<strong>${h(p.nombre || p.correo)}</strong> <span>${p.nombre ? h(p.correo) + " · " : ""}no inscrito</span>`;
    return `
    <div class="nosel-fila" data-clave="${escaparAtributo(clave)}">
      <input type="checkbox" data-marcar="${escaparAtributo(clave)}"${marcadosLote.has(clave) ? " checked" : ""} title="Marcar para asignar en lote"/>
      <div class="nosel-quien">${quien}</div>
      <select data-motivo-de="${escaparAtributo(clave)}" class="${p.motivoId ? "" : "sin-motivo"}">${opcionesMotivo(p.motivoId)}</select>
      <input type="text" class="nosel-nota" maxlength="1000" data-nota-de="${escaparAtributo(clave)}"
             placeholder="Nota para esta persona (opcional)" value="${escaparAtributo(p.nota || "")}"/>
      <button type="button" class="nosel-quitar" data-quitar-nosel="${escaparAtributo(clave)}" title="Quitar">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join("");

  actualizarBarraLote();
  avisarParticipantesEnAmbasListas();
}

function actualizarBarraLote() {
  const barra = el("gira-barra-lote");
  const conteo = el("gira-lote-conteo");
  if (!barra) return;
  // Solo se marcan los que estan en pantalla; los demas se olvidan.
  const clavesVivas = new Set(noSeleccionados.map(claveNoSel));
  marcadosLote = new Set([...marcadosLote].filter(c => clavesVivas.has(c)));
  barra.classList.toggle("visible", marcadosLote.size > 0);
  if (conteo) conteo.textContent = `${marcadosLote.size} marcado${marcadosLote.size === 1 ? "" : "s"}`;
}

el("gira-nosel-lista")?.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset?.motivoDe) {
    const p = noSeleccionados.find(x => claveNoSel(x) === t.dataset.motivoDe);
    if (p) p.motivoId = t.value;
    t.classList.toggle("sin-motivo", !t.value);
    renderMotivos();
    return;
  }
  if (t.dataset?.marcar) {
    if (t.checked) marcadosLote.add(t.dataset.marcar);
    else marcadosLote.delete(t.dataset.marcar);
    actualizarBarraLote();
  }
});

el("gira-nosel-lista")?.addEventListener("input", (ev) => {
  const clave = ev.target.dataset?.notaDe;
  if (!clave) return;
  const p = noSeleccionados.find(x => claveNoSel(x) === clave);
  if (p) p.nota = ev.target.value;
});

el("gira-nosel-lista")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-quitar-nosel]");
  if (!btn) return;
  const clave = btn.dataset.quitarNosel;
  noSeleccionados = noSeleccionados.filter(p => claveNoSel(p) !== clave);
  marcadosLote.delete(clave);
  renderNoSeleccionados();
  renderMotivos();
  renderListaParticipantesGiraSiAbierta();
});

el("btn-asignar-lote")?.addEventListener("click", () => {
  const motivoId = el("gira-lote-motivo").value;
  let n = 0;
  noSeleccionados.forEach(p => {
    if (marcadosLote.has(claveNoSel(p))) { p.motivoId = motivoId; n += 1; }
  });
  marcadosLote.clear();
  renderNoSeleccionados();
  renderMotivos();
  mostrarAlerta("success", `Motivo asignado a ${n} persona${n === 1 ? "" : "s"}.`);
});

// Si el selector de participantes esta abierto, refresca su estado visual.
function renderListaParticipantesGiraSiAbierta() {
  if (el("sheet-part")?.classList.contains("show")) renderListaParticipantesGira();
}

// Las dos listas son excluyentes: quien va a la gira no puede estar tambien
// entre los que reciben el correo de "no fuiste seleccionado". Se avisa en vez
// de impedirlo, para que el staff decida en cual dejarlo.
function avisarParticipantesEnAmbasListas() {
  const aviso = el("gira-aviso-ambas");
  if (!aviso) return;
  const enGira = new Set(participantesGiraSeleccionados.map(p => p.id));
  // Los correos sueltos tambien se cruzan: pegar la lista completa de
  // solicitantes suele incluir a gente que SI fue seleccionada. Solo se puede
  // comparar contra el correo institucional, que es el unico que trae
  // listarParticipantesParaGiras.
  const correosEnGira = new Set(
    participantesGiraSeleccionados
      .map(p => String(p.correoInstitucional || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const repetidos = noSeleccionados.filter(p =>
    (p.id && enGira.has(p.id)) ||
    (!p.id && correosEnGira.has(String(p.correo || "").toLowerCase()))
  );
  if (!repetidos.length) {
    aviso.classList.remove("visible");
    aviso.textContent = "";
    return;
  }
  aviso.classList.add("visible");
  aviso.textContent =
    `${repetidos.length === 1 ? "Esta persona está" : `Estas ${repetidos.length} personas están`} ` +
    `en las dos listas: ${repetidos.map(p => p.nombre || p.correo || p.id).join(", ")}. ` +
    `Recibirá${repetidos.length === 1 ? "" : "n"} los dos correos. Quítal${repetidos.length === 1 ? "a" : "as"} de una.`;
}

// ── Correos sueltos ─────────────────────────────────────────────────────────
// Gente que aplico a la gira sin estar inscrita en el congreso: no tiene
// documento en /participantes, asi que no aparece en el selector. El parseo
// vive en js/core/correos.js para poder probarlo de verdad.
function absorberCorreosEscritos({silencioso = false} = {}) {
  const campo = el("gira-nosel-correos");
  const error = el("gira-correos-error");
  if (!campo || !campo.value.trim()) return { validos: 0, invalidos: 0 };

  const yaHay = noSeleccionados.filter(p => !p.id).map(p => p.correo);
  const { validos, invalidos, repetidos } = parsearListaCorreos(campo.value, yaHay);
  // Si solo hay un motivo, se asigna solo: es el caso comun.
  const motivoPorDefecto = motivosAviso.length === 1 ? motivosAviso[0].id : "";
  validos.forEach(c => noSeleccionados.push({
    origen: "externo", correo: c.correo, nombre: c.nombre,
    motivoId: motivoPorDefecto, nota: "",
  }));

  // Lo que no se pudo interpretar se queda en el campo para poder corregirlo,
  // en vez de desaparecer sin explicacion.
  campo.value = invalidos.join("\n");
  renderNoSeleccionados();
  renderMotivos();

  if (error) {
    if (invalidos.length) {
      error.classList.add("visible");
      error.textContent = `No se pudo leer ${invalidos.length === 1 ? "esta dirección" : `estas ${invalidos.length} direcciones`}: ${invalidos.join(", ")}. Quedaron en el campo para que las corrijas.`;
    } else {
      error.classList.remove("visible");
      error.textContent = "";
    }
  }
  if (!silencioso && (validos.length || repetidos)) {
    mostrarAlerta(validos.length ? "success" : "warning",
        `${validos.length} correo${validos.length === 1 ? "" : "s"} agregado${validos.length === 1 ? "" : "s"}` +
        (repetidos ? ` · ${repetidos} ya estaba${repetidos === 1 ? "" : "n"} en la lista` : ""));
  }
  return { validos: validos.length, invalidos: invalidos.length };
}

el("btn-agregar-correos-nosel")?.addEventListener("click", () => absorberCorreosEscritos());


function abrirSheetParticipantesGira() {
  el("overlay-part")?.classList.add("show");
  el("sheet-part")?.classList.add("show");
  document.body.style.overflow = "hidden";
}
function cerrarSheetParticipantesGira() {
  el("overlay-part")?.classList.remove("show");
  el("sheet-part")?.classList.remove("show");
  document.body.style.overflow = "";
}

// Delegacion: un solo listener para toda la lista, en vez de uno por fila.
el("lista-participantes-gira")?.addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-mas-participantes-gira")) {
    pintarLoteParticipantesGira();
    return;
  }
  const item = ev.target.closest(".part-item");
  if (item?.dataset.id) toggleParticipanteGira(item.dataset.id);
});

// Scroll infinito dentro del sheet: al acercarse al final se pinta otro lote.
el("lista-participantes-gira")?.addEventListener("scroll", (ev) => {
  const cont = ev.currentTarget;
  if (participantesGiraVisibles >= participantesGiraFiltrados.length) return;
  if (cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 240) {
    pintarLoteParticipantesGira();
  }
}, { passive: true });

async function abrirSelectorGira(destino) {
  destinoSeleccionGira = destino;
  const titulo = el("sheet-part-titulo-txt");
  if (titulo) {
    titulo.textContent = destino === "noSeleccionados" ?
      "Seleccionar NO seleccionados" : "Seleccionar participantes";
  }
  abrirSheetParticipantesGira();
  const lista = el("lista-participantes-gira");
  if (!participantesGiraCargados) {
    // Si la precarga en segundo plano habia fallado, el sheet conserva su
    // mensaje de error; se limpia antes de reintentar.
    if (lista) lista.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gris-medio);font-size:13px;">Cargando participantes...</div>`;
    const contador = el("sheet-part-contador");
    if (contador) contador.textContent = "Cargando...";
  }
  try {
    await asegurarParticipantesGiraCargados();
    renderListaParticipantesGira();
  } catch { /* el mensaje de error ya quedó en el sheet */ }
}

el("btn-abrir-participantes-gira")?.addEventListener("click",
    () => abrirSelectorGira("participantes"));
el("btn-abrir-nosel-gira")?.addEventListener("click",
    () => abrirSelectorGira("noSeleccionados"));

// El filtro se aplica tras una pausa corta: escribir "gonzalez" ya no dispara
// ocho filtrados y ocho repintados seguidos.
el("buscar-participante-gira")?.addEventListener("input", () => {
  clearTimeout(temporizadorBusquedaGira);
  temporizadorBusquedaGira = setTimeout(renderListaParticipantesGira, 120);
});
el("btn-cerrar-sheet-part")?.addEventListener("click", cerrarSheetParticipantesGira);
el("btn-listo-participantes-gira")?.addEventListener("click", cerrarSheetParticipantesGira);
el("overlay-part")?.addEventListener("click", cerrarSheetParticipantesGira);

el("btn-guardar-gira")?.addEventListener("click", async () => {
  // Si quedo texto sin procesar en el campo de correos, se absorbe ahora: de
  // lo contrario "Guardar gira" reportaba exito y limpiarFormGira() borraba el
  // campo, perdiendo en silencio todo lo que se hubiera pegado ahi.
  const pendiente = absorberCorreosEscritos({silencioso: true});
  if (pendiente.invalidos) {
    mostrarAlerta("error",
        `Hay ${pendiente.invalidos} dirección(es) que no se pudieron leer. Corrígelas o bórralas antes de guardar.`);
    el("gira-nosel-correos").focus();
    return;
  }
  if (pendiente.validos) {
    mostrarAlerta("warning",
        `Se agregaron ${pendiente.validos} correo(s) que habías escrito pero no añadido.`);
  }

  const nombre = el("gira-nombre").value.trim();
  const fecha  = el("gira-fecha").value;
  const hora   = el("gira-hora").value; // "HH:MM" o "" si no se puso
  const area   = el("gira-area").value;
  if (!nombre || !fecha || !area) { mostrarAlerta("error", "Nombre, fecha y tipo son obligatorios."); return; }

  const coordCorreo = el("gira-coord-correo").value.trim();
  if (coordCorreo && !/@utp\.ac\.pa$/i.test(coordCorreo)) {
    mostrarAlerta("error", "El correo del coordinador debe ser institucional (@utp.ac.pa)."); return;
  }

  const data = {
    nombre, descripcion: el("gira-descripcion").value.trim(),
    fecha: new Date(fecha + "T" + (hora || "12:00") + ":00"),
    hora: hora || null, area,
    lugar:          el("gira-lugar").value.trim(),
    lugarEncuentro: el("gira-lugar-encuentro").value.trim(),
    voluntariosReq: parseInt(el("gira-voluntarios-req").value) || 0,
    cupo:           parseInt(el("gira-cupo").value) || null,
    colaboracion:   el("gira-colaboracion").value.trim(),
    coordinador: {
      nombre:    el("gira-coord-nombre").value.trim(),
      tipo:      el("gira-coord-tipo").value,
      telefono:  el("gira-coord-telefono").value.trim(),
      correoInstitucional: coordCorreo,
    },
    // Se guarda `pagoAprobado` tal como estaba al crear/editar la gira, para
    // que la tarjeta pueda marcar "NO INCLUIDO EN LA GIRA" sin depender de que
    // el selector ya haya cargado. Al pintar se prefiere el dato en vivo del
    // cache (un pago aprobado despues deja de aparecer como no incluido).
    participantes:  participantesGiraSeleccionados.map(p => ({
      id: p.id, nombre: p.nombre || "", codigo: p.codigo || "", cedula: p.cedula || "",
      correoInstitucional: p.correoInstitucional || "",
      pagoAprobado: estaAprobadoParaGira(p),
    })),
    // Lista aparte: no van a la gira, solo reciben el correo de aviso. El
    // motivo y el mensaje se guardan con la gira para que la Cloud Function los
    // lea del documento y no de lo que mande el navegador.
    // Motivos y personas viajan juntos: la Cloud Function busca el motivo de
    // cada quien por `motivoId` y le manda ese texto, mas su nota si la tiene.
    motivosAviso: motivosAviso
      .filter(m => String(m.titulo || "").trim() && String(m.mensaje || "").trim())
      .map(m => ({ id: m.id, titulo: m.titulo.trim(), mensaje: m.mensaje.trim() })),
    noSeleccionados: noSeleccionados.map(p => (p.id ? {
      origen: "participante",
      id: p.id, nombre: p.nombre || "", codigo: p.codigo || "", cedula: p.cedula || "",
      pagoAprobado: p.pagoAprobado === true,
      motivoId: p.motivoId || "", nota: String(p.nota || "").trim(),
    } : {
      // Sin `id`: no tiene documento en /participantes. La Cloud Function lo
      // distingue por eso y le escribe directo al correo.
      origen: "externo", correo: p.correo, nombre: p.nombre || "",
      motivoId: p.motivoId || "", nota: String(p.nota || "").trim(),
    })),
    activo: true, actualizadoEn: serverTimestamp(),
  };
  el("btn-guardar-gira").disabled = true;
  el("btn-guardar-gira").textContent = "Guardando...";
  try {
    if (editandoGiraId) {
      await updateDoc(doc(db, "giras_voluntarios", editandoGiraId), data);
      mostrarAlerta("success", "Gira actualizada.");
    } else {
      data.creadoEn = serverTimestamp(); data.creadoPor = auth.currentUser?.uid || "";
      data.turnos   = [];
      await addDoc(collection(db, "giras_voluntarios"), data);
      mostrarAlerta("success", "Gira creada correctamente.");
    }
    limpiarFormGira(); await cargarGiras();
  } catch (e) { mostrarAlerta("error", "Error al guardar: " + e.message); }
  el("btn-guardar-gira").disabled = false;
  el("btn-guardar-gira").textContent = "Guardar gira";
});

function limpiarFormGira() {
  el("gira-nombre").value = el("gira-descripcion").value = el("gira-fecha").value = "";
  el("gira-hora").value = "";
  el("gira-area").value = el("gira-lugar").value = "";
  el("gira-lugar-encuentro").value = "";
  el("gira-voluntarios-req").value = el("gira-colaboracion").value = "";
  el("gira-cupo").value = "";
  el("gira-coord-nombre").value = el("gira-coord-telefono").value = el("gira-coord-correo").value = "";
  el("gira-coord-tipo").value = "";
  editandoGiraId = null;
  participantesGiraSeleccionados = [];
  motivosAviso = [];
  noSeleccionados = [];
  marcadosLote.clear();
  el("gira-nosel-correos").value = "";
  el("gira-correos-error").classList.remove("visible");
  renderChipsParticipantesGira();
  renderMotivos();
  renderNoSeleccionados();
  el("form-gira-titulo").textContent = "Crear nueva gira";
  el("btn-cancelar-gira").style.display = "none";
}

window.editarGira = function(id) {
  const g = giras.find(x => x.id === id);
  if (!g) return;
  editandoGiraId = id;
  el("gira-nombre").value          = g.nombre || "";
  el("gira-descripcion").value     = g.descripcion || "";
  el("gira-area").value            = g.area || "";
  el("gira-lugar").value           = g.lugar || "";
  el("gira-lugar-encuentro").value = g.lugarEncuentro || "";
  el("gira-voluntarios-req").value = g.voluntariosReq || "";
  el("gira-cupo").value            = g.cupo || "";
  el("gira-colaboracion").value    = g.colaboracion || "";
  el("gira-coord-nombre").value    = g.coordinador?.nombre || "";
  el("gira-coord-tipo").value      = g.coordinador?.tipo || "";
  el("gira-coord-telefono").value  = g.coordinador?.telefono || "";
  el("gira-coord-correo").value    = g.coordinador?.correoInstitucional || "";
  if (g.fecha) {
    const d = g.fecha.toDate ? g.fecha.toDate() : new Date(g.fecha);
    el("gira-fecha").value = d.toISOString().split("T")[0];
  }
  el("gira-hora").value = g.hora || "";
  // Al reabrir una gira se refresca el estado de pago desde el cache si ya
  // esta disponible; si no, se conserva el valor guardado con la gira.
  participantesGiraSeleccionados = (g.participantes || []).map(p => {
    const vivo = participantesGiraCache.find(x => x.id === p.id);
    return { ...p, pagoAprobado: vivo ? vivo.pagoAprobado : p.pagoAprobado === true };
  });
  // Formato nuevo: motivos con id. Las giras guardadas antes traian un unico
  // motivo/mensaje suelto — se convierte aqui en un motivo con id "principal",
  // al que van a parar las entradas que no tengan `motivoId`.
  motivosAviso = Array.isArray(g.motivosAviso) && g.motivosAviso.length ?
    g.motivosAviso.map(m => ({ id: m.id, titulo: m.titulo || "", mensaje: m.mensaje || "" })) :
    (String(g.motivoNoSeleccionados || "").trim() ? [{
      id: "principal",
      titulo: g.motivoNoSeleccionados || "",
      mensaje: g.mensajeNoSeleccionados || "",
    }] : []);
  const motivoUnico = motivosAviso.length === 1 ? motivosAviso[0].id : "";

  noSeleccionados = (g.noSeleccionados || []).map(p => {
    const vivo = p.id ? participantesGiraCache.find(x => x.id === p.id) : null;
    return {
      ...p,
      motivoId: p.motivoId || motivoUnico,
      nota: p.nota || "",
      pagoAprobado: vivo ? vivo.pagoAprobado : p.pagoAprobado === true,
    };
  });
  marcadosLote.clear();
  el("gira-nosel-correos").value = "";
  el("gira-correos-error").classList.remove("visible");
  renderChipsParticipantesGira();
  renderMotivos();
  renderNoSeleccionados();
  el("form-gira-titulo").textContent = "Editar gira";
  el("btn-cancelar-gira").style.display = "inline-flex";
  activarTab("tab-giras");
  el("gira-nombre").scrollIntoView({ behavior: "smooth" });
};

window.toggleGira = async function(id, estadoActual) {
  try {
    await updateDoc(doc(db, "giras_voluntarios", id), { activo: !estadoActual, actualizadoEn: serverTimestamp() });
    await cargarGiras();
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

window.eliminarGira = async function(id) {
  const nombre = giras.find(g => g.id === id)?.nombre || "esta gira";
  if (!confirm(`¿Eliminar la gira "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "giras_voluntarios", id));
    giras = giras.filter(g => g.id !== id);
    renderTablaGiras();
    mostrarAlerta("success", "Gira eliminada.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

window.notificarGira = async function(id) {
  const btn = el(`btn-notificar-${id}`);
  if (!btn) return;
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Notificando...";
  try {
    const resultado = await notificarParticipantesGira(id);
    mostrarAlerta(resultado.enviados > 0 ? "success" : "warning", resultado.mensaje);
    await cargarGiras();
  } catch (e) {
    mostrarAlerta("error", "Error al notificar: " + e.message);
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
};

// Aviso a quienes quedaron fuera por pago sin aprobar. El correo no lleva
// credenciales ni enlace a la gira a proposito: no fueron incluidos, asi que no
// deben recibir el acceso. La Cloud Function vuelve a comprobar el estado de
// pago con Admin SDK antes de enviar — el cliente solo propone a quien avisar.
// Envía el correo que el equipo de Giras redactó en el formulario a la lista de
// no seleccionados. El motivo y el mensaje viajan en el documento de la gira,
// no en la llamada: la Cloud Function los lee de ahí, así que lo que sale por
// correo es exactamente lo que quedó guardado y revisado en el panel.
// Envía a cada persona de la lista el correo del motivo que le asignaron, más
// su nota individual si la tiene. Motivos y textos viajan en el documento de la
// gira: la Cloud Function los lee de ahí, así que lo que sale por correo es
// exactamente lo que quedó guardado y revisado en el panel.
window.notificarNoSeleccionados = async function(id) {
  const btn = el(`btn-notificar-no-${id}`);
  if (!btn) return;
  const gira = giras.find(g => g.id === id);
  const lista = Array.isArray(gira?.noSeleccionados) ? gira.noSeleccionados : [];
  const motivos = (Array.isArray(gira?.motivosAviso) && gira.motivosAviso.length) ?
    gira.motivosAviso :
    (String(gira?.motivoNoSeleccionados || "").trim() ?
      [{id: "principal", titulo: gira.motivoNoSeleccionados, mensaje: gira.mensajeNoSeleccionados}] : []);

  if (!lista.length) {
    mostrarAlerta("warning", "Esta gira no tiene nadie en la lista de no seleccionados.");
    return;
  }
  if (!motivos.length) {
    mostrarAlerta("warning", "Esta gira no tiene motivos de aviso. Edita la gira y define al menos uno.");
    return;
  }

  const idsMotivo = new Set(motivos.map(m => m.id));
  const conMotivo = lista.filter(p => idsMotivo.has(p.motivoId) || (!p.motivoId && motivos.length === 1));
  const sinMotivo = lista.length - conMotivo.length;
  if (!conMotivo.length) {
    mostrarAlerta("warning", "Nadie tiene un motivo asignado. Edita la gira y asígnaselos.");
    return;
  }

  // Cuántos por motivo, para que el staff vea qué va a salir antes de mandar.
  const porMotivo = motivos
    .map(m => {
      const n = conMotivo.filter(p => p.motivoId === m.id || (!p.motivoId && motivos.length === 1)).length;
      return n ? `  · ${m.titulo || "(sin título)"}: ${n}` : null;
    })
    .filter(Boolean).join("\n");

  if (!confirm(
    `Se enviará el correo a hasta ${conMotivo.length} persona(s) de "${gira?.nombre || "esta gira"}",` +
    ` cada una con el texto de su motivo:\n\n` +
    `${porMotivo}\n\n` +
    (sinMotivo ? `${sinMotivo} sin motivo asignado NO recibirá nada.\n` : "") +
    `Se omite a quienes ya fueron avisados. ¿Enviar?`
  )) return;

  const contenidoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Enviando...";
  try {
    const resultado = await notificarNoSeleccionadosGira(id);
    mostrarAlerta(resultado.enviados > 0 ? "success" : "warning", resultado.mensaje);
    await cargarGiras();
  } catch (e) {
    mostrarAlerta("error", "Error al notificar: " + e.message);
    btn.disabled = false;
    btn.innerHTML = contenidoOriginal;
  }
};

el("btn-cancelar-gira")?.addEventListener("click", limpiarFormGira);

// ════════════════════════════════════════════════════════════
// VENTAS (para el selector de asignaciones)
// ════════════════════════════════════════════════════════════

async function cargarVentas() {
  try {
    const snap = await getDocs(query(collection(db, "actividades_ventas"), orderBy("creadoEn", "desc")));
    ventas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { ventas = []; }
}

// ════════════════════════════════════════════════════════════
// VOLUNTARIADO — ASIGNACIONES
// ════════════════════════════════════════════════════════════

async function cargarAsignaciones() {
  const spAsig = el("asignaciones-spinner");
  if (spAsig) spAsig.style.display = "flex";
  try {
    const snap = await getDocs(query(collection(db, "asignaciones_voluntarios"), orderBy("creadoEn", "desc")));
    asignaciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { asignaciones = []; }
  if (spAsig) spAsig.style.display = "none";
  renderTablaAsignaciones();
  actualizarStatsAsignaciones();
  renderCardPendientes();
}

function actualizarStatsAsignaciones() {
  const uniqVols = new Set(asignaciones.map(a => a.voluntarioId));
  if (el("stat-asignados"))    el("stat-asignados").textContent     = asignaciones.length;
  if (el("stat-sin-area"))     el("stat-sin-area").textContent      = asignaciones.filter(a => !a.areaTrabajo).length;
  if (el("stat-vol-asignados")) el("stat-vol-asignados").textContent = uniqVols.size;
}

function renderTablaAsignaciones() {
  const filtroTipo = el("filtro-asig-tipo")?.value || "";
  const filtroArea = el("filtro-asig-area")?.value || "";
  let lista = asignaciones;
  if (filtroTipo) lista = lista.filter(a => a.tipo === filtroTipo);
  if (filtroArea) lista = lista.filter(a => a.areaTrabajo === filtroArea);
  const tb = el("tabla-asignaciones-body");
  if (!tb) return;
  if (!lista.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--gris-medio)">Sin asignaciones${filtroTipo || filtroArea ? " con ese filtro" : ""}</td></tr>`;
    return;
  }
  const tipoLabel = { actividad: "Actividad", gira: "Gira", venta: "Venta" };
  const tipoClass = { actividad: "tipo-actividad", gira: "tipo-gira", venta: "tipo-venta" };
  tb.innerHTML = lista.map(a => `
    <tr>
      <td><strong>${h(a.voluntarioNombre || "—")}</strong></td>
      <td>${a.areaTrabajo ? `<span class="area-badge">${h(a.areaTrabajo)}</span>` : `<span style="color:var(--gris-medio);font-size:12px;">Sin asignar</span>`}</td>
      <td><span class="tipo-badge ${tipoClass[a.tipo] || ""}">${h(tipoLabel[a.tipo] || a.tipo || "—")}</span></td>
      <td>${h(a.eventoNombre || "—")}</td>
      <td>${h(a.turnoNombre || "—")}</td>
      <td><button onclick="eliminarAsignacion('${escaparAtributo(a.id)}')" style="background:#dc3545;color:#fff;border:none;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;" title="Eliminar">${iconoImg("eliminar")}</button></td>
    </tr>`).join("");
}

function poblarSelectorVoluntarios() {
  const sel = el("asig-voluntario");
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">— Selecciona voluntario —</option>`;
  voluntarios.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `${nombreCompletoVol(v)}${v.cedula ? ` (${v.cedula})` : ""}`;
    sel.appendChild(opt);
  });
  sel.value = actual;
}

el("asig-tipo")?.addEventListener("change", () => {
  const tipo = el("asig-tipo").value;
  const selEvento = el("asig-evento");
  const selTurno  = el("asig-turno");
  selEvento.innerHTML = `<option value="">— Selecciona evento —</option>`;
  selTurno.innerHTML  = `<option value="">— Sin turno específico —</option>`;
  selTurno.disabled = true;
  if (!tipo) { selEvento.disabled = true; return; }
  selEvento.disabled = false;
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  fuente.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.nombre} (${fmtFecha(item.fecha)})`;
    selEvento.appendChild(opt);
  });
});

el("asig-evento")?.addEventListener("change", () => {
  const tipo     = el("asig-tipo").value;
  const eventoId = el("asig-evento").value;
  const selTurno = el("asig-turno");
  selTurno.innerHTML = `<option value="">— Sin turno específico —</option>`;
  selTurno.disabled = true;
  if (!eventoId) return;
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const evento = fuente.find(x => x.id === eventoId);
  if (evento?.turnos?.length) {
    selTurno.disabled = false;
    evento.turnos.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.nombre} (${t.horaInicio}–${t.horaFin})`;
      selTurno.appendChild(opt);
    });
  }
});

el("btn-asignar")?.addEventListener("click", async () => {
  const volId    = el("asig-voluntario").value;
  const areaTrab = el("asig-area-trabajo").value;
  const tipo     = el("asig-tipo").value;
  const eventoId = el("asig-evento").value;
  if (!volId || !areaTrab || !tipo || !eventoId) {
    mostrarAlerta("error", "Voluntario, área de trabajo, tipo y evento son obligatorios."); return;
  }
  const vol    = voluntarios.find(v => v.id === volId);
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const evento = fuente.find(x => x.id === eventoId);

  // Validar cupo del evento
  if (evento?.voluntariosReq > 0) {
    const yaAsignados = asignaciones.filter(a => a.eventoId === eventoId && a.tipo === tipo).length;
    if (yaAsignados >= evento.voluntariosReq) {
      const tipoLabel = { actividad: "actividad", gira: "gira", venta: "venta" }[tipo] || tipo;
      mostrarAlerta("error", `Ya hay suficientes voluntarios en esta ${tipoLabel} "${evento.nombre}" (${yaAsignados}/${evento.voluntariosReq} asignados).`);
      return;
    }
  }

  const turnoId = el("asig-turno").value;
  const turno   = evento?.turnos?.find(t => t.id === turnoId);

  // Validar conflicto con horario de clases del voluntario
  if (vol?.horario && turno && hayConflictoHorario(vol.horario, turno.horaInicio, turno.horaFin)) {
    const nombreVol = nombreCompletoVol(vol);
    const hCfg = HORARIOS.find(h => h.valor === vol.horario);
    mostrarAlerta("error", `${nombreVol} tiene clases en horario ${hCfg?.label || vol.horario}. El turno "${turno.nombre}" (${turno.horaInicio}–${turno.horaFin}) choca con su horario de clases.`);
    return;
  }

  // Validar que el voluntario no esté ya asignado a otro evento en la misma fecha/turno
  const { yaAsignados: yaAsigEste, ocupados } = getEstadoVoluntarios(tipo, eventoId, turnoId);
  const nombreVol = vol ? nombreCompletoVol(vol) : "";
  if (yaAsigEste.has(volId)) {
    mostrarAlerta("error", `${nombreVol} ya está asignado a este evento.`);
    return;
  }
  if (ocupados.has(volId)) {
    const conflicto = asignaciones.find(a => {
      if (a.voluntarioId !== volId || a.eventoId === eventoId) return false;
      const fAsig = a.tipo === "actividad" ? actividades : a.tipo === "gira" ? giras : ventas;
      const evtA  = fAsig.find(e => e.id === a.eventoId);
      if (!evtA?.fecha) return false;
      const fechaA   = (evtA.fecha.toDate ? evtA.fecha.toDate() : new Date(evtA.fecha)).toDateString();
      const fechaSel = (evento.fecha.toDate ? evento.fecha.toDate() : new Date(evento.fecha)).toDateString();
      return fechaA === fechaSel;
    });
    const evtConflictoNombre  = conflicto?.eventoNombre || "otro evento";
    const turnoConflictoLabel = conflicto?.turnoNombre ? ` en ${conflicto.turnoNombre}` : "";
    mostrarAlerta("error", `${nombreVol} ya está asignado a "${evtConflictoNombre}"${turnoConflictoLabel} en la misma fecha.`);
    return;
  }

  const data = {
    voluntarioId:     volId,
    voluntarioNombre: vol ? nombreCompletoVol(vol) : "",
    areaTrabajo: areaTrab, tipo, eventoId,
    eventoNombre: evento?.nombre || "",
    turnoId: turnoId || "",
    turnoNombre: turno ? `${turno.nombre} (${turno.horaInicio}–${turno.horaFin})` : "",
    creadoEn: serverTimestamp(), creadoPor: auth.currentUser?.uid || "",
  };
  el("btn-asignar").disabled = true;
  el("btn-asignar").textContent = "Asignando...";
  try {
    await addDoc(collection(db, "asignaciones_voluntarios"), data);
    mostrarAlerta("success", `${data.voluntarioNombre} asignado correctamente.`);
    el("asig-voluntario").value = el("asig-area-trabajo").value = el("asig-tipo").value = "";
    el("asig-evento").innerHTML = `<option value="">— Selecciona tipo primero —</option>`;
    el("asig-evento").disabled = true;
    el("asig-turno").innerHTML  = `<option value="">— Sin turno específico —</option>`;
    el("asig-turno").disabled   = true;
    await cargarAsignaciones();
  } catch (e) { mostrarAlerta("error", "Error al asignar: " + e.message); }
  el("btn-asignar").disabled = false;
  el("btn-asignar").textContent = "Asignar voluntario";
});

window.eliminarAsignacion = async function(id) {
  if (!confirm("¿Eliminar esta asignación?")) return;
  try {
    await deleteDoc(doc(db, "asignaciones_voluntarios", id));
    asignaciones = asignaciones.filter(a => a.id !== id);
    renderTablaAsignaciones();
    actualizarStatsAsignaciones();
    renderCardPendientes();
    mostrarAlerta("success", "Asignación eliminada.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

el("filtro-asig-tipo")?.addEventListener("change", renderTablaAsignaciones);
el("filtro-asig-area")?.addEventListener("change", renderTablaAsignaciones);

el("btn-exportar-asignaciones")?.addEventListener("click", () => {
  if (!asignaciones.length) { mostrarAlerta("warning", "No hay asignaciones para exportar."); return; }
  const tipoLabel = { actividad: "Actividad", gira: "Gira", venta: "Venta" };
  const filas = asignaciones.map(a => ({
    "Voluntario":      a.voluntarioNombre || "",
    "Área de trabajo": a.areaTrabajo || "",
    "Tipo":            tipoLabel[a.tipo] || a.tipo,
    "Evento":          a.eventoNombre || "",
    "Turno":           a.turnoNombre || "",
  }));
  const ws = xlsx().utils.json_to_sheet(filasSegurasHoja(filas));
  const wb = xlsx().utils.book_new();
  xlsx().utils.book_append_sheet(wb, ws, "Asignaciones");
  xlsx().writeFile(wb, `asignaciones_voluntarios_${new Date().toISOString().split("T")[0]}.xlsx`);
});

// ════════════════════════════════════════════════════════════
// GESTIÓN DE TURNOS (tab Voluntariado)
// ════════════════════════════════════════════════════════════

function coleccionPorTipo(tipo) {
  if (tipo === "actividad") return "actividades_voluntarios";
  if (tipo === "gira")      return "giras_voluntarios";
  return "actividades_ventas";
}

function eventosPorTipo(tipo) {
  if (tipo === "actividad") return actividades;
  if (tipo === "gira")      return giras;
  return ventas;
}

async function recargarEventosPorTipo(tipo) {
  if (tipo === "actividad")      await cargarActividades();
  else if (tipo === "gira")      await cargarGiras();
  else                           await cargarVentas();
}

function renderTurnosEvt() {
  const tipo     = el("turno-evt-tipo").value;
  const eventoId = el("turno-evt-evento").value;
  const lista    = el("turno-evt-lista");
  if (!tipo || !eventoId) { lista.innerHTML = ""; return; }
  const evento = eventosPorTipo(tipo).find(e => e.id === eventoId);
  const turnos = evento?.turnos || [];
  if (!turnos.length) {
    lista.innerHTML = `<p style="font-size:12px;color:var(--gris-medio);margin:4px 0;">Sin turnos todavía.</p>`;
    return;
  }
  lista.innerHTML = turnos.map(t => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:#eef2ff;border:1px solid #c7d9fc;
      border-radius:20px;padding:5px 12px;font-size:13px;margin:3px;color:#1a56db;">
      ${iconoImg("reloj")} <strong>${h(t.nombre)}</strong>&nbsp;${h(t.horaInicio)} – ${h(t.horaFin)}
      <button onclick="eliminarTurnoEvt('${escaparAtributo(tipo)}','${escaparAtributo(eventoId)}','${escaparAtributo(t.id)}')"
        style="background:none;border:none;cursor:pointer;color:#1a56db;font-size:15px;line-height:1;padding:0 2px;">×</button>
    </span>`).join("");
}

el("turno-evt-tipo")?.addEventListener("change", () => {
  const tipo = el("turno-evt-tipo").value;
  const sel  = el("turno-evt-evento");
  sel.innerHTML = `<option value="">— Selecciona evento —</option>`;
  if (!tipo) {
    sel.disabled = true;
    el("turno-evt-lista").innerHTML = "";
    el("turno-evt-form").style.display = "none";
    return;
  }
  const eventos = eventosPorTipo(tipo).filter(e => e.activo !== false);
  if (eventos.length) {
    eventos.forEach(e => {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.nombre + (e.fecha ? ` — ${fmtFecha(e.fecha)}` : "");
      sel.appendChild(opt);
    });
  } else {
    sel.innerHTML += `<option value="" disabled>Sin eventos disponibles</option>`;
  }
  sel.disabled = false;
  el("turno-evt-lista").innerHTML = "";
  el("turno-evt-form").style.display = "none";
});

el("turno-evt-evento")?.addEventListener("change", () => {
  const eventoId = el("turno-evt-evento").value;
  if (!eventoId) {
    el("turno-evt-lista").innerHTML = "";
    el("turno-evt-form").style.display = "none";
    return;
  }
  renderTurnosEvt();
  el("turno-evt-form").style.display = "block";
});

el("btn-add-turno-evt")?.addEventListener("click", async () => {
  const tipo     = el("turno-evt-tipo").value;
  const eventoId = el("turno-evt-evento").value;
  const nombre   = el("turno-evt-nombre").value.trim();
  const inicio   = el("turno-evt-inicio").value;
  const fin      = el("turno-evt-fin").value;
  if (!tipo || !eventoId)   { mostrarAlerta("error", "Selecciona tipo de evento y evento."); return; }
  if (!nombre || !inicio || !fin) { mostrarAlerta("error", "Completa nombre, hora inicio y hora fin."); return; }

  // Validar orden y duración mínima
  const minInicio = toMin(inicio);
  const minFin    = toMin(fin);
  if (minFin <= minInicio) {
    mostrarAlerta("error", "La hora de fin debe ser posterior a la hora de inicio."); return;
  }
  if (minFin - minInicio < 60) {
    mostrarAlerta("error", `El turno "${nombre}" dura solo ${minFin - minInicio} min. La duración mínima es 1 hora.`); return;
  }

  const evento = eventosPorTipo(tipo).find(e => e.id === eventoId);
  const turnos = [...(evento?.turnos || [])];
  if (turnos.some(t => t.nombre.toLowerCase() === nombre.toLowerCase())) {
    mostrarAlerta("error", "Ya existe un turno con ese nombre en este evento."); return;
  }

  // Validar que no se superponga con turnos existentes
  const nuevoTurno = { horaInicio: inicio, horaFin: fin };
  const choque = turnos.find(t => turnosSuperpuestos(nuevoTurno, t));
  if (choque) {
    mostrarAlerta("error", `El horario ${inicio}–${fin} se superpone con el turno "${choque.nombre}" (${choque.horaInicio}–${choque.horaFin}).`); return;
  }

  turnos.push({ id: `t_${Date.now()}`, nombre, horaInicio: inicio, horaFin: fin });
  try {
    await updateDoc(doc(db, coleccionPorTipo(tipo), eventoId), { turnos, actualizadoEn: serverTimestamp() });
    await recargarEventosPorTipo(tipo);
    renderTurnosEvt();
    el("turno-evt-nombre").value = el("turno-evt-inicio").value = el("turno-evt-fin").value = "";
    mostrarAlerta("success", `Turno "${nombre}" agregado.`);
  } catch (e) { mostrarAlerta("error", "Error al guardar turno: " + e.message); }
});

window.eliminarTurnoEvt = async function(tipo, eventoId, turnoId) {
  if (!confirm("¿Eliminar este turno?")) return;
  const evento = eventosPorTipo(tipo).find(e => e.id === eventoId);
  const turnos = (evento?.turnos || []).filter(t => t.id !== turnoId);
  try {
    await updateDoc(doc(db, coleccionPorTipo(tipo), eventoId), { turnos, actualizadoEn: serverTimestamp() });
    await recargarEventosPorTipo(tipo);
    renderTurnosEvt();
    mostrarAlerta("success", "Turno eliminado.");
  } catch (e) { mostrarAlerta("error", "Error: " + e.message); }
};

function renderCardPendientes() {
  const wrap = el("pendientes-wrap");
  if (!wrap) return;

  const cfgTipo = {
    actividad: { label: "Actividad", bg: "var(--verde-fondo)", color: "var(--verde-oscuro)", border: "var(--verde-claro)" },
    gira:      { label: "Gira",      bg: "#fff3cd",            color: "#856404",             border: "#fcd34d" },
    venta:     { label: "Venta",     bg: "#fde8e8",            color: "#c81e1e",             border: "#f98080" },
  };

  const pendientes = [];

  const revisar = (lista, tipoKey) => {
    lista.forEach(e => {
      const req = e.voluntariosReq || 0;
      if (!req || e.activo === false) return;
      const asig = asignaciones.filter(a => a.eventoId === e.id && a.tipo === tipoKey).length;
      if (asig < req) pendientes.push({ id: e.id, nombre: e.nombre, fecha: e.fecha, lugar: e.lugar, tipoKey, req, asig });
    });
  };

  revisar(actividades, "actividad");
  revisar(giras,       "gira");
  revisar(ventas,      "venta");

  pendientes.sort((a, b) => {
    const fa = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha || 0);
    const fb = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha || 0);
    return fa - fb;
  });

  const card = wrap.closest(".card");
  if (!pendientes.length) {
    if (card) card.style.display = "none";
    return;
  }
  if (card) card.style.display = "";

  wrap.innerHTML = pendientes.map(p => {
    const t = cfgTipo[p.tipoKey];
    const porcentaje   = p.asig / p.req;
    const numColor     = porcentaje < 0.5 ? "#c81e1e"  : "#854d0e";
    const numBg        = porcentaje < 0.5 ? "#fde8e8"  : "#fff3cd";
    const numBorder    = porcentaje < 0.5 ? "#f98080"  : "#fcd34d";
    const faltan       = p.req - p.asig;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:#f8f9fa;margin-bottom:8px;flex-wrap:wrap;">
        <div style="flex:1;min-width:120px;">
          <div style="font-weight:700;font-size:13px;color:var(--gris-texto);">${h(p.nombre)}</div>
          <div style="font-size:12px;color:var(--gris-medio);margin-top:2px;">${fmtFecha(p.fecha)}${p.lugar ? " · " + h(p.lugar) : ""}</div>
        </div>
        <span style="font-size:11px;background:${t.bg};color:${t.color};border:1px solid ${t.border};padding:2px 8px;border-radius:12px;flex-shrink:0;">${t.label}</span>
        <div style="text-align:right;flex-shrink:0;">
          <span style="font-weight:800;font-size:15px;color:${numColor};background:${numBg};border:1px solid ${numBorder};padding:4px 10px;border-radius:8px;display:inline-block;">${p.asig} / ${p.req}</span>
          <div style="font-size:11px;color:${numColor};margin-top:2px;">faltan ${faltan}</div>
        </div>
      </div>`;
  }).join("");
}

async function iniciarTabVoluntariado() {
  poblarSelectorVoluntarios();
  await Promise.all([cargarAsignaciones(), cargarVentas()]);
  const tipoActual = el("asig-tipo").value;
  if (tipoActual) el("asig-tipo").dispatchEvent(new Event("change"));
  const tipoTurno = el("turno-evt-tipo").value;
  if (tipoTurno) el("turno-evt-tipo").dispatchEvent(new Event("change"));
}

// ════════════════════════════════════════════════════════════
// ASIGNAR GRUPO
// ════════════════════════════════════════════════════════════

let grupoReq = 0;

function toMin(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function turnosSuperpuestos(t1, t2) {
  return toMin(t1.horaInicio) < toMin(t2.horaFin) && toMin(t1.horaFin) > toMin(t2.horaInicio);
}

function getEstadoVoluntarios(tipo, eventoId, turnoId) {
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const eventoSel = fuente.find(e => e.id === eventoId);
  if (!eventoSel?.fecha) return { yaAsignados: new Set(), ocupados: new Set() };

  const fechaSel = (eventoSel.fecha.toDate ? eventoSel.fecha.toDate() : new Date(eventoSel.fecha)).toDateString();
  const turnoSel = turnoId ? eventoSel.turnos?.find(t => t.id === turnoId) : null;
  const yaAsignados = new Set();
  const ocupados = new Set();

  for (const asig of asignaciones) {
    // Ya asignado a ESTE evento
    if (asig.eventoId === eventoId && asig.tipo === tipo) {
      yaAsignados.add(asig.voluntarioId);
      continue;
    }
    // Conflicto de fecha/turno con otro evento
    const fAsig = asig.tipo === "actividad" ? actividades : asig.tipo === "gira" ? giras : ventas;
    const evtAsig = fAsig.find(e => e.id === asig.eventoId);
    if (!evtAsig?.fecha) continue;
    const fechaAsig = (evtAsig.fecha.toDate ? evtAsig.fecha.toDate() : new Date(evtAsig.fecha)).toDateString();
    if (fechaAsig !== fechaSel) continue;
    if (turnoSel && asig.turnoId) {
      const turnoAsig = evtAsig.turnos?.find(t => t.id === asig.turnoId);
      if (turnoAsig && !turnosSuperpuestos(turnoSel, turnoAsig)) continue;
    }
    ocupados.add(asig.voluntarioId);
  }
  return { yaAsignados, ocupados };
}

function resetModalGrupo() {
  grupoReq = 0;
  el("grupo-tipo").value = "";
  el("grupo-evento").innerHTML = `<option value="">— Selecciona tipo primero —</option>`;
  el("grupo-evento").disabled = true;
  el("grupo-area").value = "";
  el("grupo-turno").innerHTML = `<option value="">— Sin turno específico —</option>`;
  el("grupo-turno").disabled = true;
  el("grupo-info").style.display = "none";
  el("grupo-aviso").style.display = "none";
  el("grupo-voluntarios-wrap").style.display = "none";
  el("btn-confirmar-grupo").disabled = true;
  el("btn-confirmar-grupo").textContent = "Asignar grupo";
  el("grupo-progreso").style.display = "none";
}

el("btn-abrir-grupo")?.addEventListener("click", () => { resetModalGrupo(); el("modal-grupo").classList.add("open"); });
el("modal-grupo-close")?.addEventListener("click", () => el("modal-grupo").classList.remove("open"));

el("grupo-tipo")?.addEventListener("change", () => {
  const tipo = el("grupo-tipo").value;
  const selEvt = el("grupo-evento");
  selEvt.innerHTML = `<option value="">— Selecciona evento —</option>`;
  el("grupo-turno").innerHTML = `<option value="">— Sin turno específico —</option>`;
  el("grupo-turno").disabled = true;
  el("grupo-info").style.display = "none";
  el("grupo-aviso").style.display = "none";
  el("grupo-voluntarios-wrap").style.display = "none";
  el("btn-confirmar-grupo").disabled = true;
  grupoReq = 0;
  if (!tipo) { selEvt.disabled = true; return; }
  selEvt.disabled = false;
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  fuente.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.nombre} (${fmtFecha(item.fecha)})`;
    selEvt.appendChild(opt);
  });
});

el("grupo-evento")?.addEventListener("change", () => {
  const tipo = el("grupo-tipo").value;
  const eventoId = el("grupo-evento").value;
  const selTurno = el("grupo-turno");
  selTurno.innerHTML = `<option value="">— Sin turno específico —</option>`;
  selTurno.disabled = true;
  el("grupo-info").style.display = "none";
  el("grupo-aviso").style.display = "none";
  el("grupo-voluntarios-wrap").style.display = "none";
  el("btn-confirmar-grupo").disabled = true;
  grupoReq = 0;
  if (!eventoId) return;
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const evento = fuente.find(e => e.id === eventoId);
  if (!evento) return;
  grupoReq = evento.voluntariosReq || 0;
  if (evento.turnos?.length) {
    selTurno.disabled = false;
    evento.turnos.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.nombre} (${t.horaInicio}–${t.horaFin})`;
      selTurno.appendChild(opt);
    });
  }
  const tipoLabel = { actividad: "Actividad", gira: "Gira", venta: "Venta" }[tipo];
  el("grupo-info").style.display = "block";
  el("grupo-info").innerHTML = `<strong>${h(tipoLabel)}:</strong> ${h(evento.nombre)} &nbsp;·&nbsp; <strong>Fecha:</strong> ${fmtFecha(evento.fecha)} &nbsp;·&nbsp; <strong>Voluntarios requeridos:</strong> <span style="font-weight:700;">${grupoReq || "No especificado"}</span>`;
  renderVoluntariosGrupo();
});

el("grupo-turno")?.addEventListener("change", () => { if (el("grupo-evento")?.value) renderVoluntariosGrupo(); });
el("grupo-area")?.addEventListener("change",  () => { if (el("grupo-evento")?.value) actualizarBtnGrupo(); });

function renderVoluntariosGrupo() {
  const tipo = el("grupo-tipo").value;
  const eventoId = el("grupo-evento").value;
  const turnoId = el("grupo-turno").value;
  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const evento = fuente.find(e => e.id === eventoId);
  const turno  = turnoId ? evento?.turnos?.find(t => t.id === turnoId) : null;
  const { yaAsignados, ocupados } = getEstadoVoluntarios(tipo, eventoId, turnoId);
  const aviso = el("grupo-aviso");

  // Aviso si ya hay voluntarios asignados a este evento
  if (yaAsignados.size > 0) {
    aviso.style.display = "block";
    aviso.innerHTML = `${iconoImg("advertencia")} Ya hay <strong>${yaAsignados.size}</strong> voluntario${yaAsignados.size !== 1 ? "s" : ""} asignado${yaAsignados.size !== 1 ? "s" : ""} para <strong>"${h(evento?.nombre || "este evento")}"</strong>. Aparecen marcados abajo.`;
  } else {
    aviso.style.display = "none";
  }

  el("grupo-voluntarios-wrap").style.display = "block";
  const lista = el("grupo-voluntarios-lista");

  if (!voluntarios.length) {
    lista.innerHTML = `<p style="text-align:center;color:var(--gris-medio);font-size:13px;padding:12px;">Sin voluntarios registrados.</p>`;
    return;
  }

  lista.innerHTML = voluntarios.map(v => {
    const esYaAsig          = yaAsignados.has(v.id);
    const esOcupado         = ocupados.has(v.id);
    const esConflictoHorario = !esYaAsig && !esOcupado && turno
      ? hayConflictoHorario(v.horario, turno.horaInicio, turno.horaFin)
      : false;
    const disabled = esYaAsig || esOcupado || esConflictoHorario;
    const nombre = nombreCompletoVol(v);
    let badge = "";
    if (esYaAsig)
      badge = `<span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:12px;white-space:nowrap;border:1px solid #6ee7b7;">Ya asignado</span>`;
    else if (esOcupado)
      badge = `<span style="font-size:11px;background:#fde8e8;color:#c81e1e;padding:2px 8px;border-radius:12px;white-space:nowrap;">Ocupado ese día</span>`;
    else if (esConflictoHorario)
      badge = `<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;white-space:nowrap;border:1px solid #fcd34d;">${iconoImg("advertencia")} Choca con clases ${h(v.horario)}</span>`;
    const dataAttrs = disabled
      ? `disabled data-fixed="1"${esYaAsig ? ' data-ya-asignado="1"' : ""}`
      : "";
    return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;
      cursor:${disabled ? "not-allowed" : "pointer"};background:${disabled ? "#f8f9fa" : "#fff"};
      margin-bottom:3px;${disabled ? "opacity:0.55;" : ""}">
      <input type="checkbox" value="${escaparAtributo(v.id)}" data-nombre="${escaparAtributo(nombre)}"
        ${dataAttrs} onchange="actualizarBtnGrupo()"
        style="accent-color:#1a56db;width:16px;height:16px;flex-shrink:0;"/>
      <span style="flex:1;font-size:13px;">${h(nombre)}${v.id ? ` <small style="color:var(--gris-medio)">(${h(v.id)})</small>` : ""}</span>
      ${badge}
    </label>`;
  }).join("");

  actualizarBtnGrupo();
}

window.actualizarBtnGrupo = function() {
  const allCbs = [...document.querySelectorAll("#grupo-voluntarios-lista input[type=checkbox]")];
  const freeCbs = allCbs.filter(cb => !cb.dataset.fixed);
  const sel = freeCbs.filter(cb => cb.checked).length;

  const yaAsignadosCount = allCbs.filter(cb => cb.dataset.yaAsignado === "1").length;
  const cuposRestantes   = grupoReq > 0 ? Math.max(0, grupoReq - yaAsignadosCount) : 0;

  // Bloquear checkboxes al alcanzar los cupos disponibles (no el total requerido)
  if (cuposRestantes > 0) {
    freeCbs.forEach(cb => {
      if (!cb.checked) cb.disabled = sel >= cuposRestantes;
    });
  }

  const hayArea = !!el("grupo-area").value;
  el("grupo-contador").textContent = grupoReq > 0
    ? `${sel} de ${cuposRestantes} disponible${cuposRestantes !== 1 ? "s" : ""}`
    : `${sel} seleccionado${sel !== 1 ? "s" : ""}`;
  el("btn-confirmar-grupo").disabled = sel === 0 || !hayArea;
  el("btn-confirmar-grupo").textContent = sel > 0
    ? `Asignar ${sel} voluntario${sel !== 1 ? "s" : ""}`
    : "Asignar grupo";
};

el("btn-confirmar-grupo")?.addEventListener("click", async () => {
  const tipo = el("grupo-tipo").value;
  const eventoId = el("grupo-evento").value;
  const areaTrab = el("grupo-area").value;
  const turnoId = el("grupo-turno").value;
  if (!tipo || !eventoId || !areaTrab) { mostrarAlerta("error", "Completa tipo, evento y área."); return; }

  const checkboxes = [...document.querySelectorAll("#grupo-voluntarios-lista input[type=checkbox]:checked")];
  if (!checkboxes.length) { mostrarAlerta("error", "Selecciona al menos un voluntario."); return; }

  const fuente = tipo === "actividad" ? actividades : tipo === "gira" ? giras : ventas;
  const evento = fuente.find(e => e.id === eventoId);
  const turno = evento?.turnos?.find(t => t.id === turnoId);

  el("btn-confirmar-grupo").disabled = true;
  el("grupo-progreso").style.display = "block";

  let asignados = 0;
  for (const cb of checkboxes) {
    el("grupo-progreso").textContent = `Guardando ${asignados + 1} de ${checkboxes.length}...`;
    try {
      await addDoc(collection(db, "asignaciones_voluntarios"), {
        voluntarioId:     cb.value,
        voluntarioNombre: cb.dataset.nombre || "",
        areaTrabajo: areaTrab, tipo, eventoId,
        eventoNombre:  evento?.nombre || "",
        turnoId:       turnoId || "",
        turnoNombre:   turno ? `${turno.nombre} (${turno.horaInicio}–${turno.horaFin})` : "",
        creadoEn:  serverTimestamp(),
        creadoPor: auth.currentUser?.uid || "",
      });
      asignados++;
    } catch (e) { console.error("Error asignando", cb.value, e); }
  }

  el("modal-grupo").classList.remove("open");
  mostrarAlerta("success", `${asignados} voluntario${asignados !== 1 ? "s" : ""} asignado${asignados !== 1 ? "s" : ""} correctamente.`);
  await cargarAsignaciones();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
// Este modulo lo comparten tres paginas (actividades.html, giras.html y
// voluntarios.html) y antes las cinco colecciones se leian siempre, en las
// tres. En giras.html eso significaba cuatro consultas completas
// (actividades_voluntarios, voluntarios, actividades_ventas y
// solicitudes_actividad) cuyos resultados no se pintaban en ningun lado,
// porque los render correspondientes salen temprano con `if (!tb) return`.
// Ahora cada carga se pide solo si la pagina anfitriona tiene el DOM que la
// consume. Cada bandera lista los IDs que realmente dependen de esos datos.
renderChipsParticipantesGira();
renderMotivos();
renderNoSeleccionados();

const necesitaActividades  = !!(el("tabla-actividades-body") || el("filtro-actividad") || el("asig-evento"));
const necesitaVoluntarios  = !!(el("tabla-voluntarios-body") || el("asig-voluntario"));
const necesitaGiras        = !!(el("tabla-giras-body") || el("asig-tipo") || el("turno-evt-tipo"));
const necesitaVentas       = !!(el("asig-evento") || el("turno-evt-tipo"));
const necesitaSolicitudes  = !!el("act-nombre");

const tareasIniciales = [
  necesitaActividades && cargarActividades(),
  necesitaVoluntarios && cargarVoluntarios(),
  necesitaGiras       && cargarGiras(),
  necesitaVentas      && cargarVentas(),
  necesitaSolicitudes && cargarSolicitudesAutocomplete(),
].filter(Boolean);

Promise.all(tareasIniciales).then(() => {
  const tabActivo = document.querySelector(".tab-btn.active");
  if (tabActivo?.dataset.tab === "tab-voluntariado") iniciarTabVoluntariado();
  // El selector de participantes se precalienta despues de pintar las giras:
  // listarParticipantesParaGiras es una Cloud Function y su arranque en frio
  // se paga una sola vez, en segundo plano, en vez de hacerlo esperar al
  // staff cuando abre el selector.
  if (necesitaGiras) precalentarParticipantesGira();
});

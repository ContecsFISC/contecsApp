import { db, auth } from "../core/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── DOM helpers ────────────────────────────────────────────────────────────
const el  = id => document.getElementById(id);
const QRCode = window.QRCode;
const Papa   = window.Papa;
const XLSX   = window.XLSX;

// ─── Estado global ──────────────────────────────────────────────────────────
let eventoActivo        = null;
let inscripciones       = [];
let participantesGlobal = [];
let checkpointsEvento   = [];   // de la colección 'checkpoints'
let columnasArchivo     = [];
let filasArchivo        = [];
let editandoEventoId    = null;
let editandoCpId        = null;
let qrActualCanvas      = null;

// ─── Constantes ─────────────────────────────────────────────────────────────
const CATEGORIA_LABELS = {
  estudiante_utp:     "Est. UTP",
  estudiante_externo: "Est. Externo",
  colegio:            "Colegio",
  academico:          "Académico",
  profesional:        "Profesional",
  autor:              "Autor",
  importado:          "Importado",
};

const ESTADO_PAGO_BADGE = {
  aprobado:            `<span style="background:var(--verde-fondo);color:var(--verde-oscuro);padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">✅ Aprobado</span>`,
  comprobante_enviado: `<span style="background:#e3f2fd;color:#1565c0;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">🔍 Revisión</span>`,
  pendiente_efectivo:  `<span style="background:var(--amarillo-fondo);color:var(--amarillo);padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">⏳ Pendiente</span>`,
  rechazado:           `<span style="background:var(--rojo-fondo);color:var(--rojo);padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">❌ Rechazado</span>`,
  importado:           `<span style="background:var(--gris-suave);color:var(--gris-medio);padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">📥 Importado</span>`,
};

const TIPO_LABELS = {
  conferencia: "Conferencia",
  taller:      "Taller",
  gira:        "Gira",
  workshop:    "Workshop",
  panel:       "Panel",
  otro:        "Otro",
};

const TIPO_CON_CUPOS = ["taller", "gira"];

// ─── Alerta ─────────────────────────────────────────────────────────────────
function mostrarAlerta(tipo, msg, duracion = 5000) {
  const div = el("alerta-global");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  if (duracion > 0) setTimeout(() => div.classList.remove("show"), duracion);
}

function mostrarAlertaCp(tipo, msg, duracion = 5000) {
  const div = el("alerta-cp");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  div.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (duracion > 0) setTimeout(() => div.classList.remove("show"), duracion);
}

// ─── Formatear fecha ────────────────────────────────────────────────────────
function fmtFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA");
}

function fmtFechaCorta(fechaStr) {
  if (!fechaStr) return "—";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-PA", { day: "numeric", month: "short" });
}

// Convierte un Timestamp o Date a "YYYY-MM-DD" usando hora local (evita desfase UTC)
function tsToLocalDateStr(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Convierte un Date a "YYYY-MM-DD" usando hora local
function dateToLocalStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── TABS ────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "tab-participantes") renderParticipantes();
    if (btn.dataset.tab === "tab-asistencia")    renderAsistencia();
    if (btn.dataset.tab === "tab-certificados")  renderCertificados();
  });
});

// ═══════════════════════════════════════════════════════════
// DÍAS DEL EVENTO
// ═══════════════════════════════════════════════════════════

function parseFechasEvento() {
  const ini = el("ev-fecha-inicio").value;
  const fin = el("ev-fecha-fin").value;
  const sec = el("dias-evento-section");
  if (!ini || !fin) { sec.style.display = "none"; return; }
  const start = new Date(ini + "T00:00:00");
  const end   = new Date(fin + "T00:00:00");
  if (end < start) { sec.style.display = "none"; return; }

  const dias = [];
  const cur = new Date(start);
  while (cur <= end) {
    dias.push(dateToLocalStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  renderDiasEvento(dias);
  sec.style.display = "block";
}

function renderDiasEvento(dias, diasEvento = []) {
  el("dias-evento-lista").innerHTML = dias.map(fecha => {
    const existing = diasEvento.find(d => d.fecha === fecha);
    const horaIni  = existing?.horaInicio || "08:00";
    const horaFin  = existing?.horaFin    || "18:00";
    const label = new Date(fecha + "T00:00:00").toLocaleDateString("es-PA", {
      weekday: "long", day: "numeric", month: "long",
    });
    return `<div class="dia-evento-fila" data-fecha="${fecha}">
      <span class="dia-label">${label}</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="time" class="dia-hora-inicio" value="${horaIni}" style="width:110px;padding:6px 8px;border:1.5px solid var(--verde-claro);border-radius:6px;font-size:13px;"/>
        <span style="font-size:13px;color:var(--gris-medio)">a</span>
        <input type="time" class="dia-hora-fin"    value="${horaFin}" style="width:110px;padding:6px 8px;border:1.5px solid var(--verde-claro);border-radius:6px;font-size:13px;"/>
      </div>
    </div>`;
  }).join("");
}

function leerDiasEvento() {
  return [...el("dias-evento-lista").querySelectorAll(".dia-evento-fila")].map(row => ({
    fecha:      row.dataset.fecha,
    horaInicio: row.querySelector(".dia-hora-inicio").value || "08:00",
    horaFin:    row.querySelector(".dia-hora-fin").value    || "18:00",
  }));
}

el("ev-fecha-inicio").addEventListener("change", parseFechasEvento);
el("ev-fecha-fin").addEventListener("change",    parseFechasEvento);

// ═══════════════════════════════════════════════════════════
// EVENTOS — CRUD
// ═══════════════════════════════════════════════════════════

async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc")));
  const eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderTablaEventos(eventos);
  renderSelectorEventos(eventos);
}

function renderSelectorEventos(eventos) {
  const sel = el("sel-evento");
  const prevVal = sel.value;
  sel.innerHTML = `<option value="">— Selecciona un evento —</option>`;
  eventos.forEach(ev => {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = `${ev.nombre} (${fmtFecha(ev.fechaInicio)})`;
    sel.appendChild(opt);
  });
  if (prevVal) sel.value = prevVal;
}

function renderTablaEventos(eventos) {
  const tb = el("tabla-eventos-body");
  if (!eventos.length) {
    tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--gris-medio)">Sin eventos registrados</td></tr>`;
    return;
  }
  tb.innerHTML = eventos.map(ev => {
    const diasLabel = ev.diasEvento?.length
      ? `${ev.diasEvento.length} día${ev.diasEvento.length > 1 ? "s" : ""}`
      : `${fmtFecha(ev.fechaInicio)} – ${fmtFecha(ev.fechaFin)}`;
    return `<tr>
      <td><strong>${ev.nombre}</strong></td>
      <td style="font-size:12px;">${diasLabel}</td>
      <td style="text-align:center;">${ev.checkpointsMinCertificado || 1}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="window._editarEvento('${ev.id}')" style="width:auto;margin-right:4px">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="window._eliminarEvento('${ev.id}')" style="width:auto">🗑</button>
      </td>
    </tr>`;
  }).join("");
}

el("btn-guardar-evento").addEventListener("click", async () => {
  const nombre   = el("ev-nombre").value.trim();
  const fechaIni = el("ev-fecha-inicio").value;
  const fechaFin = el("ev-fecha-fin").value;
  const minCert  = parseInt(el("ev-min-cert").value) || 1;

  if (!nombre)   { mostrarAlerta("error", "El nombre del evento es obligatorio."); return; }
  if (!fechaIni) { mostrarAlerta("error", "La fecha de inicio es obligatoria."); return; }
  if (!fechaFin) { mostrarAlerta("error", "La fecha de fin es obligatoria."); return; }

  const diasEvento = leerDiasEvento();
  const datos = {
    nombre,
    descripcion: el("ev-descripcion").value.trim(),
    fechaInicio: new Date(fechaIni + "T00:00:00"),
    fechaFin:    new Date(fechaFin + "T23:59:59"),
    diasEvento,
    checkpointsMinCertificado: minCert,
    activo: true,
    actualizadoEn: serverTimestamp(),
  };

  try {
    el("btn-guardar-evento").disabled = true;
    if (editandoEventoId) {
      // setDoc con merge para que funcione incluso si el doc fue eliminado
      await setDoc(doc(db, "eventos", editandoEventoId), datos, { merge: true });
      mostrarAlerta("success", "Evento actualizado.");
      if (eventoActivo?.id === editandoEventoId) {
        eventoActivo = { ...eventoActivo, ...datos };
        poblarSelectorDiasCP();
      }
      editandoEventoId = null;
    } else {
      datos.creadoEn  = serverTimestamp();
      datos.creadoPor = auth.currentUser?.uid || "";
      await addDoc(collection(db, "eventos"), datos);
      mostrarAlerta("success", "Evento creado.");
    }
    limpiarFormEvento();
    await cargarEventos();
  } catch (e) {
    mostrarAlerta("error", "Error al guardar evento: " + e.message);
  } finally {
    el("btn-guardar-evento").disabled = false;
  }
});

function limpiarFormEvento() {
  el("ev-nombre").value      = "";
  el("ev-descripcion").value = "";
  el("ev-fecha-inicio").value = "";
  el("ev-fecha-fin").value    = "";
  el("ev-min-cert").value     = "3";
  el("dias-evento-section").style.display = "none";
  el("dias-evento-lista").innerHTML = "";
  el("form-evento-titulo").textContent    = "Crear nuevo evento";
  el("btn-cancelar-evento").style.display = "none";
  editandoEventoId = null;
}

window._editarEvento = async id => {
  const snap = await getDoc(doc(db, "eventos", id));
  if (!snap.exists()) return;
  const ev = snap.data();
  editandoEventoId = id;

  el("ev-nombre").value      = ev.nombre || "";
  el("ev-descripcion").value = ev.descripcion || "";

  const iniStr = tsToLocalDateStr(ev.fechaInicio);
  const finStr = tsToLocalDateStr(ev.fechaFin);
  el("ev-fecha-inicio").value = iniStr;
  el("ev-fecha-fin").value    = finStr;
  el("ev-min-cert").value     = ev.checkpointsMinCertificado || 1;

  // Render días con horas guardadas
  if (iniStr && finStr) {
    const start = new Date(iniStr + "T00:00:00");
    const end   = new Date(finStr + "T00:00:00");
    const dias  = [];
    const cur = new Date(start);
    while (cur <= end) { dias.push(dateToLocalStr(cur)); cur.setDate(cur.getDate() + 1); }
    renderDiasEvento(dias, ev.diasEvento || []);
    el("dias-evento-section").style.display = "block";
  }

  el("form-evento-titulo").textContent    = "Editar evento";
  el("btn-cancelar-evento").style.display = "inline-flex";
  document.querySelector('[data-tab="tab-evento"]').click();
  el("ev-nombre").scrollIntoView({ behavior: "smooth" });

  // Si no era el evento activo, lo cargamos
  if (!eventoActivo || eventoActivo.id !== id) {
    el("sel-evento").value = id;
    eventoActivo = { id, ...ev };
    el("evento-info").innerHTML = `<strong>${ev.nombre}</strong>`;
    await Promise.all([cargarInscripciones(), cargarCheckpointsEvento(id)]);
  }
};

window._eliminarEvento = async id => {
  if (!confirm("¿Eliminar este evento? Los checkpoints y participantes no se eliminarán.")) return;
  await deleteDoc(doc(db, "eventos", id));
  if (eventoActivo?.id === id) {
    eventoActivo = null;
    el("sel-evento").value = "";
    el("evento-info").textContent = "";
    inscripciones = [];
    checkpointsEvento = [];
    actualizarBadgeCheckpoints();
  }
  if (editandoEventoId === id) limpiarFormEvento();
  await cargarEventos();
};

el("btn-cancelar-evento").addEventListener("click", limpiarFormEvento);
el("btn-nuevo-evento").addEventListener("click", () => { limpiarFormEvento(); document.querySelector('[data-tab="tab-evento"]').click(); });

// Cambio de evento activo (selector superior)
el("sel-evento").addEventListener("change", async () => {
  const id = el("sel-evento").value;
  if (!id) {
    eventoActivo = null;
    el("evento-info").textContent = "";
    inscripciones = [];
    checkpointsEvento = [];
    actualizarBadgeCheckpoints();
    return;
  }
  const snap = await getDoc(doc(db, "eventos", id));
  if (!snap.exists()) return;
  eventoActivo = { id, ...snap.data() };
  el("evento-info").innerHTML = `<strong>${eventoActivo.nombre}</strong> · ${fmtFecha(eventoActivo.fechaInicio)} – ${fmtFecha(eventoActivo.fechaFin)}`;
  await Promise.all([cargarInscripciones(), cargarCheckpointsEvento(id)]);
});

// ═══════════════════════════════════════════════════════════
// INSCRIPCIONES (carga)
// ═══════════════════════════════════════════════════════════

async function cargarInscripciones() {
  if (!eventoActivo) { inscripciones = []; return; }
  const snap = await getDocs(query(collection(db, "inscripciones"), where("eventoId", "==", eventoActivo.id)));
  inscripciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══════════════════════════════════════════════════════════
// CHECKPOINTS — CRUD
// ═══════════════════════════════════════════════════════════

async function cargarCheckpointsEvento(eventoId) {
  const snap = await getDocs(query(collection(db, "checkpoints"), where("eventoId", "==", eventoId)));
  checkpointsEvento = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      if (a.dia !== b.dia) return (a.dia || "") < (b.dia || "") ? -1 : 1;
      return (a.horaInicio || "") < (b.horaInicio || "") ? -1 : 1;
    });
  renderTablaCheckpoints();
  actualizarBadgeCheckpoints();
}

function actualizarBadgeCheckpoints() {
  const count = checkpointsEvento.length;
  const badge = el("cp-count-badge");
  if (badge) badge.textContent = count > 0 ? ` (${count})` : "";

  const minCert = el("ev-min-cert");
  if (minCert) minCert.value = count > 0 ? Math.ceil(count * 0.6) : "";

  const resumen = el("cp-modal-resumen");
  const texto   = el("cp-resumen-texto");
  if (resumen && texto) {
    if (count > 0) {
      texto.textContent = `${count} checkpoint${count > 1 ? "s" : ""} · Mínimo para certificado: ${Math.ceil(count * 0.6)}`;
      resumen.style.display = "block";
    } else {
      resumen.style.display = "none";
    }
  }

  renderVistaCheckpoints();
}

function renderVistaCheckpoints() {
  const sinEvento  = el("cp-vista-sin-evento");
  const lista      = el("cp-vista-lista");
  const resumen    = el("cp-vista-resumen");
  const texto      = el("cp-vista-resumen-texto");
  const titulo     = el("cp-vista-titulo");
  const btnGest    = el("btn-abrir-modal-cp-vista");
  if (!sinEvento) return;

  if (!eventoActivo) {
    sinEvento.style.display = "block";
    lista.style.display     = "none";
    resumen.style.display   = "none";
    if (btnGest) btnGest.style.display = "none";
    if (titulo) titulo.textContent = "Checkpoints del evento";
    return;
  }

  if (titulo) titulo.textContent = `Checkpoints — ${eventoActivo.nombre}`;
  if (btnGest) btnGest.style.display = "inline-flex";
  sinEvento.style.display = "none";
  lista.style.display     = "block";

  const count = checkpointsEvento.length;
  if (!count) {
    lista.innerHTML = `<p style="text-align:center;color:var(--gris-medio);padding:16px 0">Sin checkpoints registrados. Usa "Gestionar checkpoints" para agregarlos.</p>`;
    resumen.style.display = "none";
    return;
  }

  lista.innerHTML = checkpointsEvento.map(cp => {
    const hora    = cp.horaInicio && cp.horaFin ? `${cp.horaInicio}–${cp.horaFin}` : cp.horaInicio || "—";
    const tipoCls = cp.tipo === "taller" ? "cp-tipo-taller" : cp.tipo === "gira" ? "cp-tipo-gira" : "";
    const cuposStr = TIPO_CON_CUPOS.includes(cp.tipo) && cp.cupos
      ? `<span style="font-size:12px;font-weight:700;color:var(--verde-oscuro);">${cp.cuposDisponibles ?? cp.cupos}/${cp.cupos} cupos</span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--gris-borde);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;">${cp.nombre} <span class="cp-tipo-badge ${tipoCls}">${TIPO_LABELS[cp.tipo] || cp.tipo}</span></div>
        ${cp.titulo ? `<div style="font-size:12px;color:var(--gris-medio)">${cp.titulo}</div>` : ""}
        <div style="font-size:12px;color:var(--gris-medio)">${fmtFechaCorta(cp.dia)} · ${hora}${cp.salon ? ` · ${cp.salon}` : ""}${cp.exponente ? ` · ${cp.exponente}` : ""}</div>
        ${cuposStr}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" onclick="window._editarCp('${cp.id}')" style="width:auto">✏️</button>
        <button class="btn btn-danger btn-sm"  onclick="window._eliminarCp('${cp.id}')" style="width:auto">🗑</button>
      </div>
    </div>`;
  }).join("");

  texto.textContent    = `${count} checkpoint${count > 1 ? "s" : ""} · Mínimo para certificado: ${Math.ceil(count * 0.6)}`;
  resumen.style.display = "block";
}

function renderTablaCheckpoints() {
  const lista = el("cp-modal-lista");
  if (!lista) return;
  if (!checkpointsEvento.length) {
    lista.innerHTML = `<p style="text-align:center;color:var(--gris-medio);padding:20px 0">Sin checkpoints registrados</p>`;
    return;
  }
  lista.innerHTML = checkpointsEvento.map(cp => {
    const hora     = cp.horaInicio && cp.horaFin ? `${cp.horaInicio}–${cp.horaFin}` : cp.horaInicio || "—";
    const diaLabel = fmtFechaCorta(cp.dia);
    const tipoCls  = cp.tipo === "taller" ? "cp-tipo-taller" : cp.tipo === "gira" ? "cp-tipo-gira" : "";
    const cuposStr = TIPO_CON_CUPOS.includes(cp.tipo) && cp.cupos
      ? `<span style="font-size:12px;font-weight:700;color:var(--verde-oscuro);">${cp.cuposDisponibles ?? cp.cupos}/${cp.cupos} cupos</span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--gris-borde);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;">${cp.nombre} <span class="cp-tipo-badge ${tipoCls}">${TIPO_LABELS[cp.tipo] || cp.tipo}</span></div>
        ${cp.titulo ? `<div style="font-size:12px;color:var(--gris-medio)">${cp.titulo}</div>` : ""}
        <div style="font-size:12px;color:var(--gris-medio)">${diaLabel} · ${hora}${cp.salon ? ` · ${cp.salon}` : ""}${cp.exponente ? ` · ${cp.exponente}` : ""}</div>
        ${cuposStr}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" onclick="window._editarCp('${cp.id}')" style="width:auto">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="window._eliminarCp('${cp.id}')" style="width:auto">🗑</button>
      </div>
    </div>`;
  }).join("");
}

// Modal de checkpoints
el("btn-abrir-modal-cp").addEventListener("click", () => {
  const eventoId = editandoEventoId || eventoActivo?.id;
  if (!eventoId) {
    mostrarAlerta("error", "Guarda el evento primero antes de agregar checkpoints.");
    return;
  }
  if (!eventoActivo || eventoActivo.id !== eventoId) {
    mostrarAlerta("error", "Selecciona el evento activo primero.");
    return;
  }
  poblarSelectorDiasCP();
  poblarSelectPonentes();
  limpiarFormCp();
  el("modal-checkpoints").style.display = "flex";
});

el("modal-cp-close").addEventListener("click", () => {
  el("modal-checkpoints").style.display = "none";
  limpiarFormCp();
});

el("btn-abrir-modal-cp-vista").addEventListener("click", () => {
  if (!eventoActivo) return;
  poblarSelectorDiasCP();
  poblarSelectPonentes();
  limpiarFormCp();
  el("modal-checkpoints").style.display = "flex";
});

function poblarSelectorDiasCP() {
  const sel = el("cp-dia");
  let dias  = eventoActivo?.diasEvento || [];

  // Fallback: generar días desde fechaInicio/fechaFin si diasEvento aún no fue guardado
  if (!dias.length && eventoActivo?.fechaInicio) {
    const start = eventoActivo.fechaInicio.toDate ? eventoActivo.fechaInicio.toDate() : new Date(eventoActivo.fechaInicio);
    const end   = eventoActivo.fechaFin?.toDate   ? eventoActivo.fechaFin.toDate()    : start;
    const cur   = new Date(start);
    while (cur <= end) {
      dias.push({ fecha: dateToLocalStr(cur), horaInicio: "", horaFin: "" });
      cur.setDate(cur.getDate() + 1);
    }
  }

  if (!dias.length) {
    sel.innerHTML = `<option value="">— Edita el evento para agregar fechas —</option>`;
    return;
  }

  const prev = sel.value;
  sel.innerHTML = `<option value="">— Selecciona un día —</option>` + dias.map(d => {
    const label = new Date(d.fecha + "T00:00:00").toLocaleDateString("es-PA", {
      weekday: "long", day: "numeric", month: "long",
    });
    const horas = d.horaInicio && d.horaFin ? ` · ${d.horaInicio}–${d.horaFin}` : "";
    return `<option value="${d.fecha}">${label}${horas}</option>`;
  }).join("");
  if (prev) sel.value = prev;
}

function poblarSelectPonentes() {
  const sel = el("cp-ponente-select");
  const ponentes = participantesGlobal.filter(p => p.camposExtra?.ponencia === "si");
  // Mantener primera opción (vacía) y última (_otro); limpiar intermedias
  while (sel.options.length > 1) sel.remove(1);
  const optOtro = document.createElement("option");
  optOtro.value = "_otro";
  optOtro.textContent = "✏️ Otro (ingresar manualmente)";
  ponentes.forEach(p => {
    const opt   = document.createElement("option");
    opt.value   = p.id;
    const nombre = p.nombreCompleto || ((p.nombre || "") + " " + (p.apellido || "")).trim();
    const cedula = p.cedula ? ` — ${p.cedula}` : "";
    opt.textContent       = nombre + cedula;
    opt.dataset.nombre    = nombre;
    opt.dataset.cedula    = p.cedula || "";
    opt.dataset.categoria = p.categoria || "";
    opt.dataset.universidad = p.camposExtra?.universidad || "";
    sel.appendChild(opt);
  });
  sel.appendChild(optOtro);
}

el("cp-ponente-select").addEventListener("change", () => {
  const val     = el("cp-ponente-select").value;
  const manual  = el("cp-exponente-manual");
  const info    = el("cp-ponente-info");
  const hiddenId   = el("cp-ponente-id");
  const hiddenNom  = el("cp-exponente");

  if (val === "_otro") {
    manual.style.display = "block";
    info.style.display   = "none";
    hiddenId.value       = "";
    hiddenNom.value      = manual.value.trim();
    manual.focus();
  } else if (val === "") {
    manual.style.display = "none";
    info.style.display   = "none";
    hiddenId.value       = "";
    hiddenNom.value      = "";
  } else {
    const opt         = el("cp-ponente-select").selectedOptions[0];
    const nombre      = opt.dataset.nombre;
    const cedula      = opt.dataset.cedula;
    const categoria   = opt.dataset.categoria;
    const universidad = opt.dataset.universidad;
    let origen;
    if (categoria === "academico_utp") {
      origen = "Interna — Universidad Tecnológica de Panamá";
    } else if (categoria === "academico_externo") {
      origen = "Externa" + (universidad ? ` — ${universidad}` : "");
    } else {
      origen = "—";
    }
    hiddenId.value      = val;
    hiddenNom.value     = nombre;
    manual.style.display = "none";
    info.style.display   = "block";
    info.innerHTML = `<strong>${nombre}</strong><br>Cédula: ${cedula || "—"}<br>Origen: ${origen}`;
  }
});

el("cp-exponente-manual").addEventListener("input", () => {
  el("cp-exponente").value = el("cp-exponente-manual").value.trim();
});

// Mostrar/ocultar cupos según tipo
el("cp-tipo").addEventListener("change", () => {
  const tipo = el("cp-tipo").value;
  el("cp-cupos-section").style.display = TIPO_CON_CUPOS.includes(tipo) ? "block" : "none";
  if (!TIPO_CON_CUPOS.includes(tipo)) el("cp-cupos").value = "";
});

el("btn-guardar-cp").addEventListener("click", async () => {
  if (!eventoActivo) { mostrarAlertaCp("error", "Selecciona un evento primero."); return; }
  const nombre = el("cp-nombre").value.trim();
  const tipo   = el("cp-tipo").value;
  const dia    = el("cp-dia").value;
  if (!nombre) { mostrarAlertaCp("error", "El nombre del checkpoint es obligatorio."); return; }
  if (!dia)    { mostrarAlertaCp("error", "Selecciona el día del checkpoint."); return; }

  const horaInicio = el("cp-hora-inicio").value;
  const horaFin    = el("cp-hora-fin").value;

  // Validar horas
  if ((horaInicio && !horaFin) || (!horaInicio && horaFin)) {
    mostrarAlertaCp("error", "Debes indicar tanto la hora de inicio como la de fin."); return;
  }
  if (horaInicio && horaFin) {
    const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const ini = toMin(horaInicio), fin = toMin(horaFin);
    if (fin <= ini) {
      mostrarAlertaCp("error", "La hora de fin debe ser mayor que la de inicio."); return;
    }
    if (fin - ini < 30) {
      mostrarAlertaCp("error", "La duración mínima de un checkpoint es 30 minutos."); return;
    }
    const diaEvento = eventoActivo?.diasEvento?.find(d => d.fecha === dia);
    if (diaEvento?.horaInicio && diaEvento?.horaFin) {
      const evIni = toMin(diaEvento.horaInicio), evFin = toMin(diaEvento.horaFin);
      if (ini < evIni) {
        mostrarAlertaCp("error", `El checkpoint no puede iniciar antes de las ${diaEvento.horaInicio} (límite del evento ese día).`); return;
      }
      if (fin > evFin) {
        mostrarAlertaCp("error", `El checkpoint no puede terminar después de las ${diaEvento.horaFin} (límite del evento ese día).`); return;
      }
    }
  }

  const cupos = TIPO_CON_CUPOS.includes(tipo) ? (parseInt(el("cp-cupos").value) || null) : null;
  const datos = {
    eventoId:      eventoActivo.id,
    eventoNombre:  eventoActivo.nombre,
    nombre,
    titulo:        el("cp-titulo").value.trim(),
    tipo,
    dia,
    salon:         el("cp-salon").value.trim(),
    horaInicio,
    horaFin,
    exponente:     el("cp-exponente").value.trim(),
    ponenteId:     el("cp-ponente-id").value || null,
    tipoPresencia: el("cp-tipo-presencia").value || null,
    cupos,
    actualizadoEn: serverTimestamp(),
  };

  try {
    el("btn-guardar-cp").disabled = true;
    if (editandoCpId) {
      await updateDoc(doc(db, "checkpoints", editandoCpId), datos);
      mostrarAlertaCp("success", "Checkpoint actualizado.");
      editandoCpId = null;
    } else {
      datos.cuposDisponibles = cupos;
      datos.creadoEn = serverTimestamp();
      await addDoc(collection(db, "checkpoints"), datos);
      mostrarAlertaCp("success", "Checkpoint agregado.");
    }
    limpiarFormCp();
    await cargarCheckpointsEvento(eventoActivo.id);
  } catch (e) {
    mostrarAlertaCp("error", "Error al guardar checkpoint: " + e.message);
  } finally {
    el("btn-guardar-cp").disabled = false;
  }
});

function limpiarFormCp() {
  el("cp-nombre").value     = "";
  el("cp-titulo").value     = "";
  el("cp-tipo").value       = "conferencia";
  el("cp-dia").value        = "";
  el("cp-salon").value      = "";
  el("cp-hora-inicio").value = "";
  el("cp-hora-fin").value   = "";
  el("cp-ponente-select").value         = "";
  el("cp-ponente-id").value             = "";
  el("cp-exponente").value              = "";
  el("cp-exponente-manual").value       = "";
  el("cp-exponente-manual").style.display = "none";
  el("cp-ponente-info").style.display   = "none";
  el("cp-tipo-presencia").value         = "";
  el("cp-cupos").value      = "";
  el("cp-cupos-section").style.display  = "none";
  el("btn-guardar-cp").textContent      = "+ Agregar checkpoint";
  el("btn-cancelar-cp").style.display   = "none";
  editandoCpId = null;
}

el("btn-cancelar-cp").addEventListener("click", limpiarFormCp);

window._editarCp = id => {
  const cp = checkpointsEvento.find(c => c.id === id);
  if (!cp) return;
  editandoCpId = id;
  poblarSelectorDiasCP();
  poblarSelectPonentes();
  el("cp-nombre").value      = cp.nombre      || "";
  el("cp-titulo").value      = cp.titulo      || "";
  el("cp-tipo").value        = cp.tipo        || "conferencia";
  el("cp-dia").value         = cp.dia         || "";
  el("cp-salon").value       = cp.salon       || "";
  el("cp-hora-inicio").value = cp.horaInicio  || "";
  el("cp-hora-fin").value    = cp.horaFin     || "";
  el("cp-tipo-presencia").value = cp.tipoPresencia || "";

  // Restaurar ponente
  if (cp.ponenteId && el("cp-ponente-select").querySelector(`option[value="${cp.ponenteId}"]`)) {
    el("cp-ponente-select").value = cp.ponenteId;
    el("cp-ponente-select").dispatchEvent(new Event("change"));
  } else if (cp.exponente) {
    el("cp-ponente-select").value         = "_otro";
    el("cp-exponente-manual").value       = cp.exponente;
    el("cp-exponente-manual").style.display = "block";
    el("cp-exponente").value              = cp.exponente;
    el("cp-ponente-info").style.display   = "none";
  }

  el("cp-cupos").value       = cp.cupos       || "";
  el("cp-cupos-section").style.display = TIPO_CON_CUPOS.includes(cp.tipo) ? "block" : "none";
  el("btn-guardar-cp").textContent    = "💾 Actualizar checkpoint";
  el("btn-cancelar-cp").style.display = "inline-flex";
  el("modal-checkpoints").style.display = "flex";
  el("cp-nombre").focus();
};

window._eliminarCp = async id => {
  if (!confirm("¿Eliminar este checkpoint?")) return;
  try {
    await deleteDoc(doc(db, "checkpoints", id));
    await cargarCheckpointsEvento(eventoActivo.id);
    mostrarAlerta("success", "Checkpoint eliminado.");
  } catch (e) {
    mostrarAlerta("error", "Error al eliminar: " + e.message);
  }
};

// ═══════════════════════════════════════════════════════════
// IMPORTAR CSV / EXCEL
// ═══════════════════════════════════════════════════════════

const CAMPOS_EURUS = [
  { key: "nombre",              label: "Nombre",                          req: true  },
  { key: "apellido",            label: "Apellido",                        req: false },
  { key: "correo",              label: "Correo",                          req: true  },
  { key: "cedula",              label: "Cédula",                          req: true  },
  { key: "telefono",            label: "Teléfono",                        req: false },
  { key: "universidad",         label: "Universidad / Institución",       req: true  },
  { key: "facultad",            label: "Facultad",                        req: false },
  { key: "carrera",             label: "Carrera",                         req: false },
  { key: "ocupacion",           label: "Ocupación",                       req: false },
  { key: "categoria",           label: "Categoría",                       req: false },
  { key: "participacionCodeClash", label: "Participación CodeClashPython", req: false },
  { key: "nivelPython",         label: "Nivel de experiencia en Python",  req: false },
  { key: "temasInteres",        label: "Temas de interés",                req: false },
  { key: "tallaSueter",         label: "Talla de suéter",                 req: false },
];

const MAPEO_AUTO = {
  nombre:              ["nombre", "name", "nombre completo", "full name", "primer nombre"],
  apellido:            ["apellido", "last name", "primer apellido", "surname"],
  correo:              ["correo", "email", "correo institucional", "correo electrónico", "e-mail"],
  cedula:              ["cedula", "cédula", "número de cédula", "numero de cedula"],
  telefono:            ["telefono", "teléfono", "phone", "celular"],
  universidad:         ["universidad", "university", "institución", "institucion", "institution"],
  facultad:            ["facultad", "faculty"],
  carrera:             ["carrera", "program", "programa", "profesión"],
  ocupacion:           ["ocupacion", "ocupación", "occupation"],
  categoria:           ["categoria", "categoría", "category", "tipo", "tipo de participante"],
  participacionCodeClash: ["codeclash", "code clash", "codeclashpython", "participación en codeclash", "participacion"],
  nivelPython:         ["python", "nivel python", "experiencia python", "nivel de experiencia"],
  temasInteres:        ["temas", "topics", "temas que te entusiasman", "temas de interés", "intereses"],
  tallaSueter:         ["talla", "suéter", "sueter", "talla sueter", "sweater"],
};

function detectarColumna(campo, headers) {
  const keywords = MAPEO_AUTO[campo] || [];
  return headers.find(h => keywords.some(kw => h.toLowerCase().includes(kw))) || "";
}

function procesarArchivo(archivo) {
  const ext = archivo.name.split(".").pop().toLowerCase();
  if (ext === "csv") {
    Papa.parse(archivo, {
      header: true, skipEmptyLines: true,
      complete: res => procesarFilas(res.meta.fields || [], res.data),
      error: e => mostrarAlerta("error", "Error leyendo CSV: " + e.message),
    });
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      const wb  = XLSX.read(e.target.result, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) { mostrarAlerta("error", "El archivo parece estar vacío."); return; }
      const headers = rows[0].map(String);
      const data    = rows.slice(1).filter(r => r.some(c => c !== "" && c != null))
                         .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
      procesarFilas(headers, data);
    };
    reader.readAsArrayBuffer(archivo);
  }
}

function procesarFilas(headers, filas) {
  columnasArchivo = headers;
  filasArchivo    = filas;
  renderMapeoCols();
  el("mapeo-section").style.display = "block";
  mostrarAlerta("success", `Archivo cargado: ${filas.length} filas detectadas.`);
}

function renderMapeoCols() {
  const tbody = el("mapeo-tbody");
  tbody.innerHTML = CAMPOS_EURUS.map(campo => {
    const detectado = detectarColumna(campo.key, columnasArchivo);
    const ico = detectado ? "✅" : (campo.req ? "⚠️" : "⬜");
    const opts = columnasArchivo.map(c => `<option value="${c}" ${c === detectado ? "selected" : ""}>${c}</option>`).join("");
    return `<tr>
      <td>${ico} <strong>${campo.label}</strong>${campo.req ? " *" : ""}</td>
      <td><select id="map-${campo.key}"><option value="">— Ignorar —</option>${opts}</select></td>
    </tr>`;
  }).join("");
}

function leerMapeo() {
  const m = {};
  CAMPOS_EURUS.forEach(c => { m[c.key] = el(`map-${c.key}`)?.value || ""; });
  return m;
}

function filaAInscripcion(fila, mapeo) {
  const get      = key => String(fila[mapeo[key]] ?? "").trim();
  const apellido = get("apellido");
  const nombre   = get("nombre");
  const correo   = get("correo").toLowerCase();
  const cedula   = get("cedula");
  const categoria = get("categoria") || "importado";
  const temas    = get("temasInteres").split(/[,;]+/).map(t => t.trim()).filter(Boolean);
  const pcch     = get("participacionCodeClash").toLowerCase();

  return {
    nombre,
    apellido,
    nombreCompleto: apellido ? `${nombre} ${apellido}` : nombre,
    correo,
    cedula,
    telefono:       get("telefono"),
    categoria,
    categoriaNombre: CATEGORIA_LABELS[categoria] || "Importado",
    institucion:    get("universidad"),
    pago: {
      metodo: "importado", estado: "importado",
      comprobanteRuta: null, monto: null,
      aprobadoPor: null, aprobadoEn: null, notas: null,
    },
    esColegio: false, tutor: null, colegio: null, estudiantes: [],
    estadoRegistro: "activo",
    asistencias: {},
    camposExtra: {
      facultad:              get("facultad"),
      carrera:               get("carrera"),
      ocupacion:             get("ocupacion"),
      participacionCodeClash: pcch === "sí" || pcch === "si" || pcch === "yes" || pcch === "true",
      nivelPython:           get("nivelPython"),
      temasInteres:          temas,
      tallaSueter:           get("tallaSueter").toUpperCase().replace("TALLA ", ""),
    },
  };
}

function validarInscripcion(ins) {
  if (!ins.nombre)  return "Nombre vacío";
  if (!ins.correo || !ins.correo.includes("@")) return `Correo inválido: ${ins.correo}`;
  return null;
}

el("btn-preview-importar").addEventListener("click", () => {
  if (!filasArchivo.length) return;
  const mapeo = leerMapeo();
  const thead = el("preview-thead");
  const tbody = el("preview-tbody");
  const campos = CAMPOS_EURUS.map(c => c.label);
  thead.innerHTML = `<tr>${campos.map(c => `<th>${c}</th>`).join("")}</tr>`;
  tbody.innerHTML = filasArchivo.slice(0, 5).map(fila => {
    return `<tr>${CAMPOS_EURUS.map(c => {
      const val = mapeo[c.key] ? String(fila[mapeo[c.key]] ?? "").trim() : "";
      return `<td>${val || "—"}</td>`;
    }).join("")}</tr>`;
  }).join("");
  el("preview-resumen").textContent = `${filasArchivo.length} filas en total. Mostrando las primeras 5.`;
  el("modal-preview").classList.add("open");
});

el("btn-confirmar-importar").addEventListener("click", async () => {
  if (!filasArchivo.length) { mostrarAlerta("error", "Carga un archivo primero."); return; }

  const mapeo = leerMapeo();
  const prg   = el("importar-progreso");
  prg.style.display = "block";
  el("btn-confirmar-importar").disabled = true;

  prg.textContent = "Cargando participantes existentes...";
  const snapExist = await getDocs(collection(db, "participantes"));
  const correosExistentes = new Set(snapExist.docs.map(d => d.data().correo).filter(Boolean));

  let ok = 0, dup = 0, err = 0;
  for (let i = 0; i < filasArchivo.length; i++) {
    prg.textContent = `Procesando ${i + 1} / ${filasArchivo.length}...`;
    const ins   = filaAInscripcion(filasArchivo[i], mapeo);
    const fallo = validarInscripcion(ins);
    if (fallo) { err++; continue; }
    if (correosExistentes.has(ins.correo)) { dup++; continue; }

    try {
      const cedLimpia  = ins.cedula.replace(/[^a-zA-Z0-9]/g, "_");
      const mailLimpio = ins.correo.replace(/[^a-zA-Z0-9]/g, "_");
      const docId = cedLimpia ? `c_${cedLimpia}` : `e_${mailLimpio}`;
      const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
      const codigo = `IMP-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      await setDoc(doc(db, "participantes", docId), {
        ...ins, codigo, token,
        fechaRegistro:      serverTimestamp(),
        actualizadoEn:      serverTimestamp(),
        importadoDeArchivo: true,
      });
      correosExistentes.add(ins.correo);
      ok++;
    } catch (e) { err++; }
  }

  prg.textContent = "";
  prg.style.display = "none";
  el("btn-confirmar-importar").disabled = false;
  mostrarAlerta("success", `Importación completa: ${ok} importados · ${dup} duplicados omitidos · ${err} errores.`);
  await cargarParticipantes();
});

const zone = el("upload-zone");
zone.addEventListener("click", () => el("input-archivo").click());
zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("dragover"); const f = e.dataTransfer.files[0]; if (f) procesarArchivo(f); });
el("input-archivo").addEventListener("change", e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });

// ═══════════════════════════════════════════════════════════
// PARTICIPANTES  (lee de la colección "participantes")
// ═══════════════════════════════════════════════════════════

async function cargarParticipantes() {
  el("participantes-spinner").style.display = "flex";
  const snap = await getDocs(collection(db, "participantes"));
  participantesGlobal = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  el("participantes-spinner").style.display = "none";
  renderParticipantes();
}

function renderParticipantes() {
  el("participantes-spinner").style.display = "none";
  const busqueda = (el("buscar-participante").value || "").toLowerCase();
  const filtrados = participantesGlobal.filter(p =>
    !busqueda ||
    (p.nombreCompleto || p.nombre || "").toLowerCase().includes(busqueda) ||
    (p.correo || "").includes(busqueda) ||
    (p.cedula || "").includes(busqueda) ||
    (p.codigo || "").toLowerCase().includes(busqueda)
  );

  el("stat-total").textContent        = participantesGlobal.length;
  el("stat-asistentes").textContent   = participantesGlobal.filter(p => p.pago?.estado === "aprobado").length;
  el("stat-certificados").textContent = participantesGlobal.filter(p =>
    p.pago?.estado === "pendiente_efectivo" || p.pago?.estado === "importado"
  ).length;

  const tb = el("tabla-participantes-body");
  if (!filtrados.length) {
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--gris-medio)">Sin resultados</td></tr>`;
    return;
  }

  tb.innerHTML = filtrados.map((p, i) => {
    const nombre = p.nombreCompleto || `${p.nombre || ""} ${p.apellido || ""}`.trim() || "—";
    const fecha  = p.fechaRegistro?.toDate?.()
      ? p.fechaRegistro.toDate().toLocaleDateString("es-PA")
      : "—";
    const badge  = ESTADO_PAGO_BADGE[p.pago?.estado] || ESTADO_PAGO_BADGE["importado"];
    const metodo = p.pago?.metodo === "transferencia" ? "🏦" : p.pago?.metodo === "efectivo" ? "💵" : "—";
    return `<tr style="animation:cardIn 0.3s ${i * 0.03}s both;">
      <td><code style="font-size:11px;color:var(--verde-oscuro);">${p.codigo || "—"}</code></td>
      <td>
        <strong>${nombre}</strong>
        <br/><span style="font-size:11px;color:var(--gris-medio);">${p.correo || ""}</span>
      </td>
      <td style="font-size:12px;font-family:monospace;">${p.cedula || "—"}</td>
      <td style="font-size:12px;">${CATEGORIA_LABELS[p.categoria] || p.categoria || "—"}</td>
      <td>${badge}</td>
      <td style="font-size:13px;">${metodo}</td>
      <td style="font-size:12px;color:var(--gris-medio);">${fecha}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick="window._verQR('${p.id}')" style="width:auto">🔲 QR</button>
      </td>
    </tr>`;
  }).join("");
}

el("buscar-participante").addEventListener("input", renderParticipantes);

// ═══════════════════════════════════════════════════════════
// GENERACIÓN DE QR
// ═══════════════════════════════════════════════════════════

function generarQREnDiv(texto, divDestino) {
  divDestino.innerHTML = "";
  return new QRCode(divDestino, {
    text: texto, width: 220, height: 220,
    colorDark: "#1a1a1a", colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M,
  });
}

window._verQR = id => {
  const p = participantesGlobal.find(x => x.id === id);
  if (!p) return;
  el("qr-modal-nombre").textContent = p.nombreCompleto || p.nombre || "—";
  el("qr-modal-info").textContent   = `${p.codigo || id}  ·  ${p.correo}`;
  const wrap = el("qr-canvas-wrap");
  const qrData = p.codigo && p.token
    ? JSON.stringify({ codigo: p.codigo, token: p.token })
    : id;
  generarQREnDiv(qrData, wrap);
  qrActualCanvas = null;
  setTimeout(() => { qrActualCanvas = wrap.querySelector("canvas"); }, 120);
  el("modal-qr").classList.add("open");
};

el("btn-descargar-qr").addEventListener("click", () => {
  if (!qrActualCanvas) return;
  const link = document.createElement("a");
  link.download = `QR_${el("qr-modal-nombre").textContent.replace(/\s+/g, "_")}.png`;
  link.href = qrActualCanvas.toDataURL("image/png");
  link.click();
});

el("btn-copiar-qr").addEventListener("click", async () => {
  if (!qrActualCanvas) return;
  qrActualCanvas.toBlob(async blob => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      mostrarAlerta("success", "QR copiado al portapapeles.");
    } catch { mostrarAlerta("aviso", "Tu navegador no permite copiar imágenes. Usa Descargar."); }
  });
});

el("btn-gen-todos-qr").addEventListener("click", async () => {
  if (!participantesGlobal.length) { mostrarAlerta("aviso", "No hay participantes cargados."); return; }
  mostrarAlerta("aviso", `Descargando ${participantesGlobal.length} QR. Tu navegador descargará cada archivo individualmente.`);
  for (const p of participantesGlobal) {
    const div = document.createElement("div");
    div.style.position = "fixed"; div.style.left = "-9999px";
    document.body.appendChild(div);
    const qrData = p.codigo && p.token
      ? JSON.stringify({ codigo: p.codigo, token: p.token })
      : p.id;
    generarQREnDiv(qrData, div);
    await new Promise(r => setTimeout(r, 150));
    const canvas = div.querySelector("canvas");
    if (canvas) {
      const a = document.createElement("a");
      const nombreArchivo = (p.nombreCompleto || p.nombre || p.id).replace(/\s+/g, "_");
      a.download = `QR_${nombreArchivo}_${p.id.slice(0, 6)}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    }
    document.body.removeChild(div);
    await new Promise(r => setTimeout(r, 80));
  }
  mostrarAlerta("success", "QR generados y descargados.");
});

// ═══════════════════════════════════════════════════════════
// ASISTENCIA
// ═══════════════════════════════════════════════════════════

function renderAsistencia() {
  if (!eventoActivo) { el("asistencia-tbody").innerHTML = ""; el("asistencia-thead").innerHTML = ""; return; }
  el("asistencia-spinner").style.display = "none";

  // Usar checkpoints de la colección si están cargados, si no el array inline legacy
  const cps = checkpointsEvento.length > 0
    ? checkpointsEvento
    : (eventoActivo.checkpoints || []);

  el("asistencia-thead").innerHTML = `<tr>
    <th>Participante</th>
    ${cps.map(cp => `<th title="${cp.titulo || cp.nombre}">${(cp.nombre || "").length > 14 ? (cp.nombre || "").slice(0, 14) + "…" : (cp.nombre || "")}</th>`).join("")}
    <th>Total</th>
    <th>Cert.</th>
  </tr>`;

  const minCert = eventoActivo.checkpointsMinCertificado || 1;
  el("asistencia-tbody").innerHTML = inscripciones.map(p => {
    const asis  = p.asistencias || {};
    const total = Object.keys(asis).length;
    const celdas = cps.map(cp => asis[cp.id]
      ? `<td class="asistio" title="${fmtFecha(asis[cp.id].marcadoEn)}">✅</td>`
      : `<td class="no-asistio">—</td>`).join("");
    const cert = total >= minCert
      ? `<td style="color:var(--verde-claro);font-weight:700;">✔</td>`
      : `<td style="color:var(--gris-medio);">—</td>`;
    return `<tr><td>${p.nombre}</td>${celdas}<td style="text-align:center;font-weight:700;">${total}</td>${cert}</tr>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════════
// CERTIFICADOS / EXPORTACIONES
// ═══════════════════════════════════════════════════════════

function calcHorasNum(ini, fin) {
  if (!ini || !fin) return null;
  const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const diff = toMin(fin) - toMin(ini);
  return diff > 0 ? Math.round(diff / 60 * 2) / 2 : null; // redondea a 0.5h
}

function origenParticipante(p) {
  const cat    = p.categoria || "";
  const campos = p.camposExtra || {};
  if (["academico_utp", "estudiante_utp"].includes(cat))
    return "Interna — Universidad Tecnológica de Panamá";
  if (["academico_externo", "estudiante_externo"].includes(cat))
    return "Externa — " + (campos.universidad || "Universidad externa");
  if (cat === "colegio")
    return "Externa — " + (campos.centro || "Colegio");
  if (cat === "profesional")
    return "Externa — " + (campos.empresa || "Empresa");
  if (cat === "autor")
    return "Externa — " + (campos.universidad || campos.empresa || "Institución");
  return p.universidad || "—";
}

function fmtDiaLargo(fechaStr) {
  if (!fechaStr) return "—";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-PA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function fmtDiaCorto(fechaStr) {
  if (!fechaStr) return "—";
  return new Date(fechaStr + "T00:00:00").toLocaleDateString("es-PA", {
    day: "numeric", month: "short",
  });
}

function fmtRangoFechas(ini, fin) {
  if (!ini) return "—";
  const opts = { day: "numeric", month: "long", year: "numeric" };
  const a = (ini.toDate ? ini.toDate() : new Date(ini)).toLocaleDateString("es-PA", opts);
  if (!fin) return a;
  const b = (fin.toDate ? fin.toDate() : new Date(fin)).toLocaleDateString("es-PA", opts);
  return a === b ? a : `${a} — ${b}`;
}

function renderCertificados() {
  if (!eventoActivo) return;
  const minCert    = eventoActivo.checkpointsMinCertificado || 1;
  const elegibles  = inscripciones.filter(p => (p.totalAsistencias || 0) >= minCert);
  const exponentes = checkpointsEvento.filter(cp => cp.exponente || cp.ponenteId);

  el("cert-elegibles").textContent  = elegibles.length;
  el("cert-exponentes").textContent = exponentes.length;
  el("cert-checkpoints").textContent = checkpointsEvento.length;

  const tb = el("tabla-cert-body");
  if (!elegibles.length) {
    tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--gris-medio)">Sin participantes elegibles aún.</td></tr>`;
    return;
  }
  tb.innerHTML = elegibles.map(p => {
    const fullP  = participantesGlobal.find(g => g.cedula === p.cedula) || p;
    const origen = origenParticipante(fullP);
    const asis   = Object.keys(p.asistencias || {}).length || p.totalAsistencias || 0;
    return `<tr>
      <td><strong>${p.nombre || "—"}</strong></td>
      <td>${p.cedula || "—"}</td>
      <td style="font-size:12px;">${origen}</td>
      <td style="text-align:center;">${asis} / ${checkpointsEvento.length}</td>
    </tr>`;
  }).join("");
}

// ── 1. PDF del programa ──────────────────────────────────────

el("btn-export-pdf-programa").addEventListener("click", () => {
  if (!eventoActivo) { mostrarAlerta("aviso", "Selecciona un evento primero."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, MX = 18, CW = W - 2 * MX;
  let y = 14;

  const addPage = () => { doc.addPage(); y = 18; };
  const checkY  = (needed = 10) => { if (y + needed > 278) addPage(); };

  // Barra superior
  doc.setFillColor(0, 114, 46);
  doc.rect(0, 0, W, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.text("CONTECS — Universidad Tecnológica de Panamá", W / 2, 7, { align: "center" });
  y = 22;

  // Título del documento
  doc.setFontSize(14);
  doc.setTextColor(0, 114, 46);
  doc.text("PROGRAMA DEL EVENTO", W / 2, y, { align: "center" });
  y += 9;

  // Nombre del evento
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  const nomLines = doc.splitTextToSize(eventoActivo.nombre || "—", CW);
  doc.text(nomLines, W / 2, y, { align: "center" });
  y += nomLines.length * 6 + 4;

  // Separador
  doc.setDrawColor(0, 114, 46);
  doc.setLineWidth(0.4);
  doc.line(MX, y, W - MX, y);
  y += 7;

  // Objetivo
  doc.setFontSize(8);
  doc.setTextColor(0, 114, 46);
  doc.text("OBJETIVO", MX, y);
  y += 5;
  doc.setTextColor(60, 60, 60);
  const descLines = doc.splitTextToSize(eventoActivo.descripcion || "—", CW);
  checkY(descLines.length * 4.5 + 4);
  doc.text(descLines, MX, y);
  y += descLines.length * 4.5 + 6;

  // Fecha completa
  checkY(14);
  doc.setFontSize(8);
  doc.setTextColor(0, 114, 46);
  doc.text("FECHA", MX, y);
  y += 5;
  doc.setTextColor(60, 60, 60);
  doc.text(fmtRangoFechas(eventoActivo.fechaInicio, eventoActivo.fechaFin), MX, y);
  y += 7;

  // Horario por día
  const dias = eventoActivo.diasEvento || [];
  if (dias.length) {
    checkY(8 + dias.length * 5);
    doc.setFontSize(8);
    doc.setTextColor(0, 114, 46);
    doc.text("HORARIO POR DÍA", MX, y);
    y += 5;
    dias.forEach((d, i) => {
      doc.setTextColor(60, 60, 60);
      const horas = (d.horaInicio && d.horaFin) ? `${d.horaInicio} – ${d.horaFin}` : "Sin horario definido";
      doc.text(`Día ${i + 1} · ${fmtDiaLargo(d.fecha)}: ${horas}`, MX + 3, y);
      y += 5;
    });
  }
  y += 4;

  // Separador
  checkY(16);
  doc.setDrawColor(0, 114, 46);
  doc.setLineWidth(0.4);
  doc.line(MX, y, W - MX, y);
  y += 8;

  // Título sección actividades
  doc.setFontSize(11);
  doc.setTextColor(0, 114, 46);
  doc.text("ACTIVIDADES", W / 2, y, { align: "center" });
  y += 8;

  const cps = checkpointsEvento;
  if (!cps.length) {
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text("No hay actividades registradas.", MX, y);
  } else {
    // Cabeceras de columnas
    const C = { tit: MX, sal: MX + 64, dia: MX + 94, h: MX + 132, exp: MX + 148 };
    doc.setFontSize(8);
    doc.setTextColor(0, 114, 46);
    doc.text("Título de la actividad", C.tit, y);
    doc.text("Salón",      C.sal, y);
    doc.text("Día",        C.dia, y);
    doc.text("Horas",      C.h,   y);
    doc.text("Exponente",  C.exp, y);
    y += 1.5;
    doc.setLineWidth(0.2);
    doc.setDrawColor(180, 180, 180);
    doc.line(MX, y, W - MX, y);
    y += 4;

    cps.forEach(cp => {
      const titLines = doc.splitTextToSize(cp.titulo || cp.nombre || "—", 60);
      const expLines = doc.splitTextToSize(cp.exponente || "—", 42);
      const rowH = Math.max(titLines.length, expLines.length) * 4.5 + 3;
      checkY(rowH);
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      doc.text(titLines, C.tit, y);
      doc.text(doc.splitTextToSize(cp.salon || "—", 28), C.sal, y);
      doc.text(fmtDiaCorto(cp.dia), C.dia, y);
      const h = calcHorasNum(cp.horaInicio, cp.horaFin);
      doc.text(h ? `${h}h` : "—", C.h, y);
      doc.text(expLines, C.exp, y);
      y += rowH;
      doc.setLineWidth(0.1);
      doc.setDrawColor(220, 220, 220);
      doc.line(MX, y - 1, W - MX, y - 1);
    });
  }

  // Pie de página en todas las hojas
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFillColor(0, 114, 46);
    doc.rect(0, 285, W, 12, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text(`CONTECS · ${new Date().toLocaleDateString("es-PA")} · Pág. ${i} de ${total}`, W / 2, 292, { align: "center" });
  }

  doc.save(`Programa_${(eventoActivo.nombre || "evento").replace(/\s+/g, "_")}.pdf`);
});

// ── 2. Excel del programa ────────────────────────────────────

el("btn-export-excel-programa").addEventListener("click", () => {
  if (!eventoActivo) { mostrarAlerta("aviso", "Selecciona un evento primero."); return; }

  const dias = eventoActivo.diasEvento || [];

  // Hoja 1: Información del evento
  const h1 = [
    ["Contenido (Nombre del evento)", eventoActivo.nombre || "—"],
    ["Objetivo (Descripción)",        eventoActivo.descripcion || "—"],
    ["Fecha completa",                fmtRangoFechas(eventoActivo.fechaInicio, eventoActivo.fechaFin)],
    [],
    ["Horario por día"],
    ["Día", "Fecha", "Hora inicio", "Hora fin"],
    ...dias.map((d, i) => [
      `Día ${i + 1}`,
      fmtDiaLargo(d.fecha),
      d.horaInicio || "—",
      d.horaFin    || "—",
    ]),
  ];

  // Hoja 2: Checkpoints
  const h2 = [
    ["Título de la actividad", "Salón", "Fecha", "Cantidad de horas", "Exponente"],
    ...checkpointsEvento.map(cp => {
      const h = calcHorasNum(cp.horaInicio, cp.horaFin);
      return [
        cp.titulo || cp.nombre || "—",
        cp.salon  || "—",
        cp.dia    ? fmtDiaLargo(cp.dia) : "—",
        h ? `${h} hora${h !== 1 ? "s" : ""}` : "—",
        cp.exponente || "—",
      ];
    }),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h1), "Información del evento");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h2), "Actividades");
  XLSX.writeFile(wb, `Programa_${(eventoActivo.nombre || "evento").replace(/\s+/g, "_")}.xlsx`);
});

// ── 3. Excel de exponentes ───────────────────────────────────

el("btn-export-excel-exponentes").addEventListener("click", () => {
  if (!eventoActivo) { mostrarAlerta("aviso", "Selecciona un evento primero."); return; }

  const cps = checkpointsEvento.filter(cp => cp.exponente || cp.ponenteId);
  if (!cps.length) {
    mostrarAlerta("aviso", "No hay actividades con exponente registrado.");
    return;
  }

  const filas = [
    ["Nombre", "Cédula", "Tema que impartió", "Día", "Cantidad de horas", "Tipo de presentación", "Origen"],
    ...cps.map(cp => {
      const part   = cp.ponenteId ? participantesGlobal.find(p => p.id === cp.ponenteId) : null;
      const nombre = part
        ? (part.nombreCompleto || ((part.nombre || "") + " " + (part.apellido || "")).trim())
        : (cp.exponente || "—");
      const cedula  = part?.cedula || "—";
      const origen  = part ? origenParticipante(part) : "—";
      const h = calcHorasNum(cp.horaInicio, cp.horaFin);
      const tipo = cp.tipoPresencia
        ? cp.tipoPresencia.charAt(0).toUpperCase() + cp.tipoPresencia.slice(1)
        : "—";
      return [
        nombre,
        cedula,
        cp.titulo || cp.nombre || "—",
        cp.dia ? fmtDiaLargo(cp.dia) : "—",
        h ? `${h} hora${h !== 1 ? "s" : ""}` : "—",
        tipo,
        origen,
      ];
    }),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), "Exponentes");
  XLSX.writeFile(wb, `Exponentes_${(eventoActivo.nombre || "evento").replace(/\s+/g, "_")}.xlsx`);
});

// ── 4. Excel de participantes elegibles ─────────────────────

el("btn-export-excel-participantes").addEventListener("click", () => {
  if (!eventoActivo) { mostrarAlerta("aviso", "Selecciona un evento primero."); return; }

  const minCert   = eventoActivo.checkpointsMinCertificado || 1;
  const elegibles = inscripciones.filter(p => (p.totalAsistencias || 0) >= minCert);
  if (!elegibles.length) { mostrarAlerta("aviso", "No hay participantes elegibles."); return; }

  // Total de horas del evento
  const totalHoras = checkpointsEvento.reduce((s, cp) => s + (calcHorasNum(cp.horaInicio, cp.horaFin) || 0), 0);
  const horasLabel = totalHoras ? `${totalHoras} hora${totalHoras !== 1 ? "s" : ""}` : "—";

  const HEADER = ["Nombre", "Cédula", "Origen", "Horas"];
  const CHUNK  = 50;
  const wb     = XLSX.utils.book_new();

  for (let i = 0; i < elegibles.length; i += CHUNK) {
    const grupo = elegibles.slice(i, i + CHUNK);
    const rows  = [HEADER, ...grupo.map(p => {
      const fullP  = participantesGlobal.find(g => g.cedula === p.cedula) || p;
      return [
        p.nombre || "—",
        p.cedula || "—",
        origenParticipante(fullP),
        horasLabel,
      ];
    })];
    const sheetName = elegibles.length <= CHUNK
      ? "Participantes"
      : `Participantes ${i + 1}–${Math.min(i + CHUNK, elegibles.length)}`;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }

  XLSX.writeFile(wb, `Participantes_${(eventoActivo.nombre || "evento").replace(/\s+/g, "_")}.xlsx`);
});

// ═══════════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════════
el("modal-qr-close").addEventListener("click", () => el("modal-qr").classList.remove("open"));
el("modal-preview-close").addEventListener("click", () => el("modal-preview").classList.remove("open"));
[el("modal-qr"), el("modal-preview")].forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.remove("open"); }));

// ═══════════════════════════════════════════════════════════
// INIT — espera a que Auth confirme sesión antes de leer Firestore
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  await Promise.all([cargarEventos(), cargarParticipantes()]);
});

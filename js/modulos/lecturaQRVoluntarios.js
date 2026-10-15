import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { app } from "../core/firebase-config.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import { iconoImg } from "../core/iconos.js";
import { escaparAtributo, escaparHtml } from "../core/seguridad.js";

const el = id => document.getElementById(id);
const h = escaparHtml;
const ejecutarOperacionQr = httpsCallable(
  getFunctions(app, "us-central1"),
  "ejecutarOperacionQr",
);

let scanner          = null;
let escaneando       = false;
let actividadActiva  = null;   // con origen "congreso" es el evento y sus turnos por día
let turnoActivo      = null;
let diaActivo        = null;   // solo congreso: "2026-10-19"
const congresos      = new Map(); // eventoId -> { id, nombre, origen, turnos, dias }
let voluntarioActual = null;
let asistenciaActual = null;
let modoActual       = null;   // "entrada" | "salida" | "completo"
let ratingSeleccionado = null;
let logSesion        = [];

// Cache de voluntarios cargados al iniciar: búsqueda local instantánea
// Clave 1: campo "id" (personal/cédula)  →  objeto voluntario
// Clave 2: Firestore document ID          →  objeto voluntario
const volPorCampoId = new Map();
const volPorDocId   = new Map();

async function cargarVoluntariosLocal() {
  try {
    const snap = await getDocs(collection(db, "voluntarios"));
    snap.docs.forEach(d => {
      const datos = { _docId: d.id, ...d.data() };
      volPorDocId.set(d.id, datos);
      const campoId = String(d.data().id ?? "").trim();
      if (campoId) volPorCampoId.set(campoId, datos);
    });
  } catch (e) {
    alerta("warning", "No se pudo precargar voluntarios: " + e.message);
  }
}

// ─── Alerta ──────────────────────────────────────────────────────────────────
function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  setTimeout(() => div.classList.remove("show"), 5000);
}

function fmtHora(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

// ─── Cargar actividades ───────────────────────────────────────────────────────
// El congreso va primero: sus turnos (uno por día) se crean en Voluntariado →
// Turnos y viven en turnos_congreso/{eventoId}.
async function cargarCongresos() {
  const [eventos, turnosDocs] = await Promise.all([
    getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc"))),
    getDocs(collection(db, "turnos_congreso")),
  ]);
  const turnosPorEvento = new Map(turnosDocs.docs.map(d => [d.id, d.data().turnos || []]));
  eventos.docs.forEach(d => {
    const ev = d.data();
    const turnos = turnosPorEvento.get(d.id) || [];
    if (!turnos.length || ev.activo === false || ev.estado === "cancelado") return;
    const dias = [...new Set([...(ev.diasEvento || []).map(x => x.fecha), ...turnos.map(t => t.dia)].filter(Boolean))].sort();
    congresos.set(d.id, { id: d.id, nombre: ev.nombre || "Congreso", origen: "congreso", turnos, dias });
  });
}

async function cargarActividades() {
  const sel = el("sel-actividad-qr");
  try {
    await cargarCongresos();
    if (congresos.size) {
      const grupo = document.createElement("optgroup");
      grupo.label = "Congreso";
      congresos.forEach(c => {
        const opt = document.createElement("option");
        opt.value = `congreso:${c.id}`;
        opt.textContent = c.nombre;
        grupo.appendChild(opt);
      });
      sel.appendChild(grupo);
    }
  } catch (e) {
    alerta("warning", "No se pudieron cargar los turnos del congreso: " + e.message);
  }
  try {
    const snap = await getDocs(query(collection(db, "actividades_voluntarios"), orderBy("creadoEn", "desc")));
    const grupo = document.createElement("optgroup");
    grupo.label = "Actividades de voluntariado";
    snap.docs.forEach(d => {
      const a   = d.data();
      const opt = document.createElement("option");
      opt.value       = d.id;
      opt.textContent = `${a.nombre}${a.activo ? "" : " (inactiva)"}`;
      grupo.appendChild(opt);
    });
    if (grupo.children.length) sel.appendChild(grupo);
  } catch (e) {
    alerta("error", "No se pudieron cargar las actividades.");
  }
}

const hoy = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Panama", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const etiquetaDia = dia => new Date(`${dia}T12:00:00`).toLocaleDateString("es-PA", { weekday: "long", day: "numeric", month: "long" });

el("sel-actividad-qr").addEventListener("change", async () => {
  const valor = el("sel-actividad-qr").value;
  actividadActiva = turnoActivo = diaActivo = null;
  el("sesion-activa").textContent = "";
  el("dia-section").style.display = "none";
  if (!valor) {
    el("turno-section").style.display = "none";
    return;
  }
  if (valor.startsWith("congreso:")) {
    actividadActiva = congresos.get(valor.slice("congreso:".length)) || null;
    if (!actividadActiva) return;
    // Por defecto el día de hoy; si hoy no hay congreso, el primero.
    diaActivo = actividadActiva.dias.includes(hoy()) ? hoy() : actividadActiva.dias[0] || null;
    renderDias();
    el("dia-section").style.display = "block";
  } else {
    const snap = await getDoc(doc(db, "actividades_voluntarios", valor));
    if (!snap.exists()) return;
    actividadActiva = { id: valor, ...snap.data() };
  }
  renderTurnos();
  el("turno-section").style.display = "block";
});

function renderDias() {
  const grid = el("dias-grid");
  grid.innerHTML = actividadActiva.dias.map(dia => {
    const activo = dia === diaActivo;
    return `<button type="button" class="btn btn-sm ${activo ? "btn-primary" : "btn-outline"}" data-dia="${escaparAtributo(dia)}" style="width:auto;text-transform:capitalize;">${h(etiquetaDia(dia))}${dia === hoy() ? " · hoy" : ""}</button>`;
  }).join("");
  grid.querySelectorAll("[data-dia]").forEach(b => b.addEventListener("click", () => {
    diaActivo = b.dataset.dia;
    turnoActivo = null;
    el("sesion-activa").textContent = "";
    renderDias();
    renderTurnos();
  }));
}

// Turnos de la actividad o, en el congreso, los del día elegido.
function turnosVisibles() {
  const turnos = actividadActiva?.turnos || [];
  if (actividadActiva?.origen !== "congreso") return turnos;
  return turnos.filter(t => t.dia === diaActivo)
    .sort((a, b) => String(a.horaInicio).localeCompare(String(b.horaInicio)));
}

function renderTurnos() {
  const grid = el("turnos-grid");
  const turnos = turnosVisibles();
  if (!turnos.length) {
    grid.innerHTML = `<p style="color:var(--gris-medio);font-size:13px;">${actividadActiva?.origen === "congreso" ? "Este día no tiene turnos configurados." : "Esta actividad no tiene turnos configurados."}</p>`;
    return;
  }
  grid.innerHTML = turnos.map(t => `
    <div
      class="cp-card"
      data-turno-id="${escaparAtributo(t.id)}"
      style="background:var(--verde-fondo);border-radius:var(--radio-sm,8px);padding:10px 14px;font-size:13px;font-weight:600;color:var(--verde-oscuro);cursor:pointer;border:2px solid transparent;transition:border-color 0.2s,background 0.2s;"
    >
      ${iconoImg("reloj")} ${h(t.nombre || "Turno")}<br/><small style="font-weight:400">${h(t.horaInicio || "—")} – ${h(t.horaFin || "—")}</small>
    </div>`).join("");
  grid.querySelectorAll("[data-turno-id]").forEach(card => {
    card.addEventListener("click", () => {
      const turno = turnos.find(t => String(t.id) === card.dataset.turnoId);
      if (turno) window.seleccionarTurno(card, turno.id, turno.nombre, turno.horaInicio, turno.horaFin);
    });
  });
}

window.seleccionarTurno = function(card, id, nombre, horaInicio, horaFin) {
  document.querySelectorAll("[data-turno-id]").forEach(c => {
    c.style.borderColor = "transparent";
    c.style.background  = "var(--verde-fondo)";
  });
  card.style.borderColor = "var(--verde-claro)";
  card.style.background  = "var(--verde-claro)";
  card.style.color       = "#fff";
  turnoActivo = { id, nombre, horaInicio, horaFin };
  el("sesion-activa").textContent = `Sesión activa: ${actividadActiva.nombre}${diaActivo ? ` · ${etiquetaDia(diaActivo)}` : ""} · ${nombre} (${horaInicio}–${horaFin})`;
};

// ─── Scanner ─────────────────────────────────────────────────────────────────
el("btn-iniciar").addEventListener("click", async () => {
  if (!actividadActiva) { alerta("error", "Selecciona una actividad primero."); return; }
  if (!turnoActivo)     { alerta("error", "Selecciona un turno antes de escanear."); return; }

  if (!scanner) scanner = new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onScanExito,
      () => {}
    );
    escaneando = true;
    el("btn-iniciar").style.display = "none";
    el("btn-detener").style.display = "inline-flex";
    el("reader").closest(".scanner-overlay").classList.add("activo");
  } catch (e) {
    alerta("error", "No se pudo acceder a la cámara: " + e.message);
  }
});

el("btn-detener").addEventListener("click", async () => {
  if (scanner && escaneando) { await scanner.stop(); escaneando = false; }
  el("btn-iniciar").style.display  = "inline-flex";
  el("btn-detener").style.display  = "none";
  el("reader").closest(".scanner-overlay").classList.remove("activo");
});

// ─── Escaneo exitoso ─────────────────────────────────────────────────────────
async function onScanExito(valorQR) {
  if (!escaneando) return;
  await scanner.pause(true);

  let qr = String(valorQR ?? "").trim();
  // Credenciales nuevas: el QR es el enlace del perfil del personal
  // (perfil-personal.html?id=<doc>&t=<token>); se usa el documento.
  try {
    const url = new URL(qr);
    const docId = url.pathname.endsWith("/perfil-personal.html") ? url.searchParams.get("id") : null;
    if (docId) qr = docId;
  } catch { /* no es un enlace: cédula o id de documento */ }

  // 1. Buscar en caché local (instantáneo, sin red)
  //    El QR puede contener el campo "id" (cédula) o el Firestore doc ID.
  let volData = volPorCampoId.get(qr) || volPorDocId.get(qr);

  // 2. Si no está en caché (p.ej. voluntario agregado después de cargar la página),
  //    intentar búsqueda en tiempo real
  if (!volData) {
    try {
      const snap = await getDocs(query(collection(db, "voluntarios"), where("id", "==", qr)));
      if (!snap.empty) {
        volData = { _docId: snap.docs[0].id, ...snap.docs[0].data() };
        volPorCampoId.set(qr, volData);
        volPorDocId.set(snap.docs[0].id, volData);
      }
    } catch (e) { /* continuar al siguiente intento */ }
  }

  // 3. Último recurso: buscar por Firestore document ID directamente
  if (!volData) {
    try {
      const snapD = await getDoc(doc(db, "voluntarios", qr));
      if (snapD.exists()) {
        volData = { _docId: snapD.id, ...snapD.data() };
        volPorDocId.set(snapD.id, volData);
        const campoId = String(snapD.data().id ?? "").trim();
        if (campoId) volPorCampoId.set(campoId, volData);
      }
    } catch (e) { /* no encontrado */ }
  }

  if (!volData) {
    alerta("error", `QR no reconocido. Código escaneado: "${qr}"`);
    await scanner.resume();
    return;
  }

  voluntarioActual = volData;

  // Buscar asistencia existente (ID determinístico)
  const asistenciaId  = `${voluntarioActual._docId}_${actividadActiva.id}_${turnoActivo.id}`;
  const snapAsis      = await getDoc(doc(db, "asistencias_voluntarios", asistenciaId));

  if (!snapAsis.exists()) {
    modoActual = "entrada";
  } else {
    asistenciaActual = { id: asistenciaId, ...snapAsis.data() };
    modoActual = asistenciaActual.horaSalida ? "completo" : "salida";
  }

  mostrarResultado();
}

function mostrarResultado() {
  const v = voluntarioActual;
  el("res-nombre").textContent      = `${v.nombre || ""}${v.apellido ? " " + v.apellido : ""}`;
  el("res-cedula").textContent      = v.id      || "—";
  el("res-correo").textContent      = v.correo  || "—";
  el("res-universidad").textContent = v.carrera || "—";
  el("res-horas-total").textContent = `${(v.totalHoras || 0).toFixed(2)}h acumuladas`;

  const badge    = el("res-estado-badge");
  const infoTurno = el("res-info-turno");
  const btnConf  = el("btn-confirmar");
  const ratingSection = el("rating-section");

  ratingSeleccionado = null;
  document.querySelectorAll(".rating-btn").forEach(b => b.classList.remove("selected"));
  ratingSection.style.display = "none";

  infoTurno.textContent = `${actividadActiva.origen === "congreso" ? "Congreso" : "Actividad"}: ${actividadActiva.nombre}${diaActivo ? ` · ${etiquetaDia(diaActivo)}` : ""} · Turno: ${turnoActivo.nombre} (${turnoActivo.horaInicio}–${turnoActivo.horaFin})`;

  if (modoActual === "entrada") {
    badge.className   = "estado-badge estado-entrada";
    badge.textContent = "ENTRADA — Primera vez en este turno";
    btnConf.textContent = "Registrar entrada";
    btnConf.disabled    = false;
  } else if (modoActual === "salida") {
    const entrada    = asistenciaActual.horaEntrada?.toDate ? asistenciaActual.horaEntrada.toDate() : new Date();
    const ahora      = new Date();
    const horasPreview = ((ahora - entrada) / 3600000).toFixed(2);
    badge.className   = "estado-badge estado-salida";
    badge.textContent = `SALIDA — Entró a las ${fmtHora(asistenciaActual.horaEntrada)} · ${horasPreview}h`;
    ratingSection.style.display = "block";
    btnConf.textContent = "Registrar salida";
    btnConf.disabled    = true;  // se habilita al seleccionar rating
  } else {
    badge.className   = "estado-badge estado-completo";
    badge.textContent = `Completado — ${fmtHora(asistenciaActual.horaEntrada)} → ${fmtHora(asistenciaActual.horaSalida)} · ${(asistenciaActual.horasGanadas || 0).toFixed(2)}h`;
    btnConf.textContent = "—";
    btnConf.disabled    = true;
  }

  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Rating ───────────────────────────────────────────────────────────────────
window.seleccionarRating = function(val) {
  ratingSeleccionado = val;
  document.querySelectorAll(".rating-btn").forEach(b => {
    b.classList.toggle("selected", +b.dataset.val === val);
  });
  el("btn-confirmar").disabled = false;
};

// ─── Confirmar ────────────────────────────────────────────────────────────────
el("btn-confirmar").addEventListener("click", async () => {
  if (modoActual === "completo") return;
  el("btn-confirmar").disabled    = true;
  el("btn-confirmar").textContent = "Guardando...";

  try {
    if (modoActual === "entrada") {
      await ejecutarOperacionQr({
        tipo: "asistencia_voluntario",
        accion: "entrada",
        voluntarioId: voluntarioActual._docId,
        actividadId: actividadActiva.id,
        turnoId: turnoActivo.id,
        origen: actividadActiva.origen || "actividad",
      });

      agregarLog("entrada", voluntarioActual.nombre, turnoActivo.nombre, null);
      alerta("success", `Entrada registrada: ${voluntarioActual.nombre}`);

    } else if (modoActual === "salida") {
      const respuesta = await ejecutarOperacionQr({
        tipo: "asistencia_voluntario",
        accion: "salida",
        voluntarioId: voluntarioActual._docId,
        actividadId: actividadActiva.id,
        turnoId: turnoActivo.id,
        origen: actividadActiva.origen || "actividad",
        calificacion: ratingSeleccionado,
      });
      const horasGanadas = respuesta.data.horasGanadas;

      agregarLog("salida", voluntarioActual.nombre, turnoActivo.nombre, horasGanadas);
      alerta("success", `Salida registrada: ${voluntarioActual.nombre} · +${horasGanadas.toFixed(2)}h`);
    }
  } catch (e) {
    alerta("error", "Error al guardar: " + e.message);
    el("btn-confirmar").disabled    = false;
    el("btn-confirmar").textContent = modoActual === "entrada" ? "Registrar entrada" : "Registrar salida";
    return;
  }

  cerrarResultado();
});

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

async function cerrarResultado() {
  voluntarioActual = asistenciaActual = modoActual = null;
  ratingSeleccionado = null;
  el("resultado-box").style.display = "none";
  el("btn-confirmar").textContent   = "Confirmar";
  el("btn-confirmar").disabled      = false;
  if (scanner && escaneando) await scanner.resume();
}

// ─── Log ─────────────────────────────────────────────────────────────────────
function agregarLog(tipo, nombre, turno, horas) {
  logSesion.unshift({
    tipo, nombre, turno,
    horas: horas != null ? horas.toFixed(2) + "h" : "—",
    hora:  new Date().toLocaleTimeString("es-PA"),
  });
  renderLog();
}

function renderLog() {
  const tb = el("log-recientes");
  if (!logSesion.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gris-medio)">Sin registros aún</td></tr>`;
    return;
  }
  tb.innerHTML = logSesion.slice(0, 20).map(entry => `
    <tr>
      <td>${h(entry.nombre)}</td>
      <td class="log-${entry.tipo}">${entry.tipo === "entrada" ? "Entrada" : "Salida"}</td>
      <td>${h(entry.turno)}</td>
      <td>${h(entry.hora)}</td>
      <td><strong>${h(entry.horas)}</strong></td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarActividades();
cargarVoluntariosLocal();

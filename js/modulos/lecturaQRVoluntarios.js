import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const el = id => document.getElementById(id);

let scanner          = null;
let escaneando       = false;
let actividadActiva  = null;
let turnoActivo      = null;
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
async function cargarActividades() {
  try {
    const snap = await getDocs(query(collection(db, "actividades_voluntarios"), orderBy("creadoEn", "desc")));
    const sel  = el("sel-actividad-qr");
    snap.docs.forEach(d => {
      const a   = d.data();
      const opt = document.createElement("option");
      opt.value       = d.id;
      opt.textContent = `${a.nombre}${a.activo ? "" : " (inactiva)"}`;
      sel.appendChild(opt);
    });
  } catch (e) {
    alerta("error", "No se pudieron cargar las actividades.");
  }
}

el("sel-actividad-qr").addEventListener("change", async () => {
  const id = el("sel-actividad-qr").value;
  if (!id) {
    actividadActiva = turnoActivo = null;
    el("turno-section").style.display = "none";
    el("sesion-activa").textContent = "";
    return;
  }
  const snap = await getDoc(doc(db, "actividades_voluntarios", id));
  if (!snap.exists()) return;
  actividadActiva = { id, ...snap.data() };
  turnoActivo = null;
  renderTurnos();
  el("turno-section").style.display = "block";
  el("sesion-activa").textContent = "";
});

function renderTurnos() {
  const grid = el("turnos-grid");
  const turnos = actividadActiva?.turnos || [];
  if (!turnos.length) {
    grid.innerHTML = `<p style="color:var(--gris-medio);font-size:13px;">Esta actividad no tiene turnos configurados.</p>`;
    return;
  }
  grid.innerHTML = turnos.map(t => `
    <div
      class="cp-card"
      data-id="${t.id}"
      data-nombre="${t.nombre} (${t.horaInicio}–${t.horaFin})"
      onclick="seleccionarTurno(this,'${t.id}','${t.nombre}','${t.horaInicio}','${t.horaFin}')"
      style="background:var(--verde-fondo);border-radius:var(--radio-sm,8px);padding:10px 14px;font-size:13px;font-weight:600;color:var(--verde-oscuro);cursor:pointer;border:2px solid transparent;transition:border-color 0.2s,background 0.2s;"
    >
      🕐 ${t.nombre}<br/><small style="font-weight:400">${t.horaInicio} – ${t.horaFin}</small>
    </div>`).join("");
}

window.seleccionarTurno = function(card, id, nombre, horaInicio, horaFin) {
  document.querySelectorAll("[data-id]").forEach(c => {
    c.style.borderColor = "transparent";
    c.style.background  = "var(--verde-fondo)";
  });
  card.style.borderColor = "var(--verde-claro)";
  card.style.background  = "var(--verde-claro)";
  card.style.color       = "#fff";
  turnoActivo = { id, nombre, horaInicio, horaFin };
  el("sesion-activa").textContent = `Sesión activa: ${actividadActiva.nombre} · ${nombre} (${horaInicio}–${horaFin})`;
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

  const qr = String(valorQR ?? "").trim();

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

  infoTurno.textContent = `Actividad: ${actividadActiva.nombre} · Turno: ${turnoActivo.nombre} (${turnoActivo.horaInicio}–${turnoActivo.horaFin})`;

  if (modoActual === "entrada") {
    badge.className   = "estado-badge estado-entrada";
    badge.textContent = "🟢 ENTRADA — Primera vez en este turno";
    btnConf.textContent = "✅ Registrar entrada";
    btnConf.disabled    = false;
  } else if (modoActual === "salida") {
    const entrada    = asistenciaActual.horaEntrada?.toDate ? asistenciaActual.horaEntrada.toDate() : new Date();
    const ahora      = new Date();
    const horasPreview = ((ahora - entrada) / 3600000).toFixed(2);
    badge.className   = "estado-badge estado-salida";
    badge.textContent = `🟡 SALIDA — Entró a las ${fmtHora(asistenciaActual.horaEntrada)} · ${horasPreview}h`;
    ratingSection.style.display = "block";
    btnConf.textContent = "✅ Registrar salida";
    btnConf.disabled    = true;  // se habilita al seleccionar rating
  } else {
    badge.className   = "estado-badge estado-completo";
    badge.textContent = `✔ Completado — ${fmtHora(asistenciaActual.horaEntrada)} → ${fmtHora(asistenciaActual.horaSalida)} · ${(asistenciaActual.horasGanadas || 0).toFixed(2)}h`;
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

  const asistenciaId = `${voluntarioActual._docId}_${actividadActiva.id}_${turnoActivo.id}`;

  try {
    if (modoActual === "entrada") {
      await setDoc(doc(db, "asistencias_voluntarios", asistenciaId), {
        voluntarioId:  voluntarioActual._docId,
        actividadId:   actividadActiva.id,
        turnoId:       turnoActivo.id,
        horaEntrada:   serverTimestamp(),
        horaSalida:    null,
        horasGanadas:  null,
        calificacion:  null,
        registradoPor: auth.currentUser?.uid || "",
        creadoEn:      serverTimestamp(),
        actualizadoEn: serverTimestamp(),
      });

      agregarLog("entrada", voluntarioActual.nombre, turnoActivo.nombre, null);
      alerta("success", `✅ Entrada registrada: ${voluntarioActual.nombre}`);

    } else if (modoActual === "salida") {
      // Calcular horas reales desde la hora de entrada guardada
      const snapActual  = await getDoc(doc(db, "asistencias_voluntarios", asistenciaId));
      const entradaTs   = snapActual.data()?.horaEntrada?.toDate ? snapActual.data().horaEntrada.toDate() : new Date();
      const salidaTs    = new Date();
      const horasGanadas = Math.round(((salidaTs - entradaTs) / 3600000) * 100) / 100;

      await updateDoc(doc(db, "asistencias_voluntarios", asistenciaId), {
        horaSalida:    serverTimestamp(),
        horasGanadas,
        calificacion:  ratingSeleccionado,
        actualizadoEn: serverTimestamp(),
      });

      // Sumar horas al voluntario de forma atómica
      await updateDoc(doc(db, "voluntarios", voluntarioActual._docId), {
        totalHoras: increment(horasGanadas),
      });

      agregarLog("salida", voluntarioActual.nombre, turnoActivo.nombre, horasGanadas);
      alerta("success", `✅ Salida registrada: ${voluntarioActual.nombre} · +${horasGanadas.toFixed(2)}h`);
    }
  } catch (e) {
    alerta("error", "Error al guardar: " + e.message);
    el("btn-confirmar").disabled    = false;
    el("btn-confirmar").textContent = modoActual === "entrada" ? "✅ Registrar entrada" : "✅ Registrar salida";
    return;
  }

  cerrarResultado();
});

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

async function cerrarResultado() {
  voluntarioActual = asistenciaActual = modoActual = null;
  ratingSeleccionado = null;
  el("resultado-box").style.display = "none";
  el("btn-confirmar").textContent   = "✅ Confirmar";
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
      <td>${entry.nombre}</td>
      <td class="log-${entry.tipo}">${entry.tipo === "entrada" ? "🟢 Entrada" : "🟡 Salida"}</td>
      <td>${entry.turno}</td>
      <td>${entry.hora}</td>
      <td><strong>${entry.horas}</strong></td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarActividades();
cargarVoluntariosLocal();

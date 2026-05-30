import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, updateDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const el = id => document.getElementById(id);

let scanner         = null;
let escaneando      = false;
let eventoActivo    = null;
let checkpointSel   = null;
let participanteSel = null;
let logSesion       = [];

// ─── Alerta ──────────────────────────────────────────────────────────────────
function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  setTimeout(() => div.classList.remove("show"), 5000);
}

// ─── Cargar eventos ──────────────────────────────────────────────────────────
async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc")));
  const sel  = el("sel-evento-qr");
  snap.docs.forEach(d => {
    const ev  = d.data();
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = ev.nombre;
    sel.appendChild(opt);
  });
}

el("sel-evento-qr").addEventListener("change", async () => {
  const id = el("sel-evento-qr").value;
  if (!id) { eventoActivo = null; el("cp-section").style.display = "none"; return; }
  const snap = await getDoc(doc(db, "eventos", id));
  if (!snap.exists()) return;
  eventoActivo = { id, ...snap.data() };
  renderCheckpoints();
  el("cp-section").style.display = "block";
});

function renderCheckpoints() {
  const cps = eventoActivo?.checkpoints || [];
  const grid = el("cp-grid");
  grid.innerHTML = cps.map(cp => `
    <div class="cp-card" data-id="${cp.id}" data-nombre="${cp.nombre}" onclick="seleccionarCP(this)">
      ${cp.nombre}
    </div>`).join("");
}

window.seleccionarCP = function(card) {
  if (card.classList.contains("ya-marcado")) return;
  document.querySelectorAll(".cp-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  checkpointSel = { id: card.dataset.id, nombre: card.dataset.nombre };
  el("cp-seleccionado").textContent = `Checkpoint activo: ${checkpointSel.nombre}`;
};

// ─── Scanner ─────────────────────────────────────────────────────────────────
el("btn-iniciar").addEventListener("click", async () => {
  if (!eventoActivo) { alerta("error", "Selecciona un evento."); return; }
  if (!checkpointSel) { alerta("error", "Selecciona un checkpoint."); return; }

  if (!scanner) scanner = new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onScanExito,
      () => {}  // ignorar errores de frame
    );
    escaneando = true;
    el("btn-iniciar").style.display = "none";
    el("btn-detener").style.display = "inline-flex";
  } catch (e) {
    alerta("error", "No se pudo acceder a la cámara: " + e.message);
  }
});

el("btn-detener").addEventListener("click", async () => {
  if (scanner && escaneando) {
    await scanner.stop();
    escaneando = false;
  }
  el("btn-iniciar").style.display = "inline-flex";
  el("btn-detener").style.display = "none";
});

// ─── Escaneo exitoso ─────────────────────────────────────────────────────────
async function onScanExito(inscripcionId) {
  if (!escaneando) return;
  // Pausar scanner mientras se procesa
  await scanner.pause(true);

  const snap = await getDoc(doc(db, "inscripciones", inscripcionId));
  if (!snap.exists()) {
    alerta("error", "QR no reconocido. Participante no encontrado.");
    await scanner.resume();
    return;
  }

  const p = { id: inscripcionId, ...snap.data() };

  // Verificar que pertenece al evento activo
  if (p.eventoId !== eventoActivo.id) {
    alerta("error", `Este QR pertenece a otro evento (${p.eventoNombre || "desconocido"}).`);
    await scanner.resume();
    return;
  }

  participanteSel = p;
  mostrarInfoParticipante(p);
}

function mostrarInfoParticipante(p) {
  el("res-nombre").textContent      = p.nombre;
  el("res-correo").textContent      = p.correo;
  el("res-cedula").textContent      = p.cedula || "—";
  el("res-universidad").textContent = p.universidad || "—";
  el("res-carrera").textContent     = p.carrera || "—";

  const asis     = p.asistencias || {};
  const yaMarcado = asis[checkpointSel.id];

  const badge = el("res-estado-badge");
  if (yaMarcado) {
    badge.className = "estado-badge estado-err";
    badge.textContent = `⚠️ Ya registrado en "${checkpointSel.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else {
    badge.className = "estado-badge estado-ok";
    badge.textContent = `✅ Listo para marcar: ${checkpointSel.nombre}`;
    el("btn-confirmar-asistencia").disabled = false;
  }

  const totalCPs  = (eventoActivo.checkpoints || []).length;
  const marcados  = Object.keys(asis).map(k => {
    const cp = eventoActivo.checkpoints.find(c => c.id === k);
    return cp ? cp.nombre : k;
  });
  el("res-asistencias-actuales").textContent = marcados.length
    ? `Checkpoints previos (${marcados.length}/${totalCPs}): ${marcados.join(", ")}`
    : "Sin asistencias registradas aún.";

  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

el("btn-confirmar-asistencia").addEventListener("click", async () => {
  if (!participanteSel || !checkpointSel) return;
  el("btn-confirmar-asistencia").disabled = true;
  el("btn-confirmar-asistencia").textContent = "Guardando...";

  const ahoraKey = `asistencias.${checkpointSel.id}`;
  const nuevaAsis = {
    marcadoEn:   serverTimestamp(),
    marcadoPor:  auth.currentUser?.uid || "desconocido",
    checkpoint:  checkpointSel.nombre,
  };

  const nuevaAsistencias = { ...(participanteSel.asistencias || {}), [checkpointSel.id]: nuevaAsis };
  const nuevoTotal = Object.keys(nuevaAsistencias).length;

  try {
    await updateDoc(doc(db, "inscripciones", participanteSel.id), {
      [`asistencias.${checkpointSel.id}`]: nuevaAsis,
      totalAsistencias: nuevoTotal,
      estado: "presente",
      actualizadoEn: serverTimestamp(),
    });

    // Agregar al log de sesión
    const ahora = new Date();
    logSesion.unshift({
      nombre:     participanteSel.nombre,
      checkpoint: checkpointSel.nombre,
      hora:       ahora.toLocaleTimeString("es-PA"),
    });
    renderLog();
    alerta("success", `✅ Asistencia confirmada: ${participanteSel.nombre}`);

    // Marcar visualmente el checkpoint como ya marcado para esta persona
    marcarCPYaMarcado(checkpointSel.id);
  } catch (e) {
    alerta("error", "Error al guardar: " + e.message);
  }

  cerrarResultado();
});

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

async function cerrarResultado() {
  participanteSel = null;
  el("resultado-box").style.display = "none";
  el("btn-confirmar-asistencia").disabled = false;
  el("btn-confirmar-asistencia").textContent = "✅ Confirmar asistencia";
  if (scanner && escaneando) await scanner.resume();
}

function marcarCPYaMarcado(cpId) {
  // Visual feedback: el checkpoint queda como "ya marcado" en la sesión para esta persona
  // (no es permanente — sirve como guía visual al operador)
}

// ─── Log ─────────────────────────────────────────────────────────────────────
function renderLog() {
  const tb = el("log-recientes");
  if (!logSesion.length) { tb.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--gris-medio)">Sin registros aún</td></tr>`; return; }
  tb.innerHTML = logSesion.slice(0, 20).map(entry => `
    <tr>
      <td>${entry.nombre}</td>
      <td>${entry.checkpoint}</td>
      <td>${entry.hora}</td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarEventos();

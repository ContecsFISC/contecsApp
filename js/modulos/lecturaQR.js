import { db, auth } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const el = id => document.getElementById(id);

let scanner          = null;
let escaneando       = false;
let eventoActivo     = null;
let checkpointsSesion = [];   // cargados desde colección 'checkpoints'
let checkpointSel    = null;  // objeto completo del checkpoint seleccionado
let participanteSel  = null;
let modoTaller       = false; // true cuando el checkpoint es taller/gira con cupos
let logSesion        = [];

const TIPO_CON_CUPOS = ["taller", "gira"];

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
  if (!id) {
    eventoActivo = null;
    checkpointsSesion = [];
    el("cp-section").style.display = "none";
    return;
  }
  const snap = await getDoc(doc(db, "eventos", id));
  if (!snap.exists()) return;
  eventoActivo = { id, ...snap.data() };

  // Cargar checkpoints desde la colección (nuevo sistema)
  const cpSnap = await getDocs(query(collection(db, "checkpoints"), where("eventoId", "==", id)));
  checkpointsSesion = cpSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      if (a.dia !== b.dia) return (a.dia || "") < (b.dia || "") ? -1 : 1;
      return (a.horaInicio || "") < (b.horaInicio || "") ? -1 : 1;
    });

  // Fallback: si no hay en la colección, usar el array inline del evento (legacy)
  if (!checkpointsSesion.length && eventoActivo.checkpoints?.length) {
    checkpointsSesion = eventoActivo.checkpoints.map(cp => ({
      id: cp.id, nombre: cp.nombre, tipo: "conferencia",
      cupos: null, cuposDisponibles: null,
    }));
  }

  renderCheckpoints();
  el("cp-section").style.display = "block";
});

function renderCheckpoints() {
  const grid = el("cp-grid");
  if (!checkpointsSesion.length) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--gris-medio);grid-column:1/-1">Sin checkpoints registrados para este evento.</p>`;
    return;
  }
  grid.innerHTML = checkpointsSesion.map(cp => {
    const esTaller = TIPO_CON_CUPOS.includes(cp.tipo);
    const cuposTag = esTaller && cp.cupos != null
      ? `<span class="cp-cupos-tag">📋 ${cp.cuposDisponibles ?? cp.cupos} / ${cp.cupos} cupos</span>`
      : "";
    const tipoTag  = cp.tipo && cp.tipo !== "conferencia"
      ? `<span class="cp-tipo-tag">${cp.tipo.toUpperCase()}</span>`
      : "";
    const clsExtra = esTaller ? ` ${cp.tipo}` : "";
    return `<div class="cp-card${clsExtra}" data-id="${cp.id}" onclick="seleccionarCP(this)">
      ${cp.nombre}${tipoTag}${cuposTag}
    </div>`;
  }).join("");
}

window.seleccionarCP = function(card) {
  if (card.classList.contains("ya-marcado")) return;
  document.querySelectorAll(".cp-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  checkpointSel = checkpointsSesion.find(cp => cp.id === card.dataset.id) || null;
  modoTaller    = checkpointSel ? TIPO_CON_CUPOS.includes(checkpointSel.tipo) && checkpointSel.cupos != null : false;

  let label = `Checkpoint activo: ${checkpointSel?.nombre || ""}`;
  if (modoTaller) label += ` · ${checkpointSel.cuposDisponibles ?? checkpointSel.cupos} cupos disponibles`;
  el("cp-seleccionado").textContent = label;
};

// ─── Scanner ─────────────────────────────────────────────────────────────────
el("btn-iniciar").addEventListener("click", async () => {
  if (!eventoActivo)  { alerta("error", "Selecciona un evento."); return; }
  if (!checkpointSel) { alerta("error", "Selecciona un checkpoint."); return; }

  if (!scanner) scanner = new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onScanExito,
      () => {}
    );
    escaneando = true;
    el("btn-iniciar").style.display  = "none";
    el("btn-detener").style.display  = "inline-flex";
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
async function onScanExito(rawQR) {
  if (!escaneando) return;
  await scanner.pause(true);

  let participante = null;
  let esNuevoFormato = false;

  // ── Formato CONTECS 2026: URL perfil.html?c=CODIGO&t=TOKEN ────────────────
  try {
    const url = new URL(rawQR);
    const codigo = url.searchParams.get("c");
    const token  = url.searchParams.get("t");
    if (codigo && token) {
      const snap = await getDocs(query(collection(db, "participantes"), where("codigo", "==", codigo)));
      if (snap.empty) {
        alerta("error", "QR no reconocido. Participante no encontrado.");
        await scanner.resume();
        return;
      }
      const d = snap.docs[0];
      participante = { id: d.id, ...d.data() };
      if (participante.token !== token) {
        alerta("error", "QR inválido (token no coincide).");
        await scanner.resume();
        return;
      }
      esNuevoFormato = true;
    }
  } catch (_) {
    // No es URL válida — continuar con otros formatos
  }

  // ── Formato JSON {codigo, token} (fallback) ───────────────────────────────
  if (!participante) {
    try {
      const qrData = JSON.parse(rawQR);
      if (qrData.codigo && qrData.token) {
        const snap = await getDocs(query(collection(db, "participantes"), where("codigo", "==", qrData.codigo)));
        if (snap.empty) {
          alerta("error", "QR no reconocido. Participante no encontrado.");
          await scanner.resume();
          return;
        }
        const d = snap.docs[0];
        participante = { id: d.id, ...d.data() };
        if (participante.token !== qrData.token) {
          alerta("error", "QR inválido (token no coincide).");
          await scanner.resume();
          return;
        }
        esNuevoFormato = true;
      }
    } catch (_) {
      // No es JSON — intentar con el formato legacy (ID de inscripción)
    }
  }

  if (!participante) {
    // Formato legacy: el QR contiene el ID del doc en 'inscripciones'
    const snap = await getDoc(doc(db, "inscripciones", rawQR));
    if (!snap.exists()) {
      alerta("error", "QR no reconocido. Participante no encontrado.");
      await scanner.resume();
      return;
    }
    participante = { id: rawQR, ...snap.data() };
    if (participante.eventoId !== eventoActivo.id) {
      alerta("error", `Este QR pertenece a otro evento.`);
      await scanner.resume();
      return;
    }
  }

  participanteSel = { ...participante, esNuevoFormato };

  if (modoTaller) {
    await mostrarInfoTaller(participante);
  } else {
    mostrarInfoAsistencia(participante);
  }
}

// ─── Modo Asistencia (checkpoints normales) ───────────────────────────────────
function mostrarInfoAsistencia(p) {
  el("res-nombre").textContent      = p.nombreCompleto || p.nombre || "—";
  el("res-correo").textContent      = p.correo   || "—";
  el("res-cedula").textContent      = p.cedula   || "—";
  el("res-universidad").textContent = p.universidad || p.institucion || "—";
  el("res-carrera").textContent     = p.camposExtra?.carrera || p.carrera || "—";
  el("res-cupos-wrap").style.display = "none";

  const asis      = p.asistencias || {};
  const yaMarcado = asis[checkpointSel.id];
  const badge = el("res-estado-badge");

  if (yaMarcado) {
    badge.className   = "estado-badge estado-err";
    badge.textContent = `⚠️ Ya registrado en "${checkpointSel.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else {
    badge.className   = "estado-badge estado-ok";
    badge.textContent = `✅ Listo para marcar: ${checkpointSel.nombre}`;
    el("btn-confirmar-asistencia").disabled = false;
  }

  el("btn-confirmar-asistencia").textContent = "✅ Confirmar asistencia";

  const cps = checkpointsSesion;
  const marcados = Object.keys(asis).map(k => {
    const cp = cps.find(c => c.id === k);
    return cp ? cp.nombre : k;
  });
  el("res-asistencias-actuales").textContent = marcados.length
    ? `Checkpoints previos (${marcados.length}/${cps.length}): ${marcados.join(", ")}`
    : "Sin asistencias registradas aún.";

  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Modo Taller (inscripción in-situ con cupos) ──────────────────────────────
async function mostrarInfoTaller(p) {
  el("res-nombre").textContent      = p.nombreCompleto || p.nombre || "—";
  el("res-correo").textContent      = p.correo   || "—";
  el("res-cedula").textContent      = p.cedula   || "—";
  el("res-universidad").textContent = p.universidad || p.institucion || "—";
  el("res-carrera").textContent     = p.camposExtra?.carrera || p.carrera || "—";

  // Recargar cupos actuales del checkpoint
  const cpSnap = await getDoc(doc(db, "checkpoints", checkpointSel.id));
  const cpData  = cpSnap.exists() ? cpSnap.data() : checkpointSel;
  const disponibles = cpData.cuposDisponibles ?? cpData.cupos ?? 0;

  el("res-cupos-wrap").style.display = "block";
  el("res-cupos-display").innerHTML  = disponibles > 0
    ? `<span style="color:var(--verde-oscuro)">${disponibles} de ${cpData.cupos} disponibles</span>`
    : `<span style="color:var(--rojo)">Sin cupos disponibles</span>`;

  const badge = el("res-estado-badge");

  // Verificar si ya está inscrito en este taller
  const yaSnap = await getDocs(query(
    collection(db, "inscripciones_checkpoint"),
    where("checkpointId",    "==", checkpointSel.id),
    where("participanteId",  "==", p.id),
  ));

  if (!yaSnap.empty) {
    badge.className   = "estado-badge estado-err";
    badge.textContent = `⚠️ Ya inscrito en "${checkpointSel.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else if (disponibles <= 0) {
    badge.className   = "estado-badge estado-err";
    badge.textContent = `❌ Sin cupos disponibles para "${checkpointSel.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else {
    badge.className   = "estado-badge estado-ok";
    badge.textContent = `✅ Listo para inscribir en: ${checkpointSel.nombre}`;
    el("btn-confirmar-asistencia").disabled = false;
  }

  el("btn-confirmar-asistencia").textContent = "📋 Inscribir en taller";
  el("res-asistencias-actuales").textContent = "";
  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Confirmar (asistencia o inscripción taller) ──────────────────────────────
el("btn-confirmar-asistencia").addEventListener("click", async () => {
  if (!participanteSel || !checkpointSel) return;
  el("btn-confirmar-asistencia").disabled = true;
  el("btn-confirmar-asistencia").textContent = "Guardando...";

  if (modoTaller) {
    await confirmarInscripcionTaller();
  } else {
    await confirmarAsistencia();
  }
});

async function confirmarAsistencia() {
  const nuevaAsis = {
    marcadoEn:  serverTimestamp(),
    marcadoPor: auth.currentUser?.uid || "desconocido",
    checkpoint: checkpointSel.nombre,
  };

  const coleccion = participanteSel.esNuevoFormato ? "participantes" : "inscripciones";
  const nuevasAsistencias = { ...(participanteSel.asistencias || {}), [checkpointSel.id]: nuevaAsis };
  const nuevoTotal = Object.keys(nuevasAsistencias).length;

  try {
    await updateDoc(doc(db, coleccion, participanteSel.id), {
      [`asistencias.${checkpointSel.id}`]: nuevaAsis,
      totalAsistencias: nuevoTotal,
      estado: "presente",
      actualizadoEn: serverTimestamp(),
    });

    logSesion.unshift({
      nombre:     participanteSel.nombreCompleto || participanteSel.nombre,
      checkpoint: checkpointSel.nombre,
      hora:       new Date().toLocaleTimeString("es-PA"),
      tipo:       "asistencia",
    });
    renderLog();
    alerta("success", `✅ Asistencia confirmada: ${participanteSel.nombreCompleto || participanteSel.nombre}`);
  } catch (e) {
    alerta("error", "Error al guardar asistencia: " + e.message);
  }

  cerrarResultado();
}

async function confirmarInscripcionTaller() {
  const cpRef = doc(db, "checkpoints", checkpointSel.id);

  try {
    await runTransaction(db, async txn => {
      const cpSnap = await txn.get(cpRef);
      if (!cpSnap.exists()) throw new Error("Checkpoint no encontrado.");

      const disponibles = cpSnap.data().cuposDisponibles ?? cpSnap.data().cupos ?? 0;
      if (disponibles <= 0) throw new Error("Ya no hay cupos disponibles.");

      // Escribir inscripción
      const inscRef = doc(collection(db, "inscripciones_checkpoint"));
      txn.set(inscRef, {
        checkpointId:     checkpointSel.id,
        checkpointNombre: checkpointSel.nombre,
        eventoId:         eventoActivo.id,
        eventoNombre:     eventoActivo.nombre,
        participanteId:   participanteSel.id,
        participanteCodigo: participanteSel.codigo || null,
        participanteNombre: participanteSel.nombreCompleto || participanteSel.nombre || null,
        registradoEn:     serverTimestamp(),
        registradoPor:    auth.currentUser?.uid || "desconocido",
      });

      // Decrementar cupo
      txn.update(cpRef, { cuposDisponibles: disponibles - 1 });
    });

    // Actualizar local para siguiente escaneo
    const cpLocal = checkpointsSesion.find(c => c.id === checkpointSel.id);
    if (cpLocal) cpLocal.cuposDisponibles = (cpLocal.cuposDisponibles ?? cpLocal.cupos) - 1;
    checkpointSel = { ...checkpointSel, cuposDisponibles: (checkpointSel.cuposDisponibles ?? checkpointSel.cupos) - 1 };

    // Actualizar el label del checkpoint seleccionado
    const label = `Checkpoint activo: ${checkpointSel.nombre} · ${checkpointSel.cuposDisponibles} cupos disponibles`;
    el("cp-seleccionado").textContent = label;
    renderCheckpoints();

    logSesion.unshift({
      nombre:     participanteSel.nombreCompleto || participanteSel.nombre,
      checkpoint: checkpointSel.nombre,
      hora:       new Date().toLocaleTimeString("es-PA"),
      tipo:       "taller",
    });
    renderLog();
    alerta("success", `📋 Inscrito en taller: ${participanteSel.nombreCompleto || participanteSel.nombre}`);
  } catch (e) {
    alerta("error", e.message || "Error al inscribir en taller.");
  }

  cerrarResultado();
}

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

async function cerrarResultado() {
  participanteSel = null;
  el("resultado-box").style.display = "none";
  el("res-cupos-wrap").style.display = "none";
  el("btn-confirmar-asistencia").disabled = false;
  el("btn-confirmar-asistencia").textContent = modoTaller ? "📋 Inscribir en taller" : "✅ Confirmar asistencia";
  if (scanner && escaneando) await scanner.resume();
}

// ─── Log ─────────────────────────────────────────────────────────────────────
function renderLog() {
  const tb = el("log-recientes");
  if (!logSesion.length) {
    tb.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--gris-medio)">Sin registros aún</td></tr>`;
    return;
  }
  tb.innerHTML = logSesion.slice(0, 20).map(entry => `
    <tr>
      <td>${entry.nombre}</td>
      <td>${entry.checkpoint}${entry.tipo === "taller" ? " 📋" : ""}</td>
      <td>${entry.hora}</td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarEventos();

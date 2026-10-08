import { app, db } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import { iconoImg } from "../core/iconos.js";
import { escaparAtributo, escaparHtml } from "../core/seguridad.js";
import { extraerCredencialQr } from "../core/credencial-qr.js";
import { esperarSesionLista, getUsuarioActual } from "../core/auth.js";
import {
  enPanama, estaOperativo, checkpointsParaEscanear, proximoCheckpointHoy,
} from "../core/permanencia.js";

// Lectura QR con la cámara del celular. Solo registra ENTRADAS: la "salida"
// de un checkpoint es la entrada al siguiente (ver js/core/permanencia.js).
// El lector físico EA530 y el RFID viven en POSPER (posper.js).

const el = id => document.getElementById(id);
const h = escaparHtml;
const ejecutarOperacionQr = httpsCallable(
  getFunctions(app, "us-central1"),
  "ejecutarOperacionQr",
);

let scanner          = null;
let escaneando       = false;
let procesandoQR     = false;
let inicioEscaneo    = 0;
let avisoBusquedaMostrado = false;
let eventoActivo     = null;
let checkpointsEvento = [];   // todos los del evento (colección 'checkpoints')
let checkpointsSesion = [];   // los que se pueden escanear ahora
let checkpointSel    = null;  // objeto completo del checkpoint seleccionado
let participanteSel  = null;
let modoTaller       = false; // true cuando el checkpoint es taller/gira con cupos
let logSesion        = [];
let secuenciaCargaEvento = 0;
let tokenProcesamiento = 0;
let guardandoRegistro = false;

const TIPO_CON_CUPOS = ["taller", "workshop", "gira"];
// Solo el CEO puede ver todos los checkpoints (para probar fuera de horario).
const esCeo = () => getUsuarioActual().rol === "ceo";

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
  // Cancelados y desactivados no se ofrecen.
  const eventos = snap.docs.filter(d => estaOperativo(d.data()));
  eventos.forEach(d => {
    const ev  = d.data();
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = ev.nombre;
    sel.appendChild(opt);
  });
  if (eventos.length === 1) {
    sel.value = eventos[0].id;
    sel.dispatchEvent(new Event("change"));
  }
}

el("sel-evento-qr").addEventListener("change", async () => {
  const secuencia = ++secuenciaCargaEvento;
  await limpiarSeleccionSesion();
  const id = el("sel-evento-qr").value;
  if (!id) {
    eventoActivo = null;
    checkpointsEvento = [];
    checkpointsSesion = [];
    el("cp-section").style.display = "none";
    return;
  }
  const snap = await getDoc(doc(db, "eventos", id));
  if (!snap.exists() || secuencia !== secuenciaCargaEvento) return;
  eventoActivo = { id, ...snap.data() };

  const cpSnap = await getDocs(query(collection(db, "checkpoints"), where("eventoId", "==", id)));
  if (secuencia !== secuenciaCargaEvento) return;
  checkpointsEvento = cpSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  renderCheckpoints();
  el("cp-section").style.display = "block";
});

async function limpiarSeleccionSesion() {
  tokenProcesamiento++;
  procesandoQR = false;
  if (escaneando || estadoInternoScanner() === 3) await detenerScanner();
  checkpointSel = null;
  participanteSel = null;
  modoTaller = false;
  el("resultado-box").style.display = "none";
  el("res-cupos-wrap").style.display = "none";
  el("cp-seleccionado").textContent = "";
}

// Solo los checkpoints de hoy y a esta hora (hora de Panamá). Se recalcula
// cada minuto: aparecen los que abren y se quitan los que terminan.
function calcularCheckpointsSesion() {
  const todos = esCeo() && el("chk-todos").checked;
  const ahora = enPanama();
  checkpointsSesion = (todos ? checkpointsEvento.filter(estaOperativo) : checkpointsParaEscanear(checkpointsEvento, ahora))
    .sort((a, b) => {
      if (a.dia !== b.dia) return (a.dia || "") < (b.dia || "") ? -1 : 1;
      return (a.horaInicio || "") < (b.horaInicio || "") ? -1 : 1;
    });
  return { todos, proximo: proximoCheckpointHoy(checkpointsEvento, ahora) };
}

function renderCheckpoints() {
  const { todos, proximo } = calcularCheckpointsSesion();
  const grid = el("cp-grid");
  if (!checkpointsEvento.length) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--gris-medio);grid-column:1/-1;line-height:1.5">Este evento todavía no tiene checkpoints operativos. Créalo en Gestión de Eventos; para la entrada general selecciona el tipo Congreso / control de acceso.</p>`;
    return;
  }
  if (!checkpointsSesion.length) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--gris-medio);grid-column:1/-1;line-height:1.5">${proximo
      ? `No hay checkpoints en curso. El próximo es <strong>${h(proximo.nombre || "Checkpoint")}</strong> a las ${h(proximo.horaInicio)}: aparecerá 30 minutos antes.`
      : "No hay checkpoints programados para este momento de hoy (hora de Panamá)."}</p>`;
  } else {
    grid.innerHTML = checkpointsSesion.map(cp => {
      const esTaller = TIPO_CON_CUPOS.includes(cp.tipo);
      const cuposTag = esTaller && cp.cupos != null
        ? `<span class="cp-cupos-tag">${iconoImg("ticket")} ${cp.cuposDisponibles ?? cp.cupos} / ${cp.cupos} cupos</span>`
        : "";
      const tipoTag  = cp.tipo
        ? `<span class="cp-tipo-tag">${h(cp.tipo.toUpperCase())}${cp.horaInicio && cp.horaFin ? ` · ${h(cp.horaInicio)}–${h(cp.horaFin)}` : ""}${todos && cp.dia ? ` · ${h(cp.dia)}` : ""}</span>`
        : "";
      const clsExtra = `${cp.tipo ? ` ${cp.tipo}` : ""}${checkpointSel?.id === cp.id ? " selected" : ""}`;
      return `<div class="cp-card${clsExtra}" data-id="${escaparAtributo(cp.id)}">
        ${h(cp.nombre || "Sin nombre")}${tipoTag}${cuposTag}
      </div>`;
    }).join("");
    grid.querySelectorAll(".cp-card").forEach(card => {
      card.addEventListener("click", () => void window.seleccionarCP(card));
    });
  }

  // El checkpoint en uso terminó: se cierra la sesión de cámara.
  if (checkpointSel && !checkpointsSesion.some(cp => cp.id === checkpointSel.id) && !guardandoRegistro && !participanteSel) {
    alerta("aviso", `"${checkpointSel.nombre || "El checkpoint"}" ya terminó. Elige otro.`);
    void limpiarSeleccionSesion();
  }
}

el("chk-todos").addEventListener("change", renderCheckpoints);
setInterval(() => { if (eventoActivo) renderCheckpoints(); }, 60000);

window.seleccionarCP = async function(card) {
  if (guardandoRegistro || card.classList.contains("ya-marcado")) return;
  tokenProcesamiento++;
  procesandoQR = false;
  if (escaneando || estadoInternoScanner() === 3) await detenerScanner();
  participanteSel = null;
  el("resultado-box").style.display = "none";
  document.querySelectorAll(".cp-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  checkpointSel = checkpointsSesion.find(cp => cp.id === card.dataset.id) || null;
  modoTaller    = checkpointSel ? TIPO_CON_CUPOS.includes(checkpointSel.tipo) && checkpointSel.cupos != null : false;

  const tipo = checkpointSel?.tipo === "congreso"
    ? "Control de acceso al congreso"
    : String(checkpointSel?.tipo || "conferencia").replace(/^./, c => c.toUpperCase());
  const horario = [checkpointSel?.dia, checkpointSel?.horaInicio].filter(Boolean).join(" · ");
  let label = `Checkpoint activo: ${checkpointSel?.nombre || ""} · ${tipo}`;
  if (horario) label += ` · ${horario}`;
  if (modoTaller) label += ` · ${checkpointSel.cuposDisponibles ?? checkpointSel.cupos} cupos disponibles`;
  el("cp-seleccionado").textContent = label;
};

// ─── Scanner ─────────────────────────────────────────────────────────────────
function estadoScanner(texto, tipo = "") {
  const estado = el("scanner-estado");
  estado.textContent = texto;
  estado.className = `scanner-estado${tipo ? ` ${tipo}` : ""}`;
}

function estadoInternoScanner() {
  try {
    return scanner?.getState?.() ?? 1;
  } catch (_) {
    return 1;
  }
}

function crearScanner() {
  if (typeof Html5Qrcode === "undefined") {
    throw new Error("La librería de lectura QR no cargó. Recarga la página.");
  }
  if (!scanner) {
    const config = typeof Html5QrcodeSupportedFormats !== "undefined"
      ? { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] }
      : undefined;
    scanner = new Html5Qrcode("reader", config);
  }
  return scanner;
}

async function elegirCamaraTrasera() {
  try {
    const camaras = await Html5Qrcode.getCameras();
    if (!camaras?.length) throw new Error("No se detectaron cámaras disponibles.");
    const trasera = camaras.find(c => /back|rear|environment|trasera/i.test(c.label));
    return (trasera || camaras[camaras.length - 1]).id;
  } catch (e) {
    if (/No se detectaron/.test(e.message)) throw e;
    return { facingMode: "environment" };
  }
}

async function iniciarScanner() {
  if (!eventoActivo)  { alerta("error", "Selecciona un evento."); return; }
  if (!checkpointSel) { alerta("error", "Selecciona un checkpoint."); return; }
  if (!navigator.mediaDevices?.getUserMedia) {
    el("camara-aviso").style.display = "block";
    estadoScanner("Este navegador no permite utilizar la cámara.", "error");
    return;
  }

  const btn = el("btn-iniciar");
  btn.disabled = true;
  btn.textContent = "Abriendo...";
  estadoScanner("Solicitando acceso a la cámara...", "activo");

  try {
    const lector = crearScanner();
    const camara = await elegirCamaraTrasera();
    escaneando = true;
    inicioEscaneo = Date.now();
    avisoBusquedaMostrado = false;

    await lector.start(
      camara,
      {
        fps: 12,
        qrbox: (ancho, alto) => {
          const ladoMenor = Math.min(ancho, alto);
          const disponible = Math.max(80, ladoMenor - 24);
          const lado = Math.min(280, Math.max(120, Math.floor(ladoMenor * 0.72)), disponible);
          return { width: lado, height: lado };
        },
        aspectRatio: 4 / 3,
        disableFlip: false,
      },
      rawQR => void procesarQrDetectado(rawQR),
      onScanFallo,
    );

    btn.style.display = "none";
    btn.textContent = "Abrir cámara";
    btn.disabled = false;
    el("btn-detener").style.display = "inline-flex";
    el("reader").closest(".scanner-overlay").classList.add("activo");
    el("camara-aviso").style.display = "none";
    estadoScanner("Buscando un código QR...", "activo");
  } catch (e) {
    escaneando = false;
    btn.disabled = false;
    btn.textContent = "Abrir cámara";
    el("camara-aviso").style.display = "block";
    estadoScanner("No se pudo iniciar la cámara.", "error");
    alerta("error", "No se pudo acceder a la cámara: " + (e.message || e));
  }
}

function onScanFallo() {
  if (!escaneando || avisoBusquedaMostrado || Date.now() - inicioEscaneo < 6000) return;
  avisoBusquedaMostrado = true;
  estadoScanner("Aún buscando: centra el QR, evita reflejos y aléjalo un poco.", "activo");
}

async function detenerScanner() {
  const estado = estadoInternoScanner();
  if (scanner && (estado === 2 || estado === 3)) {
    try {
      await scanner.stop();
    } catch (e) {
      console.warn("No se pudo detener el scanner:", e);
    }
  }
  escaneando = false;
  procesandoQR = false;
  el("btn-iniciar").style.display = "inline-flex";
  el("btn-iniciar").disabled = false;
  el("btn-iniciar").textContent = "Abrir cámara";
  el("btn-detener").style.display = "none";
  el("reader").closest(".scanner-overlay").classList.remove("activo");
  estadoScanner("Cámara detenida");
}

function pausarScanner() {
  if (scanner && estadoInternoScanner() === 2) scanner.pause(true);
}

function reanudarScanner(actualizarEstado = true) {
  if (scanner && estadoInternoScanner() === 3) {
    scanner.resume();
    if (actualizarEstado) estadoScanner("Buscando un código QR...", "activo");
  }
}

async function buscarParticipanteQr(credencial) {
  if (credencial.tipo === "participante") {
    const snap = await getDocs(query(
      collection(db, "participantes"),
      where("codigo", "==", credencial.codigo),
    ));
    if (snap.empty) throw new Error(`QR no reconocido: no hay participante con el código ${credencial.codigo}.`);
    const d = snap.docs[0];
    const participante = { id: d.id, ...d.data() };
    // El token es hexadecimal (functions/registro.js): mayúsculas y minúsculas
    // son el mismo valor, así que se compara sin distinguirlas.
    if (String(participante.token || "").toLowerCase() !== credencial.token.toLowerCase()) {
      throw new Error("QR inválido: el token no coincide.");
    }
    return { participante, esNuevoFormato: true };
  }

  const snap = await getDoc(doc(db, "inscripciones", credencial.id));
  if (!snap.exists()) throw new Error("QR no reconocido. Participante no encontrado.");
  const participante = { id: credencial.id, ...snap.data() };
  if (participante.eventoId !== eventoActivo.id) {
    throw new Error("Este QR pertenece a otro evento.");
  }
  return { participante, esNuevoFormato: false };
}

async function procesarQrDetectado(rawQR) {
  if (procesandoQR || participanteSel || !escaneando) return;
  const tokenActual = ++tokenProcesamiento;
  const eventoIdActual = eventoActivo?.id;
  const checkpointIdActual = checkpointSel?.id;
  procesandoQR = true;
  pausarScanner();
  estadoScanner("QR detectado. Validando credencial...", "activo");

  try {
    const credencial = extraerCredencialQr(rawQR);
    const { participante, esNuevoFormato } = await buscarParticipanteQr(credencial);
    if (tokenActual !== tokenProcesamiento || eventoActivo?.id !== eventoIdActual ||
        checkpointSel?.id !== checkpointIdActual) return;
    if (esNuevoFormato && participante.pago?.estado !== "aprobado") {
      throw new Error("El participante todavía no tiene el pago aprobado.");
    }
    participanteSel = { ...participante, esNuevoFormato };

    if (modoTaller) await mostrarInfoTaller(participante, tokenActual);
    else mostrarInfoAsistencia(participante);

    if (tokenActual !== tokenProcesamiento) return;
    estadoScanner("Credencial reconocida. Confirma la entrada.", "activo");
  } catch (e) {
    if (tokenActual !== tokenProcesamiento) return;
    console.error("Error procesando QR:", e);
    alerta("error", e.message || "No se pudo procesar el código QR.");
    estadoScanner(e.message || "No se pudo procesar el código QR.", "error");
    reanudarScanner(false);
    setTimeout(() => {
      if (procesandoQR || participanteSel) return;
      if (escaneando && estadoInternoScanner() === 2) {
        estadoScanner("Buscando un código QR...", "activo");
      }
    }, 5000);
  } finally {
    if (tokenActual === tokenProcesamiento) procesandoQR = false;
  }
}

el("btn-iniciar").addEventListener("click", iniciarScanner);
el("btn-detener").addEventListener("click", detenerScanner);

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

  // Si el QR se lee dos veces, vale la primera entrada: no se marca otra.
  if (yaMarcado) {
    badge.className   = "estado-badge estado-err";
    badge.textContent = `Ya tiene entrada en "${checkpointSel.nombre}" (se conserva la primera)`;
    el("btn-confirmar-asistencia").disabled = true;
  } else {
    badge.className   = "estado-badge estado-ok";
    badge.textContent = `Listo para marcar la entrada: ${checkpointSel.nombre}`;
    el("btn-confirmar-asistencia").disabled = false;
  }

  el("btn-confirmar-asistencia").textContent = "Confirmar entrada";

  const cps = checkpointsEvento;
  const marcados = Object.keys(asis).map(k => {
    const cp = cps.find(c => c.id === k);
    return cp ? cp.nombre : k;
  });
  el("res-asistencias-actuales").textContent = marcados.length
    ? `Entradas previas (${marcados.length}/${cps.length}): ${marcados.join(", ")}`
    : "Sin entradas registradas aún.";

  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Modo Taller (inscripción in-situ con cupos) ──────────────────────────────
async function mostrarInfoTaller(p, tokenActual) {
  const checkpoint = checkpointSel;
  if (!checkpoint) return;
  el("res-nombre").textContent      = p.nombreCompleto || p.nombre || "—";
  el("res-correo").textContent      = p.correo   || "—";
  el("res-cedula").textContent      = p.cedula   || "—";
  el("res-universidad").textContent = p.universidad || p.institucion || "—";
  el("res-carrera").textContent     = p.camposExtra?.carrera || p.carrera || "—";

  // Recargar cupos actuales del checkpoint
  const cpSnap = await getDoc(doc(db, "checkpoints", checkpoint.id));
  if (tokenActual !== tokenProcesamiento) return;
  const cpData  = cpSnap.exists() ? cpSnap.data() : checkpoint;
  const disponibles = cpData.cuposDisponibles ?? cpData.cupos ?? 0;

  el("res-cupos-wrap").style.display = "block";
  el("res-cupos-display").innerHTML  = disponibles > 0
    ? `<span style="color:var(--verde-oscuro)">${disponibles} de ${cpData.cupos} disponibles</span>`
    : `<span style="color:var(--rojo)">Sin cupos disponibles</span>`;

  const badge = el("res-estado-badge");

  // Compatibilidad con el ID actual y el formato histórico de inscripciones.
  const coleccionParticipante = participanteSel?.esNuevoFormato ? "participantes" : "inscripciones";
  const [yaSnap, yaLegacySnap, previasSnap] = await Promise.all([
    getDoc(doc(db, "inscripciones_checkpoint", `${checkpoint.id}_${coleccionParticipante}_${p.id}`)),
    getDoc(doc(db, "inscripciones_checkpoint", `${checkpoint.id}_${p.id}`)),
    getDocs(query(
      collection(db, "inscripciones_checkpoint"),
      where("checkpointId", "==", checkpoint.id),
    )),
  ]);
  if (tokenActual !== tokenProcesamiento) return;
  const yaMarcado = Boolean(p.asistencias?.[checkpoint.id]);
  const yaHistorico = previasSnap.docs.some(d => d.data().participanteId === p.id);

  if (yaSnap.exists() || yaLegacySnap.exists() || yaMarcado || yaHistorico) {
    badge.className   = "estado-badge estado-err";
    badge.textContent = `Ya inscrito en "${checkpoint.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else if (disponibles <= 0) {
    badge.className   = "estado-badge estado-err";
    badge.textContent = `Sin cupos disponibles para "${checkpoint.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else {
    badge.className   = "estado-badge estado-ok";
    badge.textContent = `Listo para registrar: ${checkpoint.nombre}`;
    el("btn-confirmar-asistencia").disabled = false;
  }

  el("btn-confirmar-asistencia").textContent = "Confirmar entrada y cupo";
  el("res-asistencias-actuales").textContent = "";
  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Confirmar (entrada o inscripción taller) ─────────────────────────────────
el("btn-confirmar-asistencia").addEventListener("click", async () => {
  if (!participanteSel || !checkpointSel || guardandoRegistro) return;
  const contexto = {
    participante: participanteSel,
    checkpoint: checkpointSel,
    eventoId: eventoActivo?.id,
    modoTaller,
  };
  if (!contexto.eventoId) return;
  bloquearSesion(true);
  el("btn-confirmar-asistencia").disabled = true;
  el("btn-confirmar-asistencia").textContent = "Guardando...";

  try {
    await guardarAsistencia(contexto);
    const nombre = contexto.participante.nombreCompleto || contexto.participante.nombre;
    alerta("success", contexto.modoTaller
      ? `Entrada y cupo confirmados: ${nombre}`
      : `Entrada confirmada: ${nombre}`);
  } catch (e) {
    alerta("error", e.code === "functions/already-exists"
      ? `${e.message} Se conserva la primera entrada.`
      : contexto.modoTaller
        ? e.message || "Error al inscribir en taller."
        : "Error al guardar la entrada: " + e.message);
  } finally {
    bloquearSesion(false);
  }
  cerrarResultado();
});

function bloquearSesion(bloquear) {
  guardandoRegistro = bloquear;
  el("sel-evento-qr").disabled = bloquear;
  el("cp-grid").style.pointerEvents = bloquear ? "none" : "";
}

// Marca la entrada (o entrada + cupo en talleres) y la anota en el log.
// Lanza el error del servidor: quien llama decide cómo mostrarlo.
async function guardarAsistencia({ participante, checkpoint, eventoId, modoTaller: conCupos }) {
  const coleccion = participante.esNuevoFormato ? "participantes" : "inscripciones";
  const respuesta = await ejecutarOperacionQr({
    tipo: conCupos ? "inscripcion_taller" : "asistencia_participante",
    participanteId: participante.id,
    checkpointId: checkpoint.id,
    coleccion,
    eventoId,
  });

  if (conCupos) {
    const disponibles = respuesta.data.cuposDisponibles;
    // Actualizar local para siguiente escaneo
    const cpLocal = checkpointsEvento.find(c => c.id === checkpoint.id);
    if (cpLocal) cpLocal.cuposDisponibles = disponibles;
    if (checkpointSel?.id === checkpoint.id) {
      checkpointSel = { ...checkpointSel, cuposDisponibles: disponibles };
      el("cp-seleccionado").textContent = `Checkpoint activo: ${checkpoint.nombre} · ${disponibles} cupos disponibles`;
    }
    renderCheckpoints();
  }

  logSesion.unshift({
    nombre:     participante.nombreCompleto || participante.nombre,
    checkpoint: checkpoint.nombre,
    hora:       new Date().toLocaleTimeString("es-PA", { timeZone: "America/Panama" }),
    tipo:       conCupos ? "taller" : "asistencia",
  });
  renderLog();
}

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

function cerrarResultado() {
  participanteSel = null;
  el("resultado-box").style.display = "none";
  el("res-cupos-wrap").style.display = "none";
  el("btn-confirmar-asistencia").disabled = false;
  el("btn-confirmar-asistencia").textContent = modoTaller ? "Confirmar entrada y cupo" : "Confirmar entrada";
  if (escaneando) reanudarScanner();
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
      <td>${h(entry.nombre)}</td>
      <td>${h(entry.checkpoint)}${entry.tipo === "taller" ? " (taller)" : ""}</td>
      <td>${h(entry.hora)}</td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarEventos().catch(e => {
  console.error("Error cargando eventos para lectura QR:", e);
  alerta("error", "No se pudieron cargar los eventos: " + (e.message || e));
});
esperarSesionLista().then(() => {
  if (esCeo()) el("ceo-todos").style.display = "flex";
});

// Liberar la cámara si el panel se cierra o el navegador descarta la página.
window.addEventListener("pagehide", () => {
  const estado = estadoInternoScanner();
  if (scanner && (estado === 2 || estado === 3)) {
    scanner.stop().catch(e => console.warn("No se pudo liberar la cámara:", e));
  }
  escaneando = false;
});

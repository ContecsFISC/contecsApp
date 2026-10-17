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
  estaOperativo, checkpointsParaEscanear, proximoCheckpointHoy,
  efectoDeEntrada, PERMANENCIA_MINIMA_DEFECTO,
} from "../core/permanencia.js";
import { sincronizarReloj, ahoraMs, ahoraPanama } from "../core/reloj-servidor.js";
import { crearLectorFisico } from "../core/lector-fisico.js?v=20261016.1";
import { conReintento, conTiempo, esErrorDeRed, mensajeDeError, TIEMPO_MAXIMO_ESCANEO_MS } from "../core/red.js?v=20261017.1";

// Lectura QR con el lector del equipo (botón lateral: cada lectura marca la
// entrada sola, js/core/lector-fisico.js) o con la cámara del celular (con
// "Confirmar entrada"). Solo registra ENTRADAS: la "salida" de un checkpoint
// es la entrada al siguiente (ver js/core/permanencia.js). Aquí no hay RFID:
// eso es solo de POSPER (posper.js).

const el = id => document.getElementById(id);
const h = escaparHtml;
const operacionQr = httpsCallable(
  getFunctions(app, "us-central1"),
  "ejecutarOperacionQr",
  { timeout: TIEMPO_MAXIMO_ESCANEO_MS },
);
const ejecutarOperacionQr = datos => conReintento(() => operacionQr(datos));

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
// El servidor también lo revisa (ROLES_PRUEBA_HORARIO en operaciones-qr.js).
const esCeo = () => getUsuarioActual().rol === "ceo";
const modoPrueba = () => esCeo() && el("chk-todos").checked;
// Por equipo: cómo se escanea ("lector" | "camara") y dónde (evento y checkpoint).
const CLAVE_MODO = "lecturaQR.modo";
const CLAVE_CONFIG = "lecturaQR.config";
const leerLocal = (clave, defecto) => { try { return localStorage.getItem(clave) ?? defecto; } catch (_) { return defecto; } };
const guardarLocal = (clave, valor) => { try { localStorage.setItem(clave, valor); } catch (_) { /* solo esta visita */ } };
let modo = leerLocal(CLAVE_MODO, "lector") === "camara" ? "camara" : "lector";

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
  const guardado = configGuardada().eventoId;
  if (guardado && eventos.some(d => d.id === guardado)) {
    sel.value = guardado;
    sel.dispatchEvent(new Event("change"));
  } else if (eventos.length === 1) {
    sel.value = eventos[0].id;
    sel.dispatchEvent(new Event("change"));
  }
}

function configGuardada() {
  try { return JSON.parse(leerLocal(CLAVE_CONFIG, "{}")) || {}; } catch (_) { return {}; }
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
  // El checkpoint de la última vez en este equipo, o el único en curso.
  const guardado = configGuardada();
  const preferido = (guardado.eventoId === id && checkpointsSesion.find(cp => cp.id === guardado.checkpointId))
    || (checkpointsSesion.length === 1 ? checkpointsSesion[0] : null);
  const tarjeta = preferido && [...el("cp-grid").querySelectorAll(".cp-card")].find(c => c.dataset.id === preferido.id);
  if (tarjeta) await window.seleccionarCP(tarjeta);
  else pantallaLector();
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
  pantallaLector();
}

// Solo los checkpoints de hoy y a esta hora (hora de Panamá, con el reloj del
// servidor). Se recalcula cada minuto: aparecen los que abren y se quitan los
// que terminan.
function calcularCheckpointsSesion() {
  const todos = modoPrueba();
  const ahora = ahoraPanama();
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
        ? `<span class="cp-cupos-tag">${iconoImg("ticket")} ${h(cp.cuposDisponibles ?? cp.cupos)} / ${h(cp.cupos)} cupos</span>`
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

// El equipo puede pasar el día entero abierto: cada 3 min se releen los
// checkpoints del evento (los que se agregan o cambian de hora en Gestión de
// Evento aparecen sin recargar la página).
setInterval(async () => {
  if (!eventoActivo || guardandoRegistro || procesandoLector) return;
  const id = eventoActivo.id;
  try {
    const snap = await getDocs(query(collection(db, "checkpoints"), where("eventoId", "==", id)));
    if (eventoActivo?.id !== id) return;
    checkpointsEvento = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (checkpointSel) checkpointSel = checkpointsEvento.find(cp => cp.id === checkpointSel.id) || checkpointSel;
    renderCheckpoints();
  } catch (e) {
    console.warn("Lectura QR: no se pudieron releer los checkpoints:", e);
  }
}, 3 * 60 * 1000);

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
  if (checkpointSel) guardarLocal(CLAVE_CONFIG, JSON.stringify({ eventoId: eventoActivo?.id, checkpointId: checkpointSel.id }));
  pantallaLector();
  // En los equipos de pantalla chica el recuadro queda bajo la configuración.
  if (checkpointSel && modo === "lector") el("panel-lector").scrollIntoView({ block: "start" });
};

// ─── Lector del equipo ───────────────────────────────────────────────────────
// Cada lectura se registra sola (sin "Confirmar"): el voluntario solo dispara.
// Si llegan dos seguidas, se procesan en orden.
const lector = crearLectorFisico({
  campo: el("captura"),
  alLeer: texto => {
    colaLector.push(texto);
    if (!procesandoLector) void vaciarColaLector();
  },
  aceptaTeclasSueltas: () => modo === "lector" && !!checkpointSel,
  alEmpezar: () => { if (!procesandoLector && checkpointSel) el("lector-sub").textContent = "Leyendo…"; },
  alFoco: conFoco => el("captura-wrap").classList.toggle("sin-foco", !conFoco),
});
const colaLector = [];
let procesandoLector = false;
let timerLector = null;

el("chk-teclado").checked = lector.tecladoVisible;
el("chk-teclado").addEventListener("change", e => lector.mostrarTeclado(e.target.checked));

function lectorPantalla(clase, titulo, sub = "") {
  el("lector-escenario").className = `lector-escenario ${clase}`;
  el("lector-titulo").textContent = titulo;
  el("lector-sub").textContent = sub;
}

// Pantalla de espera según lo elegido arriba.
function pantallaLector() {
  clearTimeout(timerLector);
  if (!eventoActivo) lectorPantalla("inactivo", "Elige el evento", "Arriba, el evento donde estás escaneando.");
  else if (!checkpointSel) lectorPantalla("inactivo", "Elige el checkpoint", "Arriba, el checkpoint donde se marca la entrada.");
  else lectorPantalla("listo", "ESCANEA EL QR", `${checkpointSel.nombre || "Checkpoint"} · presiona el botón lateral apuntando a la credencial.`);
}

// El resultado se ve un momento; la siguiente lectura no espera a que se quite.
function resultadoLector(clase, titulo, sub) {
  lectorPantalla(clase, titulo, sub);
  clearTimeout(timerLector);
  timerLector = setTimeout(pantallaLector, clase === "ok" ? 1800 : 3000);
}

async function vaciarColaLector() {
  procesandoLector = true;
  try {
    while (colaLector.length) await registrarLectura(colaLector.shift());
  } finally {
    procesandoLector = false;
  }
}

async function registrarLectura(texto) {
  const checkpoint = checkpointSel;
  const eventoId = eventoActivo?.id;
  if (!checkpoint || !eventoId) {
    resultadoLector("error", "ELIGE EL CHECKPOINT", "Antes de escanear, elige arriba el evento y el checkpoint.");
    return;
  }
  const conCupos = TIPO_CON_CUPOS.includes(checkpoint.tipo) && checkpoint.cupos != null;
  // Hora del escaneo (reloj del servidor): si no hay internet se guarda con ella.
  const capturadoEn = ahoraMs();
  lectorPantalla("procesando", "Validando…", "Revisando la credencial.");
  let credencial;
  try {
    credencial = extraerCredencialQr(texto);
  } catch (e) {
    resultadoLector("error", "QR NO VÁLIDO", e.message || "Ese código no es una credencial de CONTECS.");
    return;
  }
  // Recién se cayó la red: se guarda directo, sin esperar a que falle otra vez.
  if (!navigator.onLine || sinRed) {
    guardarSinConexion({ texto, checkpoint, eventoId, conCupos, capturadoEn });
    return;
  }
  try {
    const { participante, esNuevoFormato } = await buscarParticipanteQr(credencial);
    const nombre = participante.nombreCompleto || participante.nombre || "Participante";
    if (esNuevoFormato && participante.pago?.estado !== "aprobado") {
      throw new Error(`${nombre} todavía no tiene el pago aprobado.`);
    }
    // Si el QR se lee dos veces, vale la primera entrada.
    if (participante.asistencias?.[checkpoint.id]) {
      resultadoLector("aviso", "YA REGISTRADO", `${nombre} ya tenía entrada en ${checkpoint.nombre || "este checkpoint"}.`);
      return;
    }
    try {
      await guardarAsistencia({ participante: { ...participante, esNuevoFormato }, checkpoint, eventoId, modoTaller: conCupos });
    } catch (e) {
      if (e.code !== "functions/already-exists") throw e;
      resultadoLector("aviso", "YA REGISTRADO", `${nombre}: ${e.message}`);
      return;
    }
    resultadoLector("ok", "ENTRADA MARCADA", `${nombre} · ${checkpoint.nombre || "Checkpoint"}`);
  } catch (e) {
    console.error("Lectura QR (lector):", e);
    // Sin internet: la lectura queda en el equipo y se manda sola al volver.
    // La persona puede pasar; no hay que escanearla de nuevo.
    if (esErrorDeRed(e) || !navigator.onLine) {
      sinRed = true;
      guardarSinConexion({ texto, checkpoint, eventoId, conCupos, capturadoEn });
      return;
    }
    resultadoLector("error", "NO SE REGISTRÓ", mensajeDeError(e, "No se pudo procesar el código QR."));
  }
}

function guardarSinConexion({ texto, checkpoint, eventoId, conCupos, capturadoEn }) {
  pendientes.push({ texto, checkpointId: checkpoint.id, checkpointNombre: checkpoint.nombre || "Checkpoint", eventoId, conCupos, capturadoEn });
  guardarPendientes();
  resultadoLector("aviso", "GUARDADA SIN CONEXIÓN", "Puede pasar: la entrada se envía sola cuando vuelva el internet.");
}

// ─── Lecturas guardadas sin conexión ────────────────────────────────────────
// Quedan en este equipo (localStorage) hasta que el servidor las recibe. Se
// mandan cada 15 s y al volver la red, con la hora real del escaneo (el
// servidor las acepta hasta 2 h después, operaciones-qr.js).
const CLAVE_PENDIENTES = "lecturaQR.pendientes";
let pendientes = (() => {
  try { return JSON.parse(leerLocal(CLAVE_PENDIENTES, "[]")) || []; } catch (_) { return []; }
})();
let enviandoPendientes = false;
// Tras un fallo de red, todo se guarda al instante sin intentar (el lector no
// espera segundos por credencial) hasta que un envío en segundo plano funcione.
let sinRed = false;

function guardarPendientes() {
  guardarLocal(CLAVE_PENDIENTES, JSON.stringify(pendientes));
  const n = pendientes.length;
  el("pendientes").hidden = !n;
  el("pendientes").textContent = n
    ? `${n} ${n === 1 ? "entrada guardada" : "entradas guardadas"} sin conexión: se envían solas cuando vuelva el internet. No cierres esta página.`
    : "";
}

async function enviarPendiente(item) {
  const credencial = extraerCredencialQr(item.texto);
  const { participante, esNuevoFormato } = await buscarParticipanteQr(credencial, item.eventoId);
  const nombre = participante.nombreCompleto || participante.nombre || "Participante";
  try {
    await ejecutarOperacionQr({
      tipo: item.conCupos ? "inscripcion_taller" : "asistencia_participante",
      participanteId: participante.id,
      checkpointId: item.checkpointId,
      coleccion: esNuevoFormato ? "participantes" : "inscripciones",
      eventoId: item.eventoId,
      capturadoEn: item.capturadoEn,
    });
    return { nombre, detalle: `${item.checkpointNombre} (enviada al volver la red)` };
  } catch (e) {
    if (e.code === "functions/already-exists") return { nombre, detalle: `${item.checkpointNombre} (ya estaba)` };
    throw Object.assign(e, { nombre });
  }
}

async function enviarPendientes() {
  if (enviandoPendientes || !pendientes.length || procesandoLector || !navigator.onLine) return;
  enviandoPendientes = true;
  try {
    while (pendientes.length) {
      const item = pendientes[0];
      let fila;
      try {
        const r = await enviarPendiente(item);
        fila = { nombre: r.nombre, checkpoint: r.detalle };
        sinRed = false; // volvió la red
      } catch (e) {
        if (esErrorDeRed(e)) break; // sigue sin red: se reintenta luego
        fila = { nombre: e.nombre || "Lectura sin conexión", checkpoint: `NO SE REGISTRÓ: ${e.message || "error"}` };
      }
      pendientes.shift();
      guardarPendientes();
      logSesion.unshift({ ...fila, hora: new Date(item.capturadoEn).toLocaleTimeString("es-PA", { timeZone: "America/Panama" }), tipo: "asistencia" });
      logSesion = logSesion.slice(0, 20);
      renderLog();
    }
  } finally {
    enviandoPendientes = false;
  }
}
setInterval(() => void enviarPendientes(), 15000);
window.addEventListener("online", () => setTimeout(() => void enviarPendientes(), 1500));

// ─── Lector del equipo o cámara ──────────────────────────────────────────────
async function aplicarModo(nuevo) {
  modo = nuevo;
  guardarLocal(CLAVE_MODO, modo);
  el("modo-lector").setAttribute("aria-pressed", String(modo === "lector"));
  el("modo-camara").setAttribute("aria-pressed", String(modo === "camara"));
  el("panel-lector").hidden = modo !== "lector";
  el("panel-camara").hidden = modo !== "camara";
  if (modo === "lector") {
    if (escaneando || estadoInternoScanner() === 3) await detenerScanner();
    cerrarResultado();
    lector.activar(true);
  } else {
    lector.activar(false);
  }
}
el("modo-lector").addEventListener("click", () => void aplicarModo("lector"));
el("modo-camara").addEventListener("click", () => void aplicarModo("camara"));

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
    // Solo QR, y con el lector nativo del navegador (BarcodeDetector) donde
    // exista: en Android/Chrome decodifica mucho más rápido que el de JS.
    const config = { experimentalFeatures: { useBarCodeDetectorIfSupported: true } };
    if (typeof Html5QrcodeSupportedFormats !== "undefined") {
      config.formatsToSupport = [Html5QrcodeSupportedFormats.QR_CODE];
    }
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

async function buscarParticipanteQr(credencial, eventoId = eventoActivo?.id) {
  if (credencial.tipo === "participante") {
    const snap = await conReintento(() => conTiempo(getDocs(query(
      collection(db, "participantes"),
      where("codigo", "==", credencial.codigo),
    ))));
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
  if (participante.eventoId !== eventoId) {
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
    alerta("error", mensajeDeError(e, "No se pudo procesar el código QR."));
    estadoScanner(mensajeDeError(e, "No se pudo procesar el código QR."), "error");
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

  // Las entradas no se borran: si con esta se va de otra actividad antes de
  // cumplir la permanencia, esa deja de contar (js/core/permanencia.js).
  const cps = checkpointsEvento;
  const nombreCp = id => cps.find(c => c.id === id)?.nombre || id;
  const { evaluacion, anuladas } = yaMarcado
    ? { evaluacion: {}, anuladas: [] }
    : efectoDeEntrada(asis, checkpointSel.id, cps, ahoraMs(), {
      porcentajeMinimo: eventoActivo?.permanenciaMinima || PERMANENCIA_MINIMA_DEFECTO,
    });
  const marcados = Object.keys(asis).map(k =>
    evaluacion[k]?.valida === false ? `${nombreCp(k)} (no cuenta)` : nombreCp(k));
  const aviso = anuladas.map(id => {
    const r = evaluacion[id];
    return `Esta entrada deja sin validez "${nombreCp(id)}" (estuvo ${r.minutos} de ${r.duracion} min).`;
  }).join(" ");
  el("res-asistencias-actuales").textContent = [
    aviso,
    marcados.length ? `Entradas previas (${marcados.length}/${cps.length}): ${marcados.join(", ")}` : "Sin entradas registradas aún.",
  ].filter(Boolean).join(" ");

  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ block: "nearest" });
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
    ? `<span style="color:var(--verde-oscuro)">${h(disponibles)} de ${h(cpData.cupos)} disponibles</span>`
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
  el("resultado-box").scrollIntoView({ block: "nearest" });
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
        ? mensajeDeError(e, "Error al inscribir en taller.")
        : "Error al guardar la entrada: " + mensajeDeError(e, "intenta de nuevo."));
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
    modoPrueba: modoPrueba(),
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
  logSesion = logSesion.slice(0, 20);
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
  tb.innerHTML = logSesion.map(entry => `
    <tr>
      <td>${h(entry.nombre)}</td>
      <td>${h(entry.checkpoint)}${entry.tipo === "taller" ? " (taller)" : ""}</td>
      <td>${h(entry.hora)}</td>
    </tr>`).join("");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
void aplicarModo(modo);
pantallaLector();
guardarPendientes();
setTimeout(() => void enviarPendientes(), 4000);
// Primero la hora del servidor: con ella se decide qué checkpoints se ofrecen.
sincronizarReloj().then(cargarEventos).catch(e => {
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

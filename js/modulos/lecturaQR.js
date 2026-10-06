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
let checkpointsSesion = [];   // cargados desde colección 'checkpoints'
let checkpointSel    = null;  // objeto completo del checkpoint seleccionado
let participanteSel  = null;
let modoTaller       = false; // true cuando el checkpoint es taller/gira con cupos
let logSesion        = [];
let secuenciaCargaEvento = 0;
let tokenProcesamiento = 0;
let guardandoRegistro = false;
let lectorActivo     = false; // lector del dispositivo (EA530) escuchando
let temporizadorLector = null;
let vigilanteLector  = null;  // revisa el campo por si el texto llega sin eventos
let ultimoValorLector = "";
let componiendoLector = false; // el teclado del equipo aún está escribiendo
let rfidPendiente    = null;  // participante reconocido que espera su RFID
let capturandoRfid   = false;

const TIPO_CON_CUPOS = ["taller", "workshop", "gira"];
// Si el lector no envía Enter al final, la lectura se procesa tras esta pausa.
const LECTOR_PAUSA_MS = 600;
const MSG_LECTOR_LISTO = "Lector listo: toca el campo del lector y presiona el gatillo.";
// Con ?diag=1 en la URL se muestra lo que la página recibe del lector.
const DIAGNOSTICO_LECTOR = new URLSearchParams(location.search).has("diag");
const VERSION_LECTOR = "2026-10-06.5";
const AYUDA_CAMARA = "Apunta la cámara trasera al QR del participante";
const AYUDA_LECTOR = "Toca el campo del lector (se abre el teclado), apunta al QR y presiona el gatillo; luego confirma la asistencia.";

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
  const secuencia = ++secuenciaCargaEvento;
  await limpiarSeleccionSesion();
  const id = el("sel-evento-qr").value;
  if (!id) {
    eventoActivo = null;
    checkpointsSesion = [];
    el("cp-section").style.display = "none";
    return;
  }
  const snap = await getDoc(doc(db, "eventos", id));
  if (!snap.exists() || secuencia !== secuenciaCargaEvento) return;
  eventoActivo = { id, ...snap.data() };

  // Cargar checkpoints desde la colección (nuevo sistema)
  const cpSnap = await getDocs(query(collection(db, "checkpoints"), where("eventoId", "==", id)));
  if (secuencia !== secuenciaCargaEvento) return;
  checkpointsSesion = cpSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      if (a.dia !== b.dia) return (a.dia || "") < (b.dia || "") ? -1 : 1;
      return (a.horaInicio || "") < (b.horaInicio || "") ? -1 : 1;
    });

  renderCheckpoints();
  el("cp-section").style.display = "block";
});

async function limpiarSeleccionSesion() {
  tokenProcesamiento++;
  procesandoQR = false;
  if (escaneando || estadoInternoScanner() === 3) await detenerScanner();
  if (lectorActivo) desactivarLector();
  checkpointSel = null;
  participanteSel = null;
  cancelarEsperaRfid();
  modoTaller = false;
  el("resultado-box").style.display = "none";
  el("res-cupos-wrap").style.display = "none";
  el("cp-seleccionado").textContent = "";
}

function renderCheckpoints() {
  const grid = el("cp-grid");
  if (!checkpointsSesion.length) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--gris-medio);grid-column:1/-1;line-height:1.5">Este evento todavía no tiene checkpoints operativos. Créalo en Gestión de Eventos; para la entrada general selecciona el tipo Congreso / control de acceso.</p>`;
    return;
  }
  grid.innerHTML = checkpointsSesion.map(cp => {
    const esTaller = TIPO_CON_CUPOS.includes(cp.tipo);
    const cuposTag = esTaller && cp.cupos != null
      ? `<span class="cp-cupos-tag">${iconoImg("ticket")} ${cp.cuposDisponibles ?? cp.cupos} / ${cp.cupos} cupos</span>`
      : "";
    const tipoTag  = cp.tipo
      ? `<span class="cp-tipo-tag">${h(cp.tipo.toUpperCase())}</span>`
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

window.seleccionarCP = async function(card) {
  if (guardandoRegistro || card.classList.contains("ya-marcado")) return;
  tokenProcesamiento++;
  procesandoQR = false;
  if (escaneando || estadoInternoScanner() === 3) await detenerScanner();
  participanteSel = null;
  cancelarEsperaRfid();
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

  // Al elegir checkpoint el lector queda listo y con el foco en su campo, para
  // que el gatillo del EA530 funcione sin más pasos; "Abrir cámara" cambia de modo.
  if (lectorActivo) {
    estadoScanner(MSG_LECTOR_LISTO, "activo");
    enfocarLector();
  } else {
    void activarLector();
  }
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
  if (lectorActivo) desactivarLector();

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

// origen: "camara" (html5-qrcode) o "lector" (lector del dispositivo en modo teclado).
async function procesarQrDetectado(rawQR, origen = "camara") {
  // Con un participante esperando su RFID, lo siguiente que lea la cámara es el RFID.
  if (rfidPendiente && origen === "camara") {
    void recibirRfid(rawQR, origen);
    return;
  }
  const desdeLector = origen === "lector";
  if (procesandoQR || participanteSel || !(desdeLector ? lectorActivo : escaneando)) return;
  const tokenActual = ++tokenProcesamiento;
  const eventoIdActual = eventoActivo?.id;
  const checkpointIdActual = checkpointSel?.id;
  procesandoQR = true;
  pausarScanner();
  estadoScanner(desdeLector ? "Código leído. Validando credencial..." : "QR detectado. Validando credencial...", "activo");

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

    estadoScanner("Credencial reconocida.", "activo");
    iniciarEsperaRfid(rawQR);
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
      } else if (lectorActivo) {
        estadoScanner(MSG_LECTOR_LISTO, "activo");
      }
    }, 5000);
  } finally {
    if (tokenActual === tokenProcesamiento) procesandoQR = false;
  }
}

el("btn-iniciar").addEventListener("click", iniciarScanner);
el("btn-detener").addEventListener("click", detenerScanner);

// ─── Lector del dispositivo (Unitech EA530 u otro lector en modo teclado) ─────
// El lector integrado "teclea" el contenido del QR en el campo enfocado
// (Scan2Key en modo teclado), normalmente terminado en Enter. El campo NO usa
// inputmode="none": en el EA530 el texto del gatillo entra por el teclado del
// sistema y, con el teclado oculto, la lectura no llega a la página.
function esCampoEditable(nodo) {
  if (!nodo || nodo === el("lector-input")) return false;
  return nodo.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(nodo.tagName);
}

function enfocarLector() {
  if (!lectorActivo) return;
  const input = el("lector-input");
  if (document.activeElement !== input) input.focus({ preventScroll: true });
}

async function activarLector() {
  if (!eventoActivo)  { alerta("error", "Selecciona un evento."); return; }
  if (!checkpointSel) { alerta("error", "Selecciona un checkpoint."); return; }
  if (escaneando || estadoInternoScanner() === 3) await detenerScanner();

  lectorActivo = true;
  el("lector-input").value = "";
  ultimoValorLector = "";
  clearInterval(vigilanteLector);
  vigilanteLector = setInterval(revisarCampoLector, LECTOR_PAUSA_MS);
  el("camara-wrap").style.display = "none";
  el("camara-aviso").style.display = "none";
  el("lector-panel").style.display = "block";
  el("btn-lector").textContent = "Detener lector";
  el("scanner-ayuda").textContent = AYUDA_LECTOR;
  estadoScanner(participanteSel ? "Confirma o cancela el registro en pantalla." : MSG_LECTOR_LISTO, "activo");
  enfocarLector();
}

function desactivarLector() {
  clearTimeout(temporizadorLector);
  temporizadorLector = null;
  clearInterval(vigilanteLector);
  vigilanteLector = null;
  lectorActivo = false;
  el("lector-input").value = "";
  el("lector-input").blur();
  el("lector-panel").style.display = "none";
  el("lector-panel").classList.remove("sin-foco");
  el("camara-wrap").style.display = "";
  el("btn-lector").textContent = "Usar lector EA530";
  el("scanner-ayuda").textContent = AYUDA_CAMARA;
  estadoScanner("Lector detenido");
}

function recibirLecturaLector(texto) {
  if (!lectorActivo || !texto) return;
  if (!eventoActivo || !checkpointSel) {
    alerta("error", "Selecciona un evento y un checkpoint antes de escanear.");
    return;
  }
  if (procesandoQR) {
    alerta("error", "Espera: se está validando la credencial anterior.");
    return;
  }
  if (rfidPendiente) {
    void recibirRfid(texto, "lector");
    return;
  }
  if (participanteSel) {
    alerta("error", "Confirma o cancela el registro en pantalla antes de escanear otra credencial.");
    return;
  }
  void procesarQrDetectado(texto, "lector");
}

function finalizarLecturaLector() {
  clearTimeout(temporizadorLector);
  temporizadorLector = null;
  const input = el("lector-input");
  const texto = input.value.trim();
  input.value = "";
  ultimoValorLector = "";
  componiendoLector = false;
  if (texto) diagLector(`lectura completa (${texto.length} car.): ${texto.slice(0, 70)}`);
  recibirLecturaLector(texto);
}

// Algunos servicios de escaneo de Android escriben el texto en el campo sin
// disparar eventos de teclado ni "input": si el valor quedó quieto, se procesa.
function revisarCampoLector() {
  const valor = el("lector-input").value;
  if (valor.trim() && valor === ultimoValorLector && !temporizadorLector && !componiendoLector) {
    diagLector("texto detectado en el campo sin eventos de teclado");
    finalizarLecturaLector();
    return;
  }
  ultimoValorLector = valor;
}

el("lector-input").addEventListener("keydown", e => {
  const esEnter = e.key === "Enter" || e.keyCode === 13;
  // Algunos lectores terminan con Tab; sin contenido, Tab navega normalmente.
  const esTabFinal = e.key === "Tab" && el("lector-input").value.trim() !== "";
  if (!esEnter && !esTabFinal) return;
  e.preventDefault();
  finalizarLecturaLector();
});

function programarFinLectura() {
  clearTimeout(temporizadorLector);
  // Mientras el teclado compone texto se espera más para no cortar la lectura.
  const pausa = componiendoLector ? LECTOR_PAUSA_MS * 3 : LECTOR_PAUSA_MS;
  temporizadorLector = setTimeout(finalizarLecturaLector, pausa);
}

el("lector-input").addEventListener("input", programarFinLectura);

el("lector-input").addEventListener("compositionstart", () => {
  componiendoLector = true;
  diagLector("el teclado empezó a componer texto");
});

el("lector-input").addEventListener("compositionend", () => {
  componiendoLector = false;
  programarFinLectura();
});

el("lector-input").addEventListener("focus", () => {
  el("lector-panel").classList.remove("sin-foco");
});

// Mantener el foco en el campo del lector mientras está activo (tocar botones o
// checkpoints lo quita); no se lo roba a otro campo, como el selector de evento.
el("lector-input").addEventListener("blur", () => {
  setTimeout(() => {
    if (!lectorActivo) return;
    if (!esCampoEditable(document.activeElement)) enfocarLector();
    el("lector-panel").classList.toggle("sin-foco", document.activeElement !== el("lector-input"));
  }, 0);
});

el("lector-panel").addEventListener("click", enfocarLector);

// Si se presiona el gatillo sin haber tocado "Usar lector EA530", el modo lector
// se activa solo (con evento y checkpoint elegidos y la cámara apagada).
function activarLectorAutomatico() {
  if (lectorActivo) return true;
  if (!eventoActivo || !checkpointSel || guardandoRegistro) return false;
  if (escaneando || estadoInternoScanner() === 3) return false;
  void activarLector(); // sin cámara activa no hay await: queda activo al instante
  return lectorActivo;
}

// Respaldo: si el foco no está en el campo (o el equipo no lo devuelve), las
// teclas que envía el lector se acumulan igual en él y el Enter final la procesa.
document.addEventListener("keydown", e => {
  const input = el("lector-input");
  if (e.target === input || esCampoEditable(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!lectorActivo) {
    const imprimible = (e.key || "").length === 1 && e.key !== " ";
    if (!imprimible || !activarLectorAutomatico()) return;
  }
  const enLectura = input.value.trim() !== "";
  if (e.key === "Enter" || e.keyCode === 13 || e.key === "Tab") {
    if (!enLectura) return;
    e.preventDefault();
    finalizarLecturaLector();
    return;
  }
  if ((e.key || "").length !== 1 || (e.key === " " && !enLectura)) return;
  e.preventDefault();
  input.value += e.key;
  enfocarLector();
  programarFinLectura();
});

// Lectores configurados para "pegar" (portapapeles) en lugar de teclear.
document.addEventListener("paste", e => {
  const input = el("lector-input");
  if (e.target === input || esCampoEditable(e.target)) return;
  const texto = e.clipboardData?.getData("text") || "";
  if (!texto.trim() || !activarLectorAutomatico()) return;
  e.preventDefault();
  input.value += texto;
  enfocarLector();
  programarFinLectura();
});

el("btn-lector").addEventListener("click", () => {
  if (lectorActivo) desactivarLector();
  else void activarLector();
});

// ─── Diagnóstico del lector (?diag=1) ─────────────────────────────────────────
// Lista los últimos eventos que llegan (teclas, texto insertado, pegado, foco)
// para saber cómo entrega los datos el servicio de escaneo del equipo.
const lineasDiag = [];

function diagLector(texto) {
  if (!DIAGNOSTICO_LECTOR) return;
  lineasDiag.unshift(`${new Date().toLocaleTimeString("es-PA")}  ${texto}`);
  lineasDiag.length = Math.min(lineasDiag.length, 15);
  el("lector-diag").textContent = lineasDiag.join("\n");
}

if (DIAGNOSTICO_LECTOR) {
  const destino = t => (t?.id ? `#${t.id}` : String(t?.tagName || "?").toLowerCase());
  el("lector-diag").hidden = false;
  diagLector(`Diagnóstico activo · versión ${VERSION_LECTOR}`);
  document.addEventListener("keydown", e => {
    diagLector(`keydown key="${e.key}" keyCode=${e.keyCode} en ${destino(e.target)}`);
  }, true);
  document.addEventListener("input", e => {
    diagLector(`input ${e.inputType || ""} (${(e.data || "").length} car.) en ${destino(e.target)} · campo con ${e.target.value?.length ?? 0} car.`);
  }, true);
  document.addEventListener("paste", e => {
    diagLector(`paste (${(e.clipboardData?.getData("text") || "").length} car.) en ${destino(e.target)}`);
  }, true);
  document.addEventListener("focusin", e => diagLector(`foco en ${destino(e.target)}`), true);
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
    badge.textContent = `Ya registrado en "${checkpointSel.nombre}"`;
    el("btn-confirmar-asistencia").disabled = true;
  } else {
    badge.className   = "estado-badge estado-ok";
    badge.textContent = `Listo para marcar: ${checkpointSel.nombre}`;
    el("btn-confirmar-asistencia").disabled = false;
  }

  el("btn-confirmar-asistencia").textContent = "Confirmar asistencia";

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

  el("btn-confirmar-asistencia").textContent = "Confirmar asistencia y cupo";
  el("res-asistencias-actuales").textContent = "";
  el("resultado-box").style.display = "block";
  el("resultado-box").scrollIntoView({ behavior: "smooth" });
}

// ─── Confirmar (asistencia o inscripción taller) ──────────────────────────────
el("btn-confirmar-asistencia").addEventListener("click", async () => {
  if (!participanteSel || !checkpointSel || guardandoRegistro || capturandoRfid) return;
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
      ? `Asistencia y cupo confirmados: ${nombre}`
      : `Asistencia confirmada: ${nombre}`);
  } catch (e) {
    alerta("error", contexto.modoTaller
      ? e.message || "Error al inscribir en taller."
      : "Error al guardar asistencia: " + e.message);
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

// Marca la asistencia (o asistencia + cupo en talleres) y la anota en el log.
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
    const cpLocal = checkpointsSesion.find(c => c.id === checkpoint.id);
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
    hora:       new Date().toLocaleTimeString("es-PA"),
    tipo:       conCupos ? "taller" : "asistencia",
  });
  renderLog();
}

// ─── RFID: lo siguiente que se escanee tras la credencial ─────────────────────
// Sea QR, código de barras o lo que sea, se ancla al participante reconocido
// (ejecutarOperacionQr / anclar_rfid). Si la asistencia no estaba marcada, se
// marca en el mismo paso; "Confirmar sin RFID" sigue disponible.
function cancelarEsperaRfid() {
  rfidPendiente = null;
  el("rfid-pantalla").classList.remove("activa", "error");
}

function estadoRfid(texto, error = false) {
  el("rfid-estado").textContent = texto;
  el("rfid-pantalla").classList.toggle("error", error);
}

function iniciarEsperaRfid(credencialCruda) {
  if (!participanteSel || !checkpointSel || !eventoActivo) return;
  rfidPendiente = {
    credencialCruda: String(credencialCruda || "").trim(),
    asistenciaHecha: false,
    contexto: {
      participante: participanteSel,
      checkpoint: checkpointSel,
      eventoId: eventoActivo.id,
      modoTaller,
    },
  };
  el("rfid-nombre").textContent = participanteSel.nombreCompleto || participanteSel.nombre || "";
  estadoRfid(participanteSel.rfid?.serial
    ? `Ya tiene el RFID ${participanteSel.rfid.serial}: si escaneas otro, lo reemplaza.`
    : "Escanea el RFID (QR, código de barras o lo que sea) para anclarlo a este participante.");
  el("rfid-pantalla").classList.add("activa");
  const btn = el("btn-confirmar-asistencia");
  if (!btn.disabled) btn.textContent = modoTaller ? "Confirmar sin RFID (con cupo)" : "Confirmar sin RFID";

  if (escaneando) {
    reanudarScanner(false);
    estadoScanner("Apunta la cámara al RFID.", "activo");
  } else if (lectorActivo) {
    estadoScanner("Presiona el gatillo sobre el RFID.", "activo");
    enfocarLector();
  }
  el("rfid-pantalla").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function recibirRfid(texto, origen) {
  const pendiente = rfidPendiente;
  const lectura = String(texto || "").trim();
  if (!pendiente || !lectura || capturandoRfid || guardandoRegistro) return;
  // La cámara sigue viendo la credencial recién leída: eso no es el RFID.
  if (lectura === pendiente.credencialCruda) {
    if (origen === "lector") estadoRfid("Eso es la misma credencial. Escanea el RFID.", true);
    return;
  }
  try {
    if (extraerCredencialQr(lectura).tipo === "participante") {
      estadoRfid("Eso es una credencial de participante, no un RFID.", true);
      return;
    }
  } catch (_) {
    // No es una credencial: es el RFID.
  }

  const { contexto } = pendiente;
  const participante = contexto.participante;
  const nombre = participante.nombreCompleto || participante.nombre || "el participante";
  const btn = el("btn-confirmar-asistencia");
  const podiaMarcar = !btn.disabled && !pendiente.asistenciaHecha;
  capturandoRfid = true;
  bloquearSesion(true);
  btn.disabled = true;
  estadoRfid("Guardando RFID...");
  estadoScanner("RFID leído. Guardando...", "activo");

  let anclado = false;
  try {
    if (!participante.esNuevoFormato) {
      throw new Error("Las credenciales antiguas no admiten RFID.");
    }
    if (podiaMarcar) {
      try {
        await guardarAsistencia(contexto);
      } catch (e) {
        if (e.code !== "functions/already-exists") throw e;
      }
      pendiente.asistenciaHecha = true;
    }
    const { data } = await ejecutarOperacionQr({
      tipo: "anclar_rfid",
      participanteId: participante.id,
      eventoId: contexto.eventoId,
      rfid: lectura,
    });
    anclado = true;
    logSesion.unshift({
      nombre,
      checkpoint: `RFID ${data.serial}`,
      hora: new Date().toLocaleTimeString("es-PA"),
      tipo: "rfid",
    });
    renderLog();
    alerta("success", `${podiaMarcar ? "Asistencia confirmada y " : ""}RFID ${data.serial} anclado a ${nombre}.`);
  } catch (e) {
    console.error("Error anclando RFID:", e);
    const msg = e.message || "No se pudo anclar el RFID.";
    alerta("error", msg);
    estadoRfid(`${msg} Escanea de nuevo o cancela.`, true);
    estadoScanner(escaneando ? "Apunta la cámara al RFID." : "Presiona el gatillo sobre el RFID.", "activo");
    if (pendiente.asistenciaHecha) {
      btn.textContent = "Asistencia ya confirmada";
    } else {
      btn.disabled = !podiaMarcar;
    }
  } finally {
    capturandoRfid = false;
    bloquearSesion(false);
  }
  if (anclado) cerrarResultado();
}

el("btn-cancelar-scan").addEventListener("click", cerrarResultado);

function cerrarResultado() {
  participanteSel = null;
  cancelarEsperaRfid();
  el("resultado-box").style.display = "none";
  el("res-cupos-wrap").style.display = "none";
  el("btn-confirmar-asistencia").disabled = false;
  el("btn-confirmar-asistencia").textContent = modoTaller ? "Confirmar asistencia y cupo" : "Confirmar asistencia";
  if (escaneando) {
    reanudarScanner();
  } else if (lectorActivo) {
    estadoScanner(MSG_LECTOR_LISTO, "activo");
    enfocarLector();
  }
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

// Liberar la cámara si el panel se cierra o el navegador descarta la página.
window.addEventListener("pagehide", () => {
  const estado = estadoInternoScanner();
  if (scanner && (estado === 2 || estado === 3)) {
    scanner.stop().catch(e => console.warn("No se pudo liberar la cámara:", e));
  }
  escaneando = false;
});

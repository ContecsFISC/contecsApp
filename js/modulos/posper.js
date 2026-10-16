// =============================================
// CONTECS — POSPER (lectores físicos EA530, EDA52, EDA51-1, HT330, Memor 12)
// =============================================
// Los equipos de POSPER traen un lector de QR que se dispara con un botón y
// "teclea" lo que lee en el campo que tenga el foco (emulación de teclado).
// Esta página mantiene un campo visible con foco permanente (con teclado: sin
// él la lectura no llega en el EA530), junta lo que escribe el lector y lo procesa:
//
//   1. QR de credencial -> marca la ENTRADA en el checkpoint elegido (misma
//      operación del servidor que lecturaQR.js con cámara). Si ya estaba
//      marcada, se conserva la primera.
//   2. "¿CAPTAR RFID?" -> SÍ: el siguiente QR leído es el RFID y se ancla al
//      participante (ejecutarOperacionQr / anclar_rfid). NO: vuelve al paso 1.
//      Quien ya tiene RFID se queda con ese: no se pregunta de nuevo.
//
// Solo se ofrecen los checkpoints programados para hoy y a esta hora (hora
// de Panamá, js/core/permanencia.js). El Randomizer lista solo a quienes
// quedaron con RFID anclado.

import { app, db } from "../core/firebase-config.js";
import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, where,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import { escaparHtml } from "../core/seguridad.js";
import { extraerCredencialQr } from "../core/credencial-qr.js";
import { esperarSesionLista, getUsuarioActual } from "../core/auth.js";
import {
  estaOperativo, checkpointsParaEscanear, proximoCheckpointHoy,
  efectoDeEntrada, PERMANENCIA_MINIMA_DEFECTO,
} from "../core/permanencia.js";
import { sincronizarReloj, desfaseReloj, ahoraMs, ahoraPanama } from "../core/reloj-servidor.js";

const el = id => document.getElementById(id);
const h = escaparHtml;
const ejecutarOperacionQr = httpsCallable(
  getFunctions(app, "us-central1"),
  "ejecutarOperacionQr",
);

const TIPO_CON_CUPOS = ["taller", "workshop", "gira"];
const CLAVE_CONFIG = "posper.config";
// Marca que este equipo está escaneando: si su lector abre en el navegador el
// link de una credencial, public/perfil.html la devuelve aquí (#lectura=...).
const CLAVE_ESCANEANDO = "posper.escaneando";
// Sin sufijo Enter, la lectura se da por terminada tras este silencio.
const SILENCIO_FIN_MS = 600;
const LONGITUD_MAX_LECTURA = 2048;
// Equipos que entregó POSPER (solo para el diagnóstico: la lectura es la misma).
const EQUIPOS_POSPER = /EA530|EDA52|EDA51(?:-\d+)?|HT330|Memor ?12/i;

// config | qr | procesando | mostrando | pregunta | rfid | anclando | prueba
let estado = "config";
let eventoActivo = null;
let checkpoints = [];        // todos los del evento
let checkpointsHoy = [];     // los que se pueden escanear ahora
let checkpointSel = null;
// El CEO y POSPER pueden ver todos los checkpoints del evento (para probar
// los equipos fuera del horario del congreso). El servidor también lo revisa
// (ROLES_PRUEBA_HORARIO en operaciones-qr.js). Se lee cada vez: la sesión
// puede terminar de cargarse después de este módulo.
const puedeProbar = () => ["ceo", "posper"].includes(getUsuarioActual().rol);
const modoPrueba = () => puedeProbar() && el("chk-todos").checked;
let participanteActual = null;
let logSesion = [];
let secuenciaEvento = 0;

// ─── Alertas y pantalla principal ───────────────────────────────────────────
function alerta(tipo, msg) {
  const div = el("alerta");
  div.className = `alerta alerta-${tipo} show`;
  div.textContent = msg;
  clearTimeout(alerta.t);
  alerta.t = setTimeout(() => div.classList.remove("show"), 5000);
}

function pantalla(clase, titulo, sub = "") {
  el("escenario").className = `escenario ${clase}`;
  el("escenario-titulo").textContent = titulo;
  el("escenario-sub").textContent = sub;
}

function nombreDe(p) {
  return p?.nombreCompleto || [p?.nombre, p?.apellido].filter(Boolean).join(" ") || "Participante";
}

function marcarEscaneando(activo) {
  try {
    if (activo) localStorage.setItem(CLAVE_ESCANEANDO, String(Date.now()));
    else localStorage.removeItem(CLAVE_ESCANEANDO);
  } catch (_) { /* sin almacenamiento: el perfil se abre como siempre */ }
}

function esperarQr(sub) {
  estado = "qr";
  marcarEscaneando(true);
  participanteActual = null;
  el("btn-cancelar-rfid").style.display = "none";
  pantalla("esperando", "ESCANEA EL QR",
    sub || "Presiona el gatillo del lector apuntando a la credencial del participante.");
  enfocarCaptura();
}

function esperarRfid() {
  estado = "rfid";
  el("btn-cancelar-rfid").style.display = "inline-flex";
  pantalla("rfid esperando", "ESCANEAR RFID",
    `Escanea el QR del RFID que se anclará a ${nombreDe(participanteActual)}.`);
  enfocarCaptura();
}

// ─── Captura del lector (emulación de teclado) ──────────────────────────────
const captura = el("captura");
const lectura = { inicio: 0, metodo: "teclado", timer: null, componiendo: false, ultimoValor: "" };
const teclasEspeciales = [];

// Teclado en pantalla: visible por defecto porque en el EA530 la lectura no
// llega sin él; en otros equipos (EDA51-1...) se puede ocultar. Se recuerda
// por equipo.
const CLAVE_SIN_TECLADO = "posper.sinTeclado";
function aplicarTeclado(oculto) {
  if (oculto) captura.setAttribute("inputmode", "none");
  else captura.removeAttribute("inputmode");
  el("chk-sin-teclado").checked = oculto;
}
try { aplicarTeclado(localStorage.getItem(CLAVE_SIN_TECLADO) === "1"); } catch (_) { aplicarTeclado(false); }
el("chk-sin-teclado").addEventListener("change", e => {
  aplicarTeclado(e.target.checked);
  try { localStorage.setItem(CLAVE_SIN_TECLADO, e.target.checked ? "1" : "0"); } catch (_) { /* solo esta visita */ }
  // Re-enfocar para que el cambio de teclado se aplique ya.
  captura.blur();
  setTimeout(enfocarCaptura, 80);
});

function enfocarCaptura() {
  const activo = document.activeElement;
  if (activo && activo !== captura && activo.matches?.("select, textarea, input:not(#captura)")) return;
  captura.focus({ preventScroll: true });
}

captura.addEventListener("focus", () => {
  el("diag-foco").textContent = "Activo (listo para leer)";
  el("captura-wrap").classList.remove("sin-foco");
});
captura.addEventListener("blur", () => {
  el("diag-foco").textContent = "Sin foco";
  setTimeout(() => {
    enfocarCaptura();
    el("captura-wrap").classList.toggle("sin-foco", document.activeElement !== captura);
  }, 60);
});

captura.addEventListener("keydown", e => {
  if (!lectura.inicio) lectura.inicio = performance.now();
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    terminarLectura(e.key);
    return;
  }
  if (e.key.length !== 1 && !["Shift", "Backspace"].includes(e.key)) anotarTeclaEspecial(e);
});

captura.addEventListener("paste", () => { lectura.metodo = "pegado"; });

function programarFin() {
  clearTimeout(lectura.timer);
  // Mientras el teclado del equipo compone texto se espera más para no cortar.
  const pausa = lectura.componiendo ? SILENCIO_FIN_MS * 3 : SILENCIO_FIN_MS;
  lectura.timer = setTimeout(() => terminarLectura("ninguno (pausa)"), pausa);
}

captura.addEventListener("input", () => {
  if (!lectura.inicio) lectura.inicio = performance.now();
  // Algunos lectores entregan el texto completo en un solo evento y sin
  // Enter: se da por terminado cuando deja de llegar texto.
  programarFin();
});
captura.addEventListener("compositionstart", () => { lectura.componiendo = true; });
captura.addEventListener("compositionend", () => {
  lectura.componiendo = false;
  programarFin();
});

// Algunos servicios de escaneo de Android escriben en el campo sin disparar
// eventos: si el valor quedó quieto entre dos revisiones, se procesa.
setInterval(() => {
  const valor = captura.value;
  if (valor.trim() && valor === lectura.ultimoValor && !lectura.componiendo) {
    lectura.metodo = "texto sin eventos";
    terminarLectura("ninguno (sin eventos)");
  }
  lectura.ultimoValor = captura.value;
}, SILENCIO_FIN_MS);

// El gatillo de algunos equipos llega como una tecla propia; se anota para
// poder diagnosticar la configuración del lector.
document.addEventListener("keydown", e => {
  if (e.target !== captura && e.key.length !== 1 && !["Shift", "Tab", "Enter"].includes(e.key)) {
    anotarTeclaEspecial(e);
  }
}, true);

// Si el campo perdió el foco, los lectores que mandan pulsaciones de tecla
// siguen llegando al documento: se juntan igual en el campo de captura.
document.addEventListener("keydown", e => {
  if (e.target === captura || !["qr", "mostrando", "rfid", "prueba"].includes(estado)) return;
  if (e.target.matches?.("select, textarea, input, button")) return;
  if (e.key === "Enter" || e.key === "Tab") {
    if (!captura.value) return;
    e.preventDefault();
    terminarLectura(e.key);
    return;
  }
  if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  if (!lectura.inicio) lectura.inicio = performance.now();
  lectura.metodo = "teclas sin foco";
  captura.value += e.key;
  programarFin();
  enfocarCaptura();
});

function anotarTeclaEspecial(e) {
  const nombre = `${e.key || "?"}${e.keyCode ? ` (${e.keyCode})` : ""}`;
  if (teclasEspeciales[0] === nombre) return;
  teclasEspeciales.unshift(nombre);
  teclasEspeciales.length = Math.min(teclasEspeciales.length, 5);
  el("diag-teclas").textContent = teclasEspeciales.join(", ");
}

function terminarLectura(terminador) {
  clearTimeout(lectura.timer);
  const texto = captura.value.trim().slice(0, LONGITUD_MAX_LECTURA);
  const duracion = lectura.inicio ? Math.round(performance.now() - lectura.inicio) : 0;
  const metodo = lectura.metodo;
  captura.value = "";
  lectura.inicio = 0;
  lectura.metodo = "teclado";
  lectura.ultimoValor = "";
  lectura.componiendo = false;
  if (!texto) return;

  el("diag-metodo").textContent = metodo === "pegado" ? "Pegado"
    : metodo === "texto sin eventos" ? "Texto escrito sin eventos"
    : metodo === "teclas sin foco" ? "Teclas sin foco en el campo" : "Emulación de teclado";
  el("diag-longitud").textContent = String(texto.length);
  el("diag-duracion").textContent = `${duracion} ms`;
  el("diag-terminador").textContent = terminador;
  el("diag-crudo").textContent = texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;

  void procesarLectura(texto);
}

// El resultado (verde o rojo) se ve un momento, pero no bloquea: si el
// operador ya dispara a la siguiente credencial, se procesa de una vez.
let timerResultado = null;
function volverAQrEn(ms, sub) {
  estado = "mostrando";
  clearTimeout(timerResultado);
  timerResultado = setTimeout(() => { if (estado === "mostrando") esperarQr(sub); }, ms);
}

async function procesarLectura(texto) {
  switch (estado) {
    case "mostrando":
      clearTimeout(timerResultado);
      estado = "qr";
      return procesarCredencial(texto);
    case "qr": return procesarCredencial(texto);
    case "rfid": return procesarRfid(texto);
    case "prueba":
      alerta("success", `Lector funcionando: ${texto.length} caracteres leídos.`);
      el("btn-probar").textContent = "Probar lector (sin registrar)";
      return volverDePrueba();
    case "config":
      alerta("aviso", "Primero elige el evento y el checkpoint.");
      return;
    case "pregunta":
      alerta("aviso", "Responde primero si se capta el RFID.");
      return;
    default:
      alerta("aviso", "Espera a que termine la lectura anterior.");
  }
}

// ─── Paso 1: credencial -> asistencia ───────────────────────────────────────
async function buscarParticipante(credencial) {
  const snap = await getDocs(query(
    collection(db, "participantes"),
    where("codigo", "==", credencial.codigo),
    limit(1),
  ));
  if (snap.empty) throw new Error("QR no reconocido. Participante no encontrado.");
  const d = snap.docs[0];
  const participante = { id: d.id, ...d.data() };
  if (String(participante.token || "") !== credencial.token) {
    throw new Error("QR inválido: el token no coincide.");
  }
  if (participante.pago?.estado !== "aprobado") {
    throw new Error("El participante todavía no tiene el pago aprobado.");
  }
  return participante;
}

async function procesarCredencial(texto) {
  estado = "procesando";
  pantalla("esperando", "Validando...", "Revisando la credencial del participante.");
  const checkpoint = checkpointSel;
  const eventoId = eventoActivo?.id;

  try {
    const credencial = extraerCredencialQr(texto);
    if (credencial.tipo !== "participante") {
      throw new Error("Credencial antigua: regístrala desde Lectura QR.");
    }
    const participante = await buscarParticipante(credencial);
    const conCupos = TIPO_CON_CUPOS.includes(checkpoint.tipo) && checkpoint.cupos != null;
    // Qué actividad deja de contar con esta entrada (no se borra nada: la
    // permanencia se calcula con todas las entradas, js/core/permanencia.js).
    const { evaluacion, anuladas } = participante.asistencias?.[checkpoint.id]
      ? { evaluacion: {}, anuladas: [] }
      : efectoDeEntrada(participante.asistencias, checkpoint.id, checkpoints, ahoraMs(), {
        porcentajeMinimo: eventoActivo?.permanenciaMinima || PERMANENCIA_MINIMA_DEFECTO,
      });

    let asistencia = "nueva";
    try {
      await ejecutarOperacionQr({
        tipo: conCupos ? "inscripcion_taller" : "asistencia_participante",
        participanteId: participante.id,
        checkpointId: checkpoint.id,
        coleccion: "participantes",
        eventoId,
        modoPrueba: modoPrueba(),
      });
    } catch (e) {
      // Ya marcado antes: igual se le puede anclar el RFID.
      if (e.code !== "functions/already-exists") throw e;
      asistencia = "previa";
    }

    const sinValidez = asistencia === "nueva"
      ? anuladas.map(id => ({ nombre: checkpoints.find(c => c.id === id)?.nombre || id, ...evaluacion[id] }))
      : [];
    participanteActual = participante;
    mostrarParticipante(participante, asistencia, sinValidez);
    agregarLog(participante, asistencia === "nueva"
      ? (sinValidez.length ? `Entrada (anula ${sinValidez.map(s => s.nombre).join(", ")})` : "Entrada")
      : "Ya estaba", participante.rfid?.serial || "—");
    pantalla("ok", asistencia === "nueva" ? "ENTRADA MARCADA" : "YA REGISTRADO", nombreDe(participante));
    // Un RFID por persona: quien ya tiene uno no vuelve a pasar por la pregunta.
    if (participante.rfid?.serial) {
      volverAQrEn(1500, `${nombreDe(participante)} ya tiene el RFID ${participante.rfid.serial}.`);
      return;
    }
    preguntarRfid(participante);
  } catch (e) {
    console.error("POSPER credencial:", e);
    const msg = e.message || "No se pudo procesar el QR.";
    alerta("error", msg);
    pantalla("error", "QR NO VÁLIDO", msg);
    volverAQrEn(2500);
  }
}

function mostrarParticipante(p, asistencia, sinValidez = []) {
  el("res-nombre").textContent = nombreDe(p);
  el("res-codigo").textContent = p.codigo || "—";
  el("res-cedula").textContent = p.cedula || "—";
  el("res-universidad").textContent = p.universidad || p.institucion || "—";
  const chips = [
    asistencia === "nueva"
      ? `<span class="chip chip-ok">Entrada marcada: ${h(checkpointSel.nombre || "")}</span>`
      : `<span class="chip chip-aviso">Ya tenía entrada en ${h(checkpointSel.nombre || "")} (se conserva la primera)</span>`,
    ...sinValidez.map(s =>
      `<span class="chip chip-aviso">"${h(s.nombre)}" deja de contar (estuvo ${h(s.minutos)} de ${h(s.duracion)} min)</span>`),
  ];
  el("res-chips").innerHTML = chips.join("");
  if (p.rfid?.serial) mostrarChipRfid(p.rfid.serial);
  el("resultado").style.display = "block";
}

function mostrarChipRfid(serial) {
  el("res-chips").querySelector(".chip-rfid")?.remove();
  el("res-chips").insertAdjacentHTML("beforeend", `<span class="chip chip-rfid">RFID ${h(serial)}</span>`);
}

// ─── Paso 2: ¿CAPTAR RFID? ──────────────────────────────────────────────────
function preguntarRfid(p) {
  estado = "pregunta";
  el("modal-rfid-texto").textContent = `¿Anclar un RFID a ${nombreDe(p)}?`;
  el("modal-rfid").classList.add("abierto");
  // El foco se queda en el campo de captura: si el lector dispara con el
  // aviso abierto, su Enter no debe "pulsar" SÍ por accidente.
  enfocarCaptura();
}

function cerrarPregunta() {
  el("modal-rfid").classList.remove("abierto");
}

el("btn-rfid-no").addEventListener("click", () => {
  cerrarPregunta();
  esperarQr();
});

el("btn-rfid-si").addEventListener("click", () => {
  cerrarPregunta();
  esperarRfid();
});

el("btn-cancelar-rfid").addEventListener("click", () => esperarQr());

// ─── Paso 3: QR del RFID -> anclar ──────────────────────────────────────────
async function procesarRfid(texto) {
  const participante = participanteActual;
  if (!participante) return esperarQr();

  // Si se escanea otra credencial por error, no se ancla como RFID.
  try {
    if (extraerCredencialQr(texto).tipo === "participante") {
      alerta("error", "Ese QR es una credencial. Escanea el QR del RFID.");
      return;
    }
  } catch (_) {
    // No es credencial: seguir.
  }

  estado = "anclando";
  pantalla("rfid", "Anclando RFID...", nombreDe(participante));
  try {
    const { data } = await ejecutarOperacionQr({
      tipo: "anclar_rfid",
      participanteId: participante.id,
      eventoId: eventoActivo.id,
      rfid: texto,
    });
    participante.rfid = { serial: data.serial };
    mostrarChipRfid(data.serial);
    actualizarLogRfid(participante.id, data.serial);
    alerta("success", data.yaAnclado
      ? `${nombreDe(participante)} ya tenía ese RFID (${data.serial}).`
      : `RFID ${data.serial} anclado a ${nombreDe(participante)}.`);
    esperarQr(`Último RFID: ${data.serial} → ${nombreDe(participante)}`);
  } catch (e) {
    console.error("POSPER RFID:", e);
    const msg = e.message || "No se pudo anclar el RFID.";
    alerta("error", msg);
    // Si la persona ya tenía otro RFID no hay nada que reintentar.
    if (e.code === "functions/already-exists" && /ya tiene el RFID/.test(msg)) {
      esperarQr(msg);
      return;
    }
    esperarRfid();
    el("escenario-sub").textContent = `${msg} Intenta de nuevo o cancela.`;
  }
}

// ─── Registro de la sesión ──────────────────────────────────────────────────
function agregarLog(p, asistencia, rfid) {
  logSesion.unshift({
    id: p.id,
    nombre: nombreDe(p),
    asistencia,
    rfid,
    hora: new Date().toLocaleTimeString("es-PA"),
  });
  logSesion = logSesion.slice(0, 30);
  renderLog();
}

function actualizarLogRfid(participanteId, serial) {
  const fila = logSesion.find(r => r.id === participanteId);
  if (fila) fila.rfid = serial;
  renderLog();
}

function renderLog() {
  el("log-posper").innerHTML = logSesion.length
    ? logSesion.map(r => `<tr>
        <td>${h(r.nombre)}</td><td>${h(r.asistencia)}</td>
        <td style="font-family:ui-monospace,Consolas,monospace">${h(r.rfid)}</td><td>${h(r.hora)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center;color:var(--gris-medio)">Sin registros aún</td></tr>`;
}

// ─── Configuración: evento y checkpoint ─────────────────────────────────────
function leerConfigGuardada() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CONFIG) || "{}"); } catch (_) { return {}; }
}

function guardarConfig() {
  try {
    localStorage.setItem(CLAVE_CONFIG, JSON.stringify({
      eventoId: eventoActivo?.id || "", checkpointId: checkpointSel?.id || "",
    }));
  } catch (_) { /* almacenamiento no disponible: solo se pierde la preferencia */ }
}

async function cargarEventos() {
  const snap = await getDocs(query(collection(db, "eventos"), orderBy("creadoEn", "desc")));
  const sel = el("sel-evento");
  // Cancelados y desactivados no se ofrecen.
  const eventos = snap.docs.filter(d => estaOperativo(d.data()));
  eventos.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nombre || d.id;
    sel.appendChild(opt);
  });
  const guardada = leerConfigGuardada();
  if (guardada.eventoId && eventos.some(d => d.id === guardada.eventoId)) {
    sel.value = guardada.eventoId;
    await elegirEvento(guardada.checkpointId);
  } else if (eventos.length === 1) {
    sel.value = eventos[0].id;
    await elegirEvento();
  }
}

function etiquetaCheckpoint(cp) {
  const horario = cp.horaInicio && cp.horaFin ? `${cp.horaInicio}–${cp.horaFin}` : "";
  return [cp.nombre || "Sin nombre", cp.tipo ? cp.tipo.toUpperCase() : "", horario, modoPrueba() ? cp.dia : ""]
    .filter(Boolean).join(" · ");
}

// Llena el selector con los checkpoints que se pueden escanear ahora (hora de
// Panamá). Se vuelve a llamar cada minuto: así aparecen los que abren y se
// quitan los que terminan.
function renderCheckpoints(checkpointPreferido = "") {
  const selCp = el("sel-checkpoint");
  const todos = modoPrueba();
  const ahora = ahoraPanama();
  checkpointsHoy = (todos ? checkpoints.filter(estaOperativo) : checkpointsParaEscanear(checkpoints, ahora))
    .sort((a, b) => `${a.dia || ""}${a.horaInicio || ""}`.localeCompare(`${b.dia || ""}${b.horaInicio || ""}`));

  const proximo = proximoCheckpointHoy(checkpoints, ahora);
  el("cp-aviso").textContent = checkpointsHoy.length
    ? (todos ? "Mostrando todos los checkpoints del evento (modo prueba)." : "Checkpoints en curso hoy (hora de Panamá).")
    : proximo
      ? `No hay checkpoints en curso. El próximo es "${proximo.nombre || "Checkpoint"}" a las ${proximo.horaInicio}: aparecerá 30 minutos antes.`
      : "No hay checkpoints programados para este momento de hoy.";

  const previo = checkpointPreferido || selCp.value;
  if (!checkpointsHoy.length) {
    selCp.innerHTML = `<option value="">Sin checkpoints en este momento</option>`;
    selCp.disabled = true;
  } else {
    selCp.innerHTML = `<option value="">— Selecciona un checkpoint —</option>` +
      checkpointsHoy.map(cp => `<option value="${h(cp.id)}">${h(etiquetaCheckpoint(cp))}</option>`).join("");
    selCp.disabled = false;
    if (previo && checkpointsHoy.some(c => c.id === previo)) selCp.value = previo;
  }

  // El checkpoint en uso terminó: se avisa y se vuelve a la configuración.
  if (checkpointSel && !checkpointsHoy.some(c => c.id === checkpointSel.id) && ["qr", "mostrando"].includes(estado)) {
    alerta("aviso", `"${checkpointSel.nombre || "El checkpoint"}" ya terminó. Elige otro.`);
    checkpointSel = null;
    irAConfig();
  }
}

async function elegirEvento(checkpointPreferido = "") {
  const secuencia = ++secuenciaEvento;
  const id = el("sel-evento").value;
  checkpointSel = null;
  irAConfig();
  const selCp = el("sel-checkpoint");
  selCp.innerHTML = `<option value="">— Selecciona un checkpoint —</option>`;
  selCp.disabled = true;
  el("cp-aviso").textContent = "";
  if (!id) { eventoActivo = null; checkpoints = []; return; }

  const [evSnap, cpSnap] = await Promise.all([
    getDoc(doc(db, "eventos", id)),
    getDocs(query(collection(db, "checkpoints"), where("eventoId", "==", id))),
  ]);
  if (secuencia !== secuenciaEvento || !evSnap.exists()) return;
  eventoActivo = { id, ...evSnap.data() };
  checkpoints = cpSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!checkpoints.length) {
    selCp.innerHTML = `<option value="">Este evento no tiene checkpoints</option>`;
    return;
  }
  renderCheckpoints(checkpointPreferido);
  if (el("sel-checkpoint").value) elegirCheckpoint();
}

function elegirCheckpoint() {
  checkpointSel = checkpointsHoy.find(c => c.id === el("sel-checkpoint").value) || null;
  if (!checkpointSel || !eventoActivo) { irAConfig(); return; }
  guardarConfig();
  el("config-texto").textContent = `${eventoActivo.nombre || "Evento"} · ${checkpointSel.nombre || "Checkpoint"}`;
  el("config-form").style.display = "none";
  el("config-resumen").style.display = "flex";
  document.activeElement?.blur?.();
  esperarQr();
}

function irAConfig() {
  estado = "config";
  marcarEscaneando(false);
  cerrarPregunta();
  el("btn-cancelar-rfid").style.display = "none";
  el("config-form").style.display = "block";
  el("config-resumen").style.display = "none";
  pantalla("inactivo", "Configura la sesión", "Elige el evento y el checkpoint para empezar a escanear.");
}

el("sel-evento").addEventListener("change", () => {
  elegirEvento().catch(e => alerta("error", "No se pudo cargar el evento: " + (e.message || e)));
});
el("sel-checkpoint").addEventListener("change", elegirCheckpoint);
el("btn-cambiar-config").addEventListener("click", irAConfig);
el("chk-todos").addEventListener("change", () => renderCheckpoints());
setInterval(() => { if (checkpoints.length) renderCheckpoints(); }, 60000);

// ─── Prueba del lector ──────────────────────────────────────────────────────
let estadoAntesDePrueba = "config";

el("btn-probar").addEventListener("click", () => {
  if (estado === "prueba") return volverDePrueba();
  if (!["config", "qr", "mostrando"].includes(estado)) {
    alerta("aviso", "Termina la lectura en curso antes de probar el lector.");
    return;
  }
  estadoAntesDePrueba = estado;
  estado = "prueba";
  el("btn-probar").textContent = "Cancelar prueba";
  pantalla("rfid esperando", "PRUEBA DEL LECTOR", "Dispara el lector: lo leído solo se muestra abajo, no se registra.");
  enfocarCaptura();
});

function volverDePrueba() {
  el("btn-probar").textContent = "Probar lector (sin registrar)";
  if (["qr", "mostrando"].includes(estadoAntesDePrueba) && checkpointSel) esperarQr();
  else irAConfig();
}

// ─── Dispositivo ────────────────────────────────────────────────────────────
async function leerDispositivo() {
  const ua = navigator.userAgent || "";
  const datos = {
    modelo: (ua.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build|\))/) || [])[1] || "",
    sistema: (ua.match(/Android [\d.]+/) || [])[0] || navigator.platform || "",
    arquitectura: "",
  };
  try {
    const alta = await navigator.userAgentData?.getHighEntropyValues?.(
      ["model", "platform", "platformVersion", "architecture", "bitness"],
    );
    if (alta) {
      if (alta.model) datos.modelo = alta.model;
      if (alta.platform) datos.sistema = `${alta.platform} ${alta.platformVersion || ""}`.trim();
      datos.arquitectura = [alta.architecture, alta.bitness ? `${alta.bitness} bits` : ""].filter(Boolean).join(" ");
    }
  } catch (_) {
    // El navegador no comparte estos datos: se queda lo del user agent.
  }

  const conexion = navigator.connection?.effectiveType;
  const minutosDesfase = Math.round(desfaseReloj() / 60000);
  const filas = [
    ["Reloj del equipo", Math.abs(minutosDesfase) < 2 ? "En hora"
      : `Desfasado ${Math.abs(minutosDesfase)} min (${minutosDesfase > 0 ? "atrasado" : "adelantado"}); se usa la hora del servidor`],
    ["Modelo", datos.modelo || "No informado por el navegador"],
    ["Sistema", datos.sistema || "—"],
    ["Arquitectura", datos.arquitectura || "—"],
    ["Núcleos de CPU", navigator.hardwareConcurrency || "—"],
    ["Memoria", navigator.deviceMemory ? `≈ ${navigator.deviceMemory} GB` : "—"],
    ["Pantalla", `${screen.width}×${screen.height} @${window.devicePixelRatio || 1}x`],
    ["Táctil", navigator.maxTouchPoints ? `Sí (${navigator.maxTouchPoints} puntos)` : "No"],
    ["Red", navigator.onLine ? `En línea${conexion ? ` (${conexion})` : ""}` : "Sin conexión"],
    ["Navegador", (ua.match(/(Chrome|Firefox|SamsungBrowser|Edg)\/[\d.]+/) || [ua.slice(0, 60)])[0]],
  ];
  el("diag-hardware").innerHTML = filas.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(String(v))}</dd>`).join("");

  const equipo = `${datos.modelo} ${ua}`.match(EQUIPOS_POSPER)?.[0]?.toUpperCase();
  const badge = el("diag-ea530");
  badge.className = `diag-badge ${equipo ? "si" : "no"}`;
  badge.textContent = equipo
    ? `${equipo} detectado: usa el gatillo del lector`
    : "Equipo no reconocido: sirve cualquier lector en modo teclado";
}

window.addEventListener("online", leerDispositivo);
window.addEventListener("offline", leerDispositivo);

// Tocar la pantalla devuelve el foco al campo de captura (si no es un control).
document.addEventListener("pointerup", e => {
  if (!e.target.closest("select, input, textarea, button, a, summary")) enfocarCaptura();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) enfocarCaptura();
});

// ─── Init ───────────────────────────────────────────────────────────────────
// El modo "todos los checkpoints" es solo para que el CEO y POSPER prueben.
esperarSesionLista().then(() => {
  if (puedeProbar()) el("ceo-todos").style.display = "flex";
});
// Credencial que devolvió public/perfil.html (el lector la abrió en el navegador).
const lecturaPendiente = new URLSearchParams(window.location.hash.slice(1)).get("lectura") || "";
if (lecturaPendiente) history.replaceState(null, "", window.location.pathname + window.location.search);

sincronizarReloj().then(() => {
  leerDispositivo();
  return cargarEventos();
}).then(() => {
  if (!lecturaPendiente) return;
  if (estado === "qr") return procesarLectura(lecturaPendiente);
  alerta("aviso", "Elige el evento y el checkpoint y vuelve a escanear la credencial.");
}).catch(e => {
  console.error("POSPER: error cargando eventos:", e);
  alerta("error", "No se pudieron cargar los eventos: " + (e.message || e));
});
enfocarCaptura();

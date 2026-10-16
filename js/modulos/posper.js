// =============================================
// CONTECS — POSPER (lectores físicos Memor 12, HT330, EDA51-1, EA530, EDA52)
// =============================================
// El lector se dispara con el botón lateral y "teclea" lo que lee; la captura
// (sin teclado en pantalla y sin mostrar el texto) vive en
// js/core/lector-fisico.js. Esta página solo la usan POSPER y el CEO:
//
//   1. QR de credencial -> marca la ENTRADA en el checkpoint elegido (misma
//      operación del servidor que Lectura QR). Si ya estaba marcada, se
//      conserva la primera.
//   2. ESCANEAR RFID (obligatorio) -> la siguiente lectura, sea QR, código de
//      barras o lo que traiga el RFID, se ancla al participante
//      (ejecutarOperacionQr / anclar_rfid). Hasta anclarlo no se acepta otra
//      credencial; "Sin RFID" pide confirmación. Quien ya tiene RFID se queda
//      con ese y no se le pide otro.
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
import { crearLectorFisico, leerDispositivo } from "../core/lector-fisico.js?v=20261016.1";

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

// config | qr | procesando | mostrando | rfid | anclando | salir-sin-rfid | prueba
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
  el("btn-sin-rfid").style.display = "none";
  pantalla("esperando", "ESCANEA EL QR",
    sub || "Presiona el botón lateral del lector apuntando a la credencial del participante.");
  lector.enfocar();
}

function esperarRfid(sub) {
  estado = "rfid";
  el("btn-sin-rfid").style.display = "inline-flex";
  pantalla("rfid esperando", "ESCANEAR RFID",
    sub || `Obligatorio: escanea el RFID que se le entrega a ${nombreDe(participanteActual)}.`);
  lector.enfocar();
}

// ─── Lector del equipo ──────────────────────────────────────────────────────
const teclasEspeciales = [];
const lector = crearLectorFisico({
  campo: el("captura"),
  alLeer: (texto, info) => {
    el("diag-metodo").textContent = info.metodo;
    el("diag-longitud").textContent = String(info.longitud);
    el("diag-duracion").textContent = `${info.duracion} ms`;
    el("diag-terminador").textContent = info.terminador;
    el("diag-crudo").textContent = texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
    void procesarLectura(texto);
  },
  aceptaTeclasSueltas: () => ["qr", "mostrando", "rfid", "prueba"].includes(estado),
  alEmpezar: () => {
    if (["qr", "mostrando", "rfid"].includes(estado)) el("escenario-sub").textContent = "Leyendo…";
  },
  alFoco: conFoco => {
    el("diag-foco").textContent = conFoco ? "Activo (listo para leer)" : "Sin foco";
    el("captura-wrap").classList.toggle("sin-foco", !conFoco);
  },
  alTeclaEspecial: nombre => {
    if (teclasEspeciales[0] === nombre) return;
    teclasEspeciales.unshift(nombre);
    teclasEspeciales.length = Math.min(teclasEspeciales.length, 5);
    el("diag-teclas").textContent = teclasEspeciales.join(", ");
  },
});

el("chk-teclado").checked = lector.tecladoVisible;
el("chk-teclado").addEventListener("change", e => lector.mostrarTeclado(e.target.checked));

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
    case "salir-sin-rfid":
      alerta("aviso", "Responde primero si sigue sin RFID.");
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
  // El token es hexadecimal (functions/registro.js): mayúsculas y minúsculas
  // son el mismo valor, y el teclado del equipo puede cambiarlas.
  if (String(participante.token || "").toLowerCase() !== credencial.token.toLowerCase()) {
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
    // Un RFID por persona: quien ya tiene uno no vuelve a pasar por el RFID.
    if (participante.rfid?.serial) {
      pantalla("ok", asistencia === "nueva" ? "ENTRADA MARCADA" : "YA REGISTRADO",
        `${nombreDe(participante)} · ya tiene el RFID ${participante.rfid.serial}`);
      volverAQrEn(1500);
      return;
    }
    esperarRfid(`${asistencia === "nueva" ? "Entrada marcada" : "Ya tenía entrada"}. Obligatorio: escanea el RFID que se le entrega a ${nombreDe(participante)}.`);
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
  mostrarRfid(p.rfid?.completo || p.rfid?.serial || "");
  el("resultado").style.display = "block";
}

// El número del RFID que quedó con la persona (o "Sin RFID").
function mostrarRfid(numero) {
  el("res-rfid").textContent = numero || "Sin RFID";
  el("res-rfid").classList.toggle("vacio", !numero);
}

// ─── Paso 2: RFID obligatorio ───────────────────────────────────────────────
// "Sin RFID" (pulsera dañada, se acabaron...) pide confirmación. El foco se
// queda en el campo de captura: si el lector dispara con el aviso abierto, su
// Enter no debe "pulsar" un botón por accidente.
el("btn-sin-rfid").addEventListener("click", () => {
  if (estado !== "rfid") return;
  estado = "salir-sin-rfid";
  el("modal-sin-rfid-texto").textContent =
    `${nombreDe(participanteActual)} ya tiene la entrada marcada, pero se quedará sin RFID y no entrará al sorteo.`;
  el("modal-sin-rfid").classList.add("abierto");
  lector.enfocar();
});

function cerrarSalida() {
  el("modal-sin-rfid").classList.remove("abierto");
}

el("btn-seguir-rfid").addEventListener("click", () => {
  cerrarSalida();
  esperarRfid();
});

el("btn-confirmar-sin-rfid").addEventListener("click", () => {
  cerrarSalida();
  const nombre = nombreDe(participanteActual);
  actualizarLogRfid(participanteActual?.id, "Sin RFID");
  esperarQr(`${nombre} quedó sin RFID.`);
});

// ─── Paso 3: lectura del RFID -> anclar ─────────────────────────────────────
async function procesarRfid(texto) {
  const participante = participanteActual;
  if (!participante) return esperarQr();

  // Hasta anclar el RFID no se acepta otra credencial.
  try {
    if (extraerCredencialQr(texto).tipo === "participante") {
      alerta("error", `Eso es una credencial. Primero el RFID de ${nombreDe(participante)}.`);
      esperarRfid(`Eso fue una credencial. Escanea el RFID de ${nombreDe(participante)} (obligatorio).`);
      return;
    }
  } catch (_) {
    // No es credencial: es el RFID.
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
    const numero = data.completo || data.serial;
    participante.rfid = { serial: data.serial, completo: data.completo };
    mostrarRfid(numero);
    actualizarLogRfid(participante.id, data.serial);
    pantalla("ok", data.yaAnclado ? "YA TENÍA ESE RFID" : "RFID ANCLADO", `RFID ${numero} → ${nombreDe(participante)}`);
    volverAQrEn(1800, `Último: RFID ${data.serial} → ${nombreDe(participante)}`);
  } catch (e) {
    console.error("POSPER RFID:", e);
    const msg = e.message || "No se pudo anclar el RFID.";
    alerta("error", msg);
    // Si la persona ya tenía otro RFID no hay nada que reintentar.
    if (e.code === "functions/already-exists" && /ya tiene el RFID/.test(msg)) {
      esperarQr(msg);
      return;
    }
    esperarRfid(`${msg} Escanea otro RFID.`);
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
  cerrarSalida();
  el("btn-sin-rfid").style.display = "none";
  el("config-form").style.display = "block";
  el("config-resumen").style.display = "none";
  pantalla("inactivo", "Configura la sesión", "Elige el evento y el checkpoint para empezar a escanear.");
}

el("sel-evento").addEventListener("change", () => {
  elegirEvento().catch(e => alerta("error", "No se pudo cargar el evento: " + (e.message || e)));
});
el("sel-checkpoint").addEventListener("change", elegirCheckpoint);
el("btn-cambiar-config").addEventListener("click", () => {
  if (estado === "rfid" || estado === "anclando") {
    alerta("aviso", `Termina primero el RFID de ${nombreDe(participanteActual)}.`);
    return;
  }
  irAConfig();
});
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
  lector.enfocar();
});

function volverDePrueba() {
  el("btn-probar").textContent = "Probar lector (sin registrar)";
  if (["qr", "mostrando"].includes(estadoAntesDePrueba) && checkpointSel) esperarQr();
  else irAConfig();
}

// ─── Dispositivo ────────────────────────────────────────────────────────────
async function pintarDispositivo() {
  const datos = await leerDispositivo();
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
    ["Navegador", datos.navegador],
  ];
  el("diag-hardware").innerHTML = filas.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(String(v))}</dd>`).join("");

  const badge = el("diag-equipo");
  badge.className = `diag-badge ${datos.equipo ? "si" : "no"}`;
  badge.textContent = datos.equipo
    ? `${datos.equipo} detectado: usa el botón lateral del lector`
    : "Equipo no reconocido: sirve cualquier lector en modo teclado";
}

window.addEventListener("online", pintarDispositivo);
window.addEventListener("offline", pintarDispositivo);

// ─── Init ───────────────────────────────────────────────────────────────────
// El modo "todos los checkpoints" es solo para que el CEO y POSPER prueben.
esperarSesionLista().then(() => {
  if (puedeProbar()) el("ceo-todos").style.display = "flex";
});
// Credencial que devolvió public/perfil.html (el lector la abrió en el navegador).
const lecturaPendiente = new URLSearchParams(window.location.hash.slice(1)).get("lectura") || "";
if (lecturaPendiente) history.replaceState(null, "", window.location.pathname + window.location.search);

sincronizarReloj().then(() => {
  pintarDispositivo();
  return cargarEventos();
}).then(() => {
  if (!lecturaPendiente) return;
  if (estado === "qr") return procesarLectura(lecturaPendiente);
  alerta("aviso", "Elige el evento y el checkpoint y vuelve a escanear la credencial.");
}).catch(e => {
  console.error("POSPER: error cargando eventos:", e);
  alerta("error", "No se pudieron cargar los eventos: " + (e.message || e));
});
lector.enfocar();

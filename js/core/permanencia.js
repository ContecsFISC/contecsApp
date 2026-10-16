// =============================================
// CONTECS — Hora de Panamá, checkpoints escaneables y permanencia
// =============================================
// Lectura QR y POSPER solo registran ENTRADAS. La "salida" de un checkpoint
// es la siguiente entrada del participante (o el fin del checkpoint si no
// hubo otra). Con eso se calcula cuánto tiempo estuvo de verdad en cada
// actividad y se descartan las que no alcanzan el porcentaje mínimo: quien
// entra a una conferencia y a los 15 minutos se va a otra no se lleva las dos.
//
// Sin dependencias de Firebase ni del DOM para poder probarlo con el código
// real desde Node (functions/test/permanencia.test.mjs).

// Panamá no tiene horario de verano: siempre UTC-5.
const OFFSET_PANAMA_MS = 5 * 60 * 60 * 1000;

// Se puede escanear desde este margen antes del inicio (la gente llega antes).
export const MARGEN_APERTURA_MIN = 30;
export const PERMANENCIA_MINIMA_DEFECTO = 75;
// Quien marca la siguiente actividad hasta 15 min antes de que empiece está
// haciendo fila: para la anterior cuenta que salió cuando empieza la nueva.
// Más temprano que eso (o si la nueva ya empezó) sale cuando marca.
export const TOLERANCIA_FILA_MIN = 15;

// El control de acceso general no es una sesión: registra que la persona
// llegó al congreso, no tiene "duración" que cumplir y tampoco cierra la
// permanencia de la actividad anterior.
const TIPOS_SIN_PERMANENCIA = new Set(["congreso"]);

// ─── Hora de Panamá ─────────────────────────────────────────────────────────
// { dia: "YYYY-MM-DD", minutos: minutos desde las 00:00 en Panamá }
export function enPanama(fecha = new Date()) {
  const local = new Date(fecha.getTime() - OFFSET_PANAMA_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return { dia: `${y}-${m}-${d}`, minutos: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export function minutosDeHora(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Instante (ms) de un día "YYYY-MM-DD" + minutos, en hora de Panamá.
export function msPanama(dia, minutos) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia || ""));
  if (!m || minutos == null) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, minutos) + OFFSET_PANAMA_MS;
}

function aMs(valor) {
  if (valor == null) return NaN;
  if (typeof valor === "number") return valor;
  if (typeof valor.toMillis === "function") return valor.toMillis();
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor.seconds === "number") return valor.seconds * 1000;
  return new Date(valor).getTime();
}

// ─── Estado de eventos y checkpoints ────────────────────────────────────────
export function estaCancelado(item) {
  return item?.estado === "cancelado";
}

// Operativo = ni cancelado ni desactivado. Los documentos antiguos no tienen
// estos campos y cuentan como operativos.
export function estaOperativo(item) {
  return Boolean(item) && !estaCancelado(item) && item.activo !== false;
}

// Checkpoints que se pueden escanear en este momento (hora de Panamá): los
// operativos programados para hoy cuya ventana [inicio - margen, fin] incluye
// la hora actual. Sin horario cuentan todo el día. El servidor revisa lo
// mismo al guardar (functions/ventana-checkpoint.js).
export function checkpointsParaEscanear(checkpoints, ahora = enPanama()) {
  return (checkpoints || []).filter(cp => {
    if (!estaOperativo(cp) || cp.dia !== ahora.dia) return false;
    const ini = minutosDeHora(cp.horaInicio);
    const fin = minutosDeHora(cp.horaFin);
    if (ini == null || fin == null) return true;
    return ahora.minutos >= ini - MARGEN_APERTURA_MIN && ahora.minutos <= fin;
  });
}

// El siguiente checkpoint operativo de hoy que todavía no abre (para avisar).
export function proximoCheckpointHoy(checkpoints, ahora = enPanama()) {
  return (checkpoints || [])
    .filter(cp => estaOperativo(cp) && cp.dia === ahora.dia)
    .filter(cp => {
      const ini = minutosDeHora(cp.horaInicio);
      return ini != null && ahora.minutos < ini - MARGEN_APERTURA_MIN;
    })
    .sort((a, b) => minutosDeHora(a.horaInicio) - minutosDeHora(b.horaInicio))[0] || null;
}

// ─── Permanencia ────────────────────────────────────────────────────────────
function esMedible(cp) {
  if (!cp || TIPOS_SIN_PERMANENCIA.has(String(cp.tipo || "").toLowerCase())) return false;
  const ini = minutosDeHora(cp.horaInicio);
  const fin = minutosDeHora(cp.horaFin);
  return ini != null && fin != null && fin > ini && msPanama(cp.dia, ini) != null;
}

/**
 * Evalúa las entradas de UN participante.
 * @param {Array<{checkpointId: string, marcadoEn: any, salidaEn?: any}>} entradas
 *   Una por checkpoint (el servidor ya guarda solo la primera). `salidaEn`
 *   existe si alguien autorizado liberó su asiento desde el Mapa del evento.
 * @param {Array<object>} checkpoints  Checkpoints con id, dia, horaInicio, horaFin, tipo.
 * @param {{porcentajeMinimo?: number}} [opciones]
 * @returns {Record<string, {valida: boolean, medible: boolean, minutos?: number,
 *   requeridos?: number, duracion?: number, cerradaPor?: "siguiente"|"fin"}>}
 */
export function evaluarPermanencia(entradas, checkpoints, { porcentajeMinimo = PERMANENCIA_MINIMA_DEFECTO } = {}) {
  const pct = Math.min(100, Math.max(0, Number(porcentajeMinimo) || 0));
  const porId = new Map((checkpoints || []).map(cp => [cp.id, cp]));
  const resultado = {};
  const medibles = [];

  for (const entrada of entradas || []) {
    const cp = porId.get(entrada.checkpointId);
    if (!cp) continue;
    const ms = aMs(entrada.marcadoEn);
    // Sin horario o sin hora de marcado no hay cómo medir: la entrada cuenta.
    if (!esMedible(cp) || !Number.isFinite(ms)) {
      resultado[cp.id] = { valida: true, medible: false };
      continue;
    }
    const salidaMs = aMs(entrada.salidaEn);
    medibles.push({ cp, ms, salidaMs: Number.isFinite(salidaMs) ? salidaMs : Infinity });
  }

  medibles.sort((a, b) => a.ms - b.ms);
  medibles.forEach(({ cp, ms, salidaMs }, i) => {
    const inicio = msPanama(cp.dia, minutosDeHora(cp.horaInicio));
    const fin = msPanama(cp.dia, minutosDeHora(cp.horaFin));
    const sig = medibles[i + 1];
    let siguiente = sig?.ms ?? Infinity;
    if (sig) {
      const inicioSig = msPanama(sig.cp.dia, minutosDeHora(sig.cp.horaInicio));
      if (siguiente < inicioSig && inicioSig - siguiente <= TOLERANCIA_FILA_MIN * 60000) siguiente = inicioSig;
    }
    const salida = Math.min(fin, siguiente, salidaMs);
    const desde = Math.max(ms, inicio);
    const minutos = Math.max(0, Math.floor((salida - desde) / 60000));
    const duracion = Math.round((fin - inicio) / 60000);
    const requeridos = Math.ceil(duracion * pct / 100);
    resultado[cp.id] = {
      valida: minutos >= requeridos,
      medible: true,
      minutos,
      requeridos,
      duracion,
      cerradaPor: salidaMs < Math.min(fin, siguiente) ? "salida" : siguiente < fin ? "siguiente" : "fin",
    };
  });

  return resultado;
}

/**
 * Qué pasaría con las entradas de un participante si ahora marca `checkpointId`.
 * No borra nada: solo sirve para avisar en el lector antes de confirmar.
 * @param {Record<string, {marcadoEn?: any}>} asistencias  mapa del participante
 * @returns {{evaluacion: object, anuladas: string[]}}  evaluación con la
 *   entrada nueva incluida y los checkpoints que dejarían de contar por ella.
 */
export function efectoDeEntrada(asistencias, checkpointId, checkpoints, ahoraMs = Date.now(), opciones = {}) {
  const previas = Object.entries(asistencias || {})
    .filter(([id]) => id !== checkpointId)
    .map(([id, a]) => ({ checkpointId: id, marcadoEn: a?.marcadoEn, salidaEn: a?.salidaEn }));
  const antes = evaluarPermanencia(previas, checkpoints, opciones);
  const evaluacion = evaluarPermanencia([...previas, { checkpointId, marcadoEn: ahoraMs }], checkpoints, opciones);
  const anuladas = Object.keys(antes).filter(id => antes[id].valida && !evaluacion[id]?.valida);
  return { evaluacion, anuladas };
}

/**
 * Quiénes están ocupando un asiento AHORA en cada checkpoint, con la misma
 * regla que la permanencia: alguien deja su asiento cuando entra a otra
 * actividad o cuando un rol autorizado lo libera (`salidaEn`). El control de
 * acceso general no saca a nadie de su actividad.
 * @param {Array<object>} asistencias  docs de `asistencias_congreso` del día
 *   ({ checkpointId, participanteId, participanteColeccion, marcadoEn, salidaEn })
 * @param {Array<object>} checkpoints
 * @param {number} [ahoraMs]
 * @returns {Map<string, Array<object>>} checkpointId -> asistencias presentes
 */
export function ocupacionActual(asistencias, checkpoints, ahoraMs = Date.now()) {
  const tipos = new Map((checkpoints || []).map(cp => [cp.id, String(cp.tipo || "").toLowerCase()]));
  const persona = a => `${a.participanteColeccion || "participantes"}:${a.participanteId}`;
  // Entradas a actividades (no control de acceso) por persona, en orden.
  const entradas = new Map();
  for (const a of asistencias || []) {
    const ms = aMs(a.marcadoEn);
    if (!Number.isFinite(ms) || ms > ahoraMs || TIPOS_SIN_PERMANENCIA.has(tipos.get(a.checkpointId))) continue;
    const lista = entradas.get(persona(a)) || [];
    lista.push(ms);
    entradas.set(persona(a), lista);
  }

  const ocupacion = new Map();
  for (const a of asistencias || []) {
    if (!tipos.has(a.checkpointId)) continue;
    const ms = aMs(a.marcadoEn);
    if (!Number.isFinite(ms) || ms > ahoraMs) continue;
    const salida = aMs(a.salidaEn);
    if (Number.isFinite(salida) && salida <= ahoraMs) continue;
    const esAcceso = TIPOS_SIN_PERMANENCIA.has(tipos.get(a.checkpointId));
    if (!esAcceso && (entradas.get(persona(a)) || []).some(t => t > ms)) continue;
    if (!ocupacion.has(a.checkpointId)) ocupacion.set(a.checkpointId, []);
    ocupacion.get(a.checkpointId).push(a);
  }
  return ocupacion;
}

// ¿El checkpoint está pasando en este momento (hora de Panamá)?
export function enCurso(cp, ahora = enPanama()) {
  if (!estaOperativo(cp) || cp.dia !== ahora.dia) return false;
  const ini = minutosDeHora(cp.horaInicio);
  const fin = minutosDeHora(cp.horaFin);
  return ini != null && fin != null && ahora.minutos >= ini && ahora.minutos < fin;
}

export function contarValidas(evaluacion) {
  return Object.values(evaluacion || {}).filter(r => r.valida).length;
}

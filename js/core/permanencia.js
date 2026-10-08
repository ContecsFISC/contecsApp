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
// la hora actual. Sin horario cuentan todo el día.
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
 * @param {Array<{checkpointId: string, marcadoEn: any}>} entradas
 *   Una por checkpoint (el servidor ya guarda solo la primera).
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
    medibles.push({ cp, ms });
  }

  medibles.sort((a, b) => a.ms - b.ms);
  medibles.forEach(({ cp, ms }, i) => {
    const inicio = msPanama(cp.dia, minutosDeHora(cp.horaInicio));
    const fin = msPanama(cp.dia, minutosDeHora(cp.horaFin));
    const siguiente = medibles[i + 1]?.ms ?? Infinity;
    const salida = Math.min(fin, siguiente);
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
      cerradaPor: siguiente < fin ? "siguiente" : "fin",
    };
  });

  return resultado;
}

export function contarValidas(evaluacion) {
  return Object.values(evaluacion || {}).filter(r => r.valida).length;
}

"use strict";

// Ventana en la que se puede marcar la entrada a un checkpoint: el día del
// checkpoint, desde 30 min antes del inicio hasta el fin (hora de Panamá).
// Es la misma regla que checkpointsParaEscanear() en js/core/permanencia.js,
// que decide qué checkpoints ofrecen Lectura QR y POSPER; aquí se repite con
// la hora del servidor para que no dependa del reloj ni de la página.
// functions/test/permanencia.test.mjs compara las dos.

// Panamá no tiene horario de verano: siempre UTC-5.
const OFFSET_PANAMA_MS = 5 * 60 * 60 * 1000;
const MARGEN_APERTURA_MIN = 30;
// Una confirmación que se empezó justo antes del cierre no se pierde.
const GRACIA_CIERRE_MIN = 2;

function enPanama(ms) {
  const local = new Date(ms - OFFSET_PANAMA_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return {
    dia: `${y}-${m}-${d}`,
    minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function minutosDeHora(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Motivo por el que el checkpoint no se puede marcar ahora, o null si sí.
 * Los checkpoints sin día no se validan (documentos antiguos); los que no
 * tienen horario valen todo su día.
 * @param {object} checkpoint
 * @param {number} [ahoraMs]
 * @param {{gracia: number}} [opciones]  minutos extra tras el fin
 * @return {string|null}
 */
function fueraDeVentana(checkpoint, ahoraMs = Date.now(), {gracia = GRACIA_CIERRE_MIN} = {}) {
  if (!checkpoint?.dia) return null;
  const nombre = `"${checkpoint.nombre || "El checkpoint"}"`;
  const ahora = enPanama(ahoraMs);
  if (checkpoint.dia !== ahora.dia) {
    return `${nombre} es del ${checkpoint.dia}: solo se puede marcar ese día.`;
  }
  const ini = minutosDeHora(checkpoint.horaInicio);
  const fin = minutosDeHora(checkpoint.horaFin);
  if (ini == null || fin == null) return null;
  if (ahora.minutos < ini - MARGEN_APERTURA_MIN) {
    return `${nombre} todavía no abre: se puede marcar desde 30 minutos antes de las ${checkpoint.horaInicio}.`;
  }
  if (ahora.minutos > fin + gracia) {
    return `${nombre} ya terminó (${checkpoint.horaFin}).`;
  }
  return null;
}

module.exports = {
  fueraDeVentana, enPanama, minutosDeHora, MARGEN_APERTURA_MIN, GRACIA_CIERRE_MIN,
};

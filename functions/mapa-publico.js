"use strict";

// Mapa público (public/mapa.html, al que lleva el QR del congreso): cualquiera
// sin iniciar sesión ve los salones, la agenda y cuántos asientos quedan.
// Nunca sale quién está dentro: solo conteos. Las colecciones siguen cerradas
// en firestore.rules; esto es lo único que se publica.
//
// Para que cientos de personas mirando el mapa no multipliquen las lecturas,
// el resultado se guarda en publico/mapa y se reutiliza durante CACHE_MS.

const {getFirestore, FieldValue} = require("firebase-admin/firestore");

const db = getFirestore();
const CACHE_MS = 20 * 1000;
const OFFSET_PANAMA_MS = 5 * 60 * 60 * 1000;

// ── Copia de js/core/permanencia.js (test/mapa-publico.test.mjs compara) ──
const TIPOS_SIN_PERMANENCIA = new Set(["congreso"]);

function aMs(valor) {
  if (valor == null) return NaN;
  if (typeof valor === "number") return valor;
  if (typeof valor.toMillis === "function") return valor.toMillis();
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor.seconds === "number") return valor.seconds * 1000;
  return new Date(valor).getTime();
}

function enPanama(fecha = new Date()) {
  const local = new Date(fecha.getTime() - OFFSET_PANAMA_MS);
  const dos = (n) => String(n).padStart(2, "0");
  return {dia: `${local.getUTCFullYear()}-${dos(local.getUTCMonth() + 1)}-${dos(local.getUTCDate())}`};
}

// checkpointId -> cuántas personas están dentro ahora. Misma regla que
// ocupacionActual() del panel: alguien deja su asiento al entrar a otra
// actividad o cuando se registra su salida.
function contarOcupacion(asistencias, checkpoints, ahoraMs = Date.now()) {
  const tipos = new Map((checkpoints || []).map((cp) => [cp.id, String(cp.tipo || "").toLowerCase()]));
  const persona = (a) => `${a.participanteColeccion || "participantes"}:${a.participanteId}`;
  const entradas = new Map();
  for (const a of asistencias || []) {
    const ms = aMs(a.marcadoEn);
    if (!Number.isFinite(ms) || ms > ahoraMs || TIPOS_SIN_PERMANENCIA.has(tipos.get(a.checkpointId))) continue;
    const lista = entradas.get(persona(a)) || [];
    lista.push(ms);
    entradas.set(persona(a), lista);
  }
  const conteo = {};
  for (const a of asistencias || []) {
    if (!tipos.has(a.checkpointId)) continue;
    const ms = aMs(a.marcadoEn);
    if (!Number.isFinite(ms) || ms > ahoraMs) continue;
    const salida = aMs(a.salidaEn);
    if (Number.isFinite(salida) && salida <= ahoraMs) continue;
    const esAcceso = TIPOS_SIN_PERMANENCIA.has(tipos.get(a.checkpointId));
    if (!esAcceso && (entradas.get(persona(a)) || []).some((t) => t > ms)) continue;
    conteo[a.checkpointId] = (conteo[a.checkpointId] || 0) + 1;
  }
  return conteo;
}

const operativo = (x) => Boolean(x) && x.estado !== "cancelado" && x.activo !== false;
const diaDe = (valor) => {
  const ms = aMs(valor);
  return Number.isFinite(ms) ? enPanama(new Date(ms)).dia : null;
};

// Lo publicable de cada cosa: ni tokens, ni cupos internos, ni autores.
function eventoPublico(id, ev) {
  return {
    id, nombre: ev.nombre || "Evento",
    diasEvento: Array.isArray(ev.diasEvento) ? ev.diasEvento.map((d) => ({fecha: d.fecha || null})) : [],
    fechaInicio: diaDe(ev.fechaInicio), fechaFin: diaDe(ev.fechaFin),
  };
}

function checkpointPublico(id, cp) {
  return {
    id, eventoId: cp.eventoId || null, nombre: cp.nombre || "Actividad", titulo: cp.titulo || "",
    tipo: cp.tipo || "otro", dia: cp.dia || null, horaInicio: cp.horaInicio || null, horaFin: cp.horaFin || null,
    salonId: cp.salonId || null, salon: cp.salon || "", exponente: cp.exponente || "",
    estado: cp.estado || null, activo: cp.activo !== false,
  };
}

async function generarMapa() {
  const hoy = enPanama().dia;
  const [eventosSnap, salonesSnap] = await Promise.all([
    db.collection("eventos").get(),
    db.collection("salones").get(),
  ]);
  const eventos = eventosSnap.docs.filter((d) => operativo(d.data())).map((d) => eventoPublico(d.id, d.data()));
  const checkpoints = [];
  for (const ev of eventos) {
    const snap = await db.collection("checkpoints").where("eventoId", "==", ev.id).get();
    snap.docs.forEach((d) => checkpoints.push(checkpointPublico(d.id, d.data())));
  }
  const salones = {};
  salonesSnap.docs.forEach((d) => {
    const s = d.data();
    salones[d.id] = {nombre: s.nombre || "", rotulo: s.rotulo || "", capacidad: Number(s.capacidad) || 0};
  });
  // Los asientos solo importan hoy: se cuentan las entradas de hoy.
  const asisSnap = await db.collection("asistencias_congreso").where("checkpointDia", "==", hoy).get();
  const asistencias = asisSnap.docs.map((d) => {
    const a = d.data();
    return {
      checkpointId: a.checkpointId, participanteId: a.participanteId,
      participanteColeccion: a.participanteColeccion, marcadoEn: a.marcadoEn, salidaEn: a.salidaEn,
    };
  });
  const ocupacion = contarOcupacion(asistencias, checkpoints.filter((cp) => cp.dia === hoy));
  return {eventos, checkpoints, salones, ocupacion, hoy};
}

async function mapaPublico() {
  const ref = db.collection("publico").doc("mapa");
  const cache = await ref.get();
  const generado = cache.exists ? aMs(cache.data().generadoEn) : 0;
  if (cache.exists && Date.now() - generado < CACHE_MS) {
    const {datos} = cache.data();
    return {...JSON.parse(datos), generadoEn: generado};
  }
  const datos = await generarMapa();
  // Como texto: un solo campo, sin límites de índices por los muchos ids.
  await ref.set({datos: JSON.stringify(datos), generadoEn: FieldValue.serverTimestamp()});
  return {...datos, generadoEn: Date.now()};
}

module.exports = {mapaPublico, contarOcupacion, generarMapa};

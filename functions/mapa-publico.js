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
// Mientras una instancia regenera, las demás sirven la versión anterior.
const LEASE_MS = 15 * 1000;
const OFFSET_PANAMA_MS = 5 * 60 * 60 * 1000;
// Una actividad cuenta asientos desde que abre la entrada (30 min antes).
const MARGEN_APERTURA_MS = 30 * 60 * 1000;

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

function minutosDeHora(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Instante (ms) de un día "YYYY-MM-DD" + minutos, en hora de Panamá.
function msPanama(dia, minutos) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia || ""));
  if (!m || minutos == null) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, minutos) + OFFSET_PANAMA_MS;
}

const resumirAsistencia = (d) => {
  const a = d.data();
  return {
    checkpointId: a.checkpointId, participanteId: a.participanteId,
    participanteColeccion: a.participanteColeccion, marcadoEn: a.marcadoEn, salidaEn: a.salidaEn,
  };
};

// Ocupación de las actividades abiertas con las mismas reglas de
// contarOcupacion: las entradas de esas actividades más las posteriores a la
// apertura de la más antigua (para saber quién ya se fue a otra). El acceso
// general ("congreso") no se mide por cambios de salón.
async function ocupacionDeAbiertas(abiertas, deHoy, hoy, ahora) {
  const ids = abiertas.map((cp) => cp.id);
  const consultas = [];
  for (let i = 0; i < ids.length; i += 30) {
    consultas.push(db.collection("asistencias_congreso").where("checkpointId", "in", ids.slice(i, i + 30)).get());
  }
  const medibles = abiertas.filter((cp) => !TIPOS_SIN_PERMANENCIA.has(String(cp.tipo || "").toLowerCase()));
  if (medibles.length) {
    const desde = Math.min(...medibles.map((cp) => msPanama(hoy, minutosDeHora(cp.horaInicio)))) - MARGEN_APERTURA_MS;
    consultas.push(db.collection("asistencias_congreso").where("marcadoEn", ">=", new Date(desde)).get());
  }
  const porId = new Map();
  (await Promise.all(consultas)).forEach((snap) => snap.docs.forEach((d) => porId.set(d.id, resumirAsistencia(d))));
  const conteo = contarOcupacion([...porId.values()], deHoy, ahora);
  return Object.fromEntries(ids.filter((id) => conteo[id]).map((id) => [id, conteo[id]]));
}
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

// La ficha de la charla (descripción, empresa, foto del exponente, logo y
// temas) también es pública: es lo que muestra el Mapa al tocar el salón.
const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function checkpointPublico(id, cp) {
  return {
    id, eventoId: cp.eventoId || null, nombre: cp.nombre || "Actividad", titulo: cp.titulo || "",
    tipo: cp.tipo || "otro", dia: cp.dia || null, horaInicio: cp.horaInicio || null, horaFin: cp.horaFin || null,
    salonId: cp.salonId || null, salon: cp.salon || "", exponente: cp.exponente || "",
    estado: cp.estado || null, activo: cp.activo !== false,
    descripcion: texto(cp.descripcion, 1200), empresa: texto(cp.empresa, 120),
    fotoExponente: texto(cp.fotoExponente, 500), logoEmpresa: texto(cp.logoEmpresa, 500),
    temas: Array.isArray(cp.temas) ? cp.temas.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 8) : [],
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
  // Los asientos solo importan en las actividades abiertas ahora. Antes se
  // leían TODAS las entradas del día en cada regeneración (miles al final de
  // la jornada); ahora solo las de esas actividades y, para saber quién se
  // cambió de salón, las marcadas desde que abrió la más antigua.
  const ahora = Date.now();
  const deHoy = checkpoints.filter((cp) => cp.dia === hoy && operativo(cp));
  const abiertas = deHoy.filter((cp) => {
    const ini = msPanama(hoy, minutosDeHora(cp.horaInicio));
    const fin = msPanama(hoy, minutosDeHora(cp.horaFin));
    return ini != null && fin != null && ahora >= ini - MARGEN_APERTURA_MS && ahora <= fin;
  });
  const ocupacion = abiertas.length ? await ocupacionDeAbiertas(abiertas, deHoy, hoy, ahora) : {};
  // Asientos apartados por charla (reservas desde el perfil, functions/charlas.js).
  const reservas = {};
  const conteos = checkpoints.length ?
    await db.getAll(...checkpoints.map((cp) => db.collection("reservas_conteo").doc(cp.id))) : [];
  conteos.forEach((snap) => {
    const n = Number(snap.data()?.reservados || 0);
    if (n > 0) reservas[snap.id] = n;
  });
  return {eventos, checkpoints, salones, ocupacion, reservas, hoy};
}

// Cientos de personas mirando el mapa: una sola regeneración a la vez.
//   1. En memoria de la instancia: si lo tiene fresco, ni siquiera lee Firestore.
//   2. Si la instancia ya está regenerando, las demás llamadas esperan ese mismo resultado.
//   3. Entre instancias, un "turno" en publico/mapa (regenerandoHasta): quien
//      no lo tiene sirve la versión anterior en vez de regenerar también.
let enMemoria = null; // {datos, generado}
let regenerando = null;

async function mapaPublico() {
  if (enMemoria && Date.now() - enMemoria.generado < CACHE_MS) {
    return {...enMemoria.datos, generadoEn: enMemoria.generado};
  }
  if (!regenerando) {
    regenerando = obtenerMapa().finally(() => {
      regenerando = null;
    });
  }
  const {datos, generado} = await regenerando;
  return {...datos, generadoEn: generado};
}

async function obtenerMapa() {
  const ref = db.collection("publico").doc("mapa");
  const ahora = Date.now();
  const turno = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const c = snap.exists ? snap.data() : {};
    const generado = aMs(c.generadoEn) || 0;
    const anterior = c.datos ? {datos: JSON.parse(c.datos), generado} : null;
    if (anterior && ahora - generado < CACHE_MS) return {listo: anterior};
    const ocupado = (aMs(c.regenerandoHasta) || 0) > ahora;
    if (ocupado && anterior) return {listo: anterior};
    tx.set(ref, {regenerandoHasta: new Date(ahora + LEASE_MS)}, {merge: true});
    return {regenerar: true, anterior};
  });
  if (turno.listo) {
    enMemoria = turno.listo;
    return turno.listo;
  }
  try {
    const datos = await generarMapa();
    // Como texto: un solo campo, sin límites de índices por los muchos ids.
    await ref.set({datos: JSON.stringify(datos), generadoEn: FieldValue.serverTimestamp(), regenerandoHasta: null});
    enMemoria = {datos, generado: Date.now()};
    return enMemoria;
  } catch (e) {
    // Si falla la regeneración, mejor la versión anterior que un error.
    if (turno.anterior) {
      console.error("mapaPublico: se sirve la versión anterior:", e);
      return turno.anterior;
    }
    throw e;
  }
}

module.exports = {mapaPublico, contarOcupacion, generarMapa, ocupacionDeAbiertas};

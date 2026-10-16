"use strict";

// Perfil por cédula y reservas de charlas y talleres.
//
// - accederConCedula: la persona inscrita entra a public/perfil.html solo con
//   su cédula (también sigue valiendo el link ?c=&t= de la credencial). Así lo
//   pidió CONTECS sabiendo que quien conozca una cédula ve ese perfil.
// - reservarCharla: aparta (o libera) un asiento en una charla o taller. La
//   reserva NO limita la entrada: el día del congreso entra quien llegue y el
//   voluntario que escanea decide cuándo el salón está lleno. Sirve para el
//   Mapa (asientos apartados) y para las métricas: cuántos reservaron, cuántos
//   de ellos fueron y cuántos entraron sin reservar.
// - Invitación por correo (enviarInvitacionCharlas en index.js): lotes con
//   tope diario para no pasar el límite de Brevo.
//
// Datos:
//   reservas_charlas/{checkpointId}_{participanteId}
//     {checkpointId, eventoId, participanteId, participanteNombre, codigo,
//      dia, horaInicio, horaFin, salonId, creadoEn}
//   reservas_conteo/{checkpointId}  {reservados}  (aparte del checkpoint para
//     que editarlo en Gestión de Evento no borre la cuenta)
//   participantes/{id}.reservas.{checkpointId}  {dia, horaInicio, horaFin, creadoEn}

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {enPanama, minutosDeHora} = require("./ventana-checkpoint");

// Perezoso: las pruebas cargan este archivo sin Firebase.
let firestore = null;
function db() {
  if (!firestore) firestore = getFirestore();
  return firestore;
}

// Tipos de checkpoint que se pueden reservar (la entrada general "congreso" y
// las giras no).
const TIPOS_RESERVABLES = new Set(["conferencia", "taller", "workshop", "panel"]);
const MAX_CEDULA = 30;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,200}$/;

function noOperativo(item) {
  return item?.estado === "cancelado" || item?.activo === false;
}

// La cédula se guardó tal como se escribió al inscribirse (solo sin espacios
// a los lados). Se prueban las formas habituales de escribir la misma: con
// mayúsculas o minúsculas y sin los ceros de relleno ("8-0123-0456").
function variantesCedula(cedula) {
  const base = String(cedula || "").trim().replace(/\s+/g, "");
  if (!base) return [];
  const sinCeros = base.replace(/(^|-)0+(?=\d)/g, "$1");
  const conGuiones = base.replace(/[–—_.]/g, "-");
  return [...new Set([
    base, base.toUpperCase(), base.toLowerCase(),
    sinCeros, sinCeros.toUpperCase(),
    conGuiones, conGuiones.toUpperCase(),
  ])].slice(0, 10);
}

// {cedula} o {codigo, token} -> {id, ref, data}. Si una cédula está en varias
// inscripciones (datos viejos), gana la que tiene el pago aprobado.
async function identificarParticipante(datos) {
  const codigo = String(datos?.codigo || "").trim().toUpperCase();
  const token = String(datos?.token || "").trim();
  let docs = [];
  if (codigo && token) {
    if (codigo.length > 30 || token.length > 64) {
      throw new HttpsError("invalid-argument", "Credenciales inválidas.");
    }
    const snap = await db().collection("participantes")
        .where("codigo", "==", codigo).where("token", "==", token).limit(1).get();
    docs = snap.docs;
  } else {
    const cedula = String(datos?.cedula || "").trim();
    if (!cedula) throw new HttpsError("invalid-argument", "Escribe tu cédula.");
    if (cedula.length > MAX_CEDULA) throw new HttpsError("invalid-argument", "Esa cédula es demasiado larga.");
    const snap = await db().collection("participantes")
        .where("cedula", "in", variantesCedula(cedula)).limit(5).get();
    docs = snap.docs;
  }
  if (!docs.length) {
    throw new HttpsError("not-found",
        "No encontramos una inscripción con esa cédula. Escríbela como al inscribirte (por ejemplo 8-123-4567).");
  }
  const elegido = docs.find((d) => d.data().pago?.estado === "aprobado") || docs[0];
  return {id: elegido.id, ref: elegido.ref, data: elegido.data()};
}

function minutos(cp, campo) {
  return minutosDeHora(cp?.[campo]);
}

// Se puede reservar hasta que empieza (hora de Panamá).
function yaEmpezo(cp, ahoraMs = Date.now()) {
  if (!cp?.dia) return false;
  const ahora = enPanama(ahoraMs);
  if (cp.dia !== ahora.dia) return cp.dia < ahora.dia;
  const ini = minutos(cp, "horaInicio");
  return ini != null && ahora.minutos >= ini;
}

function seCruzan(a, b) {
  if (!a?.dia || a.dia !== b?.dia) return false;
  const [ai, af, bi, bf] = [minutos(a, "horaInicio"), minutos(a, "horaFin"), minutos(b, "horaInicio"), minutos(b, "horaFin")];
  if ([ai, af, bi, bf].some((m) => m == null)) return false;
  return ai < bf && bi < af;
}

// Asientos que se pueden apartar: los cupos del taller o la capacidad del
// salón; sin ninguno de los dos, sin tope.
function capacidadDe(cp, salon) {
  const cupos = Number(cp?.cupos);
  if (Number.isFinite(cupos) && cupos > 0) return cupos;
  const capacidad = Number(salon?.capacidad);
  return Number.isFinite(capacidad) && capacidad > 0 ? capacidad : null;
}

// Charlas y talleres que todavía se pueden reservar, de los eventos activos.
async function charlasReservables(participanteId, reservas) {
  const eventos = await db().collection("eventos").get();
  const activos = new Map(eventos.docs.filter((d) => !noOperativo(d.data())).map((d) => [d.id, d.data()]));
  if (!activos.size) return [];
  const ids = [...activos.keys()].slice(0, 30);
  const cpSnap = await db().collection("checkpoints").where("eventoId", "in", ids).get();
  const cps = cpSnap.docs
      .map((d) => ({id: d.id, ...d.data()}))
      .filter((cp) => TIPOS_RESERVABLES.has(cp.tipo) && !noOperativo(cp) && (!yaEmpezo(cp) || reservas?.[cp.id]));
  if (!cps.length) return [];

  const salonIds = [...new Set(cps.map((cp) => cp.salonId).filter((id) => typeof id === "string" && id))];
  const [salones, conteos] = await Promise.all([
    salonIds.length ? db().getAll(...salonIds.map((id) => db().collection("salones").doc(id))) : [],
    db().getAll(...cps.map((cp) => db().collection("reservas_conteo").doc(cp.id))),
  ]);
  const salonDe = new Map(salones.filter((s) => s.exists).map((s) => [s.id, s.data()]));

  return cps.map((cp, i) => {
    const salon = salonDe.get(cp.salonId);
    return {
      id: cp.id,
      eventoId: cp.eventoId,
      eventoNombre: activos.get(cp.eventoId)?.nombre || cp.eventoNombre || "",
      nombre: cp.nombre || "",
      titulo: cp.titulo || "",
      tipo: cp.tipo,
      dia: cp.dia || "",
      horaInicio: cp.horaInicio || "",
      horaFin: cp.horaFin || "",
      salon: salon?.nombre || cp.salon || "",
      salonId: cp.salonId || "",
      exponente: cp.exponente || "",
      descripcion: cp.descripcion || "",
      capacidad: capacidadDe(cp, salon),
      reservados: Number(conteos[i]?.data()?.reservados || 0),
      reservado: !!reservas?.[cp.id],
      empezo: yaEmpezo(cp),
    };
  }).sort((a, b) => `${a.dia}${a.horaInicio}`.localeCompare(`${b.dia}${b.horaInicio}`));
}

// Lo mismo que ve la persona en su perfil: sin comprobantes ni notas del staff.
function perfilPublico(id, data, sanitizar) {
  return {...sanitizar(data), id, reservas: Object.keys(data.reservas || {})};
}

async function accederConCedula(request, sanitizar) {
  const {id, data} = await identificarParticipante(request.data);
  return {
    participante: perfilPublico(id, data, sanitizar),
    charlas: await charlasReservables(id, data.reservas),
  };
}

async function reservarCharla(request) {
  const {id: participanteId, ref: participanteRef} = await identificarParticipante(request.data);
  const checkpointId = String(request.data?.checkpointId || "").trim();
  if (!ID_VALIDO.test(checkpointId)) throw new HttpsError("invalid-argument", "Charla no válida.");
  const reservar = request.data?.reservar !== false;

  const cpRef = db().collection("checkpoints").doc(checkpointId);
  const reservaRef = db().collection("reservas_charlas").doc(`${checkpointId}_${participanteId}`);
  const conteoRef = db().collection("reservas_conteo").doc(checkpointId);

  const resultado = await db().runTransaction(async (tx) => {
    const [pSnap, cpSnap, reservaSnap, conteoSnap] = await tx.getAll(participanteRef, cpRef, reservaRef, conteoRef);
    if (!cpSnap.exists) throw new HttpsError("not-found", "Esa charla ya no existe.");
    const p = pSnap.data();
    const cp = {id: checkpointId, ...cpSnap.data()};
    const reservados = Number(conteoSnap.data()?.reservados || 0);

    if (!reservar) {
      if (!reservaSnap.exists) return {reservado: false, reservados};
      if (yaEmpezo(cp)) throw new HttpsError("failed-precondition", "La charla ya empezó: la reserva no se puede quitar.");
      tx.delete(reservaRef);
      tx.set(conteoRef, {reservados: FieldValue.increment(-1)}, {merge: true});
      tx.update(participanteRef, {[`reservas.${checkpointId}`]: FieldValue.delete()});
      return {reservado: false, reservados: Math.max(0, reservados - 1)};
    }

    if (reservaSnap.exists) return {reservado: true, reservados};
    if (p.pago?.estado !== "aprobado") {
      throw new HttpsError("failed-precondition", "Podrás reservar cuando tu pago esté aprobado.");
    }
    if (!TIPOS_RESERVABLES.has(cp.tipo)) throw new HttpsError("failed-precondition", "Esa actividad no se reserva.");
    if (noOperativo(cp)) throw new HttpsError("failed-precondition", "Esa charla fue cancelada.");
    const eventoSnap = await tx.get(db().collection("eventos").doc(cp.eventoId || "-"));
    if (!eventoSnap.exists || noOperativo(eventoSnap.data())) {
      throw new HttpsError("failed-precondition", "El evento de esa charla no está activo.");
    }
    if (yaEmpezo(cp)) throw new HttpsError("failed-precondition", "Esa charla ya empezó.");

    const choque = Object.entries(p.reservas || {}).find(([otro, r]) => otro !== checkpointId && seCruzan(r, cp));
    if (choque) {
      const otroSnap = await tx.get(db().collection("checkpoints").doc(choque[0]));
      const nombre = otroSnap.data()?.nombre || "otra charla";
      throw new HttpsError("failed-precondition",
          `Ya reservaste "${nombre}" a la misma hora. Quita esa reserva para elegir esta.`);
    }

    const salonSnap = cp.salonId ? await tx.get(db().collection("salones").doc(cp.salonId)) : null;
    const capacidad = capacidadDe(cp, salonSnap?.data());
    if (capacidad != null && reservados >= capacidad) {
      throw new HttpsError("resource-exhausted",
          "Ya se apartaron todos los asientos. Igual puedes llegar: se entra por orden de llegada si hay espacio.");
    }

    const nombre = p.nombreCompleto || `${p.nombre || ""} ${p.apellido || ""}`.trim() || null;
    tx.set(reservaRef, {
      checkpointId,
      eventoId: cp.eventoId || null,
      participanteId,
      participanteNombre: nombre,
      codigo: p.codigo || null,
      dia: cp.dia || null,
      horaInicio: cp.horaInicio || null,
      horaFin: cp.horaFin || null,
      salonId: cp.salonId || null,
      creadoEn: FieldValue.serverTimestamp(),
    });
    tx.set(conteoRef, {reservados: FieldValue.increment(1), checkpointId}, {merge: true});
    tx.update(participanteRef, {
      [`reservas.${checkpointId}`]: {
        dia: cp.dia || null,
        horaInicio: cp.horaInicio || null,
        horaFin: cp.horaFin || null,
        creadoEn: FieldValue.serverTimestamp(),
      },
    });
    return {reservado: true, reservados: reservados + 1};
  });

  return {checkpointId, ...resultado};
}

module.exports = {
  TIPOS_RESERVABLES,
  accederConCedula,
  capacidadDe,
  identificarParticipante,
  reservarCharla,
  seCruzan,
  variantesCedula,
  yaEmpezo,
};

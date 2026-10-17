"use strict";

// Perfil del personal (voluntarios y comité organizador), el equivalente a
// perfil.html de los participantes. El QR de su credencial abre
// public/perfil-personal.html?id=<doc de voluntarios>&t=<token>; el token
// vive en voluntarios/{id}.token, lo crea esta función (Admin SDK) y el
// cliente no puede cambiarlo (firestore.rules).

const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {usuarioPuede} = require("./permisos");
const {conAjustesDeRol} = require("./ajustes-rol");
const {normalizarCedula} = require("./registro-voluntarios");

const db = getFirestore();
// Debe reflejar "gestionar_credenciales" en js/core/permisos.js: quien
// imprime las credenciales es quien necesita los enlaces de perfil.
const ROLES_CREDENCIALES = new Set(["ceo"]);
const ID_VALIDO = /^[A-Za-z0-9_-]{1,200}$/;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{8,64}$/;

const nuevoToken = () => crypto.randomBytes(12).toString("base64url");

function mismoToken(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Crea el token a quien no lo tenga y devuelve los de todos:
// { tokens: { docId: token }, creados }.
async function asegurarTokensPersonal(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const snapUsuario = await db.collection("usuarios").doc(request.auth.uid).get();
  const usuario = await conAjustesDeRol(snapUsuario.exists ? snapUsuario.data() : null);
  if (!usuarioPuede(usuario, "gestionar_credenciales", ROLES_CREDENCIALES)) {
    throw new HttpsError("permission-denied", "No tienes permiso para generar credenciales.");
  }

  const snap = await db.collection("voluntarios").get();
  const tokens = {};
  const faltan = [];
  snap.docs.forEach((d) => {
    const token = d.data().token;
    if (typeof token === "string" && TOKEN_VALIDO.test(token)) tokens[d.id] = token;
    else faltan.push(d.ref);
  });
  for (let i = 0; i < faltan.length; i += 400) {
    const lote = db.batch();
    faltan.slice(i, i + 400).forEach((ref) => {
      const token = nuevoToken();
      tokens[ref.id] = token;
      lote.update(ref, {token, actualizadoEn: FieldValue.serverTimestamp()});
    });
    await lote.commit();
  }
  return {tokens, creados: faltan.length};
}

const ms = (ts) => ts?.toMillis?.() ?? null;

// Nombre de la actividad y del turno de cada asistencia: las de actividades
// de voluntariado y las del congreso (turnos_congreso + eventos).
async function historialDe(voluntarioId) {
  const snap = await db.collection("asistencias_voluntarios")
      .where("voluntarioId", "==", voluntarioId).get();
  const asistencias = snap.docs.map((d) => d.data());
  const refs = new Map();
  asistencias.forEach((a) => {
    if (!a.actividadId) return;
    if (a.origen === "congreso") {
      refs.set(`ev:${a.actividadId}`, db.collection("eventos").doc(a.actividadId));
      refs.set(`tc:${a.actividadId}`, db.collection("turnos_congreso").doc(a.actividadId));
    } else {
      refs.set(`ac:${a.actividadId}`, db.collection("actividades_voluntarios").doc(a.actividadId));
    }
  });
  const claves = [...refs.keys()];
  const docs = claves.length ? await db.getAll(...refs.values()) : [];
  const datos = new Map(claves.map((k, i) => [k, docs[i].exists ? docs[i].data() : null]));

  return asistencias.map((a) => {
    const congreso = a.origen === "congreso";
    const actividad = congreso ?
      datos.get(`ev:${a.actividadId}`) : datos.get(`ac:${a.actividadId}`);
    const conTurnos = congreso ? datos.get(`tc:${a.actividadId}`) : actividad;
    const turno = (conTurnos?.turnos || []).find((t) => String(t.id) === a.turnoId);
    return {
      actividad: actividad?.nombre || (congreso ? "Congreso" : "Actividad"),
      congreso,
      turno: turno?.nombre || "",
      horario: turno ? `${turno.horaInicio || ""}–${turno.horaFin || ""}` : "",
      dia: a.dia || turno?.dia || null,
      entrada: ms(a.horaEntrada),
      salida: ms(a.horaSalida),
      horas: typeof a.horasGanadas === "number" ? a.horasGanadas : null,
    };
  }).sort((x, y) => (y.entrada || 0) - (x.entrada || 0));
}

// Solo con la cédula (como el perfil de participantes): el documento del
// voluntario guarda su cédula normalizada en `id`. Si todavía no tiene token
// (la credencial no se ha impreso), se le crea para que su QR funcione.
async function perfilPorCedula(cedula) {
  const {ok, valor} = normalizarCedula(cedula);
  if (!ok) throw new HttpsError("invalid-argument", "Esa cédula no es válida. Escríbela como 8-123-4567.");
  const snap = await db.collection("voluntarios").where("id", "==", valor).limit(1).get();
  if (snap.empty) {
    throw new HttpsError("not-found", "No encontramos un voluntario con esa cédula. Escríbela como al registrarte.");
  }
  const d = snap.docs[0];
  let token = d.data().token;
  if (typeof token !== "string" || !TOKEN_VALIDO.test(token)) {
    token = nuevoToken();
    await d.ref.update({token, actualizadoEn: FieldValue.serverTimestamp()});
  }
  return {snap: d, id: d.id, token};
}

async function accederPersonal(request) {
  let snap;
  let id;
  let token;
  if (request.data?.cedula) {
    ({snap, id, token} = await perfilPorCedula(String(request.data.cedula).slice(0, 40)));
  } else {
    id = String(request.data?.id || "").trim();
    token = String(request.data?.token || "").trim();
    if (!ID_VALIDO.test(id) || !TOKEN_VALIDO.test(token)) {
      throw new HttpsError("invalid-argument", "El enlace del perfil no es válido.");
    }
    snap = await db.collection("voluntarios").doc(id).get();
    if (!snap.exists || !mismoToken(snap.data().token, token)) {
      throw new HttpsError("not-found", "No encontramos este perfil. Pide al equipo de CONTECS una credencial nueva.");
    }
  }
  const v = snap.data();
  return {
    docId: id,
    token,
    nombre: v.nombre || "",
    apellido: v.apellido || "",
    cedula: v.id || "",
    grupo: v.grupo === "comite" ? "comite" : "voluntario",
    carrera: v.carrera || "",
    facultad: v.facultad || "",
    centro: v.centro || "",
    totalHoras: Number(v.totalHoras || 0),
    historial: await historialDe(id),
  };
}

module.exports = {asegurarTokensPersonal, accederPersonal, historialDe};

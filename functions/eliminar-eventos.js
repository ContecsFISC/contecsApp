"use strict";

// Borrado definitivo de un evento o de un checkpoint desde Gestión de Evento,
// con todo su rastro. Existe para limpiar pruebas (un checkpoint de prueba
// deja asistencias que cuentan para certificados y ocupan asientos en el
// Mapa); el navegador no puede borrar asistencias_congreso ni
// inscripciones_checkpoint (firestore.rules), así que pasa por aquí.
//
// Qué se borra de un checkpoint:
//   - asistencias_congreso e inscripciones_checkpoint del checkpoint;
//   - la asistencia en el participante (asistencias.<id>), recalculando
//     totalAsistencias; si no le queda ninguna, se quita estado "presente";
//   - el checkpoint.
// De un evento: lo anterior para cada checkpoint, más lo que quede del evento
// en esas colecciones, sus inscripciones antiguas (colección `inscripciones`),
// los RFID anclados en ese evento (POSPER) y el evento.
//
// Dos pasos: primero `previsualizar` devuelve qué se borraría y la frase de
// confirmación; luego se llama con `confirmacion` igual a esa frase.

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {usuarioPuede} = require("./permisos");
const {conAjustesDeRol} = require("./ajustes-rol");

const db = getFirestore();

// Borrar algo vacío: quien edita eventos ("evento_editar", sub-permiso de
// "gestionar_inscripciones"; mismos roles que en js/core/permisos.js).
const ROLES_GESTION_EVENTO = new Set(["ceo", "staff_contecs"]);
// Borrar con asistencias o inscripciones: "eliminar_con_historial".
const ROLES_ELIMINAR_CON_HISTORIAL = new Set(["ceo"]);

const LIMITE_LOTE = 400;
const COLECCIONES_PARTICIPANTE = ["participantes", "inscripciones"];

function idValido(valor, campo) {
  const id = typeof valor === "string" ? valor.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    throw new HttpsError("invalid-argument", `${campo} no es válido.`);
  }
  return id;
}

// "Taller de Python 2" -> "taller_de_python_2": sin tildes ni espacios, para
// que se pueda escribir con cualquier teclado. Igual que aSlug() en el panel.
function slug(texto) {
  return String(texto || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
}

function fraseConfirmacion(nombre, id) {
  return `eliminar_${slug(nombre) || slug(id)}`;
}

async function docsDonde(coleccion, campo, valor) {
  const snap = await db.collection(coleccion).where(campo, "==", valor).get();
  return snap.docs;
}

async function enLotes(operaciones) {
  for (let i = 0; i < operaciones.length; i += LIMITE_LOTE) {
    const batch = db.batch();
    operaciones.slice(i, i + LIMITE_LOTE).forEach((op) => op(batch));
    await batch.commit();
  }
}

// Todo lo que cuelga de un checkpoint. `participantes` acumula
// "coleccion/id" -> Set de checkpoints a quitarle.
async function rastroCheckpoint(checkpointId, eventoId, rastro) {
  const [asistencias, talleres, ...conAsistencia] = await Promise.all([
    docsDonde("asistencias_congreso", "checkpointId", checkpointId),
    docsDonde("inscripciones_checkpoint", "checkpointId", checkpointId),
    // También quien tenga la asistencia en su documento sin registro central
    // (datos antiguos).
    ...COLECCIONES_PARTICIPANTE.map((col) => db.collection(col)
        .where(`asistencias.${checkpointId}.eventoId`, "==", eventoId).get()
        .then((s) => s.docs).catch(() => [])),
  ]);
  const marcar = (coleccion, id) => {
    if (!id) return;
    const clave = `${coleccion}/${id}`;
    if (!rastro.participantes.has(clave)) rastro.participantes.set(clave, new Set());
    rastro.participantes.get(clave).add(checkpointId);
  };
  asistencias.forEach((d) => {
    rastro.borrar.set(d.ref.path, d.ref);
    rastro.asistencias.add(d.ref.path);
    marcar(d.data().participanteColeccion || "participantes", d.data().participanteId);
  });
  talleres.forEach((d) => {
    rastro.borrar.set(d.ref.path, d.ref);
    rastro.talleres.add(d.ref.path);
    marcar(d.data().participanteColeccion || "participantes", d.data().participanteId);
  });
  conAsistencia.forEach((docs, i) => docs.forEach((d) => marcar(COLECCIONES_PARTICIPANTE[i], d.id)));
}

function rastroVacio() {
  return {
    borrar: new Map(), // path -> ref (asistencias, inscripciones, checkpoints, evento...)
    asistencias: new Set(),
    talleres: new Set(),
    participantes: new Map(),
    checkpoints: 0,
    inscripcionesEvento: 0,
    rfids: [], // participantes con RFID anclado en el evento
  };
}

async function rastroDeCheckpoint(checkpointId) {
  const snap = await db.collection("checkpoints").doc(checkpointId).get();
  if (!snap.exists) throw new HttpsError("not-found", "El checkpoint ya no existe.");
  const cp = snap.data();
  const rastro = rastroVacio();
  await rastroCheckpoint(checkpointId, cp.eventoId || null, rastro);
  rastro.borrar.set(snap.ref.path, snap.ref);
  rastro.checkpoints = 1;
  return {rastro, nombre: cp.nombre || "", id: checkpointId};
}

async function rastroDeEvento(eventoId) {
  const snap = await db.collection("eventos").doc(eventoId).get();
  if (!snap.exists) throw new HttpsError("not-found", "El evento ya no existe.");
  const rastro = rastroVacio();
  const checkpoints = await docsDonde("checkpoints", "eventoId", eventoId);
  for (const cp of checkpoints) {
    await rastroCheckpoint(cp.id, eventoId, rastro);
    rastro.borrar.set(cp.ref.path, cp.ref);
  }
  rastro.checkpoints = checkpoints.length;
  // Lo que quede del evento aunque su checkpoint ya no exista.
  const [asistencias, talleres, inscripciones, conRfid] = await Promise.all([
    docsDonde("asistencias_congreso", "eventoId", eventoId),
    docsDonde("inscripciones_checkpoint", "eventoId", eventoId),
    docsDonde("inscripciones", "eventoId", eventoId),
    docsDonde("participantes", "rfid.eventoId", eventoId),
  ]);
  asistencias.forEach((d) => {
    rastro.borrar.set(d.ref.path, d.ref);
    rastro.asistencias.add(d.ref.path);
    const {participanteColeccion: col = "participantes", participanteId: pid, checkpointId: cpId} = d.data();
    if (pid && cpId) {
      const clave = `${col}/${pid}`;
      if (!rastro.participantes.has(clave)) rastro.participantes.set(clave, new Set());
      rastro.participantes.get(clave).add(cpId);
    }
  });
  talleres.forEach((d) => {
    rastro.borrar.set(d.ref.path, d.ref);
    rastro.talleres.add(d.ref.path);
  });
  inscripciones.forEach((d) => {
    rastro.borrar.set(d.ref.path, d.ref);
    // Las inscripciones antiguas se borran enteras: no hace falta limpiarlas.
    rastro.participantes.delete(`inscripciones/${d.id}`);
  });
  rastro.inscripcionesEvento = inscripciones.length;
  rastro.rfids = conRfid;
  rastro.borrar.set(snap.ref.path, snap.ref);
  return {rastro, nombre: snap.data().nombre || "", id: eventoId};
}

function resumen(rastro) {
  return {
    checkpoints: rastro.checkpoints,
    asistencias: rastro.asistencias.size,
    inscripcionesTaller: rastro.talleres.size,
    participantesAfectados: [...rastro.participantes.keys()]
        .filter((k) => k.startsWith("participantes/")).length,
    inscripcionesEvento: rastro.inscripcionesEvento,
    rfids: rastro.rfids.length,
  };
}

const tieneHistorial = (r) => r.asistencias > 0 || r.inscripcionesTaller > 0 ||
  r.participantesAfectados > 0 || r.inscripcionesEvento > 0 || r.rfids > 0;

async function validarPermiso(request, conHistorial) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  const usuario = await conAjustesDeRol(snap.exists ? snap.data() : null);
  if (!usuarioPuede(usuario, "evento_editar", ROLES_GESTION_EVENTO)) {
    throw new HttpsError("permission-denied", "No tienes permiso para eliminar eventos ni checkpoints.");
  }
  if (conHistorial && !usuarioPuede(usuario, "eliminar_con_historial", ROLES_ELIMINAR_CON_HISTORIAL)) {
    throw new HttpsError("permission-denied",
        "Tiene asistencias o inscripciones registradas. Solo quien tiene el permiso " +
        "\"Eliminar con historial\" (por ahora el CEO) puede borrarlo.");
  }
  return request.auth.uid;
}

// Quita a cada participante las asistencias de los checkpoints borrados.
async function limpiarParticipantes(rastro) {
  const claves = [...rastro.participantes.keys()];
  const refs = claves.map((k) => db.doc(k));
  const snaps = refs.length ? await db.getAll(...refs) : [];
  const ops = [];
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const quitar = rastro.participantes.get(claves[i]);
    const asistencias = {...(snap.data().asistencias || {})};
    const cambios = {actualizadoEn: FieldValue.serverTimestamp()};
    quitar.forEach((cpId) => {
      if (cpId in asistencias) {
        delete asistencias[cpId];
        cambios[`asistencias.${cpId}`] = FieldValue.delete();
      }
    });
    const restantes = Object.keys(asistencias).length;
    cambios.totalAsistencias = restantes;
    if (!restantes && snap.data().estado === "presente") cambios.estado = FieldValue.delete();
    ops.push((batch) => batch.update(snap.ref, cambios));
  });
  await enLotes(ops);
}

// Suelta los RFID anclados en el evento: el lock y el dato del participante.
async function soltarRfids(rastro) {
  const ops = [];
  rastro.rfids.forEach((d) => {
    const rfid = d.data().rfid || {};
    if (rfid.lockId) {
      const lock = db.collection("rfid_participantes").doc(rfid.lockId);
      ops.push((batch) => batch.delete(lock));
    }
    ops.push((batch) => batch.update(d.ref, {rfid: FieldValue.delete(), actualizadoEn: FieldValue.serverTimestamp()}));
  });
  await enLotes(ops);
}

async function eliminarEventoOCheckpoint(request) {
  const data = request.data || {};
  const tipo = data.tipo === "evento" ? "evento" : data.tipo === "checkpoint" ? "checkpoint" : null;
  if (!tipo) throw new HttpsError("invalid-argument", "Indica si es un evento o un checkpoint.");
  const id = idValido(data.id, tipo === "evento" ? "El evento" : "El checkpoint");

  // Antes de leer nada, que al menos pueda editar eventos.
  await validarPermiso(request, false);
  const {rastro, nombre} = tipo === "evento" ? await rastroDeEvento(id) : await rastroDeCheckpoint(id);
  const conteo = resumen(rastro);
  const conHistorial = tieneHistorial(conteo);
  const frase = fraseConfirmacion(nombre, id);

  if (data.previsualizar === true) {
    let puedeConHistorial = true;
    try {
      await validarPermiso(request, conHistorial);
    } catch (e) {
      if (e.code !== "permission-denied") throw e;
      puedeConHistorial = false;
    }
    return {tipo, id, nombre, frase, conteo, conHistorial, puedeEliminar: puedeConHistorial};
  }

  const actor = await validarPermiso(request, conHistorial);
  if (String(data.confirmacion || "").trim().toLowerCase() !== frase) {
    throw new HttpsError("failed-precondition", `Para confirmar escribe exactamente: ${frase}`);
  }

  // Primero lo que cuelga, al final el checkpoint o el evento: si algo falla
  // a mitad, el documento principal sigue ahí y se puede reintentar.
  await limpiarParticipantes(rastro);
  if (tipo === "evento") await soltarRfids(rastro);
  const principal = tipo === "evento" ?
    db.collection("eventos").doc(id).path : db.collection("checkpoints").doc(id).path;
  const resto = [...rastro.borrar.values()].filter((ref) => ref.path !== principal);
  await enLotes(resto.map((ref) => (batch) => batch.delete(ref)));
  await db.doc(principal).delete();

  console.log("eliminarEventoOCheckpoint:", tipo, id, nombre, JSON.stringify(conteo), "por", actor);
  return {ok: true, tipo, id, conteo};
}

module.exports = {
  eliminarEventoOCheckpoint,
  fraseConfirmacion,
  slug,
  ROLES_ELIMINAR_CON_HISTORIAL,
};

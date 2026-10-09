"use strict";

// eliminarEventoOCheckpoint contra el emulador de Firestore: permisos, frase
// de confirmación y que no quede rastro (asistencias, inscripciones a
// talleres, asistencia en el participante, RFID) sin tocar lo de otros
// checkpoints. Un fallo aquí deja asistencias huérfanas que siguen contando
// para certificados, o borra asistencias que no tocaba.
//   npm run test:eliminar   (desde functions/)

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {eliminarEventoOCheckpoint, fraseConfirmacion} = require("../eliminar-eventos");

const como = (uid, data) => eliminarEventoOCheckpoint({auth: {uid}, data});
const existe = async (ruta) => (await db.doc(ruta).get()).exists;
const leer = async (ruta) => (await db.doc(ruta).get()).data();

let pasadas = 0;
async function prueba(nombre, fn) {
  await fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}
async function rechazaCon(promesa, codigo) {
  await assert.rejects(promesa, (e) => {
    assert.equal(e.code, codigo);
    return true;
  });
}

async function preparar() {
  const b = db.batch();
  const set = (ruta, datos) => b.set(db.doc(ruta), datos);
  set("usuarios/ceo", {rol: "ceo"});
  set("usuarios/staff", {rol: "staff_contecs"});
  set("usuarios/ventas", {rol: "ventas"});
  set("eventos/ev1", {nombre: "Congreso de Prueba"});
  set("eventos/ev2", {nombre: "Otro evento"});
  set("checkpoints/cp1", {nombre: "Taller de Python", eventoId: "ev1"});
  set("checkpoints/cp2", {nombre: "Checkpoint vacío", eventoId: "ev1"});
  set("checkpoints/cp3", {nombre: "Conferencia", eventoId: "ev1"});
  set("checkpoints/otro", {nombre: "De otro evento", eventoId: "ev2"});
  const asis = (cp, ev) => ({marcadoPor: "staff", checkpoint: cp, eventoId: ev});
  set("participantes/p1", {
    nombre: "Uno", estado: "presente", totalAsistencias: 3,
    asistencias: {cp1: asis("cp1", "ev1"), cp3: asis("cp3", "ev1"), otro: asis("otro", "ev2")},
    rfid: {lockId: "L1", serial: "ABC", eventoId: "ev1"},
  });
  set("participantes/p2", {nombre: "Dos", estado: "presente", totalAsistencias: 1, asistencias: {cp1: asis("cp1", "ev1")}});
  set("rfid_participantes/L1", {participanteId: "p1", eventoId: "ev1"});
  for (const [p, cp] of [["p1", "cp1"], ["p2", "cp1"], ["p1", "cp3"], ["p1", "otro"]]) {
    set(`asistencias_congreso/${cp}_participantes_${p}`, {
      checkpointId: cp, eventoId: cp === "otro" ? "ev2" : "ev1",
      participanteId: p, participanteColeccion: "participantes",
    });
  }
  set("inscripciones_checkpoint/cp1_participantes_p1", {
    checkpointId: "cp1", eventoId: "ev1", participanteId: "p1", participanteColeccion: "participantes",
  });
  set("inscripciones/i1", {nombre: "Antigua", eventoId: "ev1", asistencias: {cp3: asis("cp3", "ev1")}});
  await b.commit();
}

async function main() {
  await preparar();
  console.log("\neliminarEventoOCheckpoint:\n");

  await prueba("sin permiso de editar eventos no puede ni previsualizar", async () => {
    await rechazaCon(como("ventas", {tipo: "checkpoint", id: "cp2", previsualizar: true}), "permission-denied");
  });

  await prueba("la frase es eliminar_<nombre sin tildes ni espacios>", async () => {
    assert.equal(fraseConfirmacion("Taller de Pythón 2", "x"), "eliminar_taller_de_python_2");
    assert.equal(fraseConfirmacion("", "cp9"), "eliminar_cp9");
  });

  await prueba("staff borra un checkpoint vacío con la frase", async () => {
    const prev = await como("staff", {tipo: "checkpoint", id: "cp2", previsualizar: true});
    assert.equal(prev.conHistorial, false);
    assert.equal(prev.puedeEliminar, true);
    assert.equal(prev.frase, "eliminar_checkpoint_vacio");
    await como("staff", {tipo: "checkpoint", id: "cp2", confirmacion: prev.frase});
    assert.equal(await existe("checkpoints/cp2"), false);
  });

  await prueba("con historial, staff ve el conteo pero no puede borrar", async () => {
    const prev = await como("staff", {tipo: "checkpoint", id: "cp1", previsualizar: true});
    assert.equal(prev.conHistorial, true);
    assert.equal(prev.puedeEliminar, false);
    assert.deepEqual(prev.conteo, {
      checkpoints: 1, asistencias: 2, inscripcionesTaller: 1,
      participantesAfectados: 2, inscripcionesEvento: 0, rfids: 0,
    });
    await rechazaCon(como("staff", {tipo: "checkpoint", id: "cp1", confirmacion: prev.frase}), "permission-denied");
    assert.equal(await existe("checkpoints/cp1"), true);
  });

  await prueba("una frase equivocada no borra nada", async () => {
    await rechazaCon(como("ceo", {tipo: "checkpoint", id: "cp1", confirmacion: "eliminar_otro"}), "failed-precondition");
    assert.equal(await existe("checkpoints/cp1"), true);
    assert.equal(await existe("asistencias_congreso/cp1_participantes_p1"), true);
  });

  await prueba("el CEO borra el checkpoint con todo su rastro y nada más", async () => {
    await como("ceo", {tipo: "checkpoint", id: "cp1", confirmacion: "eliminar_taller_de_python"});
    assert.equal(await existe("checkpoints/cp1"), false);
    assert.equal(await existe("asistencias_congreso/cp1_participantes_p1"), false);
    assert.equal(await existe("asistencias_congreso/cp1_participantes_p2"), false);
    assert.equal(await existe("inscripciones_checkpoint/cp1_participantes_p1"), false);
    const p1 = await leer("participantes/p1");
    assert.deepEqual(Object.keys(p1.asistencias).sort(), ["cp3", "otro"]);
    assert.equal(p1.totalAsistencias, 2);
    assert.equal(p1.estado, "presente");
    const p2 = await leer("participantes/p2");
    assert.deepEqual(p2.asistencias, {});
    assert.equal(p2.totalAsistencias, 0);
    assert.equal(p2.estado, undefined);
    // Lo de otros checkpoints sigue intacto.
    assert.equal(await existe("asistencias_congreso/cp3_participantes_p1"), true);
  });

  await prueba("el CEO borra el evento: checkpoints, asistencias, inscripciones antiguas y RFID", async () => {
    const prev = await como("ceo", {tipo: "evento", id: "ev1", previsualizar: true});
    assert.equal(prev.frase, "eliminar_congreso_de_prueba");
    assert.equal(prev.conteo.checkpoints, 1);
    assert.equal(prev.conteo.inscripcionesEvento, 1);
    assert.equal(prev.conteo.rfids, 1);
    await como("ceo", {tipo: "evento", id: "ev1", confirmacion: prev.frase});
    assert.equal(await existe("eventos/ev1"), false);
    assert.equal(await existe("checkpoints/cp3"), false);
    assert.equal(await existe("asistencias_congreso/cp3_participantes_p1"), false);
    assert.equal(await existe("inscripciones/i1"), false);
    assert.equal(await existe("rfid_participantes/L1"), false);
    const p1 = await leer("participantes/p1");
    assert.equal(p1.rfid, undefined);
    assert.deepEqual(Object.keys(p1.asistencias), ["otro"]);
    assert.equal(p1.totalAsistencias, 1);
    // El otro evento no se toca.
    assert.equal(await existe("eventos/ev2"), true);
    assert.equal(await existe("checkpoints/otro"), true);
    assert.equal(await existe("asistencias_congreso/otro_participantes_p1"), true);
  });

  await prueba("algo que ya no existe responde not-found", async () => {
    await rechazaCon(como("ceo", {tipo: "evento", id: "ev1", previsualizar: true}), "not-found");
  });

  console.log(`\n${pasadas} pruebas pasaron.\n`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});

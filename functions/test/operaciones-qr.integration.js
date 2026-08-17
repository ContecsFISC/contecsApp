"use strict";

const assert = require("node:assert/strict");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({projectId: "contecs-fa6e6"});
const db = getFirestore();
const {ejecutarOperacionQr} = require("../operaciones-qr");

const request = (data) => ({auth: {uid: "staff-prueba"}, data});
const participante = (nombre, pago = "aprobado") => ({
  nombreCompleto: nombre,
  correo: `${nombre.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  cedula: `TEST-${nombre}`,
  codigo: `QR-${nombre}`,
  pago: {estado: pago},
  asistencias: {},
  totalAsistencias: 0,
});

async function rechazaCon(promesa, codigo) {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.code, codigo);
    return true;
  });
}

async function prepararDatos() {
  const batch = db.batch();
  batch.set(db.collection("usuarios").doc("staff-prueba"), {
    rol: "staff_contecs",
  });
  batch.set(db.collection("eventos").doc("evento-prueba"), {
    nombre: "Congreso de prueba",
    activo: true,
  });
  batch.set(db.collection("eventos").doc("evento-ajeno"), {
    nombre: "Otro evento",
    activo: true,
  });
  batch.set(db.collection("checkpoints").doc("acceso-prueba"), {
    eventoId: "evento-prueba",
    eventoNombre: "Congreso de prueba",
    nombre: "Entrada general",
    tipo: "congreso",
  });
  batch.set(db.collection("checkpoints").doc("taller-prueba"), {
    eventoId: "evento-prueba",
    eventoNombre: "Congreso de prueba",
    nombre: "Workshop de prueba",
    tipo: "workshop",
    cupos: 2,
    cuposDisponibles: 2,
  });
  batch.set(db.collection("checkpoints").doc("ultimo-cupo"), {
    eventoId: "evento-prueba",
    eventoNombre: "Congreso de prueba",
    nombre: "Último cupo",
    tipo: "taller",
    cupos: 1,
    cuposDisponibles: 1,
  });
  batch.set(db.collection("participantes").doc("participante-uno"),
      participante("Participante Uno"));
  batch.set(db.collection("participantes").doc("pago-pendiente"),
      participante("Pago Pendiente", "comprobante_enviado"));
  batch.set(db.collection("participantes").doc("concurrente-uno"),
      participante("Concurrente Uno"));
  batch.set(db.collection("participantes").doc("concurrente-dos"),
      participante("Concurrente Dos"));
  batch.set(db.collection("inscripciones").doc("legacy-uno"), {
    nombre: "Participante Legacy",
    eventoId: "evento-prueba",
    asistencias: {},
    totalAsistencias: 0,
  });
  await batch.commit();
}

async function probarEntradaGeneral() {
  const datos = {
    tipo: "asistencia_participante",
    participanteId: "participante-uno",
    checkpointId: "acceso-prueba",
    eventoId: "evento-prueba",
    coleccion: "participantes",
  };
  const resultado = await ejecutarOperacionQr(request(datos));
  assert.equal(resultado.ok, true);
  assert.equal(resultado.totalAsistencias, 1);

  const [pSnap, asistenciaSnap] = await Promise.all([
    db.collection("participantes").doc("participante-uno").get(),
    db.collection("asistencias_congreso")
        .doc("acceso-prueba_participantes_participante-uno").get(),
  ]);
  assert.ok(pSnap.data().asistencias["acceso-prueba"]);
  assert.equal(asistenciaSnap.data().eventoId, "evento-prueba");
  assert.equal(asistenciaSnap.data().checkpointTipo, "congreso");

  await rechazaCon(ejecutarOperacionQr(request(datos)), "already-exists");
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos,
    participanteId: "pago-pendiente",
  })), "failed-precondition");
  await rechazaCon(ejecutarOperacionQr(request({
    ...datos,
    eventoId: "evento-ajeno",
  })), "failed-precondition");
}

async function probarTallerConAsistencia() {
  const datos = {
    tipo: "inscripcion_taller",
    participanteId: "legacy-uno",
    checkpointId: "taller-prueba",
    eventoId: "evento-prueba",
    coleccion: "inscripciones",
  };
  const resultado = await ejecutarOperacionQr(request(datos));
  assert.equal(resultado.cuposDisponibles, 1);
  assert.equal(resultado.totalAsistencias, 1);

  const [cpSnap, pSnap, inscripcionSnap, asistenciaSnap] = await Promise.all([
    db.collection("checkpoints").doc("taller-prueba").get(),
    db.collection("inscripciones").doc("legacy-uno").get(),
    db.collection("inscripciones_checkpoint")
        .doc("taller-prueba_inscripciones_legacy-uno").get(),
    db.collection("asistencias_congreso")
        .doc("taller-prueba_inscripciones_legacy-uno").get(),
  ]);
  assert.equal(cpSnap.data().cuposDisponibles, 1);
  assert.ok(pSnap.data().asistencias["taller-prueba"]);
  assert.equal(inscripcionSnap.data().participanteColeccion, "inscripciones");
  assert.equal(asistenciaSnap.data().checkpointTipo, "workshop");

  await rechazaCon(ejecutarOperacionQr(request(datos)), "already-exists");
}

async function probarUltimoCupoConcurrente() {
  const base = {
    tipo: "inscripcion_taller",
    checkpointId: "ultimo-cupo",
    eventoId: "evento-prueba",
    coleccion: "participantes",
  };
  const resultados = await Promise.allSettled([
    ejecutarOperacionQr(request({...base, participanteId: "concurrente-uno"})),
    ejecutarOperacionQr(request({...base, participanteId: "concurrente-dos"})),
  ]);
  assert.equal(resultados.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(resultados.filter((r) => r.status === "rejected").length, 1);
  assert.equal(resultados.find((r) => r.status === "rejected").reason.code,
      "resource-exhausted");
  const cpSnap = await db.collection("checkpoints").doc("ultimo-cupo").get();
  assert.equal(cpSnap.data().cuposDisponibles, 0);
}

async function main() {
  await prepararDatos();
  await probarEntradaGeneral();
  await probarTallerConAsistencia();
  await probarUltimoCupoConcurrente();
  console.log("Integración QR: 13 comprobaciones críticas superadas.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

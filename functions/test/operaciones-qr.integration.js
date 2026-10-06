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

// POSPER: el RFID queda en el participante, el mismo RFID no puede quedar en
// dos personas y anclar otro reemplaza (y libera) el anterior.
async function probarAnclarRfid() {
  const base = {tipo: "anclar_rfid", eventoId: "evento-prueba"};
  const rfidA = "e2:80:11:60:60:00:02:0a:3b:4c:3f:1a";
  const rfidB = "E2801160600002FFFFFF9999";

  const r1 = await ejecutarOperacionQr(request({
    ...base, participanteId: "participante-uno", rfid: rfidA,
  }));
  assert.equal(r1.serial, "E280...3F1A");
  assert.equal(r1.reemplazado, false);
  const p1 = await db.collection("participantes").doc("participante-uno").get();
  assert.equal(p1.data().rfid.serial, "E280...3F1A");
  assert.equal(p1.data().rfid.eventoId, "evento-prueba");
  const lockA = p1.data().rfid.lockId;

  await rechazaCon(ejecutarOperacionQr(request({
    ...base, participanteId: "concurrente-uno", rfid: "E28011606000020A3B4C3F1A",
  })), "already-exists");
  await rechazaCon(ejecutarOperacionQr(request({
    ...base, participanteId: "pago-pendiente", rfid: rfidB,
  })), "failed-precondition");
  await rechazaCon(ejecutarOperacionQr(request({
    ...base, participanteId: "participante-uno", rfid: "https://x.test/?c=A&t=B",
  })), "invalid-argument");

  const r2 = await ejecutarOperacionQr(request({
    ...base, participanteId: "participante-uno", rfid: rfidB,
  }));
  assert.equal(r2.reemplazado, true);
  const viejo = await db.collection("rfid_participantes").doc(lockA).get();
  assert.equal(viejo.exists, false);
  // El RFID liberado ya lo puede usar otra persona.
  const r3 = await ejecutarOperacionQr(request({
    ...base, participanteId: "concurrente-uno", rfid: rfidA,
  }));
  assert.equal(r3.serial, "E280...3F1A");
}

async function main() {
  await prepararDatos();
  await probarEntradaGeneral();
  await probarTallerConAsistencia();
  await probarUltimoCupoConcurrente();
  await probarAnclarRfid();
  console.log("Integración QR: 23 comprobaciones críticas superadas.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

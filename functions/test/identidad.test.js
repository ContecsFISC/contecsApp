"use strict";

// Prueba de la decisión que hace crearParticipantesUnicos sobre los documentos
// de `identificadores_participantes`. Es la parte delicada del arreglo: un lock
// solo debe bloquear un registro nuevo mientras el participante al que apunta
// siga existiendo. Si no, es un huérfano y hay que dejarlo pasar — de lo
// contrario esa cédula y ese correo quedan quemados para siempre, sin que
// nadie pueda verlo (la colección es `read, write: if false`).
//
// No necesita emulador: locksQueBloquean es pura.
//   node functions/test/identidad.test.js

const assert = require("node:assert/strict");
const {locksQueBloquean} = require("../identidad");

const lock = (campo, valor, participanteId) => ({
  lock: {campo, valor, ref: {path: `identificadores_participantes/${campo}_x`}},
  participanteId,
});

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\nlocksQueBloquean:\n");

prueba("sin locks ocupados, nada bloquea", () => {
  assert.deepEqual(locksQueBloquean([], new Set()), []);
});

prueba("lock que apunta a un participante VIVO sí bloquea", () => {
  const ocupados = [lock("correo", "ana@utp.ac.pa", "c_8_111_1111")];
  const r = locksQueBloquean(ocupados, new Set(["c_8_111_1111"]));
  assert.equal(r.length, 1);
  assert.equal(r[0].lock.campo, "correo");
});

prueba("lock HUÉRFANO (participante borrado) NO bloquea", () => {
  const ocupados = [lock("cedula", "8-999-9999", "c_8_999_9999")];
  // El participante ya no existe: el Set de vivos está vacío.
  assert.deepEqual(locksQueBloquean(ocupados, new Set()), []);
});

prueba("lock sin participanteId NO bloquea", () => {
  const ocupados = [lock("correo", "x@utp.ac.pa", null)];
  assert.deepEqual(locksQueBloquean(ocupados, new Set(["lo-que-sea"])), []);
});

prueba("con locks mixtos, solo bloquea el vivo y reporta su campo", () => {
  const ocupados = [
    lock("correo", "huerfano@utp.ac.pa", "c_borrado"),
    lock("cedula", "8-222-2222", "c_8_222_2222"),
  ];
  const r = locksQueBloquean(ocupados, new Set(["c_8_222_2222"]));
  assert.equal(r.length, 1);
  assert.equal(r[0].lock.campo, "cedula");
  assert.equal(r[0].lock.valor, "8-222-2222");
});

prueba("el orden de los snapshots no altera el resultado", () => {
  const ocupados = [
    lock("cedula", "8-333-3333", "c_vivo"),
    lock("correo", "b@utp.ac.pa", "c_muerto"),
  ];
  const alReves = [...ocupados].reverse();
  const vivos = new Set(["c_vivo"]);
  assert.equal(locksQueBloquean(ocupados, vivos).length, 1);
  assert.equal(locksQueBloquean(alReves, vivos).length, 1);
  assert.equal(locksQueBloquean(alReves, vivos)[0].lock.valor, "8-333-3333");
});

console.log(`\n${pasadas} pruebas OK\n`);

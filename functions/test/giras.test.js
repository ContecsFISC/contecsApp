"use strict";

// Prueba del emparejamiento persona -> motivo en el aviso de no seleccionados.
// Es la parte donde un fallo no se nota: no rompe nada, simplemente le llega a
// alguien el motivo de otra persona ("no pagaste el seguro" a quien sí lo pagó).
//
//   node functions/test/giras.test.js

const assert = require("node:assert/strict");
const {motivoDeEntrada, motivosCrudosDeGira} = require("../giras");

const mapa = (...ms) => new Map(ms.map((m) => [m.id, m]));
const CUPO = {id: "m1", titulo: "Cupo lleno", mensaje: "No hubo espacio."};
const PAGO = {id: "m2", titulo: "Pago sin aprobar", mensaje: "Falta el pago."};
const SEGURO = {id: "m3", titulo: "Seguro pendiente", mensaje: "Falta el seguro."};

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\nmotivoDeEntrada:\n");

prueba("cada persona recibe SU motivo, no el de otra", () => {
  const motivos = mapa(CUPO, PAGO, SEGURO);
  assert.equal(motivoDeEntrada({id: "a", motivoId: "m2"}, motivos).titulo, "Pago sin aprobar");
  assert.equal(motivoDeEntrada({id: "b", motivoId: "m3"}, motivos).titulo, "Seguro pendiente");
  assert.equal(motivoDeEntrada({correo: "x@y.com", motivoId: "m1"}, motivos).titulo, "Cupo lleno");
});

prueba("sin motivo y con VARIOS definidos, no recibe nada", () => {
  // Mandarle uno al azar sería peor que no mandarle: le llegaría una razón
  // que no es la suya.
  const motivos = mapa(CUPO, PAGO);
  assert.equal(motivoDeEntrada({id: "a"}, motivos), null);
  assert.equal(motivoDeEntrada({id: "a", motivoId: ""}, motivos), null);
});

prueba("sin motivo y con UNO solo, se asume ese", () => {
  // Es el caso de las giras migradas del formato anterior.
  const motivos = mapa(CUPO);
  assert.equal(motivoDeEntrada({id: "a"}, motivos).titulo, "Cupo lleno");
});

prueba("motivoId que ya no existe (motivo borrado) no recibe nada", () => {
  const motivos = mapa(CUPO, PAGO);
  assert.equal(motivoDeEntrada({id: "a", motivoId: "borrado"}, motivos), null);
});

prueba("motivoId inexistente NO cae al único motivo", () => {
  // Si apuntaba a un motivo que se borró, no debe heredar el que quede.
  const motivos = mapa(CUPO);
  assert.equal(motivoDeEntrada({id: "a", motivoId: "m9"}, motivos), null);
});

prueba("sin motivos definidos, nadie recibe nada", () => {
  assert.equal(motivoDeEntrada({id: "a", motivoId: "m1"}, new Map()), null);
  assert.equal(motivoDeEntrada({id: "a"}, new Map()), null);
});

console.log("\nmotivosCrudosDeGira (migración del formato anterior):\n");

prueba("formato nuevo se devuelve tal cual", () => {
  const gira = {motivosAviso: [CUPO, PAGO]};
  assert.deepEqual(motivosCrudosDeGira(gira).map((m) => m.id), ["m1", "m2"]);
});

prueba("formato anterior se convierte en un motivo 'principal'", () => {
  const gira = {
    motivoNoSeleccionados: "Cupo lleno",
    mensajeNoSeleccionados: "No hubo espacio.",
  };
  const r = motivosCrudosDeGira(gira);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "principal");
  assert.equal(r[0].titulo, "Cupo lleno");
  assert.equal(r[0].mensaje, "No hubo espacio.");
});

prueba("una gira migrada envía a sus entradas sin motivoId", () => {
  // Combinación real: documento viejo + entradas viejas sin `motivoId`.
  const gira = {
    motivoNoSeleccionados: "Cupo lleno",
    mensajeNoSeleccionados: "No hubo espacio.",
    noSeleccionados: [{id: "a"}, {correo: "b@c.com"}],
  };
  const motivos = new Map(motivosCrudosDeGira(gira).map((m) => [m.id, m]));
  gira.noSeleccionados.forEach((p) => {
    assert.equal(motivoDeEntrada(p, motivos).titulo, "Cupo lleno");
  });
});

prueba("el formato nuevo gana sobre el anterior si coexisten", () => {
  const gira = {
    motivosAviso: [PAGO],
    motivoNoSeleccionados: "Viejo",
    mensajeNoSeleccionados: "Texto viejo",
  };
  assert.deepEqual(motivosCrudosDeGira(gira).map((m) => m.titulo), ["Pago sin aprobar"]);
});

prueba("motivos sin id se descartan", () => {
  const gira = {motivosAviso: [{titulo: "x", mensaje: "y"}, CUPO]};
  assert.deepEqual(motivosCrudosDeGira(gira).map((m) => m.id), ["m1"]);
});

prueba("gira sin nada devuelve lista vacía", () => {
  assert.deepEqual(motivosCrudosDeGira({}), []);
  assert.deepEqual(motivosCrudosDeGira(null), []);
});

console.log(`\n${pasadas} pruebas OK\n`);

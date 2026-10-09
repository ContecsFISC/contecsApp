// Prueba de los choques de horario por salón (Gestión de Eventos no deja
// crear un checkpoint en un salón ocupado). Un fallo aquí no rompe nada a la
// vista: dos actividades quedan en el mismo salón a la misma hora.
//
// Importa el código REAL (js/core/agenda-salones.js).
//
//   node functions/test/agenda-salones.test.mjs

import assert from "node:assert/strict";
import {
  buscarChoques,
  describirChoque,
  salonDeCheckpoint,
  etiquetaSalon,
} from "../../js/core/agenda-salones.js";

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const DIA = "2026-10-19";
const salones = {
  "3-73": { nombre: "Auditorio menor", rotulo: "3-301", capacidad: 80 },
  "2-82": { nombre: "Laboratorio 2", rotulo: "2-210", capacidad: 30 },
};
const cp = (id, salonId, horaInicio, horaFin, extra = {}) =>
  ({ id, salonId, dia: DIA, horaInicio, horaFin, nombre: `Actividad ${id}`, eventoNombre: "CONTECS 2026", ...extra });

const existentes = [
  cp("a", "3-73", "09:00", "11:00"),
  cp("b", "2-82", "09:00", "11:00"),
  cp("cancelada", "3-73", "13:00", "14:00", { estado: "cancelado" }),
  cp("pausada", "3-73", "15:00", "16:00", { activo: false }),
];

console.log("\nchoques de horario:\n");

prueba("mismo salón y horas que se cruzan: choca", () => {
  const choques = buscarChoques(cp("n", "3-73", "10:30", "12:00"), existentes, salones);
  assert.deepEqual(choques.map(c => c.id), ["a"]);
});

prueba("una actividad dentro de otra también choca", () => {
  assert.equal(buscarChoques(cp("n", "3-73", "09:30", "10:00"), existentes, salones).length, 1);
});

prueba("terminar a las 11:00 y empezar a las 11:00 no choca", () => {
  assert.equal(buscarChoques(cp("n", "3-73", "11:00", "12:00"), existentes, salones).length, 0);
});

prueba("otro salón u otro día no choca", () => {
  assert.equal(buscarChoques(cp("n", "2-90", "09:00", "11:00"), existentes, salones).length, 0);
  assert.equal(buscarChoques(cp("n", "3-73", "09:00", "11:00", { dia: "2026-10-20" }), existentes, salones).length, 0);
});

prueba("lo cancelado libera el salón; lo desactivado no", () => {
  assert.equal(buscarChoques(cp("n", "3-73", "13:00", "14:00"), existentes, salones).length, 0);
  assert.equal(buscarChoques(cp("n", "3-73", "15:30", "16:30"), existentes, salones).length, 1);
});

prueba("al editar, no choca consigo mismo", () => {
  assert.equal(buscarChoques(cp("a", "3-73", "09:00", "11:30"), existentes, salones).length, 0);
});

prueba("checkpoints de antes (solo texto) se reconocen por nombre o rótulo", () => {
  assert.equal(salonDeCheckpoint({ salon: "  auditorio MENOR " }, salones), "3-73");
  assert.equal(salonDeCheckpoint({ salon: "3-301" }, salones), "3-73");
  const viejo = { id: "v", salon: "Auditorio menor", dia: DIA, horaInicio: "10:00", horaFin: "10:30" };
  assert.equal(buscarChoques(viejo, existentes, salones).length, 1);
});

prueba("\"otro lugar\" escrito a mano choca con el mismo texto", () => {
  const otros = [{ id: "x", salon: "Cancha techada", dia: DIA, horaInicio: "08:00", horaFin: "09:00" }];
  assert.equal(buscarChoques({ salon: "cancha  techada", dia: DIA, horaInicio: "08:30", horaFin: "09:30" }, otros, salones).length, 1);
});

prueba("sin horario ocupa el día completo", () => {
  assert.equal(buscarChoques(cp("n", "3-73", "", ""), existentes, salones).length, 2);
});

prueba("el mensaje dice con qué choca, cuándo y dónde", () => {
  const msg = describirChoque(existentes[0], salones);
  assert.match(msg, /Actividad a/);
  assert.match(msg, /CONTECS 2026/);
  assert.match(msg, /09:00 a 11:00/);
  assert.match(msg, /3-301 · Auditorio menor · 80 personas/);
});

prueba("etiqueta sin datos configurados usa el número del plano", () => {
  assert.equal(etiquetaSalon("2-75", undefined), "75 · Salón 75");
});

console.log(`\n${pasadas} pruebas de salones superadas.\n`);

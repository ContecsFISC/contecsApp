// Prueba de la lógica pura de reservas de charlas (functions/charlas.js):
// cédulas escritas de otra forma, choques de horario, capacidad y cierre.
//   node functions/test/charlas.test.js

const assert = require("node:assert/strict");
const {variantesCedula, seCruzan, capacidadDe, yaEmpezo} = require("../charlas");

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

console.log("\nCédula:\n");

prueba("se prueba tal cual, en mayúsculas y sin ceros de relleno", () => {
  const v = variantesCedula(" 8-0123-0456 ");
  assert.ok(v.includes("8-0123-0456"));
  assert.ok(v.includes("8-123-456"));
  assert.ok(v.length <= 10);
});

prueba("pasaporte y letras: mayúsculas y minúsculas", () => {
  const v = variantesCedula("pe-12-345");
  assert.ok(v.includes("PE-12-345"));
  assert.ok(v.includes("pe-12-345"));
});

prueba("vacía no genera nada", () => {
  assert.deepEqual(variantesCedula("   "), []);
});

console.log("\nHorarios:\n");

const cp = (dia, horaInicio, horaFin) => ({dia, horaInicio, horaFin});

prueba("dos charlas a la misma hora chocan; seguidas no", () => {
  assert.equal(seCruzan(cp("2026-10-20", "09:00", "10:00"), cp("2026-10-20", "09:30", "10:30")), true);
  assert.equal(seCruzan(cp("2026-10-20", "09:00", "10:00"), cp("2026-10-20", "10:00", "11:00")), false);
  assert.equal(seCruzan(cp("2026-10-20", "09:00", "10:00"), cp("2026-10-21", "09:00", "10:00")), false);
});

prueba("sin horario no se considera choque", () => {
  assert.equal(seCruzan(cp("2026-10-20", "", ""), cp("2026-10-20", "09:00", "10:00")), false);
});

prueba("se cierra al empezar (hora de Panamá, UTC-5)", () => {
  // 2026-10-20 09:00 en Panamá = 14:00 UTC
  const nueve = Date.UTC(2026, 9, 20, 14, 0, 0);
  assert.equal(yaEmpezo(cp("2026-10-20", "09:00", "10:00"), nueve - 60000), false);
  assert.equal(yaEmpezo(cp("2026-10-20", "09:00", "10:00"), nueve), true);
  assert.equal(yaEmpezo(cp("2026-10-19", "09:00", "10:00"), nueve), true);
  assert.equal(yaEmpezo(cp("2026-10-21", "09:00", "10:00"), nueve), false);
});

console.log("\nCapacidad:\n");

prueba("cupos del taller, si no la capacidad del salón, si no sin tope", () => {
  assert.equal(capacidadDe({cupos: 30}, {capacidad: 80}), 30);
  assert.equal(capacidadDe({}, {capacidad: 80}), 80);
  assert.equal(capacidadDe({}, null), null);
  assert.equal(capacidadDe({cupos: 0}, {capacidad: 0}), null);
});

console.log(`\n${pasadas} pruebas pasaron.\n`);

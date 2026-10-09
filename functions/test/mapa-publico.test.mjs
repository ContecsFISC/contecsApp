// El mapa público cuenta los asientos ocupados en el servidor
// (functions/mapa-publico.js) con una copia de ocupacionActual() del panel
// (js/core/permanencia.js). Si se separan, el mapa público y el del staff
// muestran asientos distintos sin ningún error visible. Aquí se comparan.
//   node functions/test/mapa-publico.test.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ocupacionActual } from "../../js/core/permanencia.js";

const require = createRequire(import.meta.url);
// mapa-publico.js pide Firestore al cargarse: se le da uno falso.
require.cache[require.resolve("firebase-admin/firestore")] = {
  exports: { getFirestore: () => ({}), FieldValue: {} },
};
const { contarOcupacion } = require("../mapa-publico.js");

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const comparar = (asistencias, checkpoints, ahora) => {
  const panel = Object.fromEntries([...ocupacionActual(asistencias, checkpoints, ahora)].map(([k, v]) => [k, v.length]));
  assert.deepEqual(contarOcupacion(asistencias, checkpoints, ahora), panel);
};

console.log("\nOcupación del mapa público:\n");

prueba("casos a mano: cambio de salón, salida y acceso general", () => {
  const cps = [{ id: "a", tipo: "conferencia" }, { id: "b", tipo: "taller" }, { id: "acceso", tipo: "congreso" }];
  const t = 1_000_000;
  const asis = [
    { checkpointId: "acceso", participanteId: "p1", marcadoEn: t },
    { checkpointId: "a", participanteId: "p1", marcadoEn: t + 10 },
    { checkpointId: "b", participanteId: "p1", marcadoEn: t + 20 }, // dejó "a"
    { checkpointId: "a", participanteId: "p2", marcadoEn: t + 5 },
    { checkpointId: "a", participanteId: "p3", marcadoEn: t + 5, salidaEn: t + 15 }, // liberado
    { checkpointId: "a", participanteId: "p4", marcadoEn: t + 999 }, // en el futuro
  ];
  assert.deepEqual(contarOcupacion(asis, cps, t + 100), { acceso: 1, b: 1, a: 1 });
  comparar(asis, cps, t + 100);
});

prueba("2000 casos aleatorios: igual que el panel", () => {
  let semilla = 7;
  const azar = n => { semilla = (semilla * 1103515245 + 12345) % 2 ** 31; return semilla % n; };
  const tipos = ["conferencia", "taller", "congreso", "panel"];
  for (let caso = 0; caso < 2000; caso++) {
    const cps = Array.from({ length: 1 + azar(4) }, (_, i) => ({ id: `c${i}`, tipo: tipos[azar(4)] }));
    const asis = Array.from({ length: azar(12) }, () => {
      const marcado = 1000 + azar(100);
      return {
        checkpointId: `c${azar(cps.length + 1)}`, // a veces uno que no está en la lista
        participanteId: `p${azar(4)}`,
        participanteColeccion: azar(5) === 0 ? "inscripciones" : undefined,
        marcadoEn: azar(10) === 0 ? { seconds: marcado / 1000 } : marcado,
        salidaEn: azar(4) === 0 ? marcado + azar(60) : undefined,
      };
    });
    comparar(asis, cps, 1000 + azar(120));
  }
});

console.log(`\n${pasadas} pruebas pasaron.\n`);

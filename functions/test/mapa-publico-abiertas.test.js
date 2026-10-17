// El mapa público ya no lee todas las entradas del día: solo las de las
// actividades abiertas y las posteriores a su apertura (functions/mapa-publico.js,
// ocupacionDeAbiertas). Aquí se comprueba con datos al azar que da los mismos
// asientos que contar con TODAS las entradas, como antes.
//   node functions/test/mapa-publico-abiertas.test.js

const assert = require("node:assert/strict");

// Firestore falso en memoria: collection(x).where(campo, op, valor).get().
let filas = [];
const valorDe = (obj, campo) => campo.split(".").reduce((o, k) => o?.[k], obj);
const fakeDb = {
  collection: () => ({
    where: (campo, op, valor) => ({
      get: async () => {
        const docs = filas.filter((f) => {
          const v = valorDe(f.datos, campo);
          if (op === "in") return valor.includes(v);
          if (op === ">=") return (v instanceof Date ? v.getTime() : v) >= (valor instanceof Date ? valor.getTime() : valor);
          return v === valor;
        });
        return {docs: docs.map((f) => ({id: f.id, data: () => f.datos}))};
      },
    }),
  }),
};
require.cache[require.resolve("firebase-admin/firestore")] = {
  exports: {getFirestore: () => fakeDb, FieldValue: {}},
};
const {contarOcupacion, ocupacionDeAbiertas} = require("../mapa-publico.js");

let pasadas = 0;
async function prueba(nombre, fn) {
  await fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const OFFSET = 5 * 3600 * 1000;
const HOY = "2026-10-19";
const ms = (h, m = 0) => Date.UTC(2026, 9, 19, h, m) + OFFSET;
const hhmm = (h, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

(async () => {
  console.log("\nMapa público: ocupación con la consulta reducida\n");

  await prueba("100 jornadas al azar dan los mismos asientos que leer todo el día", async () => {
    let semilla = 7;
    const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
    for (let caso = 0; caso < 100; caso++) {
      const checkpoints = [
        {id: "acceso", tipo: "congreso", dia: HOY, horaInicio: "07:00", horaFin: "18:00"},
        ...Array.from({length: 8}, (_, i) => ({
          id: `cp${i}`, tipo: i % 3 ? "conferencia" : "taller", dia: HOY,
          horaInicio: hhmm(8 + i), horaFin: hhmm(9 + i),
        })),
      ];
      filas = [];
      for (let p = 0; p < 60; p++) {
        let t = ms(7, Math.floor(azar() * 60));
        filas.push({id: `acceso_${p}`, datos: {checkpointId: "acceso", participanteId: `p${p}`, marcadoEn: new Date(t)}});
        for (let k = 0; k < 4; k++) {
          const cp = checkpoints[1 + Math.floor(azar() * 8)];
          t = Math.max(t + 60000, ms(Number(cp.horaInicio.slice(0, 2)), Math.floor(azar() * 40) - 20));
          const salida = azar() < 0.1 ? new Date(t + 20 * 60000) : undefined;
          filas.push({id: `${cp.id}_${p}_${k}`, datos: {checkpointId: cp.id, participanteId: `p${p}`, marcadoEn: new Date(t), salidaEn: salida}});
        }
      }
      const ahora = ms(9 + Math.floor(azar() * 8), Math.floor(azar() * 60));
      const abiertas = checkpoints.filter((cp) => {
        const ini = ms(Number(cp.horaInicio.slice(0, 2)));
        const fin = ms(Number(cp.horaFin.slice(0, 2)));
        return ahora >= ini - 30 * 60000 && ahora <= fin;
      });
      // Antes: todas las entradas del día.
      const todo = contarOcupacion(filas.map((f) => f.datos), checkpoints, ahora);
      const esperado = Object.fromEntries(abiertas.map((cp) => cp.id).filter((id) => todo[id]).map((id) => [id, todo[id]]));
      const reducido = await ocupacionDeAbiertas(abiertas, checkpoints, HOY, ahora);
      assert.deepEqual(reducido, esperado, `caso ${caso}`);
    }
  });

  console.log(`\n${pasadas} pruebas pasaron.\n`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

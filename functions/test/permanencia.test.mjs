// Prueba de la permanencia por checkpoint (Lectura QR y POSPER solo marcan
// entradas). Lo que se protege aquí no falla ruidosamente: si el cálculo se
// equivoca, un estudiante que saltó entre conferencias se lleva el
// certificado, o uno que se quedó completo lo pierde.
//
// Importa el código REAL (js/core/permanencia.js), no una copia.
//
//   node functions/test/permanencia.test.mjs

import assert from "node:assert/strict";
import {
  enPanama,
  msPanama,
  checkpointsParaEscanear,
  proximoCheckpointHoy,
  evaluarPermanencia,
  contarValidas,
} from "../../js/core/permanencia.js";

let pasadas = 0;
function prueba(nombre, fn) {
  fn();
  pasadas += 1;
  console.log(`  ok  ${nombre}`);
}

const DIA = "2026-10-19";
const a = (hora, dia = DIA) => {
  const [h, m] = hora.split(":").map(Number);
  return msPanama(dia, h * 60 + m);
};
const cp = (id, horaInicio, horaFin, extra = {}) => ({ id, dia: DIA, horaInicio, horaFin, tipo: "conferencia", ...extra });

console.log("\nhora de Panamá:\n");

prueba("UTC-5 sin horario de verano", () => {
  // 2026-10-19 14:30 UTC = 09:30 en Panamá.
  assert.deepEqual(enPanama(new Date(Date.UTC(2026, 9, 19, 14, 30))), { dia: DIA, minutos: 9 * 60 + 30 });
  // 03:00 UTC del 20 sigue siendo el 19 en Panamá.
  assert.equal(enPanama(new Date(Date.UTC(2026, 9, 20, 3, 0))).dia, DIA);
});

console.log("\ncheckpoints para escanear:\n");

const programa = [
  cp("manana", "09:00", "11:00"),
  cp("tarde", "14:00", "16:00"),
  cp("otro-dia", "09:00", "11:00", { dia: "2026-10-20" }),
  cp("cancelado", "09:00", "11:00", { estado: "cancelado" }),
  cp("inactivo", "09:00", "11:00", { activo: false }),
  { id: "acceso", dia: DIA, tipo: "congreso" },
];

prueba("solo los de hoy, a esta hora y operativos", () => {
  const ids = checkpointsParaEscanear(programa, { dia: DIA, minutos: 9 * 60 + 10 }).map(c => c.id);
  assert.deepEqual(ids.sort(), ["acceso", "manana"]);
});

prueba("abre 30 minutos antes y cierra al terminar", () => {
  assert.ok(checkpointsParaEscanear(programa, { dia: DIA, minutos: 8 * 60 + 30 }).some(c => c.id === "manana"));
  assert.ok(!checkpointsParaEscanear(programa, { dia: DIA, minutos: 8 * 60 + 29 }).some(c => c.id === "manana"));
  assert.ok(!checkpointsParaEscanear(programa, { dia: DIA, minutos: 11 * 60 + 1 }).some(c => c.id === "manana"));
});

prueba("el próximo de hoy se informa", () => {
  assert.equal(proximoCheckpointHoy(programa, { dia: DIA, minutos: 12 * 60 })?.id, "tarde");
  assert.equal(proximoCheckpointHoy(programa, { dia: DIA, minutos: 15 * 60 }), null);
});

console.log("\npermanencia:\n");

const cps = [
  cp("A", "09:00", "11:00"),
  cp("B", "09:00", "11:00"),
  cp("C", "11:00", "12:00"),
  { id: "acceso", dia: DIA, horaInicio: "08:00", horaFin: "18:00", tipo: "congreso" },
];

prueba("se queda toda la conferencia: válida", () => {
  const r = evaluarPermanencia([{ checkpointId: "A", marcadoEn: a("08:50") }], cps);
  assert.equal(r.A.valida, true);
  assert.equal(r.A.minutos, 120);
  assert.equal(r.A.cerradaPor, "fin");
});

prueba("entra a A y a los 15 minutos se va a B: A no vale, B sí", () => {
  const r = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: a("09:00") },
    { checkpointId: "B", marcadoEn: a("09:15") },
  ], cps);
  assert.equal(r.A.valida, false);
  assert.equal(r.A.minutos, 15);
  assert.equal(r.A.cerradaPor, "siguiente");
  assert.equal(r.B.valida, true);
  assert.equal(contarValidas(r), 1);
});

prueba("el porcentaje va en proporción a la duración", () => {
  // 75 % de 120 min = 90 min.
  const justo = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: a("09:00") },
    { checkpointId: "C", marcadoEn: a("10:30") },
  ], cps);
  assert.equal(justo.A.requeridos, 90);
  assert.equal(justo.A.valida, true);
  const corto = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: a("09:00") },
    { checkpointId: "C", marcadoEn: a("10:29") },
  ], cps);
  assert.equal(corto.A.valida, false);
  // Con 50 % la misma salida sí alcanza.
  const flexible = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: a("09:00") },
    { checkpointId: "C", marcadoEn: a("10:00") },
  ], cps, { porcentajeMinimo: 50 });
  assert.equal(flexible.A.valida, true);
});

prueba("llegar tarde descuenta desde que entró", () => {
  const r = evaluarPermanencia([{ checkpointId: "A", marcadoEn: a("10:00") }], cps);
  assert.equal(r.A.minutos, 60);
  assert.equal(r.A.valida, false);
});

prueba("marcar después de que terminó no suma tiempo", () => {
  const r = evaluarPermanencia([{ checkpointId: "A", marcadoEn: a("11:30") }], cps);
  assert.equal(r.A.minutos, 0);
  assert.equal(r.A.valida, false);
});

prueba("el control de acceso siempre cuenta y no corta la sesión anterior", () => {
  const r = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: a("09:00") },
    { checkpointId: "acceso", marcadoEn: a("09:10") },
  ], cps);
  assert.equal(r.acceso.valida, true);
  assert.equal(r.acceso.medible, false);
  assert.equal(r.A.valida, true);
});

prueba("la última entrada del día cierra con el fin del checkpoint", () => {
  const r = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: a("09:00") },
    { checkpointId: "C", marcadoEn: a("11:00") },
  ], cps);
  assert.equal(r.A.valida, true);
  assert.equal(r.C.valida, true);
  assert.equal(r.C.minutos, 60);
});

prueba("una entrada al día siguiente no corta la del día anterior", () => {
  const conOtroDia = [...cps, cp("D", "09:00", "10:00", { dia: "2026-10-20" })];
  const r = evaluarPermanencia([
    { checkpointId: "C", marcadoEn: a("11:00") },
    { checkpointId: "D", marcadoEn: a("09:00", "2026-10-20") },
  ], conOtroDia);
  assert.equal(r.C.valida, true);
  assert.equal(r.D.valida, true);
});

prueba("acepta Timestamp de Firestore y Date", () => {
  const ts = { toMillis: () => a("09:00") };
  const r = evaluarPermanencia([
    { checkpointId: "A", marcadoEn: ts },
    { checkpointId: "B", marcadoEn: new Date(a("09:05")) },
  ], cps);
  assert.equal(r.A.minutos, 5);
});

prueba("checkpoint sin horario o sin hora de marcado: cuenta", () => {
  const r = evaluarPermanencia([
    { checkpointId: "X", marcadoEn: a("09:00") },
    { checkpointId: "A", marcadoEn: null },
  ], [...cps, { id: "X", dia: DIA, tipo: "panel" }]);
  assert.equal(r.X.valida, true);
  assert.equal(r.A.valida, true);
  assert.equal(r.A.medible, false);
});

console.log(`\n${pasadas} pruebas de permanencia superadas.\n`);

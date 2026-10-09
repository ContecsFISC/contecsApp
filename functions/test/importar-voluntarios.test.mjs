// Importar voluntarios (js/modulos/importar-voluntarios.js): reconocer las columnas de un
// Google Form, normalizar nombres y horario, detectar al comité y las cédulas repetidas.
//   node functions/test/importar-voluntarios.test.mjs

import assert from "node:assert/strict";
const m = await import("../../js/modulos/importar-voluntarios.js");
const enc = ["Marca temporal", "Nombre completo", "Cédula", "Correo electrónico", "Número de teléfono", "Carrera", "Año que cursas",
  "¿En qué horario asistes a clases?", "¿Por qué deseas ser voluntario?", "¿Has participado en comités o asociaciones?", "Habilidad que domines", "Grupo"];
const cols = m.detectarColumnas(enc);
if (process.env.DETALLE) console.log(enc.map((e, i) => `${e} → ${cols[i] || "(nada)"}`).join("\n"));
const filas = [["CONTECS voluntarios"], enc,
  ["1/1", "PÉREZ GÓMEZ, ANA MARÍA", "8-123-456", "Ana@Gmail.com", "6000-0000", "ISC", "3", "Matutino (mañana)", "Ayudar", "No", "Diseño", ""],
  ["1/1", "Luis de la Cruz", "8-999-1", "luis@", "", "", "", "Sábados", "", "", "", "Comité organizador"],
  ["1/1", "Repetido", "8-123-456", "", "", "", "", "", "", "", "", ""],
  ["1/1", "", "8-5", "", "", "", "", "", "", "", "", ""],
  ["1/1", "Ya Existe", "8-777", "", "", "", "", "", "", "", "", ""],
];
const fe = m.detectarEncabezado(filas);
assert.equal(fe, 1);
const normH = t => /mañana|matutino/i.test(t) ? "Diurno" : t;
const arm = m.armarFilas(filas, fe, cols, { normalizarHorario: normH, primeraFila: 1 });
const rev = m.revisarFilas(arm, { id: new Map([["8-777", "Ya Existe"]]), correo: new Map() });
if (process.env.DETALLE) rev.forEach(f => console.log(f.fila, f.estado, `${f.nombre}|${f.apellido}|${f.id}|${f.correo}|${f.horario}|${f.grupo}`, "—", f.notas.join("; ")));
assert.equal(rev[0].nombre, "Ana María"); assert.equal(rev[0].apellido, "Pérez Gómez"); assert.equal(rev[0].horario, "Diurno"); assert.equal(rev[0].estado, "ok");
assert.equal(rev[1].grupo, "comite"); assert.equal(rev[1].estado, "error");
assert.match(rev[2].notas[0], /Repite la cédula de la fila 3/);
assert.equal(rev[3].estado, "error"); assert.match(rev[4].notas[0], /Ya registrado/);
assert.equal(m.grupoDe("COMITE"), "comite"); assert.equal(m.grupoDe("voluntaria"), "voluntario");
const doc = m.documentoVoluntario(rev[0], { loteId: "x" });
assert.equal(doc.totalHoras, 0); assert.equal(doc.grupo, "voluntario");
console.log("ok");

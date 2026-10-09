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
  ["1/1", "PÉREZ GÓMEZ, ANA MARÍA", "8-123-456", "Ana@Gmail.com", "6000-0000", "ingenieria de software", "3", "Matutino (mañana)", "Ayudar", "No", "Diseño", ""],
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
// La carrera se lleva al catálogo y, sin columna de facultad, la facultad sale de la carrera.
assert.equal(doc.carrera, "Licenciatura en Ingeniería de Software");
assert.equal(doc.facultad, "Facultad de Ingeniería de Sistemas Computacionales");
assert.equal(doc.anio, "3");

// Títulos de la plantilla (los mismos campos que registro-voluntarios.html).
const plantilla = ["Nombre", "Apellido", "Cédula o pasaporte", "Correo", "Teléfono / WhatsApp", "Centro regional", "Facultad",
  "Carrera", "Año que cursa", "Horario de clases", "Habilidad que domina", "Experiencia en comités o voluntariados", "Motivación", "Grupo"];
assert.deepEqual(m.detectarColumnas(plantilla), ["nombre", "apellido", "id", "correo", "telefono", "centro", "facultad", "carrera",
  "anio", "horario", "habilidad", "experiencia", "motivacion", "grupo"]);

// Catálogo UTP: tildes, mayúsculas, siglas y textos parciales.
assert.equal(m.normalizarCentro("centro regional de chiriqui"), "Centro Regional de Chiriquí");
assert.equal(m.normalizarCentro("Azuero"), "Centro Regional de Azuero");
assert.equal(m.normalizarCentro("Panamá"), "Panamá"); // Campus Central o Panamá Oeste: no se adivina
assert.equal(m.normalizarFacultad("fisc"), "Facultad de Ingeniería de Sistemas Computacionales");
assert.equal(m.normalizarFacultad("Facultad de Ingenieria Electrica"), "Facultad de Ingeniería Eléctrica");
assert.equal(m.normalizarCarrera("Ingeniería Eléctrica"), "Licenciatura en Ingeniería Eléctrica");
assert.equal(m.normalizarCarrera("LICENCIATURA EN CIBERSEGURIDAD"), "Licenciatura en Ciberseguridad");
assert.equal(m.normalizarCarrera("Telecomunicaciones", "Facultad de Ingeniería Eléctrica"), "Técnico en Telecomunicaciones");
[["Primer año", "1"], ["2do año", "2"], ["3er año", "3"], ["IV", "4"], ["quinto", "5"], ["Egresada", "Egresado"], ["Sexto", "Sexto"]]
  .forEach(([texto, valor]) => assert.equal(m.normalizarAnio(texto), valor, texto));

const enc2 = ["Nombre", "Cédula", "Centro regional", "Facultad", "Carrera", "Año que cursa"];
const filas2 = [enc2,
  ["Eva", "8-1-1", "Coclé", "FIE", "Ingeniería Civil", "Segundo año"],
  ["Leo", "8-1-2", "Luna", "Medicina", "Cocina", "Sexto"],
];
const rev2 = m.revisarFilas(m.armarFilas(filas2, 0, m.detectarColumnas(enc2)), { id: new Map(), correo: new Map() });
assert.equal(rev2[0].centro, "Centro Regional de Coclé"); assert.equal(rev2[0].anio, "2");
assert.equal(rev2[0].estado, "aviso");
assert.ok(rev2[0].notas.includes("La carrera \"Licenciatura en Ingeniería Civil\" no es de la Facultad de Ingeniería Eléctrica"));
assert.equal(rev2[1].estado, "aviso");
["Centro regional \"Luna\"", "Facultad \"Medicina\"", "Carrera \"Cocina\"", "Año \"Sexto\""]
  .forEach(aviso => assert.ok(rev2[1].notas.some(n => n.startsWith(aviso)), aviso));
console.log("ok");

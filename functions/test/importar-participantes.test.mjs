// Datos UTP de participantes (js/modulos/importar-participantes.js): centro,
// facultad, carrera y año al texto del catálogo, como en voluntarios.
//   node functions/test/importar-participantes.test.mjs

import assert from "node:assert/strict";
const m = await import("../../js/modulos/importar-participantes.js");

// Como los dejaba registro.html: sin tildes y "1er año".
assert.deepEqual(m.normalizarDatosUtp({
  centro: "Centro Regional de Chiriqui",
  facultad: "Facultad de Ingenieria de Sistemas Computacionales",
  carrera: "Ingenieria de Software",
  anio: "3er año",
  "correo-inst": "ana@utp.ac.pa",
}, "estudiante_utp"), {
  anio: "3",
  centro: "Centro Regional de Chiriquí",
  facultad: "Facultad de Ingeniería de Sistemas Computacionales",
  carrera: "Licenciatura en Ingeniería de Software",
});

// Solo devuelve lo que cambia: ya normalizado, nada.
assert.deepEqual(m.normalizarDatosUtp({ centro: "Centro Regional de Azuero", anio: "Egresado" }, "estudiante_utp"), {});

// Estudiante externo: su carrera no es del catálogo UTP y queda como viene; el año sí.
assert.deepEqual(m.normalizarDatosUtp({ carrera: "Informática", anio: "2do año" }, "estudiante_externo"), { anio: "2" });

// Académico UTP: "Administración Central" es válida.
assert.deepEqual(m.normalizarDatosUtp({ facultad: "Administracion Central" }, "academico_utp"), { facultad: "Administración Central" });
assert.deepEqual(m.avisosDatosUtp({ facultad: "Administración Central" }, "academico_utp"), []);

// Sin facultad, se deduce de la carrera.
assert.equal(m.normalizarDatosUtp({ carrera: "Ciberseguridad" }, "estudiante_utp").facultad, "Facultad de Ingeniería de Sistemas Computacionales");

// Lo que no se reconoce se deja tal cual y se avisa.
assert.deepEqual(m.normalizarDatosUtp({ centro: "Narnia" }, "estudiante_utp"), {});
assert.deepEqual(m.avisosDatosUtp({ centro: "Narnia", anio: "x" }, "estudiante_utp"), ['Año "x" no reconocido', 'Centro regional "Narnia" no reconocido']);

// En la importación, según la categoría del lote; al servidor no viaja la categoría.
const enc = ["Nombre", "Apellido", "Cédula", "Correo", "Centro regional", "Facultad", "Carrera", "Año que cursa"];
const cols = m.detectarColumnas(enc);
const fila = ["Ana", "Pérez", "8-1-1", "ana@gmail.com", "azuero", "FISC", "ciberseguridad", "Cuarto año"];
const [utp] = m.armarFilas([enc, fila], 0, cols, { categoria: "estudiante_utp" });
assert.deepEqual(utp.camposExtra, {
  centro: "Centro Regional de Azuero",
  facultad: "Facultad de Ingeniería de Sistemas Computacionales",
  carrera: "Licenciatura en Ciberseguridad",
  anio: "4",
});
const [externo] = m.armarFilas([enc, fila], 0, cols, { categoria: "estudiante_externo" });
assert.equal(externo.camposExtra.carrera, "ciberseguridad");
assert.equal(externo.camposExtra.anio, "4");
assert.equal("categoria" in m.filaParaServidor(utp), false);
const [revisada] = m.revisarFilas([utp], { cedula: new Map(), correo: new Map() });
assert.deepEqual(revisada.notas, ["Sin teléfono"]);

console.log("ok");

// =============================================
// CONTECS — Importar voluntarios desde Excel o CSV
// =============================================
// Mismo recorrido que la importación de participantes (importar-participantes.js):
// se lee el archivo, se adivina qué trae cada columna, se revisa fila por fila
// y solo entonces se guarda. Aquí no se guarda nada; la pantalla
// (voluntarios.js) escribe en `voluntarios` con lo que esto devuelve.
//
// La cédula es obligatoria: es lo que lleva el QR del voluntario y lo que
// lee Lectura QR de voluntarios para marcar sus horas.

import { esCorreoValido } from "../core/correos.js";
import { cargarLibreria } from "../core/librerias.js";
import { leerArchivo, nombrePropio, separarNombreCompleto } from "./importar-participantes.js";

export { leerArchivo };

// Grupo interno: el comité organizador es voluntario a efectos legales y de
// horas, pero se distingue en listas y credenciales.
export const GRUPOS = {
  voluntario: "Voluntario",
  comite: "Comité organizador",
};

export const CAMPOS = [
  { clave: "nombreCompleto", etiqueta: "Nombre completo" },
  { clave: "nombre", etiqueta: "Nombre" },
  { clave: "apellido", etiqueta: "Apellido" },
  { clave: "id", etiqueta: "Cédula / pasaporte" },
  { clave: "correo", etiqueta: "Correo" },
  { clave: "telefono", etiqueta: "Teléfono" },
  { clave: "carrera", etiqueta: "Carrera" },
  { clave: "anio", etiqueta: "Año que cursa" },
  { clave: "horario", etiqueta: "Horario de clases" },
  { clave: "habilidad", etiqueta: "Habilidad destacada" },
  { clave: "experiencia", etiqueta: "Experiencia previa" },
  { clave: "motivacion", etiqueta: "Motivación" },
  { clave: "grupo", etiqueta: "Grupo (voluntario / comité)" },
];

const normalizar = texto => String(texto || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// La primera regla que acepta el encabezado gana; las específicas van antes.
// Las preguntas largas de Google Forms ("¿Por qué deseas ser voluntario?")
// también se reconocen.
const REGLAS = [
  ["correo", h => /\b(correo|email|e mail|mail|gmail)\b/.test(h)],
  ["id", h => /\b(cedula|pasaporte|identificacion|documento|cip|ci|id)\b/.test(h)],
  ["telefono", h => /\b(telefono|tel|celular|movil|whatsapp)\b/.test(h)],
  ["grupo", h => /\b(grupo|comite|tipo de voluntario|rol)\b/.test(h)],
  ["motivacion", h => /\b(por que|motivo|motivacion|deseas ser)\b/.test(h)],
  ["experiencia", h => /\b(experiencia|comites|asociaciones)\b/.test(h)],
  ["habilidad", h => /\b(habilidad|domines|destreza)\b/.test(h)],
  ["horario", h => /\b(horario|turno de clases|asiste|jornada)\b/.test(h)],
  ["nombreCompleto", h => /\bnombres?\b/.test(h) && /\bapellidos?\b/.test(h)],
  ["nombreCompleto", h => /\b(nombre completo|voluntario|estudiante)\b/.test(h)],
  ["apellido", h => /\bapellidos?\b/.test(h)],
  ["nombre", h => /\bnombres?\b/.test(h)],
  ["carrera", h => /\b(carrera|programa|licenciatura|facultad)\b/.test(h)],
  ["anio", h => /\b(ano|anio|nivel|semestre|year)\b/.test(h)],
];

function destinoDe(encabezado) {
  const h = normalizar(encabezado);
  if (!h) return "";
  return REGLAS.find(([, acepta]) => acepta(h))?.[0] || "";
}

export function detectarColumnas(encabezados) {
  const usados = new Set();
  return encabezados.map(encabezado => {
    const destino = destinoDe(encabezado);
    if (!destino || usados.has(destino)) return "";
    usados.add(destino);
    return destino;
  });
}

// La fila de títulos es, entre las 10 primeras, la que más columnas reconoce.
export function detectarEncabezado(filas) {
  let mejor = 0;
  let puntos = 1;
  filas.slice(0, 10).forEach((fila, i) => {
    const reconocidas = detectarColumnas(fila).filter(Boolean).length;
    if (reconocidas > puntos) {
      mejor = i;
      puntos = reconocidas;
    }
  });
  return mejor;
}

// "Comité organizador", "COMITE", "organizador" → comite; lo demás, voluntario.
export function grupoDe(texto) {
  const t = normalizar(texto);
  return /\b(comite|organizador|organizacion)\b/.test(t) ? "comite" : "voluntario";
}

// `normalizarHorario` viene de voluntarios.js (Diurno / Vespertino / Nocturno).
export function armarFilas(filas, filaEncabezado, columnas, {
  corregirMayusculas = true, primeraFila = 1, normalizarHorario = t => t, grupoPorDefecto = "voluntario",
} = {}) {
  const ajustar = texto => (corregirMayusculas ? nombrePropio(texto) : texto);
  const tiene = destino => columnas.includes(destino);
  return filas.slice(filaEncabezado + 1).flatMap((celdas, i) => {
    if (!celdas.some(Boolean)) return [];
    const valor = destino => {
      const indice = columnas.indexOf(destino);
      return indice === -1 ? "" : String(celdas[indice] || "").trim();
    };
    let nombre = valor("nombre");
    let apellido = valor("apellido");
    if (!tiene("nombre") && tiene("nombreCompleto")) {
      ({ nombre, apellido } = separarNombreCompleto(ajustar(valor("nombreCompleto"))));
      if (tiene("apellido") && valor("apellido")) apellido = valor("apellido");
    }
    const horarioTexto = valor("horario");
    return [{
      fila: primeraFila + filaEncabezado + i + 1,
      nombre: ajustar(nombre),
      apellido: ajustar(apellido),
      id: valor("id").toUpperCase(),
      correo: valor("correo").toLowerCase(),
      telefono: valor("telefono"),
      carrera: valor("carrera"),
      anio: valor("anio"),
      horario: horarioTexto ? normalizarHorario(horarioTexto) : "",
      horarioTexto,
      habilidad: valor("habilidad"),
      experiencia: valor("experiencia"),
      motivacion: valor("motivacion"),
      grupo: tiene("grupo") && valor("grupo") ? grupoDe(valor("grupo")) : grupoPorDefecto,
    }];
  });
}

const clave = texto => String(texto || "").trim().toLowerCase();
const LIMITES = { nombre: 100, apellido: 100, id: 30, correo: 254, telefono: 30, carrera: 150, habilidad: 300, experiencia: 1000, motivacion: 1000 };
const HORARIOS_VALIDOS = new Set(["Diurno", "Vespertino", "Nocturno"]);

// "ok", "aviso" (se importa) o "error" (no se importa). `existentes` son Map
// de cédula y correo (minúsculas) → nombre del voluntario ya registrado.
export function revisarFilas(filas, existentes) {
  const vistas = { id: new Map(), correo: new Map() };
  return filas.map(f => {
    const errores = [];
    const avisos = [];
    const textos = [f.nombre, f.apellido, f.id, f.correo, f.telefono, f.carrera, f.anio, f.habilidad, f.experiencia, f.motivacion];
    if (!f.nombre) errores.push("Falta el nombre");
    if (!f.id) errores.push("Falta la cédula (es lo que lleva su QR)");
    if (f.correo && !esCorreoValido(f.correo)) errores.push("Correo no válido");
    if (textos.some(t => /[<>]/.test(t))) errores.push("Tiene caracteres < o >");
    Object.entries(LIMITES).forEach(([campo, max]) => {
      if (String(f[campo] || "").length > max) errores.push(`${campo} demasiado largo`);
    });
    ["id", "correo"].forEach(campo => {
      const valor = clave(f[campo]);
      if (!valor) return;
      const etiqueta = campo === "id" ? "la cédula" : "el correo";
      if (existentes[campo].has(valor)) errores.push(`Ya registrado con ${etiqueta} (${existentes[campo].get(valor)})`);
      else if (vistas[campo].has(valor)) errores.push(`Repite ${etiqueta} de la fila ${vistas[campo].get(valor)}`);
      else if (!errores.length) vistas[campo].set(valor, f.fila);
    });
    if (!f.apellido) avisos.push("Sin apellido");
    if (!f.correo) avisos.push("Sin correo");
    if (!f.telefono) avisos.push("Sin teléfono");
    if (f.horarioTexto && !HORARIOS_VALIDOS.has(f.horario)) avisos.push(`Horario "${f.horarioTexto}" no reconocido: se guarda tal cual`);
    const estado = errores.length ? "error" : avisos.length ? "aviso" : "ok";
    return { ...f, estado, notas: errores.length ? errores : avisos };
  });
}

// Documento de `voluntarios` (sin creadoEn: lo pone la pantalla). totalHoras
// empieza en 0, como exige firestore.rules.
export function documentoVoluntario(f, { loteId }) {
  return {
    nombre: f.nombre, apellido: f.apellido, id: f.id, correo: f.correo, telefono: f.telefono,
    carrera: f.carrera, anio: f.anio, horario: f.horario, habilidad: f.habilidad,
    experiencia: f.experiencia, motivacion: f.motivacion, grupo: f.grupo,
    totalHoras: 0, importadoDeArchivo: new Date().toISOString(), loteImportacion: loteId,
  };
}

// ── EXCEL ──────────────────────────────────────────────────────────────────
const COLUMNAS_PLANTILLA = [
  "Nombre", "Apellido", "Cédula", "Correo", "Teléfono", "Carrera", "Año que cursa",
  "Horario de clases", "Habilidad destacada", "Grupo",
];

export async function descargarPlantilla() {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS_PLANTILLA]);
  hoja["!cols"] = COLUMNAS_PLANTILLA.map(c => ({ wch: Math.max(14, c.length + 6) }));
  const ayuda = XLSX.utils.aoa_to_sheet([
    ["Columna", "Qué escribir"],
    ["Nombre, Apellido", "Obligatorio el nombre. También sirve una sola columna «Nombre completo»."],
    ["Cédula", "Obligatoria. Es lo que lleva el QR del voluntario para marcar sus horas."],
    ["Correo, Teléfono", "Opcionales, pero recomendados."],
    ["Horario de clases", "Diurno, Vespertino o Nocturno (para no asignarle turnos que choquen con sus clases)."],
    ["Grupo", "Voluntario o Comité organizador. Si se deja vacío, se usa el que elijas al importar."],
    ["", "Puedes borrar las columnas que no uses. Los títulos se reconocen aunque cambien un poco."],
  ]);
  ayuda["!cols"] = [{ wch: 22 }, { wch: 90 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Voluntarios");
  XLSX.utils.book_append_sheet(libro, ayuda, "Instrucciones");
  XLSX.writeFile(libro, "CONTECS_plantilla_voluntarios.xlsx");
}

// Una fila por persona del archivo: importada o el motivo por el que no.
export async function descargarResultado(filas, { importadas, fallidas }) {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const ok = new Set(importadas);
  const fallo = new Map(fallidas.map(f => [f.fila, f.motivo]));
  const datos = [["Fila", "Nombre", "Apellido", "Cédula", "Correo", "Grupo", "Resultado", "Motivo"]];
  filas.forEach(f => {
    const resultado = ok.has(f.fila) ? "Importado" : fallo.has(f.fila) ? "Falló" : "No importado";
    const motivo = fallo.get(f.fila) || (ok.has(f.fila) ? "" : f.notas?.join("; ") || "Desmarcado");
    datos.push([f.fila, f.nombre, f.apellido, f.id, f.correo, GRUPOS[f.grupo] || "", resultado, motivo]);
  });
  const hoja = XLSX.utils.aoa_to_sheet(datos);
  hoja["!cols"] = [6, 20, 20, 14, 28, 20, 14, 50].map(wch => ({ wch }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Resultado");
  const hoy = new Date();
  const fecha = [hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate()].map(n => String(n).padStart(2, "0")).join("-");
  XLSX.writeFile(libro, `CONTECS_importacion_voluntarios_${fecha}.xlsx`);
}

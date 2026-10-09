// =============================================
// CONTECS — Importar participantes desde una lista
// =============================================
// Lee el Excel o CSV que manda un profesor, adivina qué dato trae cada columna
// y arma las filas que recibe la Cloud Function importarParticipantes (ver
// functions/importaciones.js). Aquí no se guarda nada: solo se prepara la
// lista y se avisa de lo que el servidor va a rechazar, para verlo antes de
// enviar. El servidor vuelve a validar todo.

import { esCorreoValido } from "../core/correos.js";
import { cargarLibreria } from "../core/librerias.js";

// Debe coincidir con CATEGORIAS_IMPORTABLES y los precios de
// CATEGORIAS_REGISTRO en functions/registro.js. "colegio" no se importa:
// necesita tutor y grupo, que se arman en registro.html.
export const CATEGORIAS_IMPORTABLES = [
  { clave: "estudiante_utp", nombre: "Estudiante UTP", precio: 10 },
  { clave: "estudiante_externo", nombre: "Estudiante externo", precio: 20 },
  { clave: "academico_utp", nombre: "Académico UTP", precio: 20 },
  { clave: "academico_externo", nombre: "Académico externo", precio: 30 },
  { clave: "profesional", nombre: "Profesional", precio: 30 },
  { clave: "otros", nombre: "Otros", precio: 20 },
];

// MAX_FILAS_POR_LLAMADA de functions/importaciones.js.
export const FILAS_POR_LLAMADA = 100;

// Datos que puede traer una columna. Los `extra: true` van a camposExtra,
// con la misma clave que usa registro.html.
export const CAMPOS = [
  { clave: "nombreCompleto", etiqueta: "Nombre completo" },
  { clave: "nombre", etiqueta: "Nombre" },
  { clave: "apellido", etiqueta: "Apellido" },
  { clave: "cedula", etiqueta: "Cédula / pasaporte" },
  { clave: "correo", etiqueta: "Correo" },
  { clave: "telefono", etiqueta: "Teléfono" },
  { clave: "correo-inst", etiqueta: "Correo institucional", extra: true },
  { clave: "centro", etiqueta: "Centro regional", extra: true },
  { clave: "facultad", etiqueta: "Facultad", extra: true },
  { clave: "carrera", etiqueta: "Carrera", extra: true },
  { clave: "anio", etiqueta: "Año que cursa", extra: true },
  { clave: "universidad", etiqueta: "Universidad / institución", extra: true },
  { clave: "empresa", etiqueta: "Empresa", extra: true },
  { clave: "cargo", etiqueta: "Cargo", extra: true },
];
const CAMPOS_EXTRA = CAMPOS.filter(c => c.extra).map(c => c.clave);

// Datos que el panel puede fijar para todo el grupo (si la fila no los trae).
export const CAMPOS_COMUNES = ["universidad", "centro", "facultad", "carrera", "anio"]
  .map(clave => CAMPOS.find(c => c.clave === clave));

// ── COLUMNAS ───────────────────────────────────────────────────────────────
const normalizar = texto => String(texto || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Se prueban en orden: la primera regla que acepta el encabezado gana. Las
// más específicas van antes ("correo institucional" antes que "correo").
const REGLAS = [
  ["correo-inst", h => /\b(correo|email|e mail|mail)\b/.test(h) && /\b(inst|institucional|utp|universitario)\b/.test(h)],
  ["correo", h => /\b(correo|email|e mail|mail|gmail)\b/.test(h)],
  ["cedula", h => /\b(cedula|pasaporte|identificacion|documento|cip|ci|id)\b/.test(h)],
  ["telefono", h => /\b(telefono|tel|celular|movil|whatsapp)\b/.test(h)],
  ["nombreCompleto", h => /\bnombres?\b/.test(h) && /\bapellidos?\b/.test(h)],
  ["nombreCompleto", h => /\b(nombre completo|estudiante|participante|alumno)\b/.test(h)],
  ["apellido", h => /\bapellidos?\b/.test(h)],
  ["nombre", h => /\bnombres?\b/.test(h)],
  ["centro", h => /\b(centro|sede|campus)\b/.test(h)],
  ["facultad", h => /\bfacultad\b/.test(h)],
  ["carrera", h => /\b(carrera|programa|licenciatura)\b/.test(h)],
  ["anio", h => /\b(ano|anio|nivel|semestre)\b/.test(h)],
  ["universidad", h => /\b(universidad|institucion)\b/.test(h)],
  ["empresa", h => /\b(empresa|organizacion)\b/.test(h)],
  ["cargo", h => /\b(cargo|puesto)\b/.test(h)],
];

function destinoDe(encabezado) {
  const h = normalizar(encabezado);
  if (!h) return "";
  return REGLAS.find(([, acepta]) => acepta(h))?.[0] || "";
}

// Un destino por columna; si dos columnas apuntan al mismo dato, gana la primera.
export function detectarColumnas(encabezados) {
  const usados = new Set();
  return encabezados.map(encabezado => {
    const destino = destinoDe(encabezado);
    if (!destino || usados.has(destino)) return "";
    usados.add(destino);
    return destino;
  });
}

// La fila de encabezados es, entre las 10 primeras, la que más columnas
// reconoce (las listas suelen traer un título arriba). Si ninguna reconoce
// al menos dos, se asume la primera.
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

// ── ARCHIVO ────────────────────────────────────────────────────────────────
async function textoDeCsv(archivo) {
  const bytes = await archivo.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  // Excel en español guarda los CSV en Windows-1252: leídos como UTF-8, las
  // tildes salen como "�".
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

// Devuelve [{ nombre, primeraFila, filas: string[][] }], una entrada por hoja
// con datos. `primeraFila` es el número de Excel de filas[0]: las filas vacías
// se conservan para que "fila 12" sea la fila 12 que ve el profesor.
export async function leerArchivo(archivo) {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const libro = /\.(csv|txt)$/i.test(archivo.name)
    ? XLSX.read(await textoDeCsv(archivo), { type: "string" })
    : XLSX.read(await archivo.arrayBuffer(), { type: "array" });
  // Las hojas ocultas (como "Listas" de la plantilla de voluntarios) no traen personas.
  const ocultas = new Set((libro.Workbook?.Sheets || []).filter(h => h.Hidden).map(h => h.name));
  return libro.SheetNames.filter(nombre => !ocultas.has(nombre)).map(nombre => {
    const hoja = libro.Sheets[nombre];
    return {
      nombre,
      primeraFila: hoja["!ref"] ? XLSX.utils.decode_range(hoja["!ref"]).s.r + 1 : 1,
      // raw: false devuelve el texto tal como se ve en Excel (cédulas, teléfonos).
      filas: XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "", blankrows: true })
        .map(fila => fila.map(celda => String(celda ?? "").replace(/\s+/g, " ").trim())),
    };
  }).filter(hoja => hoja.filas.some(fila => fila.some(Boolean)));
}

// ── FILAS ──────────────────────────────────────────────────────────────────
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "da", "van", "von"]);

// "MARÍA JOSÉ DE LA CRUZ" → "María José de la Cruz". Solo toca lo que viene
// todo en mayúsculas: un nombre escrito a mano se respeta tal cual. También
// la usa importar-voluntarios.js.
export function nombrePropio(texto) {
  if (!texto || texto !== texto.toLocaleUpperCase("es") || texto === texto.toLocaleLowerCase("es")) return texto;
  return texto.toLocaleLowerCase("es").split(" ").map((palabra, i) =>
    i > 0 && PARTICULAS.has(palabra) ? palabra : palabra.charAt(0).toLocaleUpperCase("es") + palabra.slice(1),
  ).join(" ");
}

// "Pérez Gómez, Ana María" o "Ana María Pérez Gómez". Sin coma, "de la Cruz"
// cuenta como un solo apellido; con 3 partes se toma 1 nombre y 2 apellidos, y
// con 4 o más, 2 nombres. Es una suposición: el nombre completo se guarda
// igual, solo cambia dónde se corta.
export function separarNombreCompleto(texto) {
  const limpio = String(texto || "").trim();
  if (limpio.includes(",")) {
    const [apellido, ...resto] = limpio.split(",");
    return { nombre: resto.join(" ").trim(), apellido: apellido.trim() };
  }
  const partes = [];
  let particulas = [];
  for (const palabra of limpio.split(" ").filter(Boolean)) {
    if (PARTICULAS.has(palabra.toLocaleLowerCase("es"))) {
      particulas.push(palabra);
      continue;
    }
    partes.push([...particulas, palabra].join(" "));
    particulas = [];
  }
  if (particulas.length) partes.push(particulas.join(" "));
  if (partes.length <= 1) return { nombre: limpio, apellido: "" };
  const cuantos = partes.length >= 4 ? 2 : 1;
  return { nombre: partes.slice(0, cuantos).join(" "), apellido: partes.slice(cuantos).join(" ") };
}

// Convierte las filas de datos (las que van después del encabezado) en las
// filas que entiende el servidor. `fila` es el número de fila en Excel.
export function armarFilas(filas, filaEncabezado, columnas, { corregirMayusculas = true, primeraFila = 1 } = {}) {
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
      // Primero las mayúsculas, sobre el nombre entero: así "DE LA CRUZ" queda
      // "de la Cruz" aunque luego caiga al inicio del apellido.
      ({ nombre, apellido } = separarNombreCompleto(ajustar(valor("nombreCompleto"))));
      if (tiene("apellido") && valor("apellido")) apellido = valor("apellido");
    }
    const camposExtra = {};
    CAMPOS_EXTRA.forEach(clave => {
      const texto = valor(clave);
      if (texto) camposExtra[clave] = clave === "correo-inst" ? texto.toLowerCase() : texto;
    });
    return [{
      fila: primeraFila + filaEncabezado + i + 1,
      nombre: ajustar(nombre),
      apellido: ajustar(apellido),
      cedula: valor("cedula").toUpperCase(),
      correo: valor("correo").toLowerCase(),
      telefono: valor("telefono"),
      camposExtra,
    }];
  });
}

// ── REVISIÓN ───────────────────────────────────────────────────────────────
const clave = texto => String(texto || "").trim().toLowerCase();
const LIMITES = { nombre: 100, apellido: 100, cedula: 30, correo: 254, telefono: 30 };

// Marca cada fila como "ok", "aviso" (se importa, pero le falta algo) o
// "error" (el servidor la rechazaría). `inscritos` son Map de cédula y correo
// (en minúsculas) → código, armados con los participantes ya cargados.
export function revisarFilas(filas, inscritos) {
  const vistas = { cedula: new Map(), correo: new Map() };
  return filas.map(f => {
    const errores = [];
    const avisos = [];
    const textos = [f.nombre, f.apellido, f.cedula, f.correo, f.telefono, ...Object.values(f.camposExtra)];
    if (!f.nombre) errores.push("Falta el nombre");
    if (!f.cedula && !f.correo) errores.push("Falta la cédula o el correo");
    if (f.correo && !esCorreoValido(f.correo)) errores.push("Correo no válido");
    if (textos.some(t => /[<>]/.test(t))) errores.push("Tiene caracteres < o >");
    Object.entries(LIMITES).forEach(([campo, max]) => {
      if (f[campo].length > max) errores.push(`${campo} demasiado largo`);
    });
    ["cedula", "correo"].forEach(campo => {
      const valor = clave(f[campo]);
      if (!valor) return;
      const etiqueta = campo === "cedula" ? "la cédula" : "el correo";
      if (inscritos[campo].has(valor)) errores.push(`Ya inscrito con ${etiqueta} (${inscritos[campo].get(valor)})`);
      else if (vistas[campo].has(valor)) errores.push(`Repite ${etiqueta} de la fila ${vistas[campo].get(valor)}`);
      else if (!errores.length) vistas[campo].set(valor, f.fila);
    });
    if (!f.apellido) avisos.push("Sin apellido");
    if (!f.cedula) avisos.push("Sin cédula");
    if (!f.correo) avisos.push("Sin correo: no recibirá el correo de aprobación");
    if (!f.telefono) avisos.push("Sin teléfono");
    const estado = errores.length ? "error" : avisos.length ? "aviso" : "ok";
    return { ...f, estado, notas: errores.length ? errores : avisos };
  });
}

// Lo que viaja al servidor: sin estado ni notas.
export function filaParaServidor({ fila, nombre, apellido, cedula, correo, telefono, camposExtra }) {
  return { fila, nombre, apellido, cedula, correo, telefono, camposExtra };
}

// ── EXCEL ──────────────────────────────────────────────────────────────────
const COLUMNAS_PLANTILLA = [
  "Nombre", "Apellido", "Cédula", "Correo", "Correo institucional", "Teléfono",
  "Centro regional", "Facultad", "Carrera", "Año que cursa", "Universidad / institución",
];

export async function descargarPlantilla() {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS_PLANTILLA]);
  hoja["!cols"] = COLUMNAS_PLANTILLA.map(c => ({ wch: Math.max(14, c.length + 6) }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Participantes");
  XLSX.writeFile(libro, "CONTECS_plantilla_participantes.xlsx");
}

// Una fila por persona de la lista: con su código si entró, o el motivo.
export async function descargarResultado(filas, { creados, omitidos }) {
  const XLSX = await cargarLibreria("XLSX", "xlsx.full.min.js");
  const porFila = new Map([
    ...creados.map(c => [c.fila, { estado: "Importado", codigo: c.codigo, motivo: "" }]),
    ...omitidos.map(o => [o.fila, { estado: "Omitido", codigo: "", motivo: o.motivo }]),
  ]);
  const datos = [["Fila", "Nombre", "Apellido", "Cédula", "Correo", "Resultado", "Código", "Motivo"]];
  filas.forEach(f => {
    const r = porFila.get(f.fila) || { estado: "No enviado", codigo: "", motivo: f.notas?.join("; ") || "" };
    datos.push([f.fila, f.nombre, f.apellido, f.cedula, f.correo, r.estado, r.codigo, r.motivo]);
  });
  const hoja = XLSX.utils.aoa_to_sheet(datos);
  hoja["!cols"] = [6, 20, 20, 14, 28, 12, 18, 50].map(wch => ({ wch }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Resultado");
  const hoy = new Date();
  const fecha = [hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate()].map(n => String(n).padStart(2, "0")).join("-");
  XLSX.writeFile(libro, `CONTECS_importacion_${fecha}.xlsx`);
}

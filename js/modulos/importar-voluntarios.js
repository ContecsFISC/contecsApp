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

import { ANIOS, CAMPUS, CARRERAS, FACULTADES, SIGLAS_FACULTAD } from "../core/catalogo-utp.js";
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
  { clave: "centro", etiqueta: "Centro regional" },
  { clave: "facultad", etiqueta: "Facultad" },
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
  ["centro", h => /\b(centro|campus|sede|regional)\b/.test(h)],
  ["facultad", h => /\bfacultad\b/.test(h)],
  ["carrera", h => /\b(carrera|programa|licenciatura)\b/.test(h)],
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

// ── CATÁLOGO UTP ───────────────────────────────────────────────────────────
// Lleva lo escrito al texto exacto del catálogo (catalogo-utp.js): sin
// importar tildes ni mayúsculas, y si no es igual, la única opción que lo
// contiene ("Azuero" → "Centro Regional de Azuero"). Si no hay una sola
// opción, devuelve el texto tal cual y revisarFilas lo avisa.
const sinGrado = texto => normalizar(texto).replace(/^(licenciatura|lic|tecnico|tec) (en )?/, "");

function delCatalogo(texto, lista, comparar = normalizar) {
  const t = comparar(texto);
  if (!t) return texto;
  const exacta = lista.find(opcion => comparar(opcion) === t);
  if (exacta) return exacta;
  const contienen = lista.filter(opcion => ` ${comparar(opcion)} `.includes(` ${t} `));
  return contienen.length === 1 ? contienen[0] : texto;
}

const TODAS_LAS_CARRERAS = Object.values(CARRERAS).flat();
const FACULTAD_DE_CARRERA = new Map(Object.entries(CARRERAS).flatMap(([facultad, carreras]) => carreras.map(c => [c, facultad])));
const ORDINALES = { primer: "1", primero: "1", segundo: "2", tercer: "3", tercero: "3", cuarto: "4", quinto: "5" };
const ROMANOS = { i: "1", ii: "2", iii: "3", iv: "4", v: "5" };
const ANIOS_VALIDOS = new Set(ANIOS.map(([valor]) => valor));

export function normalizarCentro(texto) {
  return delCatalogo(texto, CAMPUS);
}

export function normalizarFacultad(texto) {
  return SIGLAS_FACULTAD[String(texto || "").trim().toUpperCase()] || delCatalogo(texto, FACULTADES);
}

// Busca primero entre las carreras de la facultad y, si no está, entre todas.
export function normalizarCarrera(texto, facultad = "") {
  const propia = delCatalogo(texto, CARRERAS[facultad] || [], sinGrado);
  return CARRERAS[facultad]?.includes(propia) ? propia : delCatalogo(texto, TODAS_LAS_CARRERAS, sinGrado);
}

// "3", "3er año", "Tercer año", "III"… → "3"; "egresada" → "Egresado".
export function normalizarAnio(texto) {
  const t = normalizar(texto);
  if (!t) return "";
  if (/\begresad/.test(t)) return "Egresado";
  const digito = t.match(/\b([1-5])(?:er|ro|do|to|o)?\b/);
  if (digito) return digito[1];
  const palabras = t.split(" ");
  const ordinal = palabras.find(p => ORDINALES[p]);
  return ordinal ? ORDINALES[ordinal] : ROMANOS[palabras[0]] || texto;
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
    let facultad = normalizarFacultad(valor("facultad"));
    const carrera = normalizarCarrera(valor("carrera"), facultad);
    if (!facultad) facultad = FACULTAD_DE_CARRERA.get(carrera) || "";
    return [{
      fila: primeraFila + filaEncabezado + i + 1,
      nombre: ajustar(nombre),
      apellido: ajustar(apellido),
      id: valor("id").toUpperCase(),
      correo: valor("correo").toLowerCase(),
      telefono: valor("telefono"),
      centro: normalizarCentro(valor("centro")),
      facultad,
      carrera,
      anio: normalizarAnio(valor("anio")),
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
const LIMITES = {
  nombre: 100, apellido: 100, id: 30, correo: 254, telefono: 30, centro: 120, facultad: 150, carrera: 150,
  habilidad: 300, experiencia: 1000, motivacion: 1000,
};
const HORARIOS_VALIDOS = new Set(["Diurno", "Vespertino", "Nocturno"]);

// "ok", "aviso" (se importa) o "error" (no se importa). `existentes` son Map
// de cédula y correo (minúsculas) → nombre del voluntario ya registrado.
export function revisarFilas(filas, existentes) {
  const vistas = { id: new Map(), correo: new Map() };
  return filas.map(f => {
    const errores = [];
    const avisos = [];
    const textos = [f.nombre, f.apellido, f.id, f.correo, f.telefono, f.centro, f.facultad, f.carrera, f.anio, f.habilidad, f.experiencia, f.motivacion];
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
    if (f.centro && !CAMPUS.includes(f.centro)) avisos.push(`Centro regional "${f.centro}" no reconocido: se guarda tal cual`);
    if (f.facultad && !FACULTADES.includes(f.facultad)) avisos.push(`Facultad "${f.facultad}" no reconocida: se guarda tal cual`);
    if (f.carrera && !FACULTAD_DE_CARRERA.has(f.carrera)) avisos.push(`Carrera "${f.carrera}" no reconocida: se guarda tal cual`);
    else if (f.carrera && CARRERAS[f.facultad] && !CARRERAS[f.facultad].includes(f.carrera)) {
      avisos.push(`La carrera "${f.carrera}" no es de la ${f.facultad}`);
    }
    if (f.anio && !ANIOS_VALIDOS.has(f.anio)) avisos.push(`Año "${f.anio}" no reconocido: se guarda tal cual`);
    const estado = errores.length ? "error" : avisos.length ? "aviso" : "ok";
    return { ...f, estado, notas: errores.length ? errores : avisos };
  });
}

// Documento de `voluntarios` (sin creadoEn: lo pone la pantalla). totalHoras
// empieza en 0, como exige firestore.rules.
export function documentoVoluntario(f, { loteId }) {
  return {
    nombre: f.nombre, apellido: f.apellido, id: f.id, correo: f.correo, telefono: f.telefono,
    centro: f.centro, facultad: f.facultad, carrera: f.carrera, anio: f.anio, horario: f.horario, habilidad: f.habilidad,
    experiencia: f.experiencia, motivacion: f.motivacion, grupo: f.grupo,
    totalHoras: 0, importadoDeArchivo: new Date().toISOString(), loteImportacion: loteId,
  };
}

// ── EXCEL ──────────────────────────────────────────────────────────────────
// Mismos campos que public/registro-voluntarios.html, más el grupo. detectarColumnas
// reconoce todos los títulos.
const COLUMNAS_PLANTILLA = [
  { titulo: "Nombre", ancho: 18 },
  { titulo: "Apellido", ancho: 18 },
  { titulo: "Cédula o pasaporte", ancho: 20, texto: true },
  { titulo: "Correo", ancho: 28 },
  { titulo: "Teléfono / WhatsApp", ancho: 20, texto: true },
  { titulo: "Centro regional", ancho: 42, lista: "Centros" },
  { titulo: "Facultad", ancho: 48, lista: "Facultades" },
  { titulo: "Carrera", ancho: 62, lista: "Carreras" },
  { titulo: "Año que cursa", ancho: 16, lista: "Anios" },
  { titulo: "Horario de clases", ancho: 18, lista: "Horarios" },
  { titulo: "Habilidad que domina", ancho: 30 },
  { titulo: "Experiencia en comités o voluntariados", ancho: 40 },
  { titulo: "Motivación", ancho: 40 },
  { titulo: "Grupo", ancho: 22, lista: "Grupos" },
];
const FILAS_PLANTILLA = 1000;
const letraColumna = n => (n > 26 ? letraColumna(Math.floor((n - 1) / 26)) : "") + String.fromCharCode(65 + ((n - 1) % 26));

// Las opciones viven en la hoja oculta "Listas", cada columna con su nombre de
// rango. La carrera usa Carreras_1…Carreras_6 según la posición de la facultad
// elegida en su fila: solo ofrece las carreras de esa facultad.
export async function descargarPlantilla() {
  const ExcelJS = await cargarLibreria("ExcelJS", "exceljs.min.js");
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Voluntarios", { views: [{ state: "frozen", ySplit: 1 }] });
  const ayuda = libro.addWorksheet("Instrucciones");
  const listas = libro.addWorksheet("Listas", { state: "hidden" });

  [
    ["Centros", "Centro regional", CAMPUS],
    ["Facultades", "Facultad", FACULTADES],
    ["Anios", "Año que cursa", ANIOS.map(([, texto]) => texto)],
    ["Horarios", "Horario de clases", [...HORARIOS_VALIDOS]],
    ["Grupos", "Grupo", Object.values(GRUPOS)],
    ...FACULTADES.map((facultad, i) => [`Carreras_${i + 1}`, facultad, CARRERAS[facultad]]),
  ].forEach(([nombre, titulo, valores], i) => {
    const letra = letraColumna(i + 1);
    listas.getColumn(i + 1).values = [titulo, ...valores];
    listas.getColumn(i + 1).width = Math.min(70, Math.max(16, ...valores.map(v => v.length + 2)));
    listas.getCell(`${letra}1`).font = { bold: true };
    libro.definedNames.add(`Listas!$${letra}$2:$${letra}$${valores.length + 1}`, nombre);
  });

  hoja.columns = COLUMNAS_PLANTILLA.map(c => ({ header: c.titulo, width: c.ancho, ...(c.texto ? { style: { numFmt: "@" } } : {}) }));
  hoja.getRow(1).height = 22;
  hoja.getRow(1).eachCell(celda => {
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00722E" } };
    celda.alignment = { vertical: "middle" };
  });
  const letraFacultad = letraColumna(COLUMNAS_PLANTILLA.findIndex(c => c.lista === "Facultades") + 1);
  COLUMNAS_PLANTILLA.forEach((c, i) => {
    if (!c.lista) return;
    const letra = letraColumna(i + 1);
    const esCarrera = c.lista === "Carreras";
    hoja.dataValidations.add(`${letra}2:${letra}${FILAS_PLANTILLA + 1}`, {
      type: "list",
      allowBlank: true,
      formulae: [esCarrera ? `INDIRECT("Carreras_"&MATCH($${letraFacultad}2,Facultades,0))` : c.lista],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Elige de la lista",
      error: esCarrera ? "Primero elige la facultad y luego una de sus carreras." : `Elige una opción de la lista de ${c.titulo.toLowerCase()}.`,
    });
  });

  ayuda.columns = [{ header: "Columna", width: 28 }, { header: "Qué escribir", width: 100 }];
  ayuda.getRow(1).font = { bold: true };
  ayuda.addRows([
    ["Nombre, Apellido", "Obligatorio el nombre. Escríbelos como aparecen en la cédula: con ellos se imprime la credencial."],
    ["Cédula o pasaporte", "Obligatoria. Es lo que lleva el QR del voluntario para marcar sus horas."],
    ["Correo, Teléfono / WhatsApp", "Opcionales, pero recomendados."],
    ["Centro regional, Facultad", "Elige de la lista desplegable de la celda."],
    ["Carrera", "Primero elige la facultad: la lista solo muestra las carreras de esa facultad."],
    ["Año que cursa", "Elige de la lista: de Primer año a Quinto año, o Egresado."],
    ["Horario de clases", "Diurno, Vespertino o Nocturno (para no asignarle turnos que choquen con sus clases)."],
    ["Grupo", "Voluntario o Comité organizador. Si se deja vacío, se usa el que elijas al importar."],
    ["", "No cambies los títulos de la primera fila. Si pegas datos de otro archivo, al importar se ajustan a las listas y verás un aviso en lo que no se reconozca."],
  ]);
  ayuda.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "CONTECS_plantilla_voluntarios.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

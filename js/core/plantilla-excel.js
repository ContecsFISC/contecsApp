// =============================================
// CONTECS — Plantilla de Excel con listas desplegables
// =============================================
// La usan las plantillas de voluntarios y de participantes. Las opciones
// viven en la hoja oculta "Listas", cada columna con su nombre de rango. La
// carrera usa Carreras_1…Carreras_6 según la posición de la facultad elegida
// en su fila: solo ofrece las carreras de esa facultad.

import { ANIOS, CAMPUS, CARRERAS, FACULTADES } from "./catalogo-utp.js";
import { cargarLibreria } from "./librerias.js";

const FILAS_PLANTILLA = 1000;
const letraColumna = n => (n > 26 ? letraColumna(Math.floor((n - 1) / 26)) : "") + String.fromCharCode(65 + ((n - 1) % 26));

// Listas del catálogo UTP; `listasExtra` agrega otras ([nombre, título, valores]).
const listasUtp = () => [
  ["Centros", "Centro regional", CAMPUS],
  ["Facultades", "Facultad", FACULTADES],
  ["Anios", "Año que cursa", ANIOS.map(([, texto]) => texto)],
];

// `columnas`: [{ titulo, ancho, texto?, lista? }]; "Carreras" depende de la
// columna con lista "Facultades". `instrucciones`: filas [columna, qué escribir].
export async function descargarPlantillaConListas({ hoja: nombreHoja, columnas, listasExtra = [], instrucciones, archivo }) {
  const ExcelJS = await cargarLibreria("ExcelJS", "exceljs.min.js");
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet(nombreHoja, { views: [{ state: "frozen", ySplit: 1 }] });
  const ayuda = libro.addWorksheet("Instrucciones");
  const listas = libro.addWorksheet("Listas", { state: "hidden" });

  [
    ...listasUtp(),
    ...listasExtra,
    ...FACULTADES.map((facultad, i) => [`Carreras_${i + 1}`, facultad, CARRERAS[facultad]]),
  ].forEach(([nombre, titulo, valores], i) => {
    const letra = letraColumna(i + 1);
    listas.getColumn(i + 1).values = [titulo, ...valores];
    listas.getColumn(i + 1).width = Math.min(70, Math.max(16, ...valores.map(v => v.length + 2)));
    listas.getCell(`${letra}1`).font = { bold: true };
    libro.definedNames.add(`Listas!$${letra}$2:$${letra}$${valores.length + 1}`, nombre);
  });

  hoja.columns = columnas.map(c => ({ header: c.titulo, width: c.ancho, ...(c.texto ? { style: { numFmt: "@" } } : {}) }));
  hoja.getRow(1).height = 22;
  hoja.getRow(1).eachCell(celda => {
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00722E" } };
    celda.alignment = { vertical: "middle" };
  });
  const letraFacultad = letraColumna(columnas.findIndex(c => c.lista === "Facultades") + 1);
  columnas.forEach((c, i) => {
    if (!c.lista) return;
    const letra = letraColumna(i + 1);
    const esCarrera = c.lista === "Carreras";
    hoja.dataValidations.add(`${letra}2:${letra}${FILAS_PLANTILLA + 1}`, {
      type: "list",
      allowBlank: true,
      formulae: [esCarrera ? `INDIRECT("Carreras_"&MATCH($${letraFacultad}2,Facultades,0))` : c.lista],
      showErrorMessage: true,
      // `libre`: Excel avisa, pero deja escribir otro texto.
      errorStyle: c.libre ? "warning" : "stop",
      errorTitle: "Elige de la lista",
      error: (esCarrera ? "Primero elige la facultad y luego una de sus carreras." : `Elige una opción de la lista de ${c.titulo.toLowerCase()}.`)
        + (c.libre ? " Si no está (por ejemplo, de otra universidad), puedes dejar lo que escribiste." : ""),
    });
  });

  ayuda.columns = [{ header: "Columna", width: 28 }, { header: "Qué escribir", width: 100 }];
  ayuda.getRow(1).font = { bold: true };
  ayuda.addRows(instrucciones);
  ayuda.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buffer = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

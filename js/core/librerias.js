// =============================================
// CONTECS — Carga diferida de librerías de js/libs
// =============================================
// Las librerías pesadas (jsPDF, JSZip, SheetJS…) solo se descargan cuando un
// módulo las necesita, no al abrir la página. Cada archivo se pide una sola
// vez aunque varios módulos lo soliciten a la vez.

const pendientes = {};

// `global` es el nombre con el que la librería se publica en window.
export function cargarLibreria(global, archivo) {
  if (window[global]) return Promise.resolve(window[global]);
  pendientes[archivo] ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL(`../libs/${archivo}`, import.meta.url).href;
    s.onload = () => resolve(window[global]);
    s.onerror = () => {
      delete pendientes[archivo];
      reject(new Error(`No se pudo cargar ${archivo}.`));
    };
    document.head.appendChild(s);
  });
  return pendientes[archivo];
}

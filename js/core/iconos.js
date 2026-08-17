// ═══════════════════════════════════════════════════════════════════════════
// iconos.js — Helper central de iconografía SVG de CONTECS
//
// Sustituye la iconografía Unicode anterior por los SVG propios ubicados en
// /img/iconos/. Se usa `import.meta.url` para calcular la ruta de forma
// robusta: no importa desde qué profundidad de carpeta se importe este
// módulo, siempre resuelve correctamente hacia la carpeta raíz img/iconos/.
// ═══════════════════════════════════════════════════════════════════════════

const BASE_ICONOS = new URL("../../img/iconos/", import.meta.url).href;

// Nombres válidos de icono (deben coincidir con un archivo .svg en img/iconos/)
export const ICONOS_DISPONIBLES = [
  "advertencia", "agua", "bubble_tea", "cafe", "caja", "carrito",
  "cat_bebidas", "cat_comida", "cat_dulces", "cat_otros", "cat_postres", "cat_snacks",
  "cerrar", "chocolate", "combo", "combo_hamburguesa_soda", "combo_pizza_soda",
  "donut", "dulce", "dulce_alt", "editar", "eliminar", "estrella",
  "extra_sin_identificar_1",
  "galleta", "galleta_alt", "hamburguesa", "helado", "hotdog", "jugo",
  "manos", "nachos", "nueces", "paleta", "palomitas", "papas", "papitas",
  "pastel", "pastel_alt", "persona", "pizza", "producto", "pudin", "pudin_alt",
  "recibo", "regalo", "reloj", "sandwich", "siu_mai", "soda", "ticket", "wrap",
];

/**
 * Devuelve la URL absoluta hacia el SVG de un icono.
 * @param {string} nombre - nombre del icono (sin ".svg")
 */
export function rutaIcono(nombre) {
  return `${BASE_ICONOS}${nombre}.svg`;
}

/**
 * Devuelve el HTML de un <img> listo para insertar vía innerHTML.
 * @param {string} nombre - nombre del icono (sin ".svg")
 * @param {object} [opts]
 * @param {string} [opts.clase] - clases CSS adicionales (se suman a "icono-svg")
 * @param {string} [opts.alt] - texto alternativo (vacío por defecto, son decorativos)
 * @param {string} [opts.titulo] - atributo title (tooltip)
 */
export function iconoImg(nombre, opts = {}) {
  const { clase = "", alt = "", titulo = "" } = opts;
  const clases = ["icono-svg", clase].filter(Boolean).join(" ");
  const title = titulo ? ` title="${titulo}"` : "";
  return `<img src="${rutaIcono(nombre)}" class="${clases}" alt="${alt}"${title}/>`;
}

/**
 * Elige el SVG ilustrado correcto para un combo de venta.
 * Los combos antiguos se reconocen por su nombre y por el de sus productos.
 */
export function nombreIconoCombo(combo = {}) {
  if (["combo_hamburguesa_soda", "combo_pizza_soda"].includes(combo.icono)) {
    return combo.icono;
  }

  const texto = [
    combo.nombre,
    ...(Array.isArray(combo.items) ? combo.items.map(item => item?.nombre) : []),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (texto.includes("pizza")) return "combo_pizza_soda";
  return "combo_hamburguesa_soda";
}

export function iconoComboImg(combo, opts = {}) {
  return iconoImg(nombreIconoCombo(combo), opts);
}

/**
 * Renderiza una calificación en estrellas (1 a `max`) usando estrella.svg,
 * marcando como "llena" las primeras `cantidad` y "vacia" el resto.
 * Reemplaza las antiguas calificaciones construidas con caracteres Unicode.
 */
export function estrellasImg(cantidad, max = 5) {
  const llenas = Math.max(0, Math.min(max, Math.round(Number(cantidad) || 0)));
  let html = "";
  for (let i = 0; i < max; i++) {
    html += iconoImg("estrella", { clase: i < llenas ? "icono-estrella llena" : "icono-estrella vacia" });
  }
  return html;
}

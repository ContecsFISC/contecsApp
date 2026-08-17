import { db } from "../core/firebase-config.js";
import { iconoImg } from "../core/iconos.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── ICONOS DE CATEGORÍAS — 6 genéricos ──────────────────────────────────────
// El campo "icono" es el nombre del archivo SVG en /img/iconos/ (sin ".svg")
export const ICONOS_CATEGORIA = [
  { id: "cat_comida",   icono: "cat_comida",  label: "Comida" },
  { id: "cat_bebidas",  icono: "cat_bebidas", label: "Bebidas" },
  { id: "cat_dulces",   icono: "cat_dulces",  label: "Dulces" },
  { id: "cat_snacks",   icono: "cat_snacks",  label: "Snacks" },
  { id: "cat_postres",  icono: "cat_postres", label: "Postres" },
  { id: "cat_otros",    icono: "cat_otros",   label: "Otros" },
];

// ─── ICONOS DE PRODUCTOS — específicos por tipo ───────────────────────────────
export const ICONOS_PRODUCTO = [
  // Comida
  { id: "hamburguesa", icono: "hamburguesa", label: "Hamburguesa" },
  { id: "hotdog",      icono: "hotdog",      label: "Hot Dog" },
  { id: "sandwich",    icono: "sandwich",    label: "Sandwich" },
  { id: "wrap",        icono: "wrap",        label: "Wrap" },
  { id: "pizza",       icono: "pizza",       label: "Pizza" },
  { id: "pollo",       icono: "producto",    label: "Pollo" }, // no hay SVG específico de pollo en el set de 52 iconos
  { id: "papas",       icono: "papas",       label: "Papas fritas" },
  { id: "siu_mai",     icono: "siu_mai",     label: "Siu Mai" },
  { id: "nachos",      icono: "nachos",      label: "Nachos" },
  // Bebidas
  { id: "soda",        icono: "soda",        label: "Soda / Refresco" },
  { id: "agua",        icono: "agua",        label: "Agua" },
  { id: "cafe",        icono: "cafe",        label: "Café" },
  { id: "jugo",        icono: "jugo",        label: "Jugo" },
  // Dulces & Postres
  { id: "pudin",       icono: "pudin",       label: "Pudín / Flan" },
  { id: "helado",      icono: "helado",      label: "Helado" },
  { id: "pastel",      icono: "pastel",      label: "Pastel / Torta" },
  { id: "galleta",     icono: "galleta",     label: "Galleta" },
  { id: "donut",       icono: "donut",       label: "Dona" },
  { id: "paleta",      icono: "paleta",      label: "Paleta" },
  { id: "chocolate",   icono: "chocolate",   label: "Chocolate" },
  { id: "dulce",       icono: "dulce",       label: "Dulce / Caramelo" },
  // Snacks
  { id: "papitas",     icono: "papitas",     label: "Papitas" },
  { id: "palomitas",   icono: "palomitas",   label: "Palomitas" },
  { id: "nueces",      icono: "nueces",      label: "Nueces / Maní" },
  // Otros / General
  { id: "ticket",      icono: "ticket",      label: "Ticket / Entrada" },
  { id: "regalo",      icono: "regalo",      label: "Regalo / Souvenir" },
  { id: "producto",    icono: "producto",    label: "Producto general" },
];

// Mantener ICONOS y TODOS_ICONOS para compatibilidad con código existente
// (catálogo y galería los usan como ICONOS[grupo] o TODOS_ICONOS)
export const ICONOS = {
  categorias: ICONOS_CATEGORIA,
  productos:  ICONOS_PRODUCTO,
  // Grupos legacy — apuntan a productos para que el renderGaleria siga funcionando
  bebidas: ICONOS_PRODUCTO.filter(i => ["soda","agua","cafe","jugo"].includes(i.id)),
  comida:  ICONOS_PRODUCTO.filter(i => ["hamburguesa","hotdog","sandwich","wrap","pizza","pollo","papas","siu_mai","nachos"].includes(i.id)),
  dulces:  ICONOS_PRODUCTO.filter(i => ["pudin","helado","pastel","galleta","donut","paleta","chocolate","dulce"].includes(i.id)),
  snacks:  ICONOS_PRODUCTO.filter(i => ["papitas","palomitas","nueces"].includes(i.id)),
  otros:   ICONOS_PRODUCTO.filter(i => ["ticket","regalo","producto"].includes(i.id)),
};

export const TODOS_ICONOS = [...ICONOS_CATEGORIA, ...ICONOS_PRODUCTO];

// Devuelve el nombre de archivo SVG (sin ".svg") para un iconoId dado
export function getIconoNombre(iconoId) {
  const found = TODOS_ICONOS.find(i => i.id === iconoId);
  return found ? found.icono : "producto";
}

// Devuelve el HTML <img> listo para insertar (reemplaza al antiguo getEmoji)
export function getIconoHTML(iconoId, opts = {}) {
  return iconoImg(getIconoNombre(iconoId), opts);
}

// ─── CATEGORÍAS ───────────────────────────────────────────────────────────────
export function escucharCategorias(callback) {
  return onSnapshot(
    query(collection(db, "categorias"), orderBy("orden", "asc")),
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export async function crearCategoria(nombre, iconoId) {
  const snap = await getDocs(collection(db, "categorias"));
  const orden = snap.size + 1;
  return addDoc(collection(db, "categorias"), {
    nombre, iconoId, orden, creadoEn: serverTimestamp()
  });
}

export async function editarCategoria(id, nombre, iconoId) {
  return updateDoc(doc(db, "categorias", id), { nombre, iconoId });
}

export async function eliminarCategoria(id) {
  const q = query(collection(db, "productos"),
    where("categoriaId", "==", id),
    where("activo", "==", true));
  const snap = await getDocs(q);
  if (!snap.empty) throw new Error("La categoría tiene productos activos. Desactívalos primero.");
  return deleteDoc(doc(db, "categorias", id));
}

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────
export function escucharProductosPorCategoria(categoriaId, callback) {
  return onSnapshot(
    query(collection(db, "productos"),
      where("categoriaId", "==", categoriaId),
      orderBy("nombre", "asc")),
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export async function crearProducto(datos) {
  return addDoc(collection(db, "productos"), {
    ...datos,
    stock: 0,
    activo: true,
    creadoEn: serverTimestamp(),
  });
}

export async function editarProducto(id, datos) {
  const { nombre, iconoId, precioVenta, alertaMinima } = datos;
  return updateDoc(doc(db, "productos", id), {
    nombre, iconoId, precioVenta, alertaMinima
  });
}

export async function desactivarProducto(id) {
  return updateDoc(doc(db, "productos", id), { activo: false });
}

export async function reactivarProducto(id) {
  return updateDoc(doc(db, "productos", id), { activo: true });
}

// ─── ESTADO DEL STOCK ────────────────────────────────────────────────────────
export function estadoStock(stock, alertaMinima) {
  if (stock <= 0)            return "agotado";
  if (stock <= alertaMinima) return "alerta";
  return "ok";
}

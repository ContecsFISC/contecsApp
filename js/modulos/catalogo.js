import { db } from "../core/firebase-config.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── ICONOS DE CATEGORÍAS — 6 genéricos ──────────────────────────────────────
export const ICONOS_CATEGORIA = [
  { id: "cat_comida",   emoji: "🍔", label: "Comida" },
  { id: "cat_bebidas",  emoji: "🥤", label: "Bebidas" },
  { id: "cat_dulces",   emoji: "🍬", label: "Dulces" },
  { id: "cat_snacks",   emoji: "🍿", label: "Snacks" },
  { id: "cat_postres",  emoji: "🍰", label: "Postres" },
  { id: "cat_otros",    emoji: "📦", label: "Otros" },
];

// ─── ICONOS DE PRODUCTOS — específicos por tipo ───────────────────────────────
export const ICONOS_PRODUCTO = [
  // Comida
  { id: "hamburguesa", emoji: "🍔", label: "Hamburguesa" },
  { id: "hotdog",      emoji: "🌭", label: "Hot Dog" },
  { id: "sandwich",    emoji: "🥪", label: "Sandwich" },
  { id: "wrap",        emoji: "🌯", label: "Wrap" },
  { id: "pizza",       emoji: "🍕", label: "Pizza" },
  { id: "pollo",       emoji: "🍗", label: "Pollo" },
  { id: "papas",       emoji: "🍟", label: "Papas fritas" },
  { id: "siu_mai",     emoji: "🥟", label: "Siu Mai" },
  { id: "nachos",      emoji: "🧀", label: "Nachos" },
  // Bebidas
  { id: "soda",        emoji: "🥤", label: "Soda / Refresco" },
  { id: "agua",        emoji: "💧", label: "Agua" },
  { id: "cafe",        emoji: "☕", label: "Café" },
  { id: "jugo",        emoji: "🍹", label: "Jugo" },
  // Dulces & Postres
  { id: "pudin",       emoji: "🍮", label: "Pudín / Flan" },
  { id: "helado",      emoji: "🍦", label: "Helado" },
  { id: "pastel",      emoji: "🎂", label: "Pastel / Torta" },
  { id: "galleta",     emoji: "🍪", label: "Galleta" },
  { id: "donut",       emoji: "🍩", label: "Dona" },
  { id: "paleta",      emoji: "🍭", label: "Paleta" },
  { id: "chocolate",   emoji: "🍫", label: "Chocolate" },
  { id: "dulce",       emoji: "🍬", label: "Dulce / Caramelo" },
  // Snacks
  { id: "papitas",     emoji: "🥔", label: "Papitas" },
  { id: "palomitas",   emoji: "🍿", label: "Palomitas" },
  { id: "nueces",      emoji: "🥜", label: "Nueces / Maní" },
  // Otros / General
  { id: "ticket",      emoji: "🎟️", label: "Ticket / Entrada" },
  { id: "regalo",      emoji: "🎁", label: "Regalo / Souvenir" },
  { id: "producto",    emoji: "🏷️", label: "Producto general" },
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

export function getEmoji(iconoId) {
  const found = TODOS_ICONOS.find(i => i.id === iconoId);
  return found ? found.emoji : "📦";
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

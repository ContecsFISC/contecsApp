import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { escucharCategorias, getEmoji, estadoStock } from "./catalogo.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarVenta } from "../core/operaciones.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("registrar_ventas");
const estado = {
  categorias: [],
  productos: [],
  termino: "",
  carrito: new Map(),
  cargando: true,
};

const $ = (id) => document.getElementById(id);
const productosWrap = $("productos-wrap");
const carritoWrap = $("carrito-wrap");
const alerta = $("alerta-venta");
const buscador = $("buscador-productos");
const metodoPago = $("metodo-pago");
const nota = $("nota-venta");
const btnFinalizar = $("btn-finalizar-venta");

function mostrarAlerta(tipo, mensaje) {
  alerta.textContent = mensaje;
  alerta.className = `alerta alerta-${tipo} show`;
  alerta.style.display = "block";
}

function ocultarAlerta() {
  alerta.className = "alerta alerta-error";
  alerta.style.display = "none";
  alerta.textContent = "";
}

function productoCarrito(productoId) {
  return estado.carrito.get(productoId);
}

function totalCarrito() {
  let total = 0;
  estado.carrito.forEach((item) => {
    total += item.precioUnitario * item.cantidad;
  });
  return total;
}

function cantidadTotal() {
  let total = 0;
  estado.carrito.forEach((item) => {
    total += item.cantidad;
  });
  return total;
}

function actualizarResumen() {
  $("resumen-items").textContent = `${cantidadTotal()} unidad${cantidadTotal() === 1 ? "" : "es"}`;
  $("resumen-total").textContent = formatearMoneda(totalCarrito());
  btnFinalizar.disabled = estado.carrito.size === 0;
}

function agregarAlCarrito(producto) {
  const actual = estado.carrito.get(producto.id);
  const stock = Number(producto.stock || 0);

  if (actual) {
    if (actual.cantidad >= stock) {
      mostrarAlerta("aviso", `No hay más stock disponible para ${producto.nombre}.`);
      return;
    }
    actual.cantidad += 1;
  } else {
    if (stock <= 0) {
      mostrarAlerta("aviso", `${producto.nombre} está agotado.`);
      return;
    }
    estado.carrito.set(producto.id, {
      productoId: producto.id,
      nombre: producto.nombre,
      cantidad: 1,
      precioUnitario: Number(producto.precioVenta || 0),
      stockDisponible: stock,
    });
  }

  ocultarAlerta();
  renderCarrito();
}

function cambiarCantidad(productoId, delta) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const nuevoValor = item.cantidad + delta;
  if (nuevoValor <= 0) {
    estado.carrito.delete(productoId);
  } else {
    item.cantidad = nuevoValor;
  }
  renderCarrito();
}

function actualizarCantidad(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero)) return;
  if (numero <= 0) {
    estado.carrito.delete(productoId);
  } else {
    item.cantidad = numero;
  }
  renderCarrito();
}

function actualizarPrecio(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const numero = Number(valor);
  if (Number.isFinite(numero) && numero >= 0) {
    item.precioUnitario = numero;
    renderCarrito();
  }
}

function renderCarrito() {
  const items = [...estado.carrito.values()];
  if (items.length === 0) {
    carritoWrap.innerHTML = `
      <div class="empty-state" style="padding:24px 16px;">
        <div class="emoji">🧾</div>
        <p>Aún no agregas productos a la venta.</p>
      </div>`;
    actualizarResumen();
    return;
  }

  carritoWrap.innerHTML = items.map((item) => {
    const producto = estado.productos.find((p) => p.id === item.productoId);
    const restante = Number(producto?.stock || 0) - item.cantidad;
    const avisoStock = restante < 0 ? `<div style="color:var(--rojo);font-size:12px;margin-top:4px;">Excede el stock disponible</div>` : "";

    return `
      <div class="carrito-item">
        <div class="carrito-info">
          <div class="carrito-nombre">${item.nombre}</div>
          <div class="carrito-meta">${item.cantidad} x ${formatearMoneda(item.precioUnitario)} = ${formatearMoneda(item.cantidad * item.precioUnitario)}</div>
          ${avisoStock}
        </div>
        <div class="carrito-controles">
          <button class="chip-btn" data-action="menos" data-id="${item.productoId}">−</button>
          <button class="chip-btn" data-action="mas" data-id="${item.productoId}">+</button>
          <button class="chip-btn chip-danger" data-action="quitar" data-id="${item.productoId}">✕</button>
        </div>
        <div class="form-group" style="margin-top:10px;">
          <label for="cantidad-${item.productoId}">Cantidad</label>
          <input id="cantidad-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${item.cantidad}" data-cantidad-id="${item.productoId}">
        </div>
        <div class="form-group" style="margin-top:10px;">
          <label for="precio-${item.productoId}">Precio</label>
          <input id="precio-${item.productoId}" type="text" inputmode="decimal" autocomplete="off" value="${item.precioUnitario}" data-precio-id="${item.productoId}">
        </div>
      </div>`;
  }).join("");

  carritoWrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "menos") cambiarCantidad(id, -1);
      if (action === "mas") cambiarCantidad(id, 1);
      if (action === "quitar") estado.carrito.delete(id), renderCarrito();
    });
  });

  carritoWrap.querySelectorAll("[data-precio-id]").forEach((input) => {
    const handler = () => {
      actualizarPrecio(input.getAttribute("data-precio-id"), input.value);
    };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  carritoWrap.querySelectorAll("[data-cantidad-id]").forEach((input) => {
    const handler = () => {
      actualizarCantidad(input.getAttribute("data-cantidad-id"), input.value);
    };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  actualizarResumen();
}

function renderProductos() {
  const termino = estado.termino.toLowerCase().trim();
  const contenedor = productosWrap;
  contenedor.innerHTML = "";

  const productosFiltrados = estado.productos.filter((prod) => {
    if (!termino) return true;
    return prod.nombre.toLowerCase().includes(termino);
  });

  if (productosFiltrados.length === 0) {
    contenedor.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🔍</div>
        <p>No hay productos que coincidan con tu búsqueda.</p>
      </div>`;
    return;
  }

  estado.categorias.forEach((categoria) => {
    const productosCategoria = productosFiltrados.filter((prod) => prod.categoriaId === categoria.id);
    if (productosCategoria.length === 0) return;

    const seccion = document.createElement("div");
    seccion.className = "seccion-cat";

    const titulo = document.createElement("div");
    titulo.className = "seccion-cat-titulo";
    titulo.innerHTML = `<span style="font-size:20px;">${getEmoji(categoria.iconoId)}</span>${categoria.nombre}`;
    seccion.appendChild(titulo);

    const grid = document.createElement("div");
    grid.className = "venta-grid";

    productosCategoria.forEach((prod) => {
      const estadoStockProd = estadoStock(prod.stock ?? 0, prod.alertaMinima ?? 0);
      const card = document.createElement("div");
      card.className = `venta-card ${estadoStockProd !== "ok" ? estadoStockProd : ""}`;
      card.innerHTML = `
        <div class="venta-icono">${getEmoji(prod.iconoId)}</div>
        <div class="venta-info">
          <div class="venta-nombre">${prod.nombre}</div>
          <div class="venta-meta">${formatearMoneda(prod.precioVenta || 0)} · Stock ${prod.stock ?? 0}</div>
        </div>
        <button class="btn btn-sm btn-outline" style="width:auto;">Agregar</button>`;
      card.querySelector("button").addEventListener("click", () => agregarAlCarrito(prod));
      grid.appendChild(card);
    });

    seccion.appendChild(grid);
    contenedor.appendChild(seccion);
  });
}

async function finalizarVenta() {
  const btn = document.getElementById("btn-finalizar-venta");

  // Evitar múltiples clics
  if (btn.disabled) return;

  if (estado.carrito.size === 0) {
    mostrarAlerta("aviso", "Agrega al menos un producto.");
    return;
  }

  // Bloquear el botón y cambiar texto
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "⏳ Procesando...";
  ocultarAlerta();

  try {
    const usuarioActual = auth.currentUser;
    if (!usuarioActual) {
      mostrarAlerta("error", "No se pudo identificar al usuario. Intenta iniciar sesión de nuevo.");
      return;
    }

    const datosUsuario = getUsuarioActual();
    const resultado = await registrarVenta({
      usuarioId: usuarioActual.uid,
      usuarioNombre: datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email,
      items: [...estado.carrito.values()],
      metodoPago: metodoPago.value,
      nota: nota.value.trim(),
    });

    estado.carrito.clear();
    renderCarrito();
    mostrarAlerta("success", `Venta registrada. Total ${formatearMoneda(resultado.total)}.`);
    nota.value = "";
  } catch (error) {
    mostrarAlerta("error", error.message || "No se pudo registrar la venta.");
  } finally {
    // Reactivar el botón en caso de error o al terminar
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function renderEstadoCarga() {
  $("estado-carga").style.display = estado.cargando ? "block" : "none";
  $("pantalla-venta").style.display = estado.cargando ? "none" : "block";
}

escucharCategorias((cats) => {
  estado.categorias = cats;
  renderProductos();
  estado.cargando = false;
  renderEstadoCarga();
});

onSnapshot(
  query(collection(db, "productos"), where("activo", "==", true)),
  (snap) => {
    estado.productos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderProductos();
    renderCarrito();
    estado.cargando = false;
    renderEstadoCarga();
  }
);

buscador.addEventListener("input", (event) => {
  estado.termino = event.target.value;
  renderProductos();
});

$("btn-limpiar-carrito").addEventListener("click", () => {
  estado.carrito.clear();
  renderCarrito();
  ocultarAlerta();
});

btnFinalizar.addEventListener("click", finalizarVenta);

renderCarrito();
renderEstadoCarga();

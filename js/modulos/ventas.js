import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { escucharCategorias, getEmoji, estadoStock } from "./catalogo.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarVenta, registrarVentaConMerma } from "../core/operaciones.js";
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

// ─── HELPERS DE MERMA ──────────────────────────────────────────────────────
// Un ítem del carrito puede tener, además de su "cantidad" vendida normal,
// unidades marcadas como merma: "vendida" (se vendió a un precio reducido,
// por ejemplo producto golpeado) o "sin vender" (se perdió, no generó dinero).
function mermaVendidaActivadaItem(item) {
  return Boolean(item.mermaVendida);
}
function mermaFueVendidoItem(item) {
  return Boolean(item.mermaVendidaFueVendido);
}
function mermaVendidaCantidadItem(item) {
  const n = Math.trunc(Number(item.mermaVendidaCantidad));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function mermaVendidaDescripcionItem(item) {
  return String(item.mermaVendidaDescripcion || "");
}
function mermaVendidaPrecioItem(item) {
  const n = Number(item.mermaVendidaPrecioUnitario);
  return Number.isFinite(n) ? n : 0;
}
function mermaSinVenderActivadaItem(item) {
  return Boolean(item.mermaSinVender);
}
function mermaSinVenderCantidadItem(item) {
  const n = Math.trunc(Number(item.mermaSinVenderCantidad));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function mermaSinVenderDescripcionItem(item) {
  return String(item.mermaSinVenderDescripcion || "");
}
// La merma "vendida" tiene un único tipo principal: o se vendió a precio
// reducido, o se perdió sin vender — controlado por el mismo checkbox.
function tipoMermaPrincipalItem(item) {
  if (!mermaVendidaActivadaItem(item) || mermaVendidaCantidadItem(item) <= 0) return null;
  return mermaFueVendidoItem(item) ? "vendida" : "sin_vender";
}
function tieneMermaItem(item) {
  return mermaVendidaActivadaItem(item) || mermaSinVenderActivadaItem(item);
}

function totalCarrito() {
  let total = 0;
  estado.carrito.forEach((item) => {
    total += item.precioUnitario * item.cantidad;
    if (tipoMermaPrincipalItem(item) === "vendida") {
      total += mermaVendidaCantidadItem(item) * mermaVendidaPrecioItem(item);
    }
  });
  return total;
}

function cantidadTotal() {
  let total = 0;
  estado.carrito.forEach((item) => {
    total += item.cantidad;
    total += mermaVendidaCantidadItem(item) + mermaSinVenderCantidadItem(item);
  });
  return total;
}

// El carrito está listo para enviar si cada ítem con merma activa tiene
// cantidad y descripción válidas (y precio si se marcó como vendida).
function carritoValido() {
  if (estado.carrito.size === 0) return false;
  return [...estado.carrito.values()].every((item) => {
    if (mermaVendidaActivadaItem(item)) {
      if (mermaVendidaCantidadItem(item) <= 0) return false;
      if (!mermaVendidaDescripcionItem(item).trim()) return false;
      if (mermaFueVendidoItem(item) && mermaVendidaPrecioItem(item) <= 0) return false;
    }
    if (mermaSinVenderActivadaItem(item)) {
      if (mermaSinVenderCantidadItem(item) <= 0) return false;
      if (!mermaSinVenderDescripcionItem(item).trim()) return false;
    }
    return item.cantidad > 0 || mermaVendidaCantidadItem(item) > 0 || mermaSinVenderCantidadItem(item) > 0;
  });
}

function actualizarResumen() {
  $("resumen-items").textContent = `${cantidadTotal()} unidad${cantidadTotal() === 1 ? "" : "es"}`;
  $("resumen-total").textContent = formatearMoneda(totalCarrito());
  const hayVentaNormal = [...estado.carrito.values()].some((item) => item.cantidad > 0);
  btnFinalizar.textContent = hayVentaNormal ? "Registrar venta" : "Registrar merma";
  btnFinalizar.disabled = !carritoValido();
}

function agregarAlCarrito(producto) {
  const actual = estado.carrito.get(producto.id);
  const stock = Number(producto.stock || 0);

  // No bloqueamos la venta por falta de stock registrado: puede haber
  // producto físico disponible que aún no se cargó en inventario. Si el
  // inventario está en 0 o se excede, solo avisamos — el carrito y el cobro
  // siguen adelante igual (el stock puede quedar negativo, y eso está bien).
  if (actual) {
    if (actual.cantidad >= stock) {
      mostrarAlerta("aviso", `Atención: ${producto.nombre} supera el stock registrado (${stock}). La venta se registrará igual.`);
    }
    actual.cantidad += 1;
  } else {
    if (stock <= 0) {
      mostrarAlerta("aviso", `Atención: ${producto.nombre} figura agotado en inventario. La venta se registrará igual.`);
    }
    estado.carrito.set(producto.id, {
      productoId: producto.id,
      nombre: producto.nombre,
      cantidad: 1,
      precioUnitario: Number(producto.precioVenta || 0),
      stockDisponible: stock,
      mermaVendida: false,
      mermaVendidaFueVendido: false,
      mermaVendidaCantidad: 0,
      mermaVendidaDescripcion: "",
      mermaVendidaPrecioUnitario: 0,
      mermaSinVender: false,
      mermaSinVenderCantidad: 0,
      mermaSinVenderDescripcion: "",
    });
  }

  renderCarrito();
}

// Solo se elimina el ítem del carrito si llega a 0 y además no tiene ninguna
// merma activa — si tiene merma, el ítem se queda con cantidad 0 (toda la
// unidad vendida fue merma) en vez de desaparecer.
function cambiarCantidad(productoId, delta) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const nuevoValor = item.cantidad + delta;
  if (nuevoValor <= 0) {
    if (tieneMermaItem(item)) {
      item.cantidad = 0;
    } else {
      estado.carrito.delete(productoId);
    }
  } else {
    item.cantidad = nuevoValor;
  }
  renderCarrito();
}

function actualizarCantidad(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero) || numero < 0) return;
  if (numero <= 0 && !tieneMermaItem(item)) {
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

// ─── HANDLERS DE MERMA ──────────────────────────────────────────────────────
function actualizarMermaActiva(productoId, activada) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  item.mermaVendida = activada;
  if (!activada) {
    item.mermaVendidaFueVendido = false;
    item.mermaVendidaCantidad = 0;
    item.mermaVendidaDescripcion = "";
    item.mermaVendidaPrecioUnitario = 0;
  }
  renderCarrito();
}

function actualizarMermaCantidad(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item || !mermaVendidaActivadaItem(item)) return;
  const numero = valor === "" ? 0 : Math.trunc(Number(valor));
  if (!Number.isFinite(numero) || numero < 0) return;
  item.mermaVendidaCantidad = numero;
  renderCarrito();
}

function actualizarMermaDescripcion(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item || !mermaVendidaActivadaItem(item)) return;
  item.mermaVendidaDescripcion = String(valor || "");
  renderCarrito();
}

function actualizarMermaFueVendido(productoId, activada) {
  const item = estado.carrito.get(productoId);
  if (!item || !mermaVendidaActivadaItem(item)) return;
  item.mermaVendidaFueVendido = Boolean(activada);
  if (!item.mermaVendidaFueVendido) item.mermaVendidaPrecioUnitario = 0;
  renderCarrito();
}

function actualizarMermaPrecio(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item || !mermaFueVendidoItem(item)) return;
  const numero = valor === "" ? 0 : Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return;
  item.mermaVendidaPrecioUnitario = numero;
  renderCarrito();
}

function actualizarMermaSinVenderActiva(productoId, activada) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  item.mermaSinVender = activada;
  if (!activada) {
    item.mermaSinVenderCantidad = 0;
    item.mermaSinVenderDescripcion = "";
  }
  renderCarrito();
}

function actualizarMermaSinVenderCantidad(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item || !mermaSinVenderActivadaItem(item)) return;
  const numero = valor === "" ? 0 : Math.trunc(Number(valor));
  if (!Number.isFinite(numero) || numero < 0) return;
  item.mermaSinVenderCantidad = numero;
  renderCarrito();
}

function actualizarMermaSinVenderDescripcion(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item || !mermaSinVenderActivadaItem(item)) return;
  item.mermaSinVenderDescripcion = String(valor || "");
  renderCarrito();
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
    const restante = Number(producto?.stock || 0) - item.cantidad - mermaVendidaCantidadItem(item) - mermaSinVenderCantidadItem(item);
    const avisoStock = restante < 0
      ? `<div class="carrito-warn">Atención: supera el stock registrado por ${Math.abs(restante)} unidad${Math.abs(restante) === 1 ? "" : "es"}. La venta se registrará igual.</div>`
      : "";

    const mermaVendidaCant = mermaVendidaCantidadItem(item);
    const mermaSinVenderCant = mermaSinVenderCantidadItem(item);
    const errMermaCant = mermaVendidaActivadaItem(item) && mermaVendidaCant <= 0
      ? `<span class="campo-error show">Ingresa la cantidad de merma.</span>` : "";
    const errMermaDesc = mermaVendidaActivadaItem(item) && !mermaVendidaDescripcionItem(item).trim()
      ? `<span class="campo-error show">Ingresa una descripción de la merma.</span>` : "";
    const errMermaPrecio = mermaVendidaActivadaItem(item) && mermaFueVendidoItem(item) && mermaVendidaPrecioItem(item) <= 0
      ? `<span class="campo-error show">Ingresa un precio unitario mayor que 0.</span>` : "";
    const errSinVenderCant = mermaSinVenderActivadaItem(item) && mermaSinVenderCant <= 0
      ? `<span class="campo-error show">Ingresa la cantidad de merma.</span>` : "";
    const errSinVenderDesc = mermaSinVenderActivadaItem(item) && !mermaSinVenderDescripcionItem(item).trim()
      ? `<span class="campo-error show">Ingresa una descripción de la merma.</span>` : "";

    return `
      <div class="carrito-item">
        <div class="carrito-info">
          <div class="carrito-nombre">${item.nombre}</div>
          <div class="carrito-meta">${item.cantidad} x ${formatearMoneda(item.precioUnitario)} = ${formatearMoneda(item.cantidad * item.precioUnitario)}</div>
          ${mermaVendidaCant > 0 ? `<div class="carrito-meta">${mermaVendidaCant} unidad${mermaVendidaCant === 1 ? "" : "es"} de merma ${mermaFueVendidoItem(item) ? "vendida" : "sin vender"}</div>` : ""}
          ${avisoStock}
        </div>
        <div class="carrito-controles">
          <button class="chip-btn" data-action="menos" data-id="${item.productoId}">−</button>
          <button class="chip-btn" data-action="mas" data-id="${item.productoId}">+</button>
          <button class="chip-btn chip-danger" data-action="quitar" data-id="${item.productoId}">✕</button>
        </div>
        <div class="form-group" style="margin-top:10px;">
          <label for="cantidad-${item.productoId}">Cantidad vendida</label>
          <input id="cantidad-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${item.cantidad}" data-cantidad-id="${item.productoId}">
        </div>
        <div class="form-group" style="margin-top:10px;">
          <label for="precio-${item.productoId}">Precio</label>
          <input id="precio-${item.productoId}" type="text" inputmode="decimal" autocomplete="off" value="${item.precioUnitario}" data-precio-id="${item.productoId}">
        </div>

        <div class="form-group carrito-merma-box" style="margin-top:12px;">
          <label class="merma-toggle">
            <input type="checkbox" data-merma-toggle-id="${item.productoId}" ${mermaVendidaActivadaItem(item) ? "checked" : ""}>
            ¿Hubo merma de este producto?
          </label>
          <div class="merma-input-wrap ${mermaVendidaActivadaItem(item) ? "" : "is-hidden"}" data-merma-wrap="${item.productoId}">
            <label for="merma-cantidad-${item.productoId}">Cantidad de merma</label>
            <input id="merma-cantidad-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${item.mermaVendidaCantidad || 0}" data-merma-cantidad-id="${item.productoId}">
            ${errMermaCant}
            <label for="merma-desc-${item.productoId}">Descripción</label>
            <textarea id="merma-desc-${item.productoId}" rows="2" data-merma-desc-id="${item.productoId}" placeholder="Describe qué ocurrió...">${mermaVendidaDescripcionItem(item)}</textarea>
            ${errMermaDesc}
            <label class="merma-toggle" style="margin-top:8px;">
              <input type="checkbox" data-merma-fue-vendido-id="${item.productoId}" ${mermaFueVendidoItem(item) ? "checked" : ""}>
              Se vendió a precio reducido (si no, se marcará como pérdida total)
            </label>
            <div class="form-group ${mermaFueVendidoItem(item) ? "" : "is-hidden"}" style="margin-top:8px;" data-merma-precio-wrap="${item.productoId}">
              <label for="merma-precio-${item.productoId}">Precio unitario de la merma</label>
              <input id="merma-precio-${item.productoId}" type="text" inputmode="decimal" autocomplete="off" value="${item.mermaVendidaPrecioUnitario || 0}" data-merma-precio-id="${item.productoId}">
              ${errMermaPrecio}
            </div>
          </div>
        </div>

        <div class="form-group carrito-merma-box" style="margin-top:10px;">
          <label class="merma-toggle">
            <input type="checkbox" data-merma-sin-vender-toggle-id="${item.productoId}" ${mermaSinVenderActivadaItem(item) ? "checked" : ""}>
            ¿Hubo pérdida total (no se vendió nada)?
          </label>
          <div class="merma-input-wrap ${mermaSinVenderActivadaItem(item) ? "" : "is-hidden"}" data-merma-sin-vender-wrap="${item.productoId}">
            <label for="merma-sv-cantidad-${item.productoId}">Cantidad perdida</label>
            <input id="merma-sv-cantidad-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${item.mermaSinVenderCantidad || 0}" data-merma-sv-cantidad-id="${item.productoId}">
            ${errSinVenderCant}
            <label for="merma-sv-desc-${item.productoId}">Descripción</label>
            <textarea id="merma-sv-desc-${item.productoId}" rows="2" data-merma-sv-desc-id="${item.productoId}" placeholder="Describe qué ocurrió...">${mermaSinVenderDescripcionItem(item)}</textarea>
            ${errSinVenderDesc}
          </div>
        </div>
      </div>`;
  }).join("");

  carritoWrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "menos") cambiarCantidad(id, -1);
      if (action === "mas") cambiarCantidad(id, 1);
      if (action === "quitar") { estado.carrito.delete(id); renderCarrito(); }
    });
  });

  carritoWrap.querySelectorAll("[data-precio-id]").forEach((input) => {
    const handler = () => actualizarPrecio(input.getAttribute("data-precio-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });

  carritoWrap.querySelectorAll("[data-cantidad-id]").forEach((input) => {
    const handler = () => actualizarCantidad(input.getAttribute("data-cantidad-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });

  carritoWrap.querySelectorAll("[data-merma-toggle-id]").forEach((input) => {
    input.addEventListener("change", () => actualizarMermaActiva(input.getAttribute("data-merma-toggle-id"), input.checked));
  });
  carritoWrap.querySelectorAll("[data-merma-cantidad-id]").forEach((input) => {
    const handler = () => actualizarMermaCantidad(input.getAttribute("data-merma-cantidad-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });
  carritoWrap.querySelectorAll("[data-merma-desc-id]").forEach((input) => {
    const handler = () => actualizarMermaDescripcion(input.getAttribute("data-merma-desc-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
  });
  carritoWrap.querySelectorAll("[data-merma-fue-vendido-id]").forEach((input) => {
    input.addEventListener("change", () => actualizarMermaFueVendido(input.getAttribute("data-merma-fue-vendido-id"), input.checked));
  });
  carritoWrap.querySelectorAll("[data-merma-precio-id]").forEach((input) => {
    const handler = () => actualizarMermaPrecio(input.getAttribute("data-merma-precio-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });
  carritoWrap.querySelectorAll("[data-merma-sin-vender-toggle-id]").forEach((input) => {
    input.addEventListener("change", () => actualizarMermaSinVenderActiva(input.getAttribute("data-merma-sin-vender-toggle-id"), input.checked));
  });
  carritoWrap.querySelectorAll("[data-merma-sv-cantidad-id]").forEach((input) => {
    const handler = () => actualizarMermaSinVenderCantidad(input.getAttribute("data-merma-sv-cantidad-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });
  carritoWrap.querySelectorAll("[data-merma-sv-desc-id]").forEach((input) => {
    const handler = () => actualizarMermaSinVenderDescripcion(input.getAttribute("data-merma-sv-desc-id"), input.value);
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
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
  if (!carritoValido()) {
    mostrarAlerta("aviso", "Revisa los campos de merma marcados en rojo antes de continuar.");
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
    const usuarioId = usuarioActual.uid;
    const usuarioNombre = datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email;

    const itemsVenta = [...estado.carrito.values()]
      .filter((item) => item.cantidad > 0)
      .map((item) => ({
        productoId: item.productoId,
        nombre: item.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
      }));

    const mermaItems = [];
    estado.carrito.forEach((item) => {
      const tipoPrincipal = tipoMermaPrincipalItem(item);
      if (tipoPrincipal && mermaVendidaCantidadItem(item) > 0) {
        mermaItems.push({
          productoId: item.productoId,
          nombre: item.nombre,
          cantidad: mermaVendidaCantidadItem(item),
          descripcion: mermaVendidaDescripcionItem(item),
          tipo: tipoPrincipal,
          fueVendido: tipoPrincipal === "vendida",
          precioUnitario: tipoPrincipal === "vendida" ? mermaVendidaPrecioItem(item) : 0,
        });
      }
      if (mermaSinVenderActivadaItem(item) && mermaSinVenderCantidadItem(item) > 0) {
        mermaItems.push({
          productoId: item.productoId,
          nombre: item.nombre,
          cantidad: mermaSinVenderCantidadItem(item),
          descripcion: mermaSinVenderDescripcionItem(item),
          tipo: "sin_vender",
          fueVendido: false,
          precioUnitario: 0,
        });
      }
    });

    let resultado;
    if (mermaItems.length > 0) {
      resultado = await registrarVentaConMerma({
        usuarioId,
        usuarioNombre,
        items: itemsVenta,
        metodoPago: metodoPago.value,
        nota: nota.value.trim(),
        mermaItems,
        motivoMerma: "Merma registrada desde ventas",
      });
    } else {
      resultado = await registrarVenta({
        usuarioId,
        usuarioNombre,
        items: itemsVenta,
        metodoPago: metodoPago.value,
        nota: nota.value.trim(),
      });
    }

    estado.carrito.clear();
    renderCarrito();
    mostrarAlerta("success", `Registrado correctamente. Total ${formatearMoneda(resultado.total)}.`);
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

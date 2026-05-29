import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { escucharCategorias, getEmoji } from "./catalogo.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarCompra, esperarAuthListo } from "../core/operaciones.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("registrar_compras");
const estado = {
  categorias: [],
  productos: [],
  termino: "",
  carrito: new Map(),
  cargando: true,
  factura: null,
  facturaUrl: "",
};

const $ = (id) => document.getElementById(id);
const productosWrap = $("productos-compra-wrap");
const carritoWrap = $("carrito-compra-wrap");
const alerta = $("alerta-compra");
const buscador = $("buscador-compra");
const proveedor = $("proveedor-compra");
const metodoPago = $("metodo-pago-compra");
const factura = $("factura-compra");
const facturaPreview = $("factura-preview");
const nota = $("nota-compra");
const btnFinalizar = $("btn-finalizar-compra");

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

function mostrarAlertaYScrollTop(tipo, mensaje) {
  mostrarAlerta(tipo, mensaje);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function campoTextoValido(valor) {
  return String(valor || "").trim().length > 0;
}

function enteroValido(valor) {
  const numero = Math.trunc(Number(valor));
  return Number.isFinite(numero) && numero > 0;
}

function cantidadPaqueteValida(valor) {
  return enteroValido(valor);
}

function unidadesPorPaqueteValida(valor) {
  return enteroValido(valor);
}

function subtotalValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0;
}

function subtotalItem(item) {
  return subtotalValido(item.subtotal) ? Number(item.subtotal) : 0;
}

function precioUnitarioCalculado(item) {
  const cantidad = cantidadProductoTotal(item);
  if (!cantidad) return 0;
  const subtotal = subtotalItem(item);
  return subtotal > 0 ? subtotal / cantidad : 0;
}

function cantidadProductoTotal(item) {
  if (!cantidadPaqueteValida(item.cantidadPaquete) || !unidadesPorPaqueteValida(item.unidadesPorPaquete)) return 0;
  return Math.trunc(Number(item.cantidadPaquete)) * Math.trunc(Number(item.unidadesPorPaquete));
}

function tamanoLegible(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const unidades = ["B", "KB", "MB", "GB"];
  let valor = bytes;
  let indice = 0;
  while (valor >= 1024 && indice < unidades.length - 1) {
    valor /= 1024;
    indice += 1;
  }
  return `${valor.toFixed(indice === 0 ? 0 : 1)} ${unidades[indice]}`;
}

function validarArchivoFactura(archivo) {
  if (!archivo) throw new Error("Selecciona una factura.");
  const tiposPermitidos = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!tiposPermitidos.includes(archivo.type || "")) throw new Error("La factura debe ser un PDF o una imagen válida.");
  if (archivo.size > 10 * 1024 * 1024) throw new Error("La factura no puede superar 10 MB.");
}

function limpiarPreviewFactura() {
  if (estado.facturaUrl) {
    URL.revokeObjectURL(estado.facturaUrl);
    estado.facturaUrl = "";
  }
}

function renderPreviewFactura() {
  limpiarPreviewFactura();

  if (!estado.factura) {
    facturaPreview.innerHTML = '<div class="factura-preview-info">No hay factura seleccionada.</div>';
    actualizarResumen();
    return;
  }

  if (estado.factura.type && estado.factura.type.startsWith("image/")) {
    estado.facturaUrl = URL.createObjectURL(estado.factura);
    facturaPreview.innerHTML = `
      <img src="${estado.facturaUrl}" alt="Vista previa de la factura">
      <div class="factura-preview-info">
        <strong>${estado.factura.name}</strong><br>
        ${tamanoLegible(estado.factura.size)} · ${estado.factura.type}
      </div>`;
  } else {
    facturaPreview.innerHTML = `
      <div class="factura-preview-info">
        <strong>PDF seleccionado</strong><br>
        ${estado.factura.name}<br>
        ${tamanoLegible(estado.factura.size)}
      </div>`;
  }

  actualizarResumen();
}

function formularioCompraCompleto() {
  const carritoCompleto = [...estado.carrito.values()].every((item) => {
    return cantidadPaqueteValida(item.cantidadPaquete)
      && unidadesPorPaqueteValida(item.unidadesPorPaquete)
      && subtotalValido(item.subtotal)
      && cantidadProductoTotal(item) > 0;
  });
  return estado.carrito.size > 0
    && carritoCompleto
    && campoTextoValido(proveedor.value)
    && campoTextoValido(metodoPago.value)
    && !!estado.factura;
}

function totalCarrito() {
  let total = 0;
  estado.carrito.forEach((item) => { total += subtotalItem(item); });
  return total;
}

function cantidadTotal() {
  let total = 0;
  estado.carrito.forEach((item) => { total += cantidadProductoTotal(item); });
  return total;
}

function actualizarResumen() {
  $("resumen-compra-items").textContent = `${cantidadTotal()} unidad${cantidadTotal() === 1 ? "" : "es"}`;
  $("resumen-compra-total").textContent = formatearMoneda(totalCarrito());
  btnFinalizar.disabled = !formularioCompraCompleto();
}

function precioDefault(producto) {
  return Number(producto.precioCompra ?? producto.ultimoCosto ?? producto.precioVenta ?? 0);
}

function agregarAlCarrito(producto) {
  const actual = estado.carrito.get(producto.id);
  if (actual) {
    actual.cantidadPaquete += 1;
  } else {
    estado.carrito.set(producto.id, {
      productoId: producto.id,
      nombre: producto.nombre,
      cantidadPaquete: 1,
      unidadesPorPaquete: 1,
      cantidad: 1,
      subtotal: "",
    });
  }
  ocultarAlerta();
  renderCarrito();
}

function cambiarCantidadPaquete(productoId, delta) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const actual = Math.trunc(Number(item.cantidadPaquete || 0));
  const nuevoValor = actual + delta;
  if (nuevoValor <= 0) {
    estado.carrito.delete(productoId);
  } else {
    item.cantidadPaquete = nuevoValor;
  }
  renderCarrito();
}

function actualizarCantidadPaquete(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero)) return;
  if (numero <= 0) {
    estado.carrito.delete(productoId);
  } else {
    item.cantidadPaquete = numero;
  }
  renderCarrito();
}

function actualizarUnidadesPorPaquete(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item) return;

  if (valor === "") {
    item.unidadesPorPaquete = "";
    renderCarrito();
    return;
  }

  const numero = Math.trunc(Number(valor));
  if (!Number.isFinite(numero)) return;
  if (numero <= 0) {
    item.unidadesPorPaquete = "";
  } else {
    item.unidadesPorPaquete = numero;
  }
  renderCarrito();
}

function actualizarSubtotal(productoId, valor) {
  const item = estado.carrito.get(productoId);
  if (!item) return;
  const numero = Number(valor);
  if (valor === "") {
    item.subtotal = "";
    renderCarrito();
    return;
  }
  if (Number.isFinite(numero) && numero > 0) {
    item.subtotal = numero;
    renderCarrito();
  }
}

function renderCarrito() {
  const items = [...estado.carrito.values()];
  if (items.length === 0) {
    carritoWrap.innerHTML = `
      <div class="empty-state" style="padding:24px 16px;">
        <div class="emoji">🧾</div>
        <p>Aún no agregas productos a la compra.</p>
      </div>`;
    actualizarResumen();
    return;
  }

  carritoWrap.innerHTML = items.map((item) => `
    <div class="carrito-item">
      <div class="carrito-info">
        <div class="carrito-nombre">${item.nombre}</div>
        <div class="carrito-meta">${subtotalValido(item.subtotal) && cantidadProductoTotal(item) > 0 ? `${cantidadPaqueteValida(item.cantidadPaquete) ? item.cantidadPaquete : 0} paquetes x ${unidadesPorPaqueteValida(item.unidadesPorPaquete) ? item.unidadesPorPaquete : 0} unidades = ${cantidadProductoTotal(item)} unidades` : "Subtotal pendiente"}</div>
      </div>
      <div class="carrito-controles">
        <button class="chip-btn" data-action="menos" data-id="${item.productoId}">−</button>
        <button class="chip-btn" data-action="mas" data-id="${item.productoId}">+</button>
        <button class="chip-btn chip-danger" data-action="quitar" data-id="${item.productoId}">✕</button>
      </div>
      <div class="carrito-campos">
        <div class="form-group">
          <label for="cantidad-paquete-${item.productoId}">Cantidad paquete o caja</label>
          <input id="cantidad-paquete-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${cantidadPaqueteValida(item.cantidadPaquete) ? item.cantidadPaquete : ""}" data-cantidad-paquete-id="${item.productoId}">
        </div>
        <div class="form-group">
          <label for="unidades-paquete-${item.productoId}">Cantidad de producto por paquete</label>
          <input id="unidades-paquete-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${unidadesPorPaqueteValida(item.unidadesPorPaquete) ? item.unidadesPorPaquete : ""}" data-unidades-paquete-id="${item.productoId}">
        </div>
        <div class="form-group">
          <label for="subtotal-${item.productoId}">Costo total de la compra</label>
          <input id="subtotal-${item.productoId}" type="text" inputmode="decimal" autocomplete="off" value="${subtotalValido(item.subtotal) ? item.subtotal : ""}" data-subtotal-id="${item.productoId}">
        </div>
      </div>
    </div>`).join("");

  carritoWrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "menos") cambiarCantidadPaquete(id, -1);
      if (action === "mas") cambiarCantidadPaquete(id, 1);
      if (action === "quitar") estado.carrito.delete(id), renderCarrito();
    });
  });

  carritoWrap.querySelectorAll("[data-cantidad-paquete-id]").forEach((input) => {
    const handler = () => { actualizarCantidadPaquete(input.getAttribute("data-cantidad-paquete-id"), input.value); };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
  });

  carritoWrap.querySelectorAll("[data-unidades-paquete-id]").forEach((input) => {
    const handler = () => { actualizarUnidadesPorPaquete(input.getAttribute("data-unidades-paquete-id"), input.value); };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
  });

  carritoWrap.querySelectorAll("[data-subtotal-id]").forEach((input) => {
    const handler = () => { actualizarSubtotal(input.getAttribute("data-subtotal-id"), input.value); };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
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
      const card = document.createElement("div");
      card.className = "venta-card compra-card";
      card.innerHTML = `
        <div class="venta-icono">${getEmoji(prod.iconoId)}</div>
        <div class="venta-info">
          <div class="venta-nombre">${prod.nombre}</div>
          <div class="venta-meta">Stock: ${prod.stock ?? 0}</div>
        </div>
        <button class="btn btn-sm btn-outline" style="width:auto;">Agregar</button>`;
      card.querySelector("button").addEventListener("click", () => agregarAlCarrito(prod));
      grid.appendChild(card);
    });

    seccion.appendChild(grid);
    contenedor.appendChild(seccion);
  });
}

async function finalizarCompra() {
  const btn = document.getElementById("btn-finalizar-compra");

  if (btn.disabled) return;

  // Validación visual por campo
  let hayError = false;

  const errProveedor = document.getElementById("err-proveedor");
  if (!campoTextoValido(proveedor.value)) {
    errProveedor.textContent = "El proveedor es obligatorio.";
    errProveedor.classList.add("show");
    hayError = true;
  } else {
    errProveedor.classList.remove("show");
  }

  const errMetodo = document.getElementById("err-metodo");
  if (!campoTextoValido(metodoPago.value)) {
    errMetodo.textContent = "Selecciona un método de pago.";
    errMetodo.classList.add("show");
    hayError = true;
  } else {
    errMetodo.classList.remove("show");
  }

  const errFactura = document.getElementById("err-factura");
  if (!estado.factura) {
    errFactura.textContent = "Debes adjuntar la factura.";
    errFactura.classList.add("show");
    hayError = true;
  } else {
    errFactura.classList.remove("show");
  }

  if (estado.carrito.size === 0) {
    mostrarAlertaYScrollTop("aviso", "Agrega al menos un producto al carrito.");
    return;
  }

  if (hayError) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    btn.disabled = false;
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "⏳ Procesando...";
  ocultarAlerta();

  try {
    await esperarAuthListo();

    const usuarioActual = auth.currentUser;
    if (!usuarioActual) {
      mostrarAlertaYScrollTop("error", "No se pudo identificar al usuario. Intenta iniciar sesión de nuevo.");
      return;
    }

    const itemsCompra = [...estado.carrito.values()].map((item) => ({
      ...item,
      cantidad: cantidadProductoTotal(item),
    }));

    const datosUsuario = getUsuarioActual();
    const resultado = await registrarCompra({
      usuarioId: usuarioActual.uid,
      usuarioNombre: datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email,
      proveedor: proveedor.value.trim(),
      items: itemsCompra,
      metodoPago: metodoPago.value,
      nota: nota.value.trim(),
      factura: estado.factura,
    });

    estado.carrito.clear();
    estado.factura = null;
    factura.value = "";
    renderCarrito();
    renderPreviewFactura();

    if (resultado.facturaSubida) {
      mostrarAlertaYScrollTop("success", `Compra registrada. Total ${formatearMoneda(resultado.total)}.`);
    } else {
      const avisoFactura = resultado.facturaError ? ` La factura quedó pendiente: ${resultado.facturaError}` : " La factura quedó pendiente.";
      mostrarAlertaYScrollTop("aviso", `Compra registrada. Total ${formatearMoneda(resultado.total)}.${avisoFactura}`);
    }

    nota.value = "";
    proveedor.value = "";
  } catch (error) {
    mostrarAlertaYScrollTop("error", error.message || "No se pudo registrar la compra.");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

function renderEstadoCarga() {
  $("estado-carga-compra").style.display = estado.cargando ? "block" : "none";
  $("pantalla-compra").style.display = estado.cargando ? "none" : "block";
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

proveedor.addEventListener("input", actualizarResumen);
metodoPago.addEventListener("change", actualizarResumen);
nota.addEventListener("input", actualizarResumen);

factura.addEventListener("change", () => {
  const archivo = factura.files && factura.files[0] ? factura.files[0] : null;
  try {
    validarArchivoFactura(archivo);
    estado.factura = archivo;
    ocultarAlerta();
  } catch (error) {
    estado.factura = null;
    factura.value = "";
    mostrarAlertaYScrollTop("error", error.message || "No se pudo cargar la factura.");
  }
  renderPreviewFactura();
});

$("btn-limpiar-compra").addEventListener("click", () => {
  estado.carrito.clear();
  renderCarrito();
  ocultarAlerta();
});

btnFinalizar.addEventListener("click", finalizarCompra);

renderCarrito();
renderPreviewFactura();
renderEstadoCarga();
actualizarResumen();

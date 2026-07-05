import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { escucharCategorias, getEmoji, ICONOS_PRODUCTO, crearProducto } from "./catalogo.js";
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
  productoModalCategoriaId: "",
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
const btnAgregarProducto = $("btn-agregar-producto");
const modalProducto = $("modal-prod");
const cerrarModalProducto = $("cerrar-modal-prod");
const selectCategoriaProducto = $("prod-cat-select");
const formProductoWrap = $("prod-form-wrap");
const resumenCategoriaProducto = $("prod-cat-resumen");
const errorCategoriaProducto = $("err-cat");

function abrirModal(elemento) {
  elemento.classList.add("show");
}

function cerrarModal(elemento) {
  elemento.classList.remove("show");
}

function renderGaleriaIconos(containerId, inputId) {
  const container = $(containerId);
  const iconos = ICONOS_PRODUCTO;
  container.innerHTML = "";

  iconos.forEach((icono) => {
    const div = document.createElement("div");
    div.className = "icono-opcion";
    div.dataset.id = icono.id;
    div.innerHTML = `<span class="emoji">${icono.emoji}</span><span class="label">${icono.label}</span>`;
    div.addEventListener("click", () => {
      container.querySelectorAll(".icono-opcion").forEach((item) => item.classList.remove("seleccionado"));
      div.classList.add("seleccionado");
      $(inputId).value = icono.id;
    });
    container.appendChild(div);
  });
}

function seleccionarIconoEnGaleria(containerId, inputId, iconoId) {
  $(inputId).value = iconoId;
  document.querySelectorAll(`#${containerId} .icono-opcion`).forEach((item) => {
    item.classList.toggle("seleccionado", item.dataset.id === iconoId);
  });
}

function renderSelectorCategoriasProducto() {
  const categorias = estado.categorias;
  const valorActual = selectCategoriaProducto.value || estado.productoModalCategoriaId || "";
  selectCategoriaProducto.innerHTML = '<option value="">— Selecciona una categoría —</option>';

  categorias.forEach((categoria) => {
    const option = document.createElement("option");
    option.value = categoria.id;
    option.textContent = `${getEmoji(categoria.iconoId)} ${categoria.nombre}`;
    selectCategoriaProducto.appendChild(option);
  });

  selectCategoriaProducto.value = categorias.some((categoria) => categoria.id === valorActual) ? valorActual : "";
}

function mostrarFormularioProducto(categoriaId) {
  const categoria = estado.categorias.find((item) => item.id === categoriaId);
  if (!categoria) {
    formProductoWrap.classList.add("is-hidden");
    resumenCategoriaProducto.textContent = "";
    estado.productoModalCategoriaId = "";
    return;
  }

  estado.productoModalCategoriaId = categoriaId;
  $("prod-cat-id").value = categoriaId;
  resumenCategoriaProducto.textContent = `Categoría seleccionada: ${getEmoji(categoria.iconoId)} ${categoria.nombre}`;
  formProductoWrap.classList.remove("is-hidden");
  errorCategoriaProducto.classList.remove("show");
  renderGaleriaIconos("galeria-prod", "prod-icono-sel");
}

function abrirModalNuevoProducto() {
  if (estado.categorias.length === 0) {
    mostrarAlertaYScrollTop("aviso", "Primero debes crear al menos una categoría en el catálogo.");
    return;
  }

  $("modal-prod-titulo").textContent = "Nuevo producto";
  selectCategoriaProducto.value = "";
  estado.productoModalCategoriaId = "";
  $("prod-nombre-input").value = "";
  $("prod-precio-input").value = "";
  $("prod-alerta-input").value = "";
  $("prod-icono-sel").value = "";
  $("prod-edit-id").value = "";
  $("prod-cat-id").value = "";
  formProductoWrap.classList.add("is-hidden");
  errorCategoriaProducto.classList.remove("show");
  renderSelectorCategoriasProducto();
  abrirModal(modalProducto);
}

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

function marcarCampoRequerido(campo, mensaje, errorElemento) {
  if (errorElemento) {
    errorElemento.textContent = mensaje;
    errorElemento.classList.add("show");
  }

  campo.classList.add("campo-invalido");
  campo.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof campo.focus === "function") {
    campo.focus({ preventScroll: true });
  }
}

function limpiarCampoRequerido(campo, errorElemento) {
  if (errorElemento) {
    errorElemento.textContent = "";
    errorElemento.classList.remove("show");
  }

  campo.classList.remove("campo-invalido");
}

function limpiarFormularioCompra() {
  proveedor.value = "";
  metodoPago.value = "";
  nota.value = "";
  estado.factura = null;
  factura.value = "";
  limpiarCampoRequerido(proveedor, document.getElementById("err-proveedor"));
  limpiarCampoRequerido(metodoPago, document.getElementById("err-metodo"));
  limpiarCampoRequerido(factura, document.getElementById("err-factura"));
  ocultarAlerta();
  renderPreviewFactura();
  actualizarResumen();
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
  const unidadesTotales = cantidadProductoTotal(item);
  if (!unidadesTotales) return 0;

  const totalCompra = subtotalItem(item) * Math.trunc(Number(item.cantidadPaquete || 0));
  return totalCompra > 0 ? totalCompra / unidadesTotales : 0;
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

function limpiarErrorProducto() {
  errorCategoriaProducto.classList.remove("show");
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
  estado.carrito.forEach((item) => {
    const precioPaquete = subtotalItem(item);
    const cantidadPaquetes = cantidadPaqueteValida(item.cantidadPaquete) ? Math.trunc(Number(item.cantidadPaquete)) : 0;
    total += precioPaquete * cantidadPaquetes;
  });
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
  btnFinalizar.disabled = estado.carrito.size === 0;
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

  carritoWrap.innerHTML = `
    <div class="carrito-tabla-wrap">
      <table class="carrito-tabla">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Paquetes</th>
            <th>Unidades/Paquete</th>
            <th>Total unidades</th>
            <th>Precio x Paquete</th>
            <th>Precio x unidad</th>
            <th>Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const totalUnidades = cantidadProductoTotal(item);
            const cantidadPaquetes = cantidadPaqueteValida(item.cantidadPaquete) ? Math.trunc(Number(item.cantidadPaquete)) : 0;
            const precioPaqueteValor = subtotalValido(item.subtotal) ? Number(item.subtotal) : 0;
            const totalCompra = cantidadPaquetes > 0 && precioPaqueteValor > 0 ? cantidadPaquetes * precioPaqueteValor : 0;
            const precioPaquete = precioPaqueteValor > 0 ? formatearMoneda(precioPaqueteValor) : "—";
            const precioUnidad = totalUnidades > 0 && totalCompra > 0 ? formatearMoneda(totalCompra / totalUnidades) : "—";
            return `
              <tr>
                <td class="celda-producto">
                  <div class="producto-titulo">${item.nombre}</div>
                  <div class="producto-meta">ID: ${item.productoId}</div>
                </td>
                <td>
                  <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${cantidadPaqueteValida(item.cantidadPaquete) ? item.cantidadPaquete : ""}" data-cantidad-paquete-id="${item.productoId}">
                </td>
                <td>
                  <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${unidadesPorPaqueteValida(item.unidadesPorPaquete) ? item.unidadesPorPaquete : ""}" data-unidades-paquete-id="${item.productoId}">
                </td>
                <td class="subtotal-cell">${totalUnidades > 0 ? totalUnidades : "Pendiente"}</td>
                <td>
                  <input type="text" inputmode="decimal" autocomplete="off" value="${precioPaqueteValor > 0 ? precioPaqueteValor : ""}" data-subtotal-id="${item.productoId}" placeholder="0.00">
                </td>
                <td class="subtotal-cell">${precioUnidad}</td>
                <td class="subtotal-cell">${totalCompra > 0 ? formatearMoneda(totalCompra) : "—"}</td>
                <td class="accion-cell">
                  <div class="carrito-acciones">
                    <button class="chip-btn" data-action="menos" data-id="${item.productoId}">−</button>
                    <button class="chip-btn" data-action="mas" data-id="${item.productoId}">+</button>
                    <button class="chip-btn chip-danger" data-action="quitar" data-id="${item.productoId}">✕</button>
                  </div>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  carritoWrap.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "menos") cambiarCantidadPaquete(id, -1);
      if (action === "mas") cambiarCantidadPaquete(id, 1);
      if (action === "quitar") {
        estado.carrito.delete(id);
        renderCarrito();
      }
    });
  });

  carritoWrap.querySelectorAll("[data-cantidad-paquete-id]").forEach((input) => {
    const handler = () => { actualizarCantidadPaquete(input.getAttribute("data-cantidad-paquete-id"), input.value); };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  carritoWrap.querySelectorAll("[data-unidades-paquete-id]").forEach((input) => {
    const handler = () => { actualizarUnidadesPorPaquete(input.getAttribute("data-unidades-paquete-id"), input.value); };
    input.addEventListener("change", handler);
    input.addEventListener("blur", handler);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  carritoWrap.querySelectorAll("[data-subtotal-id]").forEach((input) => {
    const handler = () => { actualizarSubtotal(input.getAttribute("data-subtotal-id"), input.value); };
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

  let hayError = false;

  const primerCampoRequerido = { actual: null };

  function registrarErrorCampo(campo, mensaje, errorElemento) {
    marcarCampoRequerido(campo, mensaje, errorElemento);
    if (!primerCampoRequerido.actual) {
      primerCampoRequerido.actual = campo;
    }
    hayError = true;
  }

  const errProveedor = document.getElementById("err-proveedor");
  if (!campoTextoValido(proveedor.value)) {
    registrarErrorCampo(proveedor, "No se ingresó el nombre del proveedor.", errProveedor);
  } else {
    limpiarCampoRequerido(proveedor, errProveedor);
  }

  const errMetodo = document.getElementById("err-metodo");
  if (!campoTextoValido(metodoPago.value)) {
    registrarErrorCampo(metodoPago, "Selecciona un método de pago.", errMetodo);
  } else {
    limpiarCampoRequerido(metodoPago, errMetodo);
  }

  const errFactura = document.getElementById("err-factura");
  if (!estado.factura) {
    registrarErrorCampo(factura, "Debes adjuntar la factura.", errFactura);
  } else {
    limpiarCampoRequerido(factura, errFactura);
  }

  if (hayError) {
    mostrarAlertaYScrollTop("aviso", "Ingrese campos requeridos.");
  }

  if (estado.carrito.size === 0) {
    mostrarAlertaYScrollTop("aviso", "Agrega al menos un producto al carrito.");
    return;
  }

  if (hayError) {
    if (primerCampoRequerido.actual) {
      primerCampoRequerido.actual.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof primerCampoRequerido.actual.focus === "function") {
        primerCampoRequerido.actual.focus({ preventScroll: true });
      }
    }
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
      precioPaquete: subtotalValido(item.subtotal) ? Number(item.subtotal) : 0,
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
      renderCarrito();
      limpiarFormularioCompra();

    if (resultado.facturaSubida) {
      mostrarAlertaYScrollTop("success", `Compra registrada. Total ${formatearMoneda(resultado.total)}.`);
    } else {
      const avisoFactura = resultado.facturaError ? ` La factura quedó pendiente: ${resultado.facturaError}` : " La factura quedó pendiente.";
      mostrarAlertaYScrollTop("aviso", `Compra registrada. Total ${formatearMoneda(resultado.total)}.${avisoFactura}`);
    }

    nota.value = "";
    proveedor.value = "";
  } catch (error) {
    console.error("[compras2] Error al registrar compra:", error.code, error.message, error);
    mostrarAlertaYScrollTop("error", error.message || "No se pudo registrar la compra.");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function guardarProductoDesdeModal() {
  const btn = $("btn-guardar-prod");
  if (btn.disabled) return;

  const categoriaId = selectCategoriaProducto.value || estado.productoModalCategoriaId || "";
  const nombre = $("prod-nombre-input").value.trim();
  const precio = Number($("prod-precio-input").value);
  const alertaMinima = Number.parseInt($("prod-alerta-input").value, 10);
  const iconoId = $("prod-icono-sel").value;

  if (!categoriaId) {
    errorCategoriaProducto.classList.add("show");
    return;
  }
  errorCategoriaProducto.classList.remove("show");

  if (!nombre) {
    mostrarAlertaYScrollTop("error", "Escribe el nombre del producto.");
    return;
  }
  if (!Number.isFinite(precio)) {
    mostrarAlertaYScrollTop("error", "Escribe un precio válido.");
    return;
  }
  if (!iconoId) {
    mostrarAlertaYScrollTop("error", "Selecciona un icono.");
    return;
  }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "⏳ Guardando...";

  try {
    await crearProducto({
      nombre,
      precioVenta: precio,
      alertaMinima: Number.isFinite(alertaMinima) ? alertaMinima : 0,
      iconoId,
      categoriaId,
    });

    cerrarModal(modalProducto);
    mostrarAlertaYScrollTop("success", "Producto creado correctamente. Ya queda disponible en la lista de productos.");
  } catch (error) {
    mostrarAlertaYScrollTop("error", error.message || "No se pudo guardar el producto.");
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
  renderSelectorCategoriasProducto();
  if (estado.productoModalCategoriaId) {
    mostrarFormularioProducto(estado.productoModalCategoriaId);
  }
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

btnAgregarProducto.addEventListener("click", abrirModalNuevoProducto);

selectCategoriaProducto.addEventListener("change", () => {
  const categoriaId = selectCategoriaProducto.value;
  if (!categoriaId) {
    estado.productoModalCategoriaId = "";
    formProductoWrap.classList.add("is-hidden");
    resumenCategoriaProducto.textContent = "";
    limpiarErrorProducto();
    return;
  }

  mostrarFormularioProducto(categoriaId);
});

cerrarModalProducto.addEventListener("click", () => cerrarModal(modalProducto));

modalProducto.addEventListener("click", (event) => {
  if (event.target === modalProducto) cerrarModal(modalProducto);
});

$("btn-guardar-prod").addEventListener("click", guardarProductoDesdeModal);

$("btn-limpiar-compra").addEventListener("click", () => {
  estado.carrito.clear();
  renderCarrito();
  limpiarFormularioCompra();
});

btnFinalizar.addEventListener("click", finalizarCompra);

renderCarrito();
renderPreviewFactura();
renderEstadoCarga();
actualizarResumen();
renderSelectorCategoriasProducto();
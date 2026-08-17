import { guardRoute, requirePermiso, getUsuarioActual, usuarioTienePermiso } from "../core/auth.js";
import { getIconoHTML } from "./catalogo.js";
import { iconoImg, iconoComboImg } from "../core/iconos.js?v=20260817-combos";
import { escaparAtributo, escaparHtml } from "../core/seguridad.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarVenta, registrarVentaConMerma, esperarAuthListo } from "../core/operaciones.js";
import {
	collection, query, where, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
await requirePermiso("acceso_venta_rapida");
const h = escaparHtml;

// Clave de sessionStorage para no perder la venta en progreso si el vendedor
// recarga la página por accidente antes de presionar "Enviar venta".
// sessionStorage (no localStorage) porque se borra solo al cerrar la pestaña,
// evitando que un carrito quede pegado para el siguiente vendedor que use el mismo dispositivo.
const CLAVE_ESTADO = "ventaRapida_enProgreso";

const estado = {
	actividades: [],
	actividadVentaId: null,
	actividadVentaNombre: "",
	productosCatalogo: [],
	productosDisponibles: [],
	combosDisponibles: [],
	productosNoAsignados: [],
	pedido: new Map(),
	mermas: new Map(),
	cargando: true,
};

// Evita que el guardado automático borre el sessionStorage con el render
// vacío inicial, antes de que se intente restaurar lo que había guardado.
let listoParaPersistir = false;

const $ = (id) => document.getElementById(id);
const catalogoWrap = $("catalogo-wrap");
const pedidoWrap = $("pedido-wrap");
const alerta = $("alerta-venta");
const metodoPago = $("metodo-pago");
const grupoMetodoPago = $("grupo-metodo-pago");
const resumenTotalLabel = $("resumen-total-label");
const btnEnviar = $("btn-enviar-venta");
const btnVaciarPedido = $("btn-vaciar-pedido");
const btnCrearActividad = $("btn-crear-actividad");
const cardMerma = $("card-merma");
const mermaLista = $("merma-lista");
const mermaContador = $("merma-contador");
const mermaProducto = $("sel-merma-producto");
const mermaCantidad = $("merma-cantidad");
const mermaError = $("merma-error");
const btnAgregarMerma = $("btn-agregar-merma");
const puedeRegistrarMerma = usuarioTienePermiso("registrar_ventas");

// Registrar actividades sigue siendo una operación administrativa. Quienes
// solo venden pueden usar las actividades existentes, pero no crear nuevas.
if (!usuarioTienePermiso("gestionar_ventas")) {
	btnCrearActividad?.remove();
}

const r2 = (v) => Math.round(Number(v) * 100) / 100;

function mostrarAlerta(tipo, mensaje) {
	alerta.textContent = mensaje;
	alerta.className = `alerta alerta-${tipo} show`;
	alerta.style.display = "block";
	window.scrollTo({ top: 0, behavior: "smooth" });
}

function ocultarAlerta() {
	alerta.className = "alerta alerta-error";
	alerta.style.display = "none";
	alerta.textContent = "";
}

function fmtFecha(ts) {
	if (!ts) return "";
	const d = ts.toDate ? ts.toDate() : new Date(ts);
	return d.toLocaleDateString("es-PA");
}

// Combina líneas repetidas del mismo producto (venta directa + venta vía combo)
// en una sola línea, para no decrementar el stock dos veces sobre el mismo documento
// dentro de la misma transacción de Firestore.
function combinarItemsPorProducto(items) {
	// Agrupa por producto + precio unitario: un mismo producto vendido a precios
	// distintos (p.ej. suelto vs. dentro de un combo) debe quedar en líneas
	// separadas para no diluir el precio real en un promedio ponderado.
	const mapa = new Map();
	items.forEach((item) => {
		const cantidad = Math.trunc(Number(item.cantidad)) || 0;
		if (cantidad <= 0) return;
		const precio = r2(Number(item.precioUnitario) || 0);
		const clave = `${item.productoId}::${precio}`;
		const existente = mapa.get(clave);
		if (existente) {
			existente.cantidad += cantidad;
		} else {
			mapa.set(clave, { ...item, cantidad, precioUnitario: precio });
		}
	});
	return [...mapa.values()];
}

// ─── CARGA DE DATOS ─────────────────────────────────────────────────────────
function esHoy(fecha) {
	if (!fecha) return false;
	const d = fecha?.toDate ? fecha.toDate() : new Date(fecha);
	const hoy = new Date();
	return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

async function cargarActividades() {
	const sel = $("sel-actividad");
	try {
		const snap = await getDocs(collection(db, "actividades_ventas"));
		estado.actividades = snap.docs
			.map((d) => ({ id: d.id, ...d.data() }))
			.filter((a) => a.activo !== false)
			.sort((a, b) => {
				const fa = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha || 0);
				const fb = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha || 0);
				return fb - fa;
			});
		// Esta pantalla lista TODAS las actividades no desactivadas, no solo
		// las de hoy — marcamos claramente cuál es la de hoy para evitar
		// seleccionar por error una actividad vieja y ver sus productos/combos.
		sel.innerHTML = `<option value="">— Selecciona una actividad —</option>` +
			estado.actividades.map((a) =>
			`<option value="${escaparAtributo(a.id)}">${esHoy(a.fecha) ? "HOY — " : ""}${h(a.nombre)}${a.fecha ? " — " + fmtFecha(a.fecha) : ""}</option>`
			).join("");
	} catch (e) {
		console.warn("No se pudieron cargar actividades:", e.message);
		sel.innerHTML = `<option value="">— Sin actividades disponibles —</option>`;
		estado.actividades = [];
	}
}

function recalcularDisponibles() {
	const a = estado.actividades.find((x) => x.id === estado.actividadVentaId) || null;
	if (!a) {
		estado.productosDisponibles = [];
		estado.combosDisponibles = [];
		estado.productosNoAsignados = [];
		return;
	}
	const idsAsignados = new Set((a.productos || []).map((p) => p.productoId));
	estado.productosDisponibles = estado.productosCatalogo.filter((p) => idsAsignados.has(p.id));
	estado.combosDisponibles = a.combos || [];
	// Productos activos que existen en el catálogo pero no se preasignaron a
	// esta actividad — van en el desplegable "Todos los productos", por si
	// falta algo por agregar el día del evento.
	estado.productosNoAsignados = estado.productosCatalogo.filter((p) => !idsAsignados.has(p.id));
}

// ─── STOCK ──────────────────────────────────────────────────────────────────
function stockDisponibleCatalogo(productoId) {
	const p = estado.productosCatalogo.find((x) => x.id === productoId);
	return Number(p?.stock || 0);
}

function unidadesEnPedidoProducto(productoId) {
	let total = 0;
	estado.pedido.forEach((it) => {
		if (it.tipo === "producto" && it.productoId === productoId) total += it.cantidad;
		if (it.tipo === "combo") {
			(it.items || []).forEach((comp) => { if (comp.productoId === productoId) total += it.cantidad; });
		}
	});
	return total;
}

// Ya NO se usa para bloquear — el stock puede estar desactualizado (producto
// físico sin cargar a inventario todavía), así que nunca debe impedir cobrar
// una venta real. El dinero siempre se registra; el stock puede quedar en
// negativo como señal para logística.

// ─── PEDIDO ─────────────────────────────────────────────────────────────────
function agregarUnidadProducto(producto) {
	if (unidadesEnPedidoProducto(producto.id) + 1 > stockDisponibleCatalogo(producto.id)) {
		mostrarAlerta("aviso", `Atención: ${producto.nombre} supera el stock registrado. Se agrega igual — la venta se registrará.`);
	}
	const key = `p_${producto.id}`;
	const actual = estado.pedido.get(key);
	if (actual) actual.cantidad += 1;
	else estado.pedido.set(key, {
		tipo: "producto",
		productoId: producto.id,
		nombre: producto.nombre,
		precioUnitario: Number(producto.precioVenta || 0),
		cantidad: 1,
	});
	ocultarAlerta();
	renderTodo();
}

function agregarUnidadCombo(combo) {
	const items = combo.items || [];
	const faltante = items.find((it) => unidadesEnPedidoProducto(it.productoId) + 1 > stockDisponibleCatalogo(it.productoId));
	if (faltante) {
		mostrarAlerta("aviso", `Atención: ${faltante.nombre} (en el combo ${combo.nombre}) supera el stock registrado. Se agrega igual.`);
	}
	const key = `c_${combo.id}`;
	const actual = estado.pedido.get(key);
	if (actual) actual.cantidad += 1;
	else estado.pedido.set(key, {
		tipo: "combo",
		comboId: combo.id,
		nombre: combo.nombre,
		icono: combo.icono,
		items,
		precioTotal: Number(combo.precioTotal) || 0,
		cantidad: 1,
	});
	ocultarAlerta();
	renderTodo();
}

function cambiarCantidadPedido(key, delta) {
	const it = estado.pedido.get(key);
	if (!it) return;
	if (delta > 0) {
		const excedido = it.tipo === "producto"
			? unidadesEnPedidoProducto(it.productoId) + 1 > stockDisponibleCatalogo(it.productoId)
			: (it.items || []).find((x) => unidadesEnPedidoProducto(x.productoId) + 1 > stockDisponibleCatalogo(x.productoId));
		if (excedido) {
			mostrarAlerta("aviso", `Atención: ${it.tipo === "producto" ? it.nombre : excedido.nombre} supera el stock registrado. Se agrega igual.`);
		}
	}
	const nuevo = it.cantidad + delta;
	if (nuevo <= 0) estado.pedido.delete(key);
	else it.cantidad = nuevo;
	renderTodo();
}

function actualizarCantidadPedido(key, valor) {
	const it = estado.pedido.get(key);
	if (!it) return;
	const numero = Math.trunc(Number(valor));
	if (!Number.isFinite(numero)) return;
	if (numero <= 0) estado.pedido.delete(key);
	else it.cantidad = numero;
	renderTodo();
}

function quitarDelPedido(key) {
	estado.pedido.delete(key);
	renderTodo();
}

function totalPedido() {
	let total = 0;
	estado.pedido.forEach((it) => {
		total += it.cantidad * (it.tipo === "producto" ? it.precioUnitario : it.precioTotal);
	});
	return total;
}

function actualizarPrecioPedido(key, valor) {
	const it = estado.pedido.get(key);
	if (!it || it.tipo !== "producto") return;
	const numero = Number(valor);
	if (Number.isFinite(numero) && numero >= 0) {
		it.precioUnitario = numero;
		renderTodo();
	}
}

// ─── MERMA ─────────────────────────────────────────────────────────────────
// La merma vive separada del carrito: representa productos dañados que ya no
// se pueden vender. No altera el total cobrado, pero sí descuenta inventario.
function mostrarErrorMerma(mensaje = "") {
	mermaError.textContent = mensaje;
	mermaError.classList.toggle("show", Boolean(mensaje));
}

function refrescarSelectorMerma() {
	const valorActual = mermaProducto.value;
	const productos = estado.productosCatalogo
		.filter(p => p.nombre)
		.slice()
		.sort((a, b) => a.nombre.localeCompare(b.nombre));
	mermaProducto.innerHTML = `<option value="">— Selecciona un producto —</option>` +
		productos.map(p => `<option value="${escaparAtributo(p.id)}">${h(p.nombre)}</option>`).join("");
	if (productos.some(p => p.id === valorActual)) mermaProducto.value = valorActual;
}

function agregarMerma() {
	const producto = estado.productosCatalogo.find(p => p.id === mermaProducto.value);
	const cantidad = Math.trunc(Number(mermaCantidad.value));
	if (!producto) { mostrarErrorMerma("Selecciona el producto que se dañó."); return; }
	if (!Number.isFinite(cantidad) || cantidad <= 0) { mostrarErrorMerma("La cantidad debe ser mayor que cero."); return; }

	const existente = estado.mermas.get(producto.id);
	estado.mermas.set(producto.id, {
		productoId: producto.id,
		nombre: producto.nombre,
		iconoId: producto.iconoId,
		cantidad: (existente?.cantidad || 0) + cantidad,
	});
	mermaProducto.value = "";
	mermaCantidad.value = "1";
	mostrarErrorMerma();
	renderTodo();
}

function actualizarCantidadMerma(productoId, valor) {
	const item = estado.mermas.get(productoId);
	if (!item) return;
	const cantidad = Math.trunc(Number(valor));
	if (!Number.isFinite(cantidad) || cantidad <= 0) estado.mermas.delete(productoId);
	else item.cantidad = cantidad;
	renderTodo();
}

function quitarMerma(productoId) {
	estado.mermas.delete(productoId);
	renderTodo();
}

// ─── PERSISTENCIA DE LA VENTA EN PROGRESO ──────────────────────────────────
function guardarEstado() {
	if (!listoParaPersistir) return;
	try {
		if (!estado.actividadVentaId && estado.pedido.size === 0 && estado.mermas.size === 0) {
			sessionStorage.removeItem(CLAVE_ESTADO);
			return;
		}
		sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify({
			actividadVentaId: estado.actividadVentaId,
			pedido: [...estado.pedido.entries()],
			mermas: [...estado.mermas.entries()],
			metodoPago: metodoPago.value,
		}));
	} catch (e) {
		console.warn("No se pudo guardar la venta en progreso:", e.message);
	}
}

function restaurarEstadoGuardado() {
	let guardado = null;
	try {
		guardado = JSON.parse(sessionStorage.getItem(CLAVE_ESTADO) || "null");
	} catch {
		guardado = null;
	}
	if (!guardado) return;

	const actividad = estado.actividades.find((a) => a.id === guardado.actividadVentaId);
	if (!actividad) {
		// La actividad guardada ya no existe o fue desactivada: no hay nada seguro que restaurar.
		sessionStorage.removeItem(CLAVE_ESTADO);
		return;
	}

	estado.actividadVentaId = actividad.id;
	estado.actividadVentaNombre = actividad.nombre;
	$("sel-actividad").value = actividad.id;
	estado.pedido = new Map(Array.isArray(guardado.pedido) ? guardado.pedido : []);
	estado.mermas = new Map(Array.isArray(guardado.mermas) ? guardado.mermas : []);
	if (guardado.metodoPago) metodoPago.value = guardado.metodoPago;
	recalcularDisponibles();

	if (estado.pedido.size > 0) {
		mostrarAlerta("aviso", "Se restauró la venta que tenías en progreso antes de recargar la página.");
	}
}

function seleccionarActividadDeRetorno() {
	const actividadId = new URLSearchParams(window.location.search).get("actividad");
	if (!actividadId) return false;

	const actividad = estado.actividades.find((item) => item.id === actividadId);
	if (!actividad) return false;

	estado.actividadVentaId = actividad.id;
	estado.actividadVentaNombre = actividad.nombre;
	$("sel-actividad").value = actividad.id;
	estado.pedido.clear();
	estado.mermas.clear();
	recalcularDisponibles();

	// La actividad ya quedó seleccionada; limpiamos el parámetro para que una
	// recarga normal no vuelva a reemplazar una venta en progreso.
	window.history.replaceState({}, "", window.location.pathname);
	return true;
}

// ─── RENDER ─────────────────────────────────────────────────────────────────
let mostrarTodosLosProductos = false;

function renderCatalogo() {
	const hayActividad = Boolean(estado.actividadVentaId);
	const hayCatalogo = estado.productosDisponibles.length > 0 || estado.combosDisponibles.length > 0 || estado.productosNoAsignados.length > 0;

	$("sin-actividad").classList.toggle("is-hidden", hayActividad);
	$("sin-catalogo").classList.toggle("is-hidden", !hayActividad || hayCatalogo);
	$("card-catalogo").style.display = hayActividad && hayCatalogo ? "" : "none";
	$("card-pedido").style.display = hayActividad && hayCatalogo ? "" : "none";
	$("barra-total").classList.toggle("is-hidden", !(hayActividad && hayCatalogo));

	if (!hayActividad || !hayCatalogo) {
		catalogoWrap.innerHTML = "";
		return;
	}

	const bloques = [];

	if (estado.combosDisponibles.length > 0) {
		bloques.push(`<div class="seccion-titulo">${iconoComboImg(estado.combosDisponibles[0])} Combos</div><div class="catalogo-grid">${
			estado.combosDisponibles.map((c) => {
				const enPedido = estado.pedido.get(`c_${c.id}`);
				const cantidad = enPedido ? enPedido.cantidad : 0;
				return `
					<div class="item-card combo ${cantidad > 0 ? "tiene-cant" : ""}" data-combo-id="${escaparAtributo(c.id)}">
						<span class="badge-combo">Combo</span>
						${cantidad > 0 ? `<span class="badge-cant" data-combo-restar="${escaparAtributo(c.id)}">${cantidad}</span>` : ""}
						<div class="icono">${iconoComboImg(c, { clase: "icono-lg" })}</div>
						<div class="nombre">${h(c.nombre)}</div>
						<div class="precio">${formatearMoneda(c.precioTotal)}</div>
					</div>`;
			}).join("")
		}</div>`);
	}

	if (estado.productosDisponibles.length > 0) {
		bloques.push(`<div class="seccion-titulo">${iconoImg("producto")} Productos</div><div class="catalogo-grid">${
			estado.productosDisponibles.map((p) => {
				const enPedido = estado.pedido.get(`p_${p.id}`);
				const cantidad = enPedido ? enPedido.cantidad : 0;
				const agotado = Number(p.stock || 0) <= 0;
				return `
					<div class="item-card ${cantidad > 0 ? "tiene-cant" : ""} ${agotado ? "agotado" : ""}" data-producto-id="${escaparAtributo(p.id)}">
						${cantidad > 0 ? `<span class="badge-cant" data-producto-restar="${escaparAtributo(p.id)}">${cantidad}</span>` : ""}
						<div class="icono">${getIconoHTML(p.iconoId, { clase: "icono-lg" })}</div>
						<div class="nombre">${h(p.nombre)}</div>
						<div class="precio">${formatearMoneda(p.precioVenta || 0)}</div>
					</div>`;
			}).join("")
		}</div>`);
	}

	// Sección plegable con el resto del catálogo activo que no se preasignó a
	// esta actividad — por si falta algo por agregar el día del evento, sin
	// tener que ir a "Crear actividad de venta" a editarla primero.
	if (estado.productosNoAsignados.length > 0) {
		bloques.push(`
			<div class="seccion-titulo" style="cursor:pointer;justify-content:space-between;" id="toggle-todos-productos">
				<span>${iconoImg("producto")} Todos los productos (${estado.productosNoAsignados.length})</span>
				<span>${mostrarTodosLosProductos ? "▲ Ocultar" : "▼ Ver todos"}</span>
			</div>
			${mostrarTodosLosProductos ? `<div class="catalogo-grid">${
				estado.productosNoAsignados.map((p) => {
					const enPedido = estado.pedido.get(`p_${p.id}`);
					const cantidad = enPedido ? enPedido.cantidad : 0;
					const agotado = Number(p.stock || 0) <= 0;
					return `
						<div class="item-card ${cantidad > 0 ? "tiene-cant" : ""} ${agotado ? "agotado" : ""}" data-producto-extra-id="${escaparAtributo(p.id)}">
							${cantidad > 0 ? `<span class="badge-cant" data-producto-extra-restar="${escaparAtributo(p.id)}">${cantidad}</span>` : ""}
							<div class="icono">${getIconoHTML(p.iconoId, { clase: "icono-lg" })}</div>
							<div class="nombre">${h(p.nombre)}</div>
							<div class="precio">${formatearMoneda(p.precioVenta || 0)}</div>
						</div>`;
				}).join("")
			}</div>` : ""}
		`);
	}

	catalogoWrap.innerHTML = bloques.join("");

	const toggleBtn = document.getElementById("toggle-todos-productos");
	if (toggleBtn) {
		toggleBtn.addEventListener("click", () => {
			mostrarTodosLosProductos = !mostrarTodosLosProductos;
			renderCatalogo();
		});
	}

	catalogoWrap.querySelectorAll("[data-combo-id]").forEach((card) => {
		card.addEventListener("click", (e) => {
			if (e.target.closest("[data-combo-restar]")) return;
			const combo = estado.combosDisponibles.find((c) => c.id === card.getAttribute("data-combo-id"));
			if (combo) agregarUnidadCombo(combo);
		});
	});
	catalogoWrap.querySelectorAll("[data-combo-restar]").forEach((badge) => {
		badge.addEventListener("click", (e) => {
			e.stopPropagation();
			cambiarCantidadPedido(`c_${badge.getAttribute("data-combo-restar")}`, -1);
		});
	});
	catalogoWrap.querySelectorAll("[data-producto-id]").forEach((card) => {
		card.addEventListener("click", (e) => {
			if (e.target.closest("[data-producto-restar]")) return;
			const producto = estado.productosDisponibles.find((p) => p.id === card.getAttribute("data-producto-id"));
			if (producto) agregarUnidadProducto(producto);
		});
	});
	catalogoWrap.querySelectorAll("[data-producto-restar]").forEach((badge) => {
		badge.addEventListener("click", (e) => {
			e.stopPropagation();
			cambiarCantidadPedido(`p_${badge.getAttribute("data-producto-restar")}`, -1);
		});
	});
	// Mismo comportamiento que los productos preasignados, pero leyendo de
	// productosNoAsignados en vez de productosDisponibles.
	catalogoWrap.querySelectorAll("[data-producto-extra-id]").forEach((card) => {
		card.addEventListener("click", (e) => {
			if (e.target.closest("[data-producto-extra-restar]")) return;
			const producto = estado.productosNoAsignados.find((p) => p.id === card.getAttribute("data-producto-extra-id"));
			if (producto) agregarUnidadProducto(producto);
		});
	});
	catalogoWrap.querySelectorAll("[data-producto-extra-restar]").forEach((badge) => {
		badge.addEventListener("click", (e) => {
			e.stopPropagation();
			cambiarCantidadPedido(`p_${badge.getAttribute("data-producto-extra-restar")}`, -1);
		});
	});
}

function renderPedido() {
	const items = [...estado.pedido.entries()];
	grupoMetodoPago.style.display = items.length > 0 ? "" : "none";
	if (items.length === 0) {
		pedidoWrap.innerHTML = `
			<div class="empty-state" style="padding:16px 4px;">
				<div class="emoji">${iconoImg("recibo", { clase: "icono-hero" })}</div>
				<p>Toca un producto o combo arriba para agregarlo.</p>
			</div>`;
	} else {
		pedidoWrap.innerHTML = items.map(([key, it]) => {
			const precio = it.tipo === "producto" ? it.precioUnitario : it.precioTotal;
			const subtotal = precio * it.cantidad;
			let aviso = "";
			if (it.tipo === "producto") {
				const restante = stockDisponibleCatalogo(it.productoId) - unidadesEnPedidoProducto(it.productoId);
				if (restante < 0) aviso = `<div class="pedido-warn">Atención: supera el stock registrado por ${Math.abs(restante)} unidad${Math.abs(restante) === 1 ? "" : "es"}. Se registrará igual.</div>`;
			} else {
				const faltantes = (it.items || [])
					.filter((x) => unidadesEnPedidoProducto(x.productoId) > stockDisponibleCatalogo(x.productoId))
					.map((x) => x.nombre);
				if (faltantes.length > 0) aviso = `<div class="pedido-warn">Atención: supera stock de ${faltantes.map(h).join(", ")}. Se registrará igual.</div>`;
			}

			return `
				<div class="pedido-fila">
					<div class="info">
						<div class="nombre">${it.tipo === "combo" ? iconoComboImg(it) + " " : ""}${h(it.nombre)}</div>
						<div class="meta">Subtotal ${formatearMoneda(subtotal)}</div>
						${aviso}
					</div>
					${it.tipo === "producto" ? `
					<div class="form-group" style="margin:0;width:90px;">
						<label style="font-size:10px;">Precio c/u</label>
						<input type="text" inputmode="decimal" value="${it.precioUnitario}" data-pedido-precio="${key}">
					</div>` : `<div class="meta" style="width:90px;text-align:right;">${formatearMoneda(precio)} c/u</div>`}
					<div class="stepper">
						<button type="button" data-pedido-menos="${key}">−</button>
						<input type="text" inputmode="numeric" pattern="[0-9]*" value="${it.cantidad}" data-pedido-cantidad="${key}">
						<button type="button" data-pedido-mas="${key}">+</button>
					</div>
					<button type="button" class="quitar" data-pedido-quitar="${key}" title="Quitar">${iconoImg("cerrar")}</button>
				</div>`;
		}).join("");
	}

	pedidoWrap.querySelectorAll("[data-pedido-menos]").forEach((btn) => {
		btn.addEventListener("click", () => cambiarCantidadPedido(btn.getAttribute("data-pedido-menos"), -1));
	});
	pedidoWrap.querySelectorAll("[data-pedido-mas]").forEach((btn) => {
		btn.addEventListener("click", () => cambiarCantidadPedido(btn.getAttribute("data-pedido-mas"), 1));
	});
	pedidoWrap.querySelectorAll("[data-pedido-quitar]").forEach((btn) => {
		btn.addEventListener("click", () => quitarDelPedido(btn.getAttribute("data-pedido-quitar")));
	});
	pedidoWrap.querySelectorAll("[data-pedido-cantidad]").forEach((input) => {
		const handler = () => actualizarCantidadPedido(input.getAttribute("data-pedido-cantidad"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});
	pedidoWrap.querySelectorAll("[data-pedido-precio]").forEach((input) => {
		const handler = () => actualizarPrecioPedido(input.getAttribute("data-pedido-precio"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});
	$("pedido-total").textContent = formatearMoneda(totalPedido());
	const hayVenta = estado.pedido.size > 0;
	const hayMerma = estado.mermas.size > 0;
	resumenTotalLabel.textContent = hayVenta ? "Total pedido" : (hayMerma ? "Merma pendiente" : "Total pedido");
	btnEnviar.disabled = (!hayVenta && !hayMerma) || !estado.actividadVentaId;
	btnEnviar.textContent = hayVenta && hayMerma
		? "Registrar venta y merma"
		: hayMerma ? "Registrar merma" : "Enviar venta";
}

function renderMerma() {
	const hayActividad = Boolean(estado.actividadVentaId) && puedeRegistrarMerma;
	cardMerma.style.display = hayActividad ? "" : "none";
	if (!hayActividad) return;

	const items = [...estado.mermas.values()];
	const cantidadTotal = items.reduce((total, item) => total + item.cantidad, 0);
	mermaContador.textContent = cantidadTotal > 0
		? `${cantidadTotal} unidad${cantidadTotal === 1 ? "" : "es"}`
		: "Sin registros";

	if (items.length === 0) {
		mermaLista.innerHTML = `<div class="merma-vacia">No hay productos dañados registrados.</div>`;
		return;
	}

	mermaLista.innerHTML = items.map(item => {
		const restante = stockDisponibleCatalogo(item.productoId) - unidadesEnPedidoProducto(item.productoId) - item.cantidad;
		return `
			<div class="merma-fila">
				<div class="producto">
					${getIconoHTML(item.iconoId)}
					<span>${h(item.nombre)}${restante < 0 ? `<small class="pedido-warn" style="display:block;">Supera el stock por ${Math.abs(restante)}</small>` : ""}</span>
				</div>
				<input type="number" min="1" step="1" value="${item.cantidad}" aria-label="Cantidad dañada de ${escaparAtributo(item.nombre)}" data-merma-cantidad="${escaparAtributo(item.productoId)}"/>
				<button type="button" class="quitar" title="Quitar merma" data-merma-quitar="${escaparAtributo(item.productoId)}">${iconoImg("eliminar")}</button>
			</div>`;
	}).join("");

	mermaLista.querySelectorAll("[data-merma-cantidad]").forEach(input => {
		const handler = () => actualizarCantidadMerma(input.getAttribute("data-merma-cantidad"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});
	mermaLista.querySelectorAll("[data-merma-quitar]").forEach(btn => {
		btn.addEventListener("click", () => quitarMerma(btn.getAttribute("data-merma-quitar")));
	});
}

function renderTodo() {
	renderCatalogo();
	renderPedido();
	renderMerma();
	guardarEstado();
}

function renderEstadoCarga() {
	$("estado-carga").style.display = estado.cargando ? "block" : "none";
	$("pantalla-venta").style.display = estado.cargando ? "none" : "block";
}

// ─── ENVIAR VENTA ───────────────────────────────────────────────────────────
async function enviarVenta() {
	if (btnEnviar.disabled) return;
	const habiaVenta = estado.pedido.size > 0;
	const habiaMerma = estado.mermas.size > 0;
	if (!habiaVenta && !habiaMerma) { mostrarAlerta("aviso", "Agrega una venta o registra una merma."); return; }
	if (!estado.actividadVentaId) { mostrarAlerta("aviso", "Selecciona una actividad de ventas."); return; }

	btnEnviar.disabled = true;
	btnEnviar.textContent = "Registrando...";
	ocultarAlerta();

	try {
		await esperarAuthListo();
		const usuarioActual = auth.currentUser;
		if (!usuarioActual) {
			mostrarAlerta("error", "No se pudo identificar al usuario. Intenta iniciar sesión de nuevo.");
			return;
		}
		const datosUsuario = getUsuarioActual();
		const usuarioId = usuarioActual.uid;
		const usuarioNombre = datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email;

		const itemsProductos = [...estado.pedido.values()]
			.filter((it) => it.tipo === "producto" && it.cantidad > 0)
			.map((it) => ({ productoId: it.productoId, nombre: it.nombre, cantidad: it.cantidad, precioUnitario: it.precioUnitario }));

		const itemsCombos = [...estado.pedido.values()]
			.filter((it) => it.tipo === "combo")
			.flatMap((it) => (it.items || []).map((comp) => ({
				productoId: comp.productoId,
				nombre: comp.nombre,
				cantidad: it.cantidad,
				precioUnitario: Number(comp.precio) || 0,
				motivo: `Venta combo: ${it.nombre}`,
			})));

		const itemsVenta = combinarItemsPorProducto([...itemsProductos, ...itemsCombos]);

		const mermaItems = [...estado.mermas.values()].map(item => ({
			productoId: item.productoId,
			nombre: item.nombre,
			cantidad: item.cantidad,
			descripcion: "Producto dañado durante la actividad",
			tipo: "sin_vender",
			fueVendido: false,
			precioUnitario: 0,
		}));

		let resultado;
		if (mermaItems.length > 0) {
			resultado = await registrarVentaConMerma({
				usuarioId,
				usuarioNombre,
				items: itemsVenta,
				metodoPago: metodoPago.value,
				nota: "",
				mermaItems,
				motivoMerma: "Producto dañado durante la actividad de venta",
				actividadVentaId: estado.actividadVentaId,
				actividadVentaNombre: estado.actividadVentaNombre,
			});
		} else {
			resultado = await registrarVenta({
				usuarioId,
				usuarioNombre,
				items: itemsVenta,
				metodoPago: metodoPago.value,
				nota: "",
				actividadVentaId: estado.actividadVentaId,
				actividadVentaNombre: estado.actividadVentaNombre,
			});
		}

		estado.pedido.clear();
		estado.mermas.clear();
		renderTodo();
		const mensaje = habiaVenta
			? `Venta${habiaMerma ? " y merma" : ""} registrada correctamente. Total ${formatearMoneda(resultado.total)}.`
			: "Merma registrada correctamente y descontada del inventario.";
		mostrarAlerta("success", mensaje);
	} catch (error) {
		mostrarAlerta("error", error.message || "No se pudo registrar la venta.");
	} finally {
		renderTodo();
	}
}

// ─── EVENTOS ────────────────────────────────────────────────────────────────
$("sel-actividad").addEventListener("change", (e) => {
	const a = estado.actividades.find((x) => x.id === e.target.value) || null;
	estado.actividadVentaId = a ? a.id : null;
	estado.actividadVentaNombre = a ? a.nombre : "";
	estado.pedido.clear();
	estado.mermas.clear();
	recalcularDisponibles();
	renderTodo();
});

btnEnviar.addEventListener("click", enviarVenta);
metodoPago.addEventListener("change", guardarEstado);
btnAgregarMerma.addEventListener("click", agregarMerma);
mermaCantidad.addEventListener("keydown", (e) => {
	if (e.key === "Enter") { e.preventDefault(); agregarMerma(); }
});

btnVaciarPedido.addEventListener("click", () => {
	if (estado.pedido.size === 0) return;
	estado.pedido.clear();
	ocultarAlerta();
	renderTodo();
});

// ─── INIT ───────────────────────────────────────────────────────────────────
onSnapshot(
	query(collection(db, "productos"), where("activo", "==", true)),
	(snap) => {
		estado.productosCatalogo = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
		refrescarSelectorMerma();
		recalcularDisponibles();
		renderTodo();
		estado.cargando = false;
		renderEstadoCarga();
	}
);

cargarActividades().then(() => {
	if (!seleccionarActividadDeRetorno()) restaurarEstadoGuardado();
	listoParaPersistir = true;
	renderTodo();
});
renderEstadoCarga();
renderTodo();

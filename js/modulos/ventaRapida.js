import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { getIconoHTML } from "./catalogo.js";
import { iconoImg } from "../core/iconos.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarVenta, registrarVentaConMerma, esperarAuthListo } from "../core/operaciones.js";
import {
	collection, query, where, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("acceso_venta_rapida");

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
const btnEnviar = $("btn-enviar-venta");
const btnVaciarPedido = $("btn-vaciar-pedido");

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
			`<option value="${a.id}">${esHoy(a.fecha) ? "HOY — " : ""}${a.nombre}${a.fecha ? " — " + fmtFecha(a.fecha) : ""}</option>`
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
			it.items.forEach((comp) => { if (comp.productoId === productoId) total += it.cantidad; });
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
		mermaVendida: false,
		mermaVendidaFueVendido: false,
		mermaVendidaCantidad: 0,
		mermaVendidaDescripcion: "",
		mermaVendidaPrecioUnitario: 0,
		mermaSinVender: false,
		mermaSinVenderCantidad: 0,
		mermaSinVenderDescripcion: "",
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
			: it.items.find((x) => unidadesEnPedidoProducto(x.productoId) + 1 > stockDisponibleCatalogo(x.productoId));
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
		if (it.tipo === "producto" && tipoMermaPrincipalItem(it) === "vendida") {
			total += mermaVendidaCantidadItem(it) * mermaVendidaPrecioItem(it);
		}
	});
	return total;
}

// ─── HELPERS DE MERMA (mismo esquema que ventas.js, para reportes consistentes) ─
function mermaVendidaActivadaItem(it) { return Boolean(it.mermaVendida); }
function mermaFueVendidoItem(it) { return Boolean(it.mermaVendidaFueVendido); }
function mermaVendidaCantidadItem(it) {
	const n = Math.trunc(Number(it.mermaVendidaCantidad));
	return Number.isFinite(n) && n > 0 ? n : 0;
}
function mermaVendidaDescripcionItem(it) { return String(it.mermaVendidaDescripcion || ""); }
function mermaVendidaPrecioItem(it) {
	const n = Number(it.mermaVendidaPrecioUnitario);
	return Number.isFinite(n) ? n : 0;
}
function mermaSinVenderActivadaItem(it) { return Boolean(it.mermaSinVender); }
function mermaSinVenderCantidadItem(it) {
	const n = Math.trunc(Number(it.mermaSinVenderCantidad));
	return Number.isFinite(n) && n > 0 ? n : 0;
}
function mermaSinVenderDescripcionItem(it) { return String(it.mermaSinVenderDescripcion || ""); }
function tipoMermaPrincipalItem(it) {
	if (!mermaVendidaActivadaItem(it) || mermaVendidaCantidadItem(it) <= 0) return null;
	return mermaFueVendidoItem(it) ? "vendida" : "sin_vender";
}
function itemMermaValida(it) {
	if (it.tipo !== "producto") return true;
	if (mermaVendidaActivadaItem(it)) {
		if (mermaVendidaCantidadItem(it) <= 0) return false;
		if (!mermaVendidaDescripcionItem(it).trim()) return false;
		if (mermaFueVendidoItem(it) && mermaVendidaPrecioItem(it) <= 0) return false;
	}
	if (mermaSinVenderActivadaItem(it)) {
		if (mermaSinVenderCantidadItem(it) <= 0) return false;
		if (!mermaSinVenderDescripcionItem(it).trim()) return false;
	}
	return true;
}
function pedidoMermaOk() {
	return [...estado.pedido.values()].every(itemMermaValida);
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

function actualizarMermaActiva(key, activada) {
	const it = estado.pedido.get(key);
	if (!it) return;
	it.mermaVendida = activada;
	if (!activada) {
		it.mermaVendidaFueVendido = false;
		it.mermaVendidaCantidad = 0;
		it.mermaVendidaDescripcion = "";
		it.mermaVendidaPrecioUnitario = 0;
	}
	renderTodo();
}
function actualizarMermaCantidad(key, valor) {
	const it = estado.pedido.get(key);
	if (!it || !mermaVendidaActivadaItem(it)) return;
	const numero = valor === "" ? 0 : Math.trunc(Number(valor));
	if (!Number.isFinite(numero) || numero < 0) return;
	it.mermaVendidaCantidad = numero;
	renderTodo();
}
function actualizarMermaDescripcion(key, valor) {
	const it = estado.pedido.get(key);
	if (!it || !mermaVendidaActivadaItem(it)) return;
	it.mermaVendidaDescripcion = String(valor || "");
	renderTodo();
}
function actualizarMermaFueVendido(key, activada) {
	const it = estado.pedido.get(key);
	if (!it || !mermaVendidaActivadaItem(it)) return;
	it.mermaVendidaFueVendido = Boolean(activada);
	if (!it.mermaVendidaFueVendido) it.mermaVendidaPrecioUnitario = 0;
	renderTodo();
}
function actualizarMermaPrecio(key, valor) {
	const it = estado.pedido.get(key);
	if (!it || !mermaFueVendidoItem(it)) return;
	const numero = valor === "" ? 0 : Number(valor);
	if (!Number.isFinite(numero) || numero < 0) return;
	it.mermaVendidaPrecioUnitario = numero;
	renderTodo();
}
function actualizarMermaSinVenderActiva(key, activada) {
	const it = estado.pedido.get(key);
	if (!it) return;
	it.mermaSinVender = activada;
	if (!activada) {
		it.mermaSinVenderCantidad = 0;
		it.mermaSinVenderDescripcion = "";
	}
	renderTodo();
}
function actualizarMermaSinVenderCantidad(key, valor) {
	const it = estado.pedido.get(key);
	if (!it || !mermaSinVenderActivadaItem(it)) return;
	const numero = valor === "" ? 0 : Math.trunc(Number(valor));
	if (!Number.isFinite(numero) || numero < 0) return;
	it.mermaSinVenderCantidad = numero;
	renderTodo();
}
function actualizarMermaSinVenderDescripcion(key, valor) {
	const it = estado.pedido.get(key);
	if (!it || !mermaSinVenderActivadaItem(it)) return;
	it.mermaSinVenderDescripcion = String(valor || "");
	renderTodo();
}

// ─── PERSISTENCIA DE LA VENTA EN PROGRESO ──────────────────────────────────
function guardarEstado() {
	if (!listoParaPersistir) return;
	try {
		if (!estado.actividadVentaId && estado.pedido.size === 0) {
			sessionStorage.removeItem(CLAVE_ESTADO);
			return;
		}
		sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify({
			actividadVentaId: estado.actividadVentaId,
			pedido: [...estado.pedido.entries()],
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
	if (guardado.metodoPago) metodoPago.value = guardado.metodoPago;
	recalcularDisponibles();

	if (estado.pedido.size > 0) {
		mostrarAlerta("aviso", "Se restauró la venta que tenías en progreso antes de recargar la página.");
	}
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
		bloques.push(`<div class="seccion-titulo">${iconoImg("combo")} Combos</div><div class="catalogo-grid">${
			estado.combosDisponibles.map((c) => {
				const enPedido = estado.pedido.get(`c_${c.id}`);
				const cantidad = enPedido ? enPedido.cantidad : 0;
				return `
					<div class="item-card combo ${cantidad > 0 ? "tiene-cant" : ""}" data-combo-id="${c.id}">
						<span class="badge-combo">Combo</span>
						${cantidad > 0 ? `<span class="badge-cant" data-combo-restar="${c.id}">${cantidad}</span>` : ""}
						<div class="icono">${iconoImg("combo", { clase: "icono-lg" })}</div>
						<div class="nombre">${c.nombre}</div>
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
					<div class="item-card ${cantidad > 0 ? "tiene-cant" : ""} ${agotado ? "agotado" : ""}" data-producto-id="${p.id}">
						${cantidad > 0 ? `<span class="badge-cant" data-producto-restar="${p.id}">${cantidad}</span>` : ""}
						<div class="icono">${getIconoHTML(p.iconoId, { clase: "icono-lg" })}</div>
						<div class="nombre">${p.nombre}</div>
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
						<div class="item-card ${cantidad > 0 ? "tiene-cant" : ""} ${agotado ? "agotado" : ""}" data-producto-extra-id="${p.id}">
							${cantidad > 0 ? `<span class="badge-cant" data-producto-extra-restar="${p.id}">${cantidad}</span>` : ""}
							<div class="icono">${getIconoHTML(p.iconoId, { clase: "icono-lg" })}</div>
							<div class="nombre">${p.nombre}</div>
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
				const faltantes = it.items
					.filter((x) => unidadesEnPedidoProducto(x.productoId) > stockDisponibleCatalogo(x.productoId))
					.map((x) => x.nombre);
				if (faltantes.length > 0) aviso = `<div class="pedido-warn">Atención: supera stock de ${faltantes.join(", ")}. Se registrará igual.</div>`;
			}

			const mermaHtml = it.tipo === "producto" ? renderMermaFila(key, it) : "";

			return `
				<div class="pedido-fila" style="flex-wrap:wrap;">
					<div class="info">
						<div class="nombre">${it.tipo === "combo" ? iconoImg("combo") + " " : ""}${it.nombre}</div>
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
					${mermaHtml}
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
	wireMermaHandlers();

	$("pedido-total").textContent = formatearMoneda(totalPedido());
	btnEnviar.disabled = estado.pedido.size === 0 || !estado.actividadVentaId || !pedidoMermaOk();
}

function renderMermaFila(key, it) {
	const mermaVendidaCant = mermaVendidaCantidadItem(it);
	const mermaSinVenderCant = mermaSinVenderCantidadItem(it);
	const errCant = mermaVendidaActivadaItem(it) && mermaVendidaCant <= 0 ? `<span class="campo-error show">Ingresa la cantidad de merma.</span>` : "";
	const errDesc = mermaVendidaActivadaItem(it) && !mermaVendidaDescripcionItem(it).trim() ? `<span class="campo-error show">Ingresa una descripción.</span>` : "";
	const errPrecio = mermaVendidaActivadaItem(it) && mermaFueVendidoItem(it) && mermaVendidaPrecioItem(it) <= 0 ? `<span class="campo-error show">Ingresa un precio mayor que 0.</span>` : "";
	const errSvCant = mermaSinVenderActivadaItem(it) && mermaSinVenderCant <= 0 ? `<span class="campo-error show">Ingresa la cantidad.</span>` : "";
	const errSvDesc = mermaSinVenderActivadaItem(it) && !mermaSinVenderDescripcionItem(it).trim() ? `<span class="campo-error show">Ingresa una descripción.</span>` : "";

	return `
		<div class="carrito-merma-box" style="width:100%;margin-top:6px;">
			<label class="merma-toggle">
				<input type="checkbox" data-merma-toggle-id="${key}" ${mermaVendidaActivadaItem(it) ? "checked" : ""}>
				¿Hubo merma de este producto?
			</label>
			<div class="merma-input-wrap ${mermaVendidaActivadaItem(it) ? "" : "is-hidden"}">
				<label>Cantidad de merma</label>
				<input type="text" inputmode="numeric" pattern="[0-9]*" value="${it.mermaVendidaCantidad || 0}" data-merma-cantidad-id="${key}">
				${errCant}
				<label>Descripción</label>
				<textarea rows="2" data-merma-desc-id="${key}" placeholder="Describe qué ocurrió...">${mermaVendidaDescripcionItem(it)}</textarea>
				${errDesc}
				<label class="merma-toggle" style="margin-top:6px;">
					<input type="checkbox" data-merma-fue-vendido-id="${key}" ${mermaFueVendidoItem(it) ? "checked" : ""}>
					Se vendió a precio reducido (si no, pérdida total)
				</label>
				<div class="merma-input-wrap ${mermaFueVendidoItem(it) ? "" : "is-hidden"}">
					<label>Precio unitario de la merma</label>
					<input type="text" inputmode="decimal" value="${it.mermaVendidaPrecioUnitario || 0}" data-merma-precio-id="${key}">
					${errPrecio}
				</div>
			</div>
		</div>
		<div class="carrito-merma-box" style="width:100%;margin-top:6px;">
			<label class="merma-toggle">
				<input type="checkbox" data-merma-sv-toggle-id="${key}" ${mermaSinVenderActivadaItem(it) ? "checked" : ""}>
				¿Pérdida total (no se vendió nada)?
			</label>
			<div class="merma-input-wrap ${mermaSinVenderActivadaItem(it) ? "" : "is-hidden"}">
				<label>Cantidad perdida</label>
				<input type="text" inputmode="numeric" pattern="[0-9]*" value="${it.mermaSinVenderCantidad || 0}" data-merma-sv-cantidad-id="${key}">
				${errSvCant}
				<label>Descripción</label>
				<textarea rows="2" data-merma-sv-desc-id="${key}" placeholder="Describe qué ocurrió...">${mermaSinVenderDescripcionItem(it)}</textarea>
				${errSvDesc}
			</div>
		</div>`;
}

function wireMermaHandlers() {
	pedidoWrap.querySelectorAll("[data-merma-toggle-id]").forEach((input) => {
		input.addEventListener("change", () => actualizarMermaActiva(input.getAttribute("data-merma-toggle-id"), input.checked));
	});
	pedidoWrap.querySelectorAll("[data-merma-cantidad-id]").forEach((input) => {
		const handler = () => actualizarMermaCantidad(input.getAttribute("data-merma-cantidad-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});
	pedidoWrap.querySelectorAll("[data-merma-desc-id]").forEach((input) => {
		const handler = () => actualizarMermaDescripcion(input.getAttribute("data-merma-desc-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});
	pedidoWrap.querySelectorAll("[data-merma-fue-vendido-id]").forEach((input) => {
		input.addEventListener("change", () => actualizarMermaFueVendido(input.getAttribute("data-merma-fue-vendido-id"), input.checked));
	});
	pedidoWrap.querySelectorAll("[data-merma-precio-id]").forEach((input) => {
		const handler = () => actualizarMermaPrecio(input.getAttribute("data-merma-precio-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});
	pedidoWrap.querySelectorAll("[data-merma-sv-toggle-id]").forEach((input) => {
		input.addEventListener("change", () => actualizarMermaSinVenderActiva(input.getAttribute("data-merma-sv-toggle-id"), input.checked));
	});
	pedidoWrap.querySelectorAll("[data-merma-sv-cantidad-id]").forEach((input) => {
		const handler = () => actualizarMermaSinVenderCantidad(input.getAttribute("data-merma-sv-cantidad-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});
	pedidoWrap.querySelectorAll("[data-merma-sv-desc-id]").forEach((input) => {
		const handler = () => actualizarMermaSinVenderDescripcion(input.getAttribute("data-merma-sv-desc-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});
}

function renderTodo() {
	renderCatalogo();
	renderPedido();
	guardarEstado();
}

function renderEstadoCarga() {
	$("estado-carga").style.display = estado.cargando ? "block" : "none";
	$("pantalla-venta").style.display = estado.cargando ? "none" : "block";
}

// ─── ENVIAR VENTA ───────────────────────────────────────────────────────────
async function enviarVenta() {
	if (btnEnviar.disabled) return;
	if (estado.pedido.size === 0) { mostrarAlerta("aviso", "Agrega al menos un producto o combo."); return; }
	if (!estado.actividadVentaId) { mostrarAlerta("aviso", "Selecciona una actividad de ventas."); return; }
	// Ya no bloqueamos por stock: si el inventario está desactualizado, la
	// venta se registra igual y el stock puede quedar negativo.
	if (!pedidoMermaOk()) { mostrarAlerta("error", "Revisa los campos de merma marcados en rojo."); return; }

	btnEnviar.disabled = true;
	const textoOriginal = btnEnviar.textContent;
	btnEnviar.textContent = "⏳ Enviando...";
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
			.flatMap((it) => it.items.map((comp) => ({
				productoId: comp.productoId,
				nombre: comp.nombre,
				cantidad: it.cantidad,
				precioUnitario: Number(comp.precio) || 0,
				motivo: `Venta combo: ${it.nombre}`,
			})));

		const itemsVenta = combinarItemsPorProducto([...itemsProductos, ...itemsCombos]);

		const mermaItems = [];
		estado.pedido.forEach((it) => {
			if (it.tipo !== "producto") return;
			const tipoPrincipal = tipoMermaPrincipalItem(it);
			if (tipoPrincipal && mermaVendidaCantidadItem(it) > 0) {
				mermaItems.push({
					productoId: it.productoId,
					nombre: it.nombre,
					cantidad: mermaVendidaCantidadItem(it),
					descripcion: mermaVendidaDescripcionItem(it),
					tipo: tipoPrincipal,
					fueVendido: tipoPrincipal === "vendida",
					precioUnitario: tipoPrincipal === "vendida" ? mermaVendidaPrecioItem(it) : 0,
				});
			}
			if (mermaSinVenderActivadaItem(it) && mermaSinVenderCantidadItem(it) > 0) {
				mermaItems.push({
					productoId: it.productoId,
					nombre: it.nombre,
					cantidad: mermaSinVenderCantidadItem(it),
					descripcion: mermaSinVenderDescripcionItem(it),
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
				nota: "",
				mermaItems,
				motivoMerma: "Merma registrada desde ventas",
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
		renderTodo();
		mostrarAlerta("success", `Registrado correctamente. Total ${formatearMoneda(resultado.total)}.`);
	} catch (error) {
		mostrarAlerta("error", error.message || "No se pudo registrar la venta.");
	} finally {
		btnEnviar.disabled = estado.pedido.size === 0 || !estado.actividadVentaId;
		btnEnviar.textContent = textoOriginal;
	}
}

// ─── EVENTOS ────────────────────────────────────────────────────────────────
$("sel-actividad").addEventListener("change", (e) => {
	const a = estado.actividades.find((x) => x.id === e.target.value) || null;
	estado.actividadVentaId = a ? a.id : null;
	estado.actividadVentaNombre = a ? a.nombre : "";
	estado.pedido.clear();
	recalcularDisponibles();
	renderTodo();
});

btnEnviar.addEventListener("click", enviarVenta);
metodoPago.addEventListener("change", guardarEstado);

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
		recalcularDisponibles();
		renderTodo();
		estado.cargando = false;
		renderEstadoCarga();
	}
);

cargarActividades().then(() => {
	restaurarEstadoGuardado();
	listoParaPersistir = true;
	renderTodo();
});
renderEstadoCarga();
renderTodo();

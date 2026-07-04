import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { getEmoji } from "./catalogo.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarVenta, esperarAuthListo } from "../core/operaciones.js";
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
		sel.innerHTML = `<option value="">— Selecciona una actividad —</option>` +
			estado.actividades.map((a) =>
				`<option value="${a.id}">${a.nombre}${a.fecha ? " — " + fmtFecha(a.fecha) : ""}</option>`
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
		return;
	}
	const idsAsignados = new Set((a.productos || []).map((p) => p.productoId));
	estado.productosDisponibles = estado.productosCatalogo.filter((p) => idsAsignados.has(p.id));
	estado.combosDisponibles = a.combos || [];
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

function pedidoStockOk() {
	const ids = new Set();
	estado.pedido.forEach((it) => {
		if (it.tipo === "producto") ids.add(it.productoId);
		else it.items.forEach((x) => ids.add(x.productoId));
	});
	for (const id of ids) {
		if (unidadesEnPedidoProducto(id) > stockDisponibleCatalogo(id)) return false;
	}
	return true;
}

// ─── PEDIDO ─────────────────────────────────────────────────────────────────
function agregarUnidadProducto(producto) {
	if (unidadesEnPedidoProducto(producto.id) + 1 > stockDisponibleCatalogo(producto.id)) {
		mostrarAlerta("aviso", `Sin stock suficiente de ${producto.nombre}.`);
		return;
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
		mostrarAlerta("aviso", `Sin stock suficiente de ${faltante.nombre} para el combo ${combo.nombre}.`);
		return;
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
		const bloqueado = it.tipo === "producto"
			? unidadesEnPedidoProducto(it.productoId) + 1 > stockDisponibleCatalogo(it.productoId)
			: it.items.find((x) => unidadesEnPedidoProducto(x.productoId) + 1 > stockDisponibleCatalogo(x.productoId));
		if (bloqueado) {
			mostrarAlerta("aviso", `Sin stock suficiente de ${it.tipo === "producto" ? it.nombre : bloqueado.nombre}.`);
			return;
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
function renderCatalogo() {
	const hayActividad = Boolean(estado.actividadVentaId);
	const hayCatalogo = estado.productosDisponibles.length > 0 || estado.combosDisponibles.length > 0;

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
		bloques.push(`<div class="seccion-titulo">🍔 Combos</div><div class="catalogo-grid">${
			estado.combosDisponibles.map((c) => {
				const enPedido = estado.pedido.get(`c_${c.id}`);
				const cantidad = enPedido ? enPedido.cantidad : 0;
				return `
					<div class="item-card combo ${cantidad > 0 ? "tiene-cant" : ""}" data-combo-id="${c.id}">
						<span class="badge-combo">Combo</span>
						${cantidad > 0 ? `<span class="badge-cant" data-combo-restar="${c.id}">${cantidad}</span>` : ""}
						<div class="icono">🍔</div>
						<div class="nombre">${c.nombre}</div>
						<div class="precio">${formatearMoneda(c.precioTotal)}</div>
					</div>`;
			}).join("")
		}</div>`);
	}

	if (estado.productosDisponibles.length > 0) {
		bloques.push(`<div class="seccion-titulo">🧾 Productos</div><div class="catalogo-grid">${
			estado.productosDisponibles.map((p) => {
				const enPedido = estado.pedido.get(`p_${p.id}`);
				const cantidad = enPedido ? enPedido.cantidad : 0;
				const agotado = Number(p.stock || 0) <= 0;
				return `
					<div class="item-card ${cantidad > 0 ? "tiene-cant" : ""} ${agotado ? "agotado" : ""}" data-producto-id="${p.id}">
						${cantidad > 0 ? `<span class="badge-cant" data-producto-restar="${p.id}">${cantidad}</span>` : ""}
						<div class="icono">${getEmoji(p.iconoId)}</div>
						<div class="nombre">${p.nombre}</div>
						<div class="precio">${formatearMoneda(p.precioVenta || 0)}</div>
					</div>`;
			}).join("")
		}</div>`);
	}

	catalogoWrap.innerHTML = bloques.join("");

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
}

function renderPedido() {
	const items = [...estado.pedido.entries()];
	if (items.length === 0) {
		pedidoWrap.innerHTML = `
			<div class="empty-state" style="padding:16px 4px;">
				<div class="emoji">🧾</div>
				<p>Toca un producto o combo arriba para agregarlo.</p>
			</div>`;
	} else {
		pedidoWrap.innerHTML = items.map(([key, it]) => {
			const precio = it.tipo === "producto" ? it.precioUnitario : it.precioTotal;
			const subtotal = precio * it.cantidad;
			let aviso = "";
			if (it.tipo === "producto") {
				const restante = stockDisponibleCatalogo(it.productoId) - unidadesEnPedidoProducto(it.productoId);
				if (restante < 0) aviso = `<div class="pedido-warn">Excede stock por ${Math.abs(restante)} unidad${Math.abs(restante) === 1 ? "" : "es"}.</div>`;
			} else {
				const faltantes = it.items
					.filter((x) => unidadesEnPedidoProducto(x.productoId) > stockDisponibleCatalogo(x.productoId))
					.map((x) => x.nombre);
				if (faltantes.length > 0) aviso = `<div class="pedido-warn">Excede stock de: ${faltantes.join(", ")}.</div>`;
			}
			return `
				<div class="pedido-fila">
					<div class="info">
						<div class="nombre">${it.tipo === "combo" ? "🍔 " : ""}${it.nombre}</div>
						<div class="meta">${formatearMoneda(precio)} c/u · Subtotal ${formatearMoneda(subtotal)}</div>
						${aviso}
					</div>
					<div class="stepper">
						<button type="button" data-pedido-menos="${key}">−</button>
						<input type="text" inputmode="numeric" pattern="[0-9]*" value="${it.cantidad}" data-pedido-cantidad="${key}">
						<button type="button" data-pedido-mas="${key}">+</button>
					</div>
					<button type="button" class="quitar" data-pedido-quitar="${key}">✕</button>
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

	$("pedido-total").textContent = formatearMoneda(totalPedido());
	btnEnviar.disabled = estado.pedido.size === 0 || !estado.actividadVentaId || !pedidoStockOk();
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
	if (!pedidoStockOk()) { mostrarAlerta("error", "Hay productos sin stock suficiente en el pedido."); return; }

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

		const itemsProductos = [...estado.pedido.values()]
			.filter((it) => it.tipo === "producto")
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

		const resultado = await registrarVenta({
			usuarioId: usuarioActual.uid,
			usuarioNombre: datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email,
			items: itemsVenta,
			metodoPago: metodoPago.value,
			nota: "",
			actividadVentaId: estado.actividadVentaId,
			actividadVentaNombre: estado.actividadVentaNombre,
		});

		estado.pedido.clear();
		renderTodo();
		mostrarAlerta("success", `Venta registrada. Total ${formatearMoneda(resultado.total)}.`);
	} catch (error) {
		mostrarAlerta("error", error.message || "No se pudo registrar la venta.");
	} finally {
		btnEnviar.disabled = estado.pedido.size === 0 || !estado.actividadVentaId || !pedidoStockOk();
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

import { guardRoute, requirePermiso, getUsuarioActual } from "../core/auth.js";
import { escucharCategorias, getEmoji, estadoStock } from "./catalogo.js";
import { db, auth } from "../core/firebase-config.js";
import { formatearMoneda, registrarVenta, registrarVentaConMerma, esperarAuthListo } from "../core/operaciones.js";
import {
	collection, query, where, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

guardRoute();
requirePermiso("registrar_ventas");

const estado = {
	categorias: [],
	productos: [],
	actividades: [],
	actividadVentaId: null,
	actividadVentaNombre: "",
	combosDisponibles: [],
	termino: "",
	carrito: new Map(),
	carritoCombos: new Map(),
	cargando: true,
};

const $ = (id) => document.getElementById(id);
const productosWrap = $("productos-wrap");
const combosWrap = $("combos-wrap");
const carritoWrap = $("carrito-wrap");
const carritoCombosWrap = $("carrito-combos-wrap");
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

function mostrarAlertaYScrollTop(tipo, mensaje) {
	mostrarAlerta(tipo, mensaje);
	window.scrollTo({ top: 0, behavior: "smooth" });
}

function enteroNoNegativo(valor) {
	const numero = Math.trunc(Number(valor));
	return Number.isFinite(numero) && numero >= 0;
}

function enteroPositivo(valor) {
	const numero = Math.trunc(Number(valor));
	return Number.isFinite(numero) && numero > 0;
}

function unidadesPorCajaProducto(producto) {
	const candidato = Number(producto.unidadesPorCaja ?? producto.unidadesPorPaquete ?? producto.cantidadPorPaquete ?? 12);
	return enteroPositivo(candidato) ? Math.trunc(candidato) : 12;
}

function cajasItem(item) {
	return enteroNoNegativo(item.cajas) ? Math.trunc(Number(item.cajas)) : 0;
}

function unidadesPorCajaItem(item) {
	return enteroPositivo(item.unidadesPorCaja) ? Math.trunc(Number(item.unidadesPorCaja)) : 0;
}

function unidadesSueltasItem(item) {
	return enteroNoNegativo(item.unidadesSueltas) ? Math.trunc(Number(item.unidadesSueltas)) : 0;
}

function mermaActivadaItem(item) {
	return Boolean(item.mermaVendida || item.mermaSinVender || item.merma);
}

function mermaVendidaActivadaItem(item) {
	return Boolean(item.mermaVendida);
}

function mermaSinVenderActivadaItem(item) {
	return Boolean(item.mermaSinVender);
}

function mermaVendidaCantidadItem(item) {
	return enteroNoNegativo(item.mermaVendidaCantidad) ? Math.trunc(Number(item.mermaVendidaCantidad)) : 0;
}

function mermaSinVenderCantidadItem(item) {
	return enteroNoNegativo(item.mermaSinVenderCantidad) ? Math.trunc(Number(item.mermaSinVenderCantidad)) : 0;
}

function mermaVendidaDescripcionItem(item) {
	return String(item.mermaVendidaDescripcion || "");
}

function mermaSinVenderDescripcionItem(item) {
	return String(item.mermaSinVenderDescripcion || "");
}

function mermaVendidaPrecioItem(item) {
	const numero = Number(item.mermaVendidaPrecioUnitario);
	return Number.isFinite(numero) ? numero : 0;
}

function mermaCantidadItem(item) {
	return mermaVendidaCantidadItem(item) + mermaSinVenderCantidadItem(item);
}

function mermaFueVendidoItem(item) {
	return Boolean(item.mermaVendidaFueVendido);
}

function mermaPrincipalEsVendidaItem(item) {
	return mermaVendidaActivadaItem(item) && mermaFueVendidoItem(item);
}

function tipoMermaPrincipalItem(item) {
	if (!mermaVendidaActivadaItem(item) || mermaVendidaCantidadItem(item) <= 0) return null;
	return mermaFueVendidoItem(item) ? "vendida" : "sin_vender";
}

function mermaPrecioItem(item) {
	const numero = Number(item.mermaVendidaPrecioUnitario);
	return Number.isFinite(numero) ? numero : 0;
}

function totalUnidadesVendidas(item) {
	const cajas = cajasItem(item);
	const porCaja = unidadesPorCajaItem(item);
	const sueltas = unidadesSueltasItem(item);
	return cajas * porCaja + sueltas;
}

function totalUnidadesMerma(item) {
	return mermaCantidadItem(item);
}

function totalUnidadesMovimiento(item) {
	return totalUnidadesVendidas(item) + totalUnidadesMerma(item);
}

function precioItem(item) {
	const numero = Number(item.precioUnitario);
	return Number.isFinite(numero) ? numero : 0;
}

const r2 = (v) => Math.round(Number(v) * 100) / 100;

function totalCarrito() {
	let total = 0;
	estado.carrito.forEach((item) => {
		total += totalUnidadesVendidas(item) * precioItem(item);
		if (mermaVendidaActivadaItem(item) && mermaFueVendidoItem(item) && mermaVendidaCantidadItem(item) > 0) {
			total += mermaVendidaCantidadItem(item) * mermaVendidaPrecioItem(item);
		}
	});
	return total;
}

function cantidadTotalVendida() {
	let total = 0;
	estado.carrito.forEach((item) => { total += totalUnidadesVendidas(item); });
	total += totalUnidadesCombos();
	return total;
}

function cantidadTotalMerma() {
	let total = 0;
	estado.carrito.forEach((item) => { total += totalUnidadesMerma(item); });
	return total;
}

function hayVentaNormal() {
	return [...estado.carrito.values()].some((item) => totalUnidadesVendidas(item) > 0) || estado.carritoCombos.size > 0;
}

function totalUnidadesCombos() {
	let total = 0;
	estado.carritoCombos.forEach((c) => { total += c.cantidad * c.items.length; });
	return total;
}

function totalMontoCombos() {
	let total = 0;
	estado.carritoCombos.forEach((c) => { total += c.precioTotal * c.cantidad; });
	return total;
}

function gananciaCombos() {
	let total = 0;
	estado.carritoCombos.forEach((c) => {
		c.items.forEach((it) => {
			const producto = productoActual(it.productoId);
			const costoProducto = Number(producto?.precioCompra ?? producto?.ultimoCosto ?? producto?.precioVenta ?? 0);
			total += (Number(it.precio) - costoProducto) * c.cantidad;
		});
	});
	return total;
}

function unidadesRequeridasProducto(productoId) {
	let total = 0;
	const item = estado.carrito.get(productoId);
	if (item) total += totalUnidadesMovimiento(item);
	estado.carritoCombos.forEach((c) => {
		if (c.items.some((it) => it.productoId === productoId)) {
			total += c.cantidad;
		}
	});
	return total;
}

function stockSuficienteParaTodo() {
	const productosImplicados = new Set();
	estado.carrito.forEach((item) => productosImplicados.add(item.productoId));
	estado.carritoCombos.forEach((c) => c.items.forEach((it) => productosImplicados.add(it.productoId)));
	for (const productoId of productosImplicados) {
		if (unidadesRequeridasProducto(productoId) > stockDisponible(productoId)) return false;
	}
	return true;
}

function motivoMermaDefault() {
	return "Merma registrada desde ventas 2";
}

function stockDisponible(productoId) {
	const producto = estado.productos.find((p) => p.id === productoId);
	return Number(producto?.stock || 0);
}

function carritoCompleto() {
	if (estado.carrito.size === 0 && estado.carritoCombos.size === 0) return false;
	if (!estado.actividadVentaId) return false;

	const itemsValidos = [...estado.carrito.values()].every((item) => {
		const vendido = totalUnidadesVendidas(item);
		const mermaVendida = mermaVendidaCantidadItem(item);
		const mermaSinVender = mermaSinVenderCantidadItem(item);
		if (mermaVendidaActivadaItem(item)) {
			if (mermaVendida <= 0) return false;
			if (String(mermaVendidaDescripcionItem(item)).trim().length === 0) return false;
			if (mermaFueVendidoItem(item) && mermaVendidaPrecioItem(item) <= 0) return false;
		}
		if (mermaSinVenderActivadaItem(item)) {
			if (mermaSinVender <= 0) return false;
			if (String(mermaSinVenderDescripcionItem(item)).trim().length === 0) return false;
		}
		return vendido > 0 || mermaVendida > 0 || mermaSinVender > 0;
	});
	const combosValidos = [...estado.carritoCombos.values()].every((c) => c.cantidad > 0);

	return itemsValidos
		&& combosValidos
		&& stockSuficienteParaTodo()
		&& (
			!hayVentaNormal()
			|| String(metodoPago.value || "").trim().length > 0
		);
}

function actualizarResumen() {
	let ventaTotal = 0;
	let ventaProfit = 0;
	let mermaVendidaTotal = 0;
	let mermaVendidaProfit = 0;
	let perdidaMermaSinVender = 0;

	estado.carrito.forEach((item) => {
		const producto = productoActual(item.productoId);
		const costoProducto = Number(producto?.precioCompra ?? producto?.ultimoCosto ?? producto?.precioVenta ?? 0);
		const vendido = totalUnidadesVendidas(item);
		ventaTotal += vendido * precioItem(item);
		ventaProfit += (precioItem(item) - costoProducto) * vendido;

		const mv = mermaVendidaCantidadItem(item);
		if (mermaVendidaActivadaItem(item) && mermaFueVendidoItem(item) && mv > 0) {
			mermaVendidaTotal  += mv * mermaVendidaPrecioItem(item);
			mermaVendidaProfit += (mermaVendidaPrecioItem(item) - costoProducto) * mv;
		}

		const msv = mermaSinVenderCantidadItem(item);
		if (mermaSinVenderActivadaItem(item) && msv > 0) {
			perdidaMermaSinVender += costoProducto * msv;
		}
	});

	const totalCombinado = ventaTotal + mermaVendidaTotal + totalMontoCombos();
	const gananciaCombinada = ventaProfit + mermaVendidaProfit - perdidaMermaSinVender + gananciaCombos();

	$("resumen-vendidas").textContent = String(cantidadTotalVendida());
	$("resumen-total").textContent = formatearMoneda(totalCombinado);
	$("resumen-ganancia").textContent = formatearMoneda(gananciaCombinada);

	btnFinalizar.textContent = hayVentaNormal() ? "Registrar venta" : "Registrar merma";
	btnFinalizar.disabled = !carritoCompleto();
}

function productoActual(productoId) {
	return estado.productos.find((producto) => producto.id === productoId);
}

function agregarAlCarrito(producto) {
	const actual = estado.carrito.get(producto.id);
	if (actual) {
		actual.cajas = cajasItem(actual) + 1;
	} else {
		estado.carrito.set(producto.id, {
			productoId: producto.id,
			nombre: producto.nombre,
			precioUnitario: Number(producto.precioVenta || 0),
			cajas: 1,
			unidadesPorCaja: unidadesPorCajaProducto(producto),
			unidadesSueltas: 0,
			mermaVendida: false,
			mermaVendidaFueVendido: false,
			mermaVendidaCantidad: 0,
			mermaVendidaDescripcion: "",
			mermaVendidaPrecioUnitario: 0,
			mermaSinVender: false,
			mermaSinVenderCantidad: 0,
			mermaSinVenderDescripcion: "",
			merma: false,
		});
	}

	ocultarAlerta();
	renderCarrito();
}

function cambiarCajas(productoId, delta) {
	const item = estado.carrito.get(productoId);
	if (!item) return;
	const nuevoValor = cajasItem(item) + delta;
	if (nuevoValor <= 0) {
		estado.carrito.delete(productoId);
	} else {
		item.cajas = nuevoValor;
	}
	renderCarrito();
}

function actualizarCajas(productoId, valor) {
	const item = estado.carrito.get(productoId);
	if (!item) return;
	const numero = Math.trunc(Number(valor));
	if (!Number.isFinite(numero)) return;
	if (numero <= 0) {
		estado.carrito.delete(productoId);
	} else {
		item.cajas = numero;
	}
	renderCarrito();
}

function actualizarUnidadesPorCaja(productoId, valor) {
	const item = estado.carrito.get(productoId);
	if (!item) return;
	const numero = Math.trunc(Number(valor));
	if (!Number.isFinite(numero) || numero < 0) return;
	item.unidadesPorCaja = numero;
	renderCarrito();
}

function actualizarUnidadesSueltas(productoId, valor) {
	const item = estado.carrito.get(productoId);
	if (!item) return;
	if (valor === "") {
		item.unidadesSueltas = 0;
		renderCarrito();
		return;
	}
	const numero = Math.trunc(Number(valor));
	if (!Number.isFinite(numero) || numero < 0) return;
	item.unidadesSueltas = numero;
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
	item.merma = Boolean(item.mermaVendida || item.mermaSinVender);
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
	if (!item.mermaVendidaFueVendido) {
		item.mermaVendidaPrecioUnitario = 0;
	}
	renderCarrito();
}

function actualizarMermaPrecio(productoId, valor) {
	const item = estado.carrito.get(productoId);
	if (!item || !mermaFueVendidoItem(item)) return;
	if (valor === "") {
		item.mermaVendidaPrecioUnitario = 0;
		renderCarrito();
		return;
	}
	const numero = Number(valor);
	if (!Number.isFinite(numero) || numero < 0) return;
	item.mermaVendidaPrecioUnitario = numero;
	renderCarrito();
}

function actualizarMermaCantidad(productoId, valor) {
	const item = estado.carrito.get(productoId);
	if (!item || !mermaVendidaActivadaItem(item)) return;
	if (valor === "") {
		item.mermaVendidaCantidad = 0;
		renderCarrito();
		return;
	}
	const numero = Math.trunc(Number(valor));
	if (!Number.isFinite(numero) || numero < 0) return;
	item.mermaVendidaCantidad = numero;
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
	item.merma = Boolean(item.mermaVendida || item.mermaSinVender);
	renderCarrito();
}

function actualizarMermaSinVenderCantidad(productoId, valor) {
	const item = estado.carrito.get(productoId);
	if (!item || !mermaSinVenderActivadaItem(item)) return;
	if (valor === "") {
		item.mermaSinVenderCantidad = 0;
		renderCarrito();
		return;
	}
	const numero = Math.trunc(Number(valor));
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
	renderCarritoCombos();

	const items = [...estado.carrito.values()];
	if (items.length === 0) {
		carritoWrap.innerHTML = estado.carritoCombos.size > 0 ? "" : `
			<div class="empty-state" style="padding:24px 16px;">
				<div class="emoji">🧾</div>
				<p>Aún no agregas productos a la venta.</p>
			</div>`;
		actualizarResumen();
		return;
	}

	carritoWrap.innerHTML = items.map((item) => {
		const producto = productoActual(item.productoId);
		const stock = Number(producto?.stock || 0);
		const vendido = totalUnidadesVendidas(item);
		const mermaVendida = mermaVendidaCantidadItem(item);
		const mermaSinVender = mermaSinVenderCantidadItem(item);
		const restante = stock - unidadesRequeridasProducto(item.productoId);
		const estadoStockProd = producto ? estadoStock(producto.stock ?? 0, producto.alertaMinima ?? 0) : "ok";
		const avisoStock = restante < 0 ? `<div class="carrito-warn">Excede el stock disponible por ${Math.abs(restante)} unidades.</div>` : "";
		const costoProducto = Number(producto?.precioCompra ?? producto?.ultimoCosto ?? producto?.precioVenta ?? 0);
		const utilidadVenta = (precioItem(item) - costoProducto) * vendido;
		const tipoMermaPrincipal = tipoMermaPrincipalItem(item);
		const utilidadMermaPrincipal = tipoMermaPrincipal === "vendida"
			? (mermaVendidaPrecioItem(item) - costoProducto) * mermaVendida
			: tipoMermaPrincipal === "sin_vender"
				? -costoProducto * mermaVendida
				: 0;
		const perdidaMermaSinVenderLocal = costoProducto * mermaSinVender;
		const utilidadTotal = utilidadVenta + utilidadMermaPrincipal - perdidaMermaSinVenderLocal;

		const lineaResumen = utilidadVenta >= 0 ? `Ganancia estimada ${formatearMoneda(utilidadVenta)}` : `Pérdida estimada ${formatearMoneda(Math.abs(utilidadVenta))}`;
		const mermaPrincipalCantidad = mermaVendidaCantidadItem(item);
		const mermaPrincipalResumen = tipoMermaPrincipal === "vendida"
			? `${mermaPrincipalCantidad} unidades de merma vendida`
			: tipoMermaPrincipal === "sin_vender"
				? `${mermaPrincipalCantidad} unidades de merma sin vender`
				: "";
		const mermaPrincipalLineaResumen = utilidadTotal >= 0
			? `Ganancia estimada ${formatearMoneda(utilidadTotal)}`
			: `Pérdida estimada ${formatearMoneda(Math.abs(utilidadTotal))}`;
		const mermaVendidaBalance = (mermaVendidaPrecioItem(item) - costoProducto) * mermaVendida;
		const estiloMermaVendida = mermaVendidaBalance >= 0
			? "background: rgba(46, 125, 50, 0.08); color: var(--verde-oscuro); border: 1px solid rgba(46, 125, 50, 0.18);"
			: "background: rgba(192, 57, 43, 0.08); color: var(--rojo); border: 1px solid rgba(192, 57, 43, 0.18);";
		const errorMermaPrincipalCantidad = mermaPrincipalEsVendidaItem(item)
			? "Ingresa la cantidad de merma vendida."
			: "Ingresa la cantidad de merma sin vender.";
		const errorMermaPrincipalDesc = mermaPrincipalEsVendidaItem(item)
			? "Ingresa una descripción de la merma vendida."
			: "Ingresa una descripción de la merma sin vender.";
		const errorVentaCantidad = mermaVendidaActivadaItem(item) && mermaVendida <= 0 ? `<span class="campo-error show">${errorMermaPrincipalCantidad}</span>` : "";
		const errorVentaDesc = mermaVendidaActivadaItem(item) && String(mermaVendidaDescripcionItem(item)).trim().length === 0 ? `<span class="campo-error show">${errorMermaPrincipalDesc}</span>` : "";
		const errorVentaPrecio = mermaVendidaActivadaItem(item) && mermaVendidaPrecioItem(item) <= 0 ? `<span class="campo-error show">Ingresa un precio unitario de merma mayor que 0.</span>` : "";
		const errorSinVenderCantidad = mermaSinVenderActivadaItem(item) && mermaSinVender <= 0 ? `<span class="campo-error show">Ingresa la cantidad de merma sin vender.</span>` : "";
		const errorSinVenderDesc = mermaSinVenderActivadaItem(item) && String(mermaSinVenderDescripcionItem(item)).trim().length === 0 ? `<span class="campo-error show">Ingresa una descripción de la merma sin vender.</span>` : "";

		return `
			<div class="carrito-item">
				<div class="carrito-nombre">${item.nombre}</div>
				<div class="carrito-meta">${vendido} unidades vendidas</div>
				${tipoMermaPrincipal ? `<div class="carrito-meta">${mermaPrincipalResumen}</div>` : ""}
				<div class="carrito-meta">Unidades sin vender: ${restante >= 0 ? restante : 0}</div>
				<div class="carrito-meta">${cajasItem(item)} caja${cajasItem(item) === 1 ? "" : "s"} x ${unidadesPorCajaItem(item)} + ${unidadesSueltasItem(item)} sueltas = ${vendido} unidades</div>
				<div class="carrito-meta">Precio unitario: ${formatearMoneda(precioItem(item))}</div>
				<div class="carrito-resumen-item">Total ${formatearMoneda(vendido * precioItem(item) + (mermaVendida * mermaVendidaPrecioItem(item)))}</div>
				${tipoMermaPrincipal ? `<div class="carrito-resumen-item">${mermaPrincipalLineaResumen}</div>` : ""}
				${avisoStock}
				<div class="carrito-controles">
					<button class="chip-btn" data-action="menos" data-id="${item.productoId}">−</button>
					<button class="chip-btn" data-action="mas" data-id="${item.productoId}">+</button>
					<button class="chip-btn chip-danger" data-action="quitar" data-id="${item.productoId}">✕</button>
				</div>
				<div class="carrito-campos">
					<div class="form-group">
						<label for="cajas-${item.productoId}">Cajas o paquetes vendidos</label>
						<input id="cajas-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${cajasItem(item)}" data-cajas-id="${item.productoId}">
					</div>
					<div class="form-group">
						<label for="por-caja-${item.productoId}">Unidades por caja o paquete</label>
						<input id="por-caja-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${unidadesPorCajaItem(item)}" data-por-caja-id="${item.productoId}">
					</div>
					<div class="form-group">
						<label for="sueltas-${item.productoId}">Unidades individuales vendidas (Si aplica)</label>
						<input id="sueltas-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${unidadesSueltasItem(item)}" data-sueltas-id="${item.productoId}">
					</div>
					<div class="form-group carrito-merma-box" style="grid-column:1 / -1;">
						<label class="merma-toggle" style="justify-content:space-between;">
						<table>
							<tr>
							<td style="padding:5px 0px 0 0; border:1px; border-collapse:collapse; font-size:12px; color:#555;"><input type="checkbox" data-merma-vendida-toggle-id="${item.productoId}" ${mermaVendidaActivadaItem(item) ? "checked" : ""}></td>
							<td style="padding:0px 4px 0 0;">¿Desea agregar merma?</td>
							</tr>
						</table>
						</label>
						<div class="merma-input-wrap ${mermaVendidaActivadaItem(item) ? "" : "is-hidden"}" data-merma-vendida-wrap="${item.productoId}">
							<label for="merma-vendida-cantidad-${item.productoId}">Cantidad de merma</label>
							<input id="merma-vendida-cantidad-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${mermaVendidaCantidadItem(item)}" data-merma-vendida-cantidad-id="${item.productoId}">
							${errorVentaCantidad}
							<label for="merma-vendida-desc-${item.productoId}">Descripción</label>
							<textarea id="merma-vendida-desc-${item.productoId}" rows="2" data-merma-vendida-desc-id="${item.productoId}" placeholder="Describe qué ocurrió...">${mermaVendidaDescripcionItem(item)}</textarea>
							${errorVentaDesc}
							<label class="merma-toggle" style="margin-top:8px; font-weight:600; justify-content:space-between;">
								<table>
								<tr>
									<td style="padding:5px 0px 0 0; border:1px; border-collapse:collapse; font-size:12px; color:#555;"><input type="checkbox" data-merma-vendida-fue-vendido-id="${item.productoId}" ${mermaFueVendidoItem(item) ? "checked" : ""}></td>
									<td style="padding:0px 4px 0 0;">Añade precio de venta (Si aplica)</td>
								</tr>
								</table>
							</label>
							<div class="form-group" style="margin-top:8px; ${mermaFueVendidoItem(item) ? "" : "display:none;"}" data-merma-vendida-precio-wrap="${item.productoId}">
								<label for="merma-vendida-precio-${item.productoId}">Precio unitario merma</label>
								<input id="merma-vendida-precio-${item.productoId}" type="text" inputmode="decimal" autocomplete="off" value="${mermaVendidaPrecioItem(item)}" data-merma-vendida-precio-id="${item.productoId}">
								${errorVentaPrecio}
								<div class="form-group carrito-merma-box" style="grid-column:1 / -1; margin-top:30px;">
									<label class="merma-toggle" style="justify-content:space-between;">
									<table>
										<tr>
										<td style="padding:5px 0px 0 0; border:1px; border-collapse:collapse; font-size:12px; color:#555;"><input type="checkbox" data-merma-sin-vender-toggle-id="${item.productoId}" ${mermaSinVenderActivadaItem(item) ? "checked" : ""}></td>
										<td style="padding:0px 4px 0 0;">Añade Merma sin vender (Si aplica)</td>
										</tr>
									</table>
									</label>
									<div class="merma-input-wrap ${mermaSinVenderActivadaItem(item) ? "" : "is-hidden"}" data-merma-sin-vender-wrap="${item.productoId}">
										<label for="merma-sin-vender-cantidad-${item.productoId}">Cantidad de merma</label>
										<input id="merma-sin-vender-cantidad-${item.productoId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${mermaSinVenderCantidadItem(item)}" data-merma-sin-vender-cantidad-id="${item.productoId}">
										${errorSinVenderCantidad}
										<label for="merma-sin-vender-desc-${item.productoId}">Descripción</label>
										<textarea id="merma-sin-vender-desc-${item.productoId}" rows="2" data-merma-sin-vender-desc-id="${item.productoId}" placeholder="Describe qué ocurrió...">${mermaSinVenderDescripcionItem(item)}</textarea>
										${errorSinVenderDesc}
									</div>
								</div>
							</div>
						</div>
					</div>
					<div class="form-group" style="grid-column:1 / -1;">
						<label for="precio-${item.productoId}">Precio unitario</label>
						<input id="precio-${item.productoId}" type="text" inputmode="decimal" autocomplete="off" value="${precioItem(item)}" data-precio-id="${item.productoId}">
					</div>
					<div class="carrito-resumen-item">
						${vendido} unidades vendidas · Total ${formatearMoneda(vendido * precioItem(item))}
						<div class="carrito-meta">${lineaResumen}</div>
					</div>
					${mermaVendida > 0 ? `<div class="carrito-resumen-item" style="${estiloMermaVendida}">
					${mermaVendida} unidades vendidas en merma · Total ${formatearMoneda(mermaVendida * mermaVendidaPrecioItem(item))}
					<div class="carrito-meta" style="color: inherit;">${mermaVendidaBalance >= 0 ? `Ganancia estimada de la merma ${formatearMoneda(mermaVendidaBalance)}` : `Pérdida estimada de la merma ${formatearMoneda(Math.abs(mermaVendidaBalance))}`}</div>
					</div>` : ""}
					${mermaSinVender > 0 ? `
						<div class="carrito-resumen-item" style="background: rgba(192, 57, 43, 0.08); color: var(--rojo); border: 1px solid rgba(192, 57, 43, 0.18);">
							${mermaSinVender} unidades de merma sin vender
							<div class="carrito-meta" style="color: var(--rojo);">Pérdida estimada de la merma ${formatearMoneda(costoProducto * mermaSinVender)}</div>
						</div>
					` : ""}
					${estadoStockProd !== "ok" ? `<div class="carrito-warn">Producto en estado ${estadoStockProd === "alerta" ? "alerta" : "agotado"}.</div>` : ""}
				</div>`;
	}).join("");

	carritoWrap.querySelectorAll("[data-action]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const id = btn.getAttribute("data-id");
			const action = btn.getAttribute("data-action");
			if (action === "menos") cambiarCajas(id, -1);
			if (action === "mas") cambiarCajas(id, 1);
			if (action === "quitar") {
				estado.carrito.delete(id);
				renderCarrito();
			}
		});
	});

	carritoWrap.querySelectorAll("[data-cajas-id]").forEach((input) => {
		const handler = () => actualizarCajas(input.getAttribute("data-cajas-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	carritoWrap.querySelectorAll("[data-por-caja-id]").forEach((input) => {
		const handler = () => actualizarUnidadesPorCaja(input.getAttribute("data-por-caja-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	carritoWrap.querySelectorAll("[data-merma-vendida-toggle-id]").forEach((input) => {
		input.addEventListener("change", () => {
			actualizarMermaActiva(input.getAttribute("data-merma-vendida-toggle-id"), input.checked);
		});
	});

	carritoWrap.querySelectorAll("[data-merma-vendida-cantidad-id]").forEach((input) => {
		const handler = () => actualizarMermaCantidad(input.getAttribute("data-merma-vendida-cantidad-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	carritoWrap.querySelectorAll("[data-merma-vendida-desc-id]").forEach((input) => {
		const handler = () => actualizarMermaDescripcion(input.getAttribute("data-merma-vendida-desc-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});

	carritoWrap.querySelectorAll("[data-merma-vendida-fue-vendido-id]").forEach((input) => {
		input.addEventListener("change", () => {
			actualizarMermaFueVendido(input.getAttribute("data-merma-vendida-fue-vendido-id"), input.checked);
		});
	});

	carritoWrap.querySelectorAll("[data-merma-vendida-precio-id]").forEach((input) => {
		const handler = () => actualizarMermaPrecio(input.getAttribute("data-merma-vendida-precio-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	carritoWrap.querySelectorAll("[data-merma-sin-vender-toggle-id]").forEach((input) => {
		input.addEventListener("change", () => {
			actualizarMermaSinVenderActiva(input.getAttribute("data-merma-sin-vender-toggle-id"), input.checked);
		});
	});

	carritoWrap.querySelectorAll("[data-merma-sin-vender-cantidad-id]").forEach((input) => {
		const handler = () => actualizarMermaSinVenderCantidad(input.getAttribute("data-merma-sin-vender-cantidad-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	carritoWrap.querySelectorAll("[data-merma-sin-vender-desc-id]").forEach((input) => {
		const handler = () => actualizarMermaSinVenderDescripcion(input.getAttribute("data-merma-sin-vender-desc-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
	});

	carritoWrap.querySelectorAll("[data-sueltas-id]").forEach((input) => {
		const handler = () => actualizarUnidadesSueltas(input.getAttribute("data-sueltas-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	carritoWrap.querySelectorAll("[data-precio-id]").forEach((input) => {
		const handler = () => actualizarPrecio(input.getAttribute("data-precio-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});

	actualizarResumen();
}

// ─── COMBOS ────────────────────────────────────────────────────────────────
function renderCombosDisponibles() {
	if (!combosWrap) return;
	const combos = estado.combosDisponibles || [];

	if (!estado.actividadVentaId) {
		combosWrap.innerHTML = "";
		return;
	}
	if (combos.length === 0) {
		combosWrap.innerHTML = "";
		return;
	}

	combosWrap.innerHTML = `
		<div class="seccion-cat">
			<div class="seccion-cat-titulo"><span style="font-size:20px;">🍔</span>Combos</div>
			<div class="venta-grid">
				${combos.map((c) => `
					<div class="venta-card">
						<div class="venta-icono">🍔</div>
						<div class="venta-info">
							<div class="venta-nombre">${c.nombre}</div>
							<div class="venta-meta">${formatearMoneda(c.precioTotal)} · ${c.items.map((it) => it.nombre).join(" + ")}</div>
						</div>
						<button class="btn btn-sm btn-outline" style="width:auto;" data-combo-agregar-id="${c.id}">Agregar</button>
					</div>`).join("")}
			</div>
		</div>`;

	combosWrap.querySelectorAll("[data-combo-agregar-id]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const combo = combos.find((c) => c.id === btn.getAttribute("data-combo-agregar-id"));
			if (combo) agregarComboAlCarrito(combo);
		});
	});
}

function agregarComboAlCarrito(combo) {
	const actual = estado.carritoCombos.get(combo.id);
	if (actual) {
		actual.cantidad += 1;
	} else {
		estado.carritoCombos.set(combo.id, {
			comboId: combo.id,
			nombre: combo.nombre,
			items: combo.items || [],
			precioTotal: Number(combo.precioTotal) || 0,
			cantidad: 1,
		});
	}
	ocultarAlerta();
	renderCarrito();
}

function cambiarCantidadCombo(comboId, delta) {
	const c = estado.carritoCombos.get(comboId);
	if (!c) return;
	const nuevo = c.cantidad + delta;
	if (nuevo <= 0) {
		estado.carritoCombos.delete(comboId);
	} else {
		c.cantidad = nuevo;
	}
	renderCarrito();
}

function actualizarCantidadCombo(comboId, valor) {
	const c = estado.carritoCombos.get(comboId);
	if (!c) return;
	const numero = Math.trunc(Number(valor));
	if (!Number.isFinite(numero)) return;
	if (numero <= 0) {
		estado.carritoCombos.delete(comboId);
	} else {
		c.cantidad = numero;
	}
	renderCarrito();
}

function renderCarritoCombos() {
	if (!carritoCombosWrap) return;
	const combos = [...estado.carritoCombos.values()];
	if (combos.length === 0) {
		carritoCombosWrap.innerHTML = "";
		return;
	}

	carritoCombosWrap.innerHTML = combos.map((c) => {
		const avisos = c.items
			.map((it) => {
				const stock = stockDisponible(it.productoId);
				const requerido = unidadesRequeridasProducto(it.productoId);
				const faltante = requerido - stock;
				return faltante > 0 ? `${it.nombre} (${faltante} unidad${faltante === 1 ? "" : "es"} de más)` : null;
			})
			.filter(Boolean);
		const avisoStock = avisos.length > 0 ? `<div class="carrito-warn">Excede el stock disponible: ${avisos.join(", ")}.</div>` : "";

		let ganancia = 0;
		c.items.forEach((it) => {
			const producto = productoActual(it.productoId);
			const costoProducto = Number(producto?.precioCompra ?? producto?.ultimoCosto ?? producto?.precioVenta ?? 0);
			ganancia += (Number(it.precio) - costoProducto) * c.cantidad;
		});
		const lineaGanancia = ganancia >= 0 ? `Ganancia estimada ${formatearMoneda(ganancia)}` : `Pérdida estimada ${formatearMoneda(Math.abs(ganancia))}`;

		return `
			<div class="carrito-item">
				<div class="carrito-nombre">🍔 ${c.nombre} <span style="font-size:12px;color:var(--gris-medio);font-weight:400;">(combo)</span></div>
				<div class="carrito-meta">${c.items.map((it) => `${it.nombre} ${formatearMoneda(it.precio)}`).join(" + ")}</div>
				<div class="carrito-meta">Precio del combo: ${formatearMoneda(c.precioTotal)}</div>
				${avisoStock}
				<div class="carrito-controles">
					<button class="chip-btn" data-combo-action="menos" data-combo-id="${c.comboId}">−</button>
					<button class="chip-btn" data-combo-action="mas" data-combo-id="${c.comboId}">+</button>
					<button class="chip-btn chip-danger" data-combo-action="quitar" data-combo-id="${c.comboId}">✕</button>
				</div>
				<div class="carrito-campos">
					<div class="form-group">
						<label for="combo-cantidad-${c.comboId}">Combos vendidos</label>
						<input id="combo-cantidad-${c.comboId}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${c.cantidad}" data-combo-cantidad-id="${c.comboId}">
					</div>
				</div>
				<div class="carrito-resumen-item">
					${c.cantidad} combo${c.cantidad === 1 ? "" : "s"} vendidos · Total ${formatearMoneda(c.precioTotal * c.cantidad)}
					<div class="carrito-meta" style="color:inherit;">${lineaGanancia}</div>
				</div>
			</div>`;
	}).join("");

	carritoCombosWrap.querySelectorAll("[data-combo-action]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const id = btn.getAttribute("data-combo-id");
			const action = btn.getAttribute("data-combo-action");
			if (action === "menos") cambiarCantidadCombo(id, -1);
			if (action === "mas") cambiarCantidadCombo(id, 1);
			if (action === "quitar") { estado.carritoCombos.delete(id); renderCarrito(); }
		});
	});

	carritoCombosWrap.querySelectorAll("[data-combo-cantidad-id]").forEach((input) => {
		const handler = () => actualizarCantidadCombo(input.getAttribute("data-combo-cantidad-id"), input.value);
		input.addEventListener("change", handler);
		input.addEventListener("blur", handler);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
	});
}

function fmtFecha(ts) {
	if (!ts) return "";
	const d = ts.toDate ? ts.toDate() : new Date(ts);
	return d.toLocaleDateString("es-PA");
}

async function cargarActividades() {
	const sel = $("sel-actividad");
	try {
		const snap = await getDocs(collection(db, "actividades_ventas"));
		estado.actividades = snap.docs
			.map(d => ({ id: d.id, ...d.data() }))
			.filter(a => a.activo !== false)
			.sort((a, b) => {
				const fa = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha || 0);
				const fb = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha || 0);
				return fb - fa;
			});
		sel.innerHTML = `<option value="">— Selecciona una actividad —</option>` +
			estado.actividades.map(a =>
				`<option value="${a.id}">${a.nombre}${a.fecha ? " — " + fmtFecha(a.fecha) : ""}</option>`
			).join("");
	} catch (e) {
		console.warn("No se pudieron cargar actividades:", e.message);
		sel.innerHTML = `<option value="">— Sin actividades disponibles —</option>`;
		estado.actividades = [];
	}
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
					<div class="venta-meta">${formatearMoneda(prod.precioVenta || 0)} · Stock ${prod.stock ?? 0} · ${unidadesPorCajaProducto(prod)} uds/caja</div>
				</div>
				<button class="btn btn-sm btn-outline" style="width:auto;">Agregar</button>`;
			card.querySelector("button").addEventListener("click", () => agregarAlCarrito(prod));
			grid.appendChild(card);
		});

		seccion.appendChild(grid);
		contenedor.appendChild(seccion);
	});
}

function itemsDeCombosVenta() {
	const items = [];
	estado.carritoCombos.forEach((c) => {
		c.items.forEach((it) => {
			items.push({
				productoId: it.productoId,
				nombre: it.nombre,
				cantidad: c.cantidad,
				precioUnitario: Number(it.precio) || 0,
				motivo: `Venta combo: ${c.nombre}`,
			});
		});
	});
	return items;
}

// Agrupa por producto + precio unitario: un mismo producto vendido a precios
// distintos (p.ej. suelto vs. dentro de un combo) queda en líneas separadas para
// no diluir el precio real en un promedio ponderado. Solo se fusionan líneas del
// mismo producto que además comparten precio exacto.
function combinarItemsPorProducto(items) {
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

async function finalizarVenta() {
	const btn = $("btn-finalizar-venta");

	if (btn.disabled) return;

	if (estado.carrito.size === 0 && estado.carritoCombos.size === 0) {
		mostrarAlerta("aviso", "Agrega al menos un producto o combo.");
		return;
	}

	if (!estado.actividadVentaId) {
		mostrarAlerta("aviso", "Selecciona una actividad de ventas antes de registrar.");
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
			mostrarAlerta("error", "No se pudo identificar al usuario. Intenta iniciar sesión de nuevo.");
			return;
		}

		const datosUsuario = getUsuarioActual();
		const itemsVenta = combinarItemsPorProducto([
			...[...estado.carrito.values()]
				.filter((item) => totalUnidadesVendidas(item) > 0)
				.map((item) => ({
					...item,
					cantidad: totalUnidadesVendidas(item),
				})),
			...itemsDeCombosVenta(),
		]);
		const mermaItems = [];
		estado.carrito.forEach((item) => {
			const tipoMermaPrincipal = tipoMermaPrincipalItem(item);
			if (tipoMermaPrincipal && mermaVendidaCantidadItem(item) > 0) {
				mermaItems.push({
					productoId: item.productoId,
					nombre: item.nombre,
					cantidad: mermaVendidaCantidadItem(item),
					descripcion: mermaVendidaDescripcionItem(item),
					tipo: tipoMermaPrincipal,
					fueVendido: tipoMermaPrincipal === "vendida",
					precioUnitario: tipoMermaPrincipal === "vendida" ? mermaVendidaPrecioItem(item) : 0,
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
		if (itemsVenta.length > 0 || mermaItems.length > 0) {
			resultado = await registrarVentaConMerma({
				usuarioId: usuarioActual.uid,
				usuarioNombre: datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email,
				items: itemsVenta,
				metodoPago: metodoPago.value,
				nota: nota.value.trim(),
				mermaItems,
				motivoMerma: motivoMermaDefault(),
				actividadVentaId: estado.actividadVentaId,
				actividadVentaNombre: estado.actividadVentaNombre,
			});
		} else {
			resultado = await registrarVenta({
				usuarioId: usuarioActual.uid,
				usuarioNombre: datosUsuario.nombre || usuarioActual.displayName || usuarioActual.email,
				items: itemsVenta,
				metodoPago: metodoPago.value,
				nota: nota.value.trim(),
				actividadVentaId: estado.actividadVentaId,
				actividadVentaNombre: estado.actividadVentaNombre,
			});
		}

		estado.carrito.clear();
		estado.carritoCombos.clear();
		renderCarrito();
		if (itemsVenta.length > 0) {
			mostrarAlertaYScrollTop("success", `Venta registrada. Total ${formatearMoneda(resultado.total)}.`);
		} else {
			mostrarAlertaYScrollTop("success", "Merma registrada correctamente.");
		}
		nota.value = "";
	} catch (error) {
		mostrarAlertaYScrollTop("error", error.message || "No se pudo registrar la venta.");
	} finally {
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

buscador.addEventListener("input", (e) => {
	estado.termino = e.target.value;
	renderProductos();
});

$("sel-actividad").addEventListener("change", (e) => {
	const a = estado.actividades.find(x => x.id === e.target.value) || null;
	estado.actividadVentaId = a ? a.id : null;
	estado.actividadVentaNombre = a ? a.nombre : "";
	estado.combosDisponibles = a ? (a.combos || []) : [];
	estado.carritoCombos.clear();
	const info = $("actividad-info");
	if (a) {
		info.textContent = [fmtFecha(a.fecha), a.lugar, a.responsables].filter(Boolean).join(" · ");
		info.style.display = "block";
	} else {
		info.style.display = "none";
	}
	renderCombosDisponibles();
	renderCarrito();
});

metodoPago.addEventListener("change", actualizarResumen);
nota.addEventListener("input", actualizarResumen);

$("btn-limpiar-carrito").addEventListener("click", () => {
	estado.carrito.clear();
	estado.carritoCombos.clear();
	renderCarrito();
	ocultarAlerta();
});

btnFinalizar.addEventListener("click", finalizarVenta);

cargarActividades();
renderCarrito();
renderEstadoCarga();
actualizarResumen();

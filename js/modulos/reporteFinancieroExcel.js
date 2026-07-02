import { db } from "../core/firebase-config.js";
import {
  collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Requiere que js/libs/exceljs.min.js esté cargado en la página (expone `ExcelJS` global).

// ── Paleta de marca (tomada de css/styles.css) ───────────────────────────────
const COLOR = {
  verde: "FF00722E",
  verdeOscuro: "FF045223",
  verdeClaro: "FF39B54A",
  verdeFondo: "FFE8F5EC",
  rojo: "FFC0392B",
  rojoFondo: "FFFDEDEC",
  amarillo: "FFD4850A",
  amarilloFondo: "FFFEF9E7",
  grisTexto: "FF1A2E1E",
  grisSuave: "FFF4F7F5",
  grisBorde: "FFD0DBD2",
  grisMedio: "FF8A9E8D",
  blanco: "FFFFFFFF",
};

const FMT_MONEDA = '"USD "#,##0.00';
const FMT_PORCENTAJE = '0.0"%"';

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function fechaTexto(ts) {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleString("es-PA", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fechaOrden(ts) {
  return ts?.toDate ? ts.toDate().getTime() : 0;
}

function colLetra(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    x -= 1;
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26);
  }
  return s;
}

function bordeFino() {
  const estilo = { style: "thin", color: { argb: COLOR.grisBorde } };
  return { top: estilo, left: estilo, bottom: estilo, right: estilo };
}

// ── Estilos reutilizables ────────────────────────────────────────────────────
function estiloBarraTitulo(ws, fila, texto, numCols, colorFondo = COLOR.verdeOscuro) {
  ws.mergeCells(fila, 1, fila, numCols);
  const cell = ws.getCell(fila, 1);
  cell.value = texto;
  cell.font = { bold: true, size: 13, color: { argb: COLOR.blanco } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colorFondo } };
  cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(fila).height = 24;
}

function estiloEncabezados(ws, fila) {
  const row = ws.getRow(fila);
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: COLOR.verdeOscuro }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.verdeFondo } };
    cell.alignment = { vertical: "middle" };
    cell.border = bordeFino();
  });
  row.height = 20;
}

function estilizarFilaDatos(ws, fila, opciones = {}) {
  const { moneyCols = [], percentCols = [], zebra = false, verdeCols = [], rojoCols = [], signCols = [] } = opciones;
  const row = ws.getRow(fila);
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.border = bordeFino();
    if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grisSuave } };
    if (moneyCols.includes(colNumber)) {
      cell.numFmt = FMT_MONEDA;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    if (percentCols.includes(colNumber)) {
      cell.numFmt = FMT_PORCENTAJE;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    if (verdeCols.includes(colNumber) && typeof cell.value === "number") {
      cell.font = { color: { argb: COLOR.verde } };
    }
    if (rojoCols.includes(colNumber) && typeof cell.value === "number") {
      cell.font = { color: { argb: COLOR.rojo } };
    }
    if (signCols.includes(colNumber) && typeof cell.value === "number") {
      cell.font = { color: { argb: cell.value >= 0 ? COLOR.verde : COLOR.rojo }, bold: true };
    }
  });
}

function estiloFilaTotales(ws, fila) {
  const row = ws.getRow(fila);
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: COLOR.verdeOscuro } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.verdeFondo } };
    cell.border = { top: { style: "medium", color: { argb: COLOR.verdeClaro } } };
  });
}

function congelarYFiltrar(ws, filaEncabezado, numCols) {
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: filaEncabezado, topLeftCell: `A${filaEncabezado + 1}`, activeCell: `A${filaEncabezado + 1}` }];
  ws.autoFilter = `A${filaEncabezado}:${colLetra(numCols)}${filaEncabezado}`;
}

function aplicarAnchos(ws, anchos) {
  anchos.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: RESUMEN EJECUTIVO
// ════════════════════════════════════════════════════════════════════════════
function hojaResumen(wb, { balance, movimientos, ventas, compras, mermas, productos, filtroInfo }) {
  const ws = wb.addWorksheet("Resumen", { properties: { tabColor: { argb: COLOR.verdeOscuro } } });
  aplicarAnchos(ws, [56, 20]);

  const totalIngresos = movimientos.filter(m => m.tipo === "ingreso").reduce((a, m) => a + numero(m.monto), 0);
  const totalEgresos = movimientos.filter(m => m.tipo !== "ingreso").reduce((a, m) => a + numero(m.monto), 0);
  const totalVentas = ventas.reduce((a, v) => a + numero(v.total), 0);
  const utilidadVentas = ventas.reduce((a, v) => a + numero(v.utilidadTotal), 0);
  const totalCompras = compras.reduce((a, c) => a + numero(c.total), 0);
  const totalPerdidaMermas = mermas.reduce((a, m) => a + numero(m.totalPerdida), 0);
  const impactoNetoMermas = mermas.reduce((a, m) => a + numero(m.utilidadTotal), 0);
  const productosActivos = productos.filter(p => p.activo !== false);
  const valorInventario = productosActivos.reduce((a, p) => a + numero(p.precioCompra ?? p.ultimoCosto ?? 0) * numero(p.stock), 0);
  const gananciaPotencialStock = productosActivos.reduce((a, p) => {
    const costo = numero(p.precioCompra ?? p.ultimoCosto ?? 0);
    return a + (numero(p.precioVenta) - costo) * numero(p.stock);
  }, 0);
  const gananciaNeta = utilidadVentas + impactoNetoMermas;

  let fila = 1;
  ws.mergeCells(fila, 1, fila, 2);
  const titulo = ws.getCell(fila, 1);
  titulo.value = "REPORTE FINANCIERO — CONTECS";
  titulo.font = { bold: true, size: 16, color: { argb: COLOR.blanco } };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.verdeOscuro } };
  titulo.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(fila).height = 30;
  fila += 1;

  ws.mergeCells(fila, 1, fila, 2);
  ws.getCell(fila, 1).value = `Generado el ${new Date().toLocaleString("es-PA", { dateStyle: "long", timeStyle: "short" })}`;
  ws.getCell(fila, 1).font = { italic: true, color: { argb: COLOR.grisMedio }, size: 10 };
  fila += 1;

  ws.mergeCells(fila, 1, fila, 2);
  ws.getCell(fila, 1).value = `Libro de movimientos filtrado por: ${filtroInfo || "sin filtros (histórico completo)"}`;
  ws.getCell(fila, 1).font = { italic: true, color: { argb: COLOR.grisMedio }, size: 10 };
  fila += 2;

  function seccion(nombre, color) {
    estiloBarraTitulo(ws, fila, nombre, 2, color);
    fila += 1;
  }
  function indicador(etiqueta, valor, { moneda = true, verdeRojoPorSigno = false, destacar = false } = {}) {
    const filaActual = fila;
    ws.getCell(filaActual, 1).value = etiqueta;
    ws.getCell(filaActual, 2).value = valor;
    ws.getCell(filaActual, 1).font = { bold: destacar, color: { argb: COLOR.grisTexto }, size: destacar ? 12 : 11 };
    ws.getCell(filaActual, 1).border = bordeFino();
    ws.getCell(filaActual, 2).border = bordeFino();
    ws.getCell(filaActual, 1).alignment = { indent: 1, vertical: "middle" };
    if (moneda) {
      ws.getCell(filaActual, 2).numFmt = FMT_MONEDA;
      ws.getCell(filaActual, 2).alignment = { horizontal: "right", vertical: "middle" };
    } else {
      ws.getCell(filaActual, 2).alignment = { horizontal: "right", vertical: "middle" };
    }
    const colorTexto = verdeRojoPorSigno ? (numero(valor) >= 0 ? COLOR.verde : COLOR.rojo) : COLOR.grisTexto;
    ws.getCell(filaActual, 2).font = { bold: destacar, size: destacar ? 13 : 11, color: { argb: colorTexto } };
    if (filaActual % 2 === 0) {
      ws.getCell(filaActual, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grisSuave } };
      ws.getCell(filaActual, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.grisSuave } };
    }
    fila += 1;
  }

  seccion("FONDO", COLOR.verde);
  indicador("Balance actual del fondo", balance, { verdeRojoPorSigno: true, destacar: true });
  indicador("Total de ingresos (movimientos filtrados)", totalIngresos);
  indicador("Total de egresos (movimientos filtrados)", totalEgresos);
  fila += 1;

  seccion("VENTAS", COLOR.verdeClaro);
  indicador("Cantidad de ventas registradas", ventas.length, { moneda: false });
  indicador("Total vendido", totalVentas);
  indicador("Utilidad bruta generada por ventas", utilidadVentas, { verdeRojoPorSigno: true });
  fila += 1;

  seccion("COMPRAS", COLOR.amarillo);
  indicador("Cantidad de compras registradas", compras.length, { moneda: false });
  indicador("Total invertido en compras", totalCompras);
  fila += 1;

  seccion("MERMAS", COLOR.rojo);
  indicador("Cantidad de registros de merma", mermas.length, { moneda: false });
  indicador("Pérdida total contemplada (merma sin vender)", totalPerdidaMermas);
  indicador("Impacto neto de mermas (vendida a descuento + pérdida)", impactoNetoMermas, { verdeRojoPorSigno: true });
  fila += 1;

  seccion("INVENTARIO ACTUAL", COLOR.grisMedio);
  indicador("Productos activos", productosActivos.length, { moneda: false });
  indicador("Productos inactivos", productos.length - productosActivos.length, { moneda: false });
  indicador("Valor de inventario al costo", valorInventario);
  indicador("Ganancia potencial si se vende todo el stock", gananciaPotencialStock, { verdeRojoPorSigno: true });
  fila += 1;

  seccion("RESULTADO", COLOR.verdeOscuro);
  indicador("Ganancia neta estimada (utilidad de ventas + impacto de mermas)", gananciaNeta, { verdeRojoPorSigno: true, destacar: true });
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: MOVIMIENTOS DE FONDO (LIBRO CONTABLE)
// ════════════════════════════════════════════════════════════════════════════
function hojaMovimientos(wb, movimientos) {
  const ws = wb.addWorksheet("Movimientos de Fondo", { properties: { tabColor: { argb: COLOR.verde } } });
  const headers = ["Fecha", "Movimiento", "Usuario", "Origen", "Referencia", "Ingreso", "Egreso", "Balance acumulado (del conjunto filtrado)"];
  aplicarAnchos(ws, [18, 32, 20, 12, 22, 14, 14, 20]);

  estiloBarraTitulo(ws, 1, "LIBRO DE MOVIMIENTOS DE FONDO (orden cronológico)", headers.length);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  const ordenados = [...movimientos].sort((a, b) => fechaOrden(a.creadoEn) - fechaOrden(b.creadoEn));
  let acumulado = 0;
  ordenados.forEach((m, idx) => {
    const monto = numero(m.monto);
    if (m.tipo === "ingreso") acumulado += monto; else acumulado -= monto;
    const filaNum = 3 + idx;
    ws.addRow([
      fechaTexto(m.creadoEn),
      m.titulo || m.descripcion || "Movimiento",
      m.usuarioNombre || m.usuarioId || "—",
      m.origen || "manual",
      m.referenciaId || "—",
      m.tipo === "ingreso" ? monto : "",
      m.tipo !== "ingreso" ? monto : "",
      acumulado,
    ]);
    estilizarFilaDatos(ws, filaNum, { moneyCols: [6, 7, 8], zebra: idx % 2 === 1, verdeCols: [6], rojoCols: [7], signCols: [8] });
  });

  const totalIngresos = ordenados.filter(m => m.tipo === "ingreso").reduce((a, m) => a + numero(m.monto), 0);
  const totalEgresos = ordenados.filter(m => m.tipo !== "ingreso").reduce((a, m) => a + numero(m.monto), 0);
  const filaTotales = 3 + ordenados.length;
  ws.addRow(["", "", "", "", "TOTALES", totalIngresos, totalEgresos, acumulado]);
  estiloFilaTotales(ws, filaTotales);
  ws.getCell(filaTotales, 6).numFmt = FMT_MONEDA;
  ws.getCell(filaTotales, 7).numFmt = FMT_MONEDA;
  ws.getCell(filaTotales, 8).numFmt = FMT_MONEDA;

  if (ordenados.length > 0) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: VENTAS — RESUMEN
// ════════════════════════════════════════════════════════════════════════════
function hojaVentasResumen(wb, ventas) {
  const ws = wb.addWorksheet("Ventas (Resumen)", { properties: { tabColor: { argb: COLOR.verdeClaro } } });
  const headers = ["Fecha", "Usuario", "Actividad de venta", "Método de pago", "Total vendido", "Utilidad", "Pérdida contemplada (merma)", "Nota"];
  aplicarAnchos(ws, [18, 20, 24, 16, 14, 14, 18, 30]);

  estiloBarraTitulo(ws, 1, "VENTAS — RESUMEN POR TRANSACCIÓN", headers.length, COLOR.verde);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  ventas.forEach((v, idx) => {
    const filaNum = 3 + idx;
    ws.addRow([
      fechaTexto(v.creadoEn), v.usuarioNombre || "—", v.actividadVentaNombre || "—",
      v.metodoPago || "efectivo", numero(v.total), numero(v.utilidadTotal), numero(v.perdidaTotal), v.nota || "",
    ]);
    estilizarFilaDatos(ws, filaNum, { moneyCols: [5, 6, 7], zebra: idx % 2 === 1, verdeCols: [5], signCols: [6], rojoCols: [7] });
  });

  const totalVentas = ventas.reduce((a, v) => a + numero(v.total), 0);
  const totalUtilidad = ventas.reduce((a, v) => a + numero(v.utilidadTotal), 0);
  const totalPerdida = ventas.reduce((a, v) => a + numero(v.perdidaTotal), 0);
  const filaTotales = 3 + ventas.length;
  ws.addRow(["", "", "", "TOTALES", totalVentas, totalUtilidad, totalPerdida, ""]);
  estiloFilaTotales(ws, filaTotales);
  [5, 6, 7].forEach((c) => { ws.getCell(filaTotales, c).numFmt = FMT_MONEDA; });

  if (ventas.length > 0) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: VENTAS — DETALLE POR PRODUCTO
// ════════════════════════════════════════════════════════════════════════════
function hojaVentasDetalle(wb, ventas) {
  const ws = wb.addWorksheet("Ventas (Detalle)", { properties: { tabColor: { argb: COLOR.verdeClaro } } });
  const headers = ["Fecha venta", "Usuario", "Actividad", "Producto", "Tipo", "Cantidad", "Precio unitario", "Costo unitario", "Utilidad total", "Subtotal"];
  aplicarAnchos(ws, [18, 20, 22, 24, 18, 10, 14, 14, 14, 14]);

  estiloBarraTitulo(ws, 1, "VENTAS — DETALLE LÍNEA POR PRODUCTO", headers.length, COLOR.verde);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  let filaNum = 2;
  let totalUtilidad = 0;
  let totalSubtotal = 0;
  ventas.forEach((v) => {
    (v.items || []).forEach((it) => {
      filaNum += 1;
      const utilidad = numero(it.utilidadTotal);
      const subtotal = numero(it.subtotal);
      totalUtilidad += utilidad; totalSubtotal += subtotal;
      ws.addRow([
        fechaTexto(v.creadoEn), v.usuarioNombre || "—", v.actividadVentaNombre || "—",
        it.nombre || "—", "Venta", numero(it.cantidad),
        numero(it.precioUnitario), numero(it.costoUnitario), utilidad, subtotal,
      ]);
      estilizarFilaDatos(ws, filaNum, { moneyCols: [7, 8, 9, 10], zebra: filaNum % 2 === 1, signCols: [9] });
    });
    (v.mermas || []).forEach((m) => {
      filaNum += 1;
      const utilidad = numero(m.utilidadTotal);
      const subtotal = numero(m.cantidad) * numero(m.precioUnitario ?? m.precio);
      totalUtilidad += utilidad; totalSubtotal += subtotal;
      ws.addRow([
        fechaTexto(v.creadoEn), v.usuarioNombre || "—", v.actividadVentaNombre || "—",
        m.nombre || "—", m.tipo === "sin_vender" ? "Merma sin vender" : "Merma vendida", numero(m.cantidad),
        numero(m.precioUnitario ?? m.precio), numero(m.costoUnitario ?? m.costo), utilidad, subtotal,
      ]);
      estilizarFilaDatos(ws, filaNum, { moneyCols: [7, 8, 9, 10], zebra: filaNum % 2 === 1, signCols: [9] });
    });
  });

  const filaTotales = filaNum + 1;
  ws.addRow(["", "", "", "", "", "", "", "TOTALES", totalUtilidad, totalSubtotal]);
  estiloFilaTotales(ws, filaTotales);
  ws.getCell(filaTotales, 9).numFmt = FMT_MONEDA;
  ws.getCell(filaTotales, 10).numFmt = FMT_MONEDA;

  if (filaNum > 2) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: COMPRAS — RESUMEN
// ════════════════════════════════════════════════════════════════════════════
function hojaComprasResumen(wb, compras) {
  const ws = wb.addWorksheet("Compras (Resumen)", { properties: { tabColor: { argb: COLOR.amarillo } } });
  const headers = ["Fecha", "Usuario", "Proveedor", "Método de pago", "Total", "Estado de factura", "Nota"];
  aplicarAnchos(ws, [18, 20, 24, 16, 14, 16, 30]);

  estiloBarraTitulo(ws, 1, "COMPRAS — RESUMEN POR TRANSACCIÓN", headers.length, COLOR.amarillo);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  compras.forEach((c, idx) => {
    const filaNum = 3 + idx;
    ws.addRow([
      fechaTexto(c.creadoEn), c.usuarioNombre || "—", c.proveedor || "Sin proveedor",
      c.metodoPago || "efectivo", numero(c.total), c.facturaEstado || "—", c.nota || "",
    ]);
    estilizarFilaDatos(ws, filaNum, { moneyCols: [5], zebra: idx % 2 === 1, rojoCols: [5] });
  });

  const totalCompras = compras.reduce((a, c) => a + numero(c.total), 0);
  const filaTotales = 3 + compras.length;
  ws.addRow(["", "", "", "TOTAL", totalCompras, "", ""]);
  estiloFilaTotales(ws, filaTotales);
  ws.getCell(filaTotales, 5).numFmt = FMT_MONEDA;

  if (compras.length > 0) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: COMPRAS — DETALLE POR PRODUCTO
// ════════════════════════════════════════════════════════════════════════════
function hojaComprasDetalle(wb, compras) {
  const ws = wb.addWorksheet("Compras (Detalle)", { properties: { tabColor: { argb: COLOR.amarillo } } });
  const headers = ["Fecha compra", "Proveedor", "Producto", "Cantidad", "Precio unitario (costo)", "Subtotal"];
  aplicarAnchos(ws, [18, 24, 24, 10, 18, 14]);

  estiloBarraTitulo(ws, 1, "COMPRAS — DETALLE LÍNEA POR PRODUCTO", headers.length, COLOR.amarillo);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  let filaNum = 2;
  let totalSubtotal = 0;
  compras.forEach((c) => {
    (c.items || []).forEach((it) => {
      filaNum += 1;
      const subtotal = numero(it.subtotal);
      totalSubtotal += subtotal;
      ws.addRow([fechaTexto(c.creadoEn), c.proveedor || "Sin proveedor", it.nombre || "—", numero(it.cantidad), numero(it.precioUnitario), subtotal]);
      estilizarFilaDatos(ws, filaNum, { moneyCols: [5, 6], zebra: filaNum % 2 === 1, rojoCols: [6] });
    });
  });

  const filaTotales = filaNum + 1;
  ws.addRow(["", "", "", "", "TOTAL", totalSubtotal]);
  estiloFilaTotales(ws, filaTotales);
  ws.getCell(filaTotales, 6).numFmt = FMT_MONEDA;

  if (filaNum > 2) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: MERMAS
// ════════════════════════════════════════════════════════════════════════════
function hojaMermas(wb, mermas) {
  const ws = wb.addWorksheet("Mermas", { properties: { tabColor: { argb: COLOR.rojo } } });
  const headers = ["Fecha", "Usuario", "Producto", "Tipo", "Cantidad", "Costo unitario", "Impacto (utilidad/pérdida)", "Motivo"];
  aplicarAnchos(ws, [18, 20, 24, 14, 10, 14, 18, 30]);

  estiloBarraTitulo(ws, 1, "MERMAS — DETALLE", headers.length, COLOR.rojo);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  let filaNum = 2;
  let totalImpacto = 0;
  mermas.forEach((m) => {
    (m.items || []).forEach((it) => {
      filaNum += 1;
      const impacto = numero(it.utilidadTotal);
      totalImpacto += impacto;
      ws.addRow([
        fechaTexto(m.creadoEn), m.usuarioNombre || "—", it.nombre || "—",
        it.tipo === "sin_vender" ? "Sin vender" : "Vendida", numero(it.cantidad),
        numero(it.costoUnitario), impacto, m.motivo || "",
      ]);
      estilizarFilaDatos(ws, filaNum, { moneyCols: [6, 7], zebra: filaNum % 2 === 1, signCols: [7] });
    });
  });

  const filaTotales = filaNum + 1;
  ws.addRow(["", "", "", "", "", "TOTAL", totalImpacto, ""]);
  estiloFilaTotales(ws, filaTotales);
  ws.getCell(filaTotales, 7).numFmt = FMT_MONEDA;

  if (filaNum > 2) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// HOJA: INVENTARIO DE PRODUCTOS
// ════════════════════════════════════════════════════════════════════════════
function hojaProductos(wb, productos, categoriasMap) {
  const ws = wb.addWorksheet("Inventario de Productos", { properties: { tabColor: { argb: COLOR.grisMedio } } });
  const headers = ["Producto", "Categoría", "Precio de venta", "Costo actual", "Margen unitario", "Margen %", "Stock actual", "Alerta mínima", "Valor de inventario (costo)", "Ganancia potencial en stock", "Estado"];
  aplicarAnchos(ws, [26, 16, 14, 12, 14, 10, 12, 12, 20, 20, 10]);

  estiloBarraTitulo(ws, 1, "INVENTARIO DE PRODUCTOS", headers.length, COLOR.verdeOscuro);
  ws.addRow(headers);
  estiloEncabezados(ws, 2);

  let totalValorInventario = 0;
  let totalGananciaPotencial = 0;
  productos.forEach((p, idx) => {
    const filaNum = 3 + idx;
    const precio = numero(p.precioVenta);
    const costo = numero(p.precioCompra ?? p.ultimoCosto ?? 0);
    const margen = precio - costo;
    const margenPct = precio > 0 ? (margen / precio) * 100 : 0;
    const stock = numero(p.stock);
    const valorInv = costo * stock;
    const gananciaPot = margen * stock;
    totalValorInventario += valorInv;
    totalGananciaPotencial += gananciaPot;

    ws.addRow([
      p.nombre || "—", categoriasMap.get(p.categoriaId) || "—",
      precio, costo, margen, +margenPct.toFixed(1), stock, numero(p.alertaMinima),
      valorInv, gananciaPot, p.activo === false ? "Inactivo" : "Activo",
    ]);
    estilizarFilaDatos(ws, filaNum, { moneyCols: [3, 4, 5, 9, 10], percentCols: [6], zebra: idx % 2 === 1, signCols: [5, 10] });
    if (p.activo === false) ws.getCell(filaNum, 11).font = { color: { argb: COLOR.grisMedio }, italic: true };
    else ws.getCell(filaNum, 11).font = { color: { argb: COLOR.verde }, bold: true };
  });

  const filaTotales = 3 + productos.length;
  ws.addRow(["", "", "", "", "", "", "", "TOTAL", totalValorInventario, totalGananciaPotencial, ""]);
  estiloFilaTotales(ws, filaTotales);
  ws.getCell(filaTotales, 9).numFmt = FMT_MONEDA;
  ws.getCell(filaTotales, 10).numFmt = FMT_MONEDA;

  if (productos.length > 0) congelarYFiltrar(ws, 2, headers.length);
}

// ════════════════════════════════════════════════════════════════════════════
// PUNTO DE ENTRADA
// ════════════════════════════════════════════════════════════════════════════
export async function generarReporteFinancieroExcel({ movimientosFiltrados, balance, filtroInfo }) {
  const [snapProductos, snapCategorias, snapCompras, snapVentas, snapMermas] = await Promise.all([
    getDocs(collection(db, "productos")),
    getDocs(collection(db, "categorias")),
    getDocs(query(collection(db, "compras"), orderBy("creadoEn", "asc"))),
    getDocs(query(collection(db, "ventas"), orderBy("creadoEn", "asc"))),
    getDocs(query(collection(db, "mermas"), orderBy("creadoEn", "asc"))),
  ]);

  const categoriasMap = new Map(snapCategorias.docs.map(d => [d.id, d.data().nombre]));
  const productos = snapProductos.docs.map(d => ({ id: d.id, ...d.data() }));
  const compras = snapCompras.docs.map(d => ({ id: d.id, ...d.data() }));
  const ventas = snapVentas.docs.map(d => ({ id: d.id, ...d.data() }));
  const mermas = snapMermas.docs.map(d => ({ id: d.id, ...d.data() }));

  const wb = new ExcelJS.Workbook();
  wb.creator = "CONTECS";
  wb.created = new Date();

  hojaResumen(wb, { balance, movimientos: movimientosFiltrados, ventas, compras, mermas, productos, filtroInfo });
  hojaMovimientos(wb, movimientosFiltrados);
  hojaVentasResumen(wb, ventas);
  hojaVentasDetalle(wb, ventas);
  hojaComprasResumen(wb, compras);
  hojaComprasDetalle(wb, compras);
  hojaMermas(wb, mermas);
  hojaProductos(wb, productos, categoriasMap);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fechaArchivo = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `reporte_financiero_contecs_${fechaArchivo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

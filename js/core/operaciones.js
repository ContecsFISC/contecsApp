import { auth, db, storage } from "./firebase-config.js";
import {
  collection, doc, increment, runTransaction, serverTimestamp, setDoc,
  getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

function aNumero(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

// Los montos en dólares se redondean a centavos en cuanto se leen/calculan, para
// que la Utilidad mostrada siempre coincida exactamente con P/U y Costo (también
// redondeados a 2 decimales) tal como se ven en pantalla.
function r2(valor) {
  return Math.round(aNumero(valor, 0) * 100) / 100;
}

function nombreProducto(item, producto) {
  return item.nombre || producto?.nombre || "Producto";
}

function precioItem(item, producto, campoAlterno = "precioVenta") {
  const directo = aNumero(item.precioUnitario, NaN);
  if (Number.isFinite(directo)) return r2(directo);

  const alterno = aNumero(item[campoAlterno], NaN);
  if (Number.isFinite(alterno)) return r2(alterno);

  return r2(aNumero(producto?.[campoAlterno], 0));
}

function costoUnitarioProducto(producto) {
  return r2(aNumero(producto?.precioCompra ?? producto?.ultimoCosto ?? producto?.costoUnitario ?? producto?.precioVenta ?? 0, 0));
}

function costoItem(item, producto) {
  const directo = aNumero(item.costoUnitario, NaN);
  if (Number.isFinite(directo) && directo >= 0) return r2(directo);

  return costoUnitarioProducto(producto);
}

function utilidadUnitaria(ventaUnitario, costoUnitario) {
  return r2(aNumero(ventaUnitario, 0) - aNumero(costoUnitario, 0));
}

function subtotalItem(item, producto, campoAlterno = "precioCompra") {
  const directo = aNumero(item.subtotal, NaN);
  if (Number.isFinite(directo)) {
    if (directo <= 0) {
      throw new Error("El subtotal debe ser mayor que cero.");
    }
    return directo;
  }

  const unitario = precioItem(item, producto, campoAlterno);
  const cantidad = cantidadItem(item);
  return unitario * cantidad;
}

function cantidadItem(item) {
  const cantidad = Math.trunc(aNumero(item.cantidad, 0));
  if (cantidad <= 0) {
    throw new Error("La cantidad debe ser mayor que cero.");
  }
  return cantidad;
}

function fondoRef() {
  return doc(db, "fondos", "principal");
}

async function asegurarFondo(tx) {
  const ref = fondoRef();
  const snap = await tx.get(ref);
  if (!snap.exists()) {
    tx.set(ref, {
      balance: 0,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
    return 0;
  }
  return aNumero(snap.data().balance, 0);
}

function crearMovimientoInventarioRef() {
  return doc(collection(db, "movimientos_inventario"));
}

function crearMovimientoFondoRef() {
  return doc(collection(db, "fondos_entrada"));
}

export async function esperarAuthListo(timeout = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeout);
    onAuthStateChanged(auth, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function validarFacturaArchivo(factura) {
  if (!factura) {
    throw new Error("Selecciona una factura.");
  }

  const tiposPermitidos = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
  const tipoArchivo = factura.type || "";

  if (!tiposPermitidos.includes(tipoArchivo)) {
    throw new Error("La factura debe ser un PDF o una imagen válida.");
  }

  const limiteBytes = 10 * 1024 * 1024;
  if (factura.size > limiteBytes) {
    throw new Error("La factura no puede superar 10 MB.");
  }
}

function limpiarNombreArchivo(nombre) {
  return String(nombre || "factura")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function descripcionErrorStorage(error, ruta, bucket) {
  const codigo = error?.code || "desconocido";
  const mensaje = error?.message || String(error || "Error desconocido");
  return `No se pudo subir la factura a ${bucket}/${ruta} (${codigo}). ${mensaje}`;
}

export async function subirFacturaAStorage({ compraId, factura, usuarioId }) {
  if (!compraId) throw new Error("No se pudo preparar la carga de la factura.");
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");

  validarFacturaArchivo(factura);
  await esperarAuthListo();

  const nombreSeguro = limpiarNombreArchivo(factura.name);
  const metadata = {
    contentType: factura.type || "application/octet-stream",
  };

  const ruta = `compras/${compraId}/facturas/${Date.now()}_${nombreSeguro}`;
  const archivoRef = storageRef(storage, ruta);

  try {
    const resultado = await uploadBytes(archivoRef, factura, metadata);
    const url = await getDownloadURL(resultado.ref);

    return {
      url,
      name: factura.name,
      size: factura.size,
      contentType: factura.type || "application/octet-stream",
      uploadedAt: serverTimestamp(),
      uploadedBy: usuarioId,
    };
  } catch (error) {
    if (error?.code === "storage/unauthorized") {
      throw new Error(descripcionErrorStorage(error, ruta, storage.app.options.storageBucket || "storageBucket-desconocido"));
    }

    throw new Error(descripcionErrorStorage(error, ruta, storage.app.options.storageBucket || "storageBucket-desconocido"));
  }
}

async function leerProductosTx(tx, items, cache = new Map()) {
  const lecturas = [];
  for (const item of items) {
    let entrada = cache.get(item.productoId);
    if (!entrada) {
      const productoRef = doc(db, "productos", item.productoId);
      const productoSnap = await tx.get(productoRef);
      entrada = { ref: productoRef, snap: productoSnap };
      cache.set(item.productoId, entrada);
    }
    lecturas.push({ ref: entrada.ref, snap: entrada.snap, item });
  }
  return lecturas;
}

// Varias líneas de items pueden compartir el mismo productoId (p.ej. un producto
// vendido individualmente y también dentro de un combo, cada uno con su propio precio).
// Esta función permite decrementar el stock de forma acumulativa entre esas líneas
// dentro de una misma transacción, en vez de que cada línea lea/escriba el stock de
// forma independiente y la última sobrescriba el descuento de las anteriores.
function tomarStockActual(stockPorProducto, productoId, producto) {
  return stockPorProducto.has(productoId)
    ? stockPorProducto.get(productoId)
    : aNumero(producto.stock, 0);
}

export function formatearMoneda(valor) {
  return aNumero(valor, 0).toLocaleString("es-PA", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export function resumenItemPrincipal(items) {
  if (!Array.isArray(items) || items.length === 0) return "Movimiento";
  if (items.length === 1) return items[0].nombre || "Movimiento";
  return `${items[0].nombre || "Movimiento"} +${items.length - 1} más`;
}

export async function registrarVenta({ usuarioId, usuarioNombre = "", items, metodoPago = "efectivo", nota = "", actividadVentaId = "", actividadVentaNombre = "" }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Agrega al menos un producto.");

  const ventaRef = doc(collection(db, "ventas"));
  const fondoMovimientoRef = crearMovimientoFondoRef();
  const movimientoRefs = items.map(() => crearMovimientoInventarioRef());

  return runTransaction(db, async (tx) => {
    const lecturas = await leerProductosTx(tx, items);

    const lineas = [];
    let total = 0;
    let utilidadTotal = 0;
    const stockPorProducto = new Map();

    for (let i = 0; i < lecturas.length; i += 1) {
      const { ref: productoRef, snap: productoSnap, item } = lecturas[i];

      if (!productoSnap.exists()) {
        throw new Error(`El producto ${nombreProducto(item)} ya no existe.`);
      }

      const producto = productoSnap.data();
      if (producto.activo === false) {
        throw new Error(`El producto ${nombreProducto(item, producto)} está inactivo.`);
      }

      const cantidad = cantidadItem(item);
      const stockActual = tomarStockActual(stockPorProducto, item.productoId, producto);
      if (stockActual < cantidad) {
        throw new Error(`Stock insuficiente para ${nombreProducto(item, producto)}.`);
      }

      const unitario = precioItem(item, producto, "precioVenta");
      const costoUnitario = costoItem(item, producto);
      const utilidadUnit = utilidadUnitaria(unitario, costoUnitario);
      const subtotal = r2(unitario * cantidad);
      const utilidadLinea = r2(utilidadUnit * cantidad);
      const nuevoStock = stockActual - cantidad;
      stockPorProducto.set(item.productoId, nuevoStock);

      tx.update(productoRef, {
        stock: nuevoStock,
        actualizadoEn: serverTimestamp(),
      });

      tx.set(movimientoRefs[i], {
        tipo: "salida",
        origen: "venta",
        productoId: item.productoId,
        nombre: nombreProducto(item, producto),
        cantidad,
        antes: stockActual,
        despues: nuevoStock,
        motivo: item.motivo || "Venta registrada",
        referenciaId: ventaRef.id,
        usuarioId,
        creadoEn: serverTimestamp(),
      });

      lineas.push({
        productoId: item.productoId,
        nombre: nombreProducto(item, producto),
        cantidad,
        cantidadPaquete: aNumero(item.cantidadPaquete, 0),
        unidadesPorPaquete: aNumero(item.unidadesPorPaquete, 0),
        precioUnitario: unitario,
        costoUnitario,
        utilidadUnitaria: utilidadUnit,
        utilidadTotal: utilidadLinea,
        subtotal,
        tipo: "venta",
      });

      total += subtotal;
      utilidadTotal += utilidadLinea;
    }
    total = r2(total);
    utilidadTotal = r2(utilidadTotal);

    // increment() suma atómicamente sin necesitar leer antes el balance,
    // para que roles sin acceso de lectura a /fondos (todo el staff de ventas)
    // puedan completar esta transacción sin exponerles el balance actual.
    tx.set(fondoRef(), {
      balance: increment(total),
      actualizadoEn: serverTimestamp(),
    }, { merge: true });

    tx.set(fondoMovimientoRef, {
      tipo: "ingreso",
      origen: "venta",
      monto: total,
      descripcion: nota || resumenItemPrincipal(lineas),
      titulo: resumenItemPrincipal(lineas),
      referenciaId: ventaRef.id,
      usuarioId,
      usuarioNombre,
      creadoEn: serverTimestamp(),
    });

    tx.set(ventaRef, {
      usuarioId,
      usuarioNombre,
      items: lineas,
      total,
      utilidadTotal,
      metodoPago,
      nota,
      actividadVentaId: actividadVentaId || null,
      actividadVentaNombre: actividadVentaNombre || null,
      creadoEn: serverTimestamp(),
    });

    return { id: ventaRef.id, total, utilidadTotal, items: lineas };
  });
}

export async function registrarCompra({ usuarioId, usuarioNombre = "", proveedor = "", items, metodoPago = "efectivo", nota = "", factura = null }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Agrega al menos un producto.");
  if (!String(proveedor).trim()) throw new Error("El proveedor es obligatorio.");
  if (!String(metodoPago).trim()) throw new Error("El método de pago es obligatorio.");
  if (!factura) throw new Error("Selecciona una factura.");

  const compraRef = doc(collection(db, "compras"));
  const fondoMovimientoRef = crearMovimientoFondoRef();
  const movimientoRefs = items.map(() => crearMovimientoInventarioRef());

  // Primero: guardar compra en Firestore (atomicamente)
  const transactionResult = await runTransaction(db, async (tx) => {
    const lecturas = await leerProductosTx(tx, items);

    const lineas = [];
    let total = 0;

    for (let i = 0; i < lecturas.length; i += 1) {
      const { ref: productoRef, snap: productoSnap, item } = lecturas[i];

      if (!productoSnap.exists()) {
        throw new Error(`El producto ${nombreProducto(item)} ya no existe.`);
      }

      const producto = productoSnap.data();
      const cantidad = cantidadItem(item);
      const stockActual = aNumero(producto.stock, 0);
      const precioPaquete = aNumero(item.precioPaquete, NaN);
      const subtotal = r2(Number.isFinite(precioPaquete) && precioPaquete > 0
        ? precioPaquete * Math.trunc(aNumero(item.cantidadPaquete, 0))
        : subtotalItem(item, producto, "precioCompra"));
      const unitario = r2(subtotal / cantidad);
      const nuevoStock = stockActual + cantidad;

      tx.update(productoRef, {
        stock: nuevoStock,
        precioCompra: unitario,
        ultimoCosto: unitario,
        actualizadoEn: serverTimestamp(),
      });

      tx.set(movimientoRefs[i], {
        tipo: "entrada",
        origen: "compra",
        productoId: item.productoId,
        nombre: nombreProducto(item, producto),
        cantidad,
        antes: stockActual,
        despues: nuevoStock,
        motivo: item.motivo || "Compra registrada",
        referenciaId: compraRef.id,
        usuarioId,
        creadoEn: serverTimestamp(),
      });

      // Se guardan también paquetes/unidades-por-paquete/precio-por-paquete
      // (no solo el total ya calculado) para que una corrección posterior
      // pueda editar la compra con las mismas unidades con que se capturó,
      // en vez de forzar a recalcular a partir del precio por unidad.
      const cantidadPaqueteGuardada = Math.trunc(aNumero(item.cantidadPaquete, 0)) || 1;
      const unidadesPorPaqueteGuardada = Math.trunc(aNumero(item.unidadesPorPaquete, 0)) || cantidad;
      const precioPaqueteGuardado = Number.isFinite(precioPaquete) && precioPaquete > 0
        ? r2(precioPaquete)
        : r2(subtotal / cantidadPaqueteGuardada);

      lineas.push({
        productoId: item.productoId,
        nombre: nombreProducto(item, producto),
        cantidad,
        cantidadPaquete: cantidadPaqueteGuardada,
        unidadesPorPaquete: unidadesPorPaqueteGuardada,
        precioPaquete: precioPaqueteGuardado,
        precioUnitario: unitario,
        subtotal,
      });

      total += subtotal;
    }
    total = r2(total);

    // increment() suma/resta atómicamente sin necesitar leer antes el balance,
    // para que roles sin acceso de lectura a /fondos (ej. logística) puedan
    // completar esta transacción sin exponerles el balance actual.
    tx.set(fondoRef(), {
      balance: increment(-total),
      actualizadoEn: serverTimestamp(),
    }, { merge: true });

    tx.set(fondoMovimientoRef, {
      tipo: "salida",
      origen: "compra",
      monto: total,
      descripcion: nota || resumenItemPrincipal(lineas),
      titulo: resumenItemPrincipal(lineas),
      referenciaId: compraRef.id,
      usuarioId,
      usuarioNombre,
      creadoEn: serverTimestamp(),
    });

    tx.set(compraRef, {
      usuarioId,
      usuarioNombre,
      proveedor,
      items: lineas,
      total,
      metodoPago,
      nota,
      factura: null,
      facturaEstado: "pendiente",
      facturaError: null,
      creadoEn: serverTimestamp(),
    });

    return { id: compraRef.id, total, items: lineas };
  });

  // Segundo: intenta subir factura de manera no-bloqueante
  let facturaSubida = false;
  let facturaError = null;

  try {
    const facturaMetadata = await subirFacturaAStorage({
      compraId: transactionResult.id,
      factura,
      usuarioId,
    });

    // Éxito: actualiza el documento con la factura
    await setDoc(doc(db, "compras", transactionResult.id), {
      factura: facturaMetadata,
      facturaEstado: "subida",
      facturaError: null,
      actualizadoEn: serverTimestamp(),
    }, { merge: true });

    facturaSubida = true;
  } catch (error) {
    // Fallo: registra el error pero NO detiene el proceso. La compra ya quedó
    // guardada por la transacción anterior; si este intento de marcarla como
    // "error" también falla, no debe ocultar el resultado ya exitoso.
    facturaError = error.message || "Error desconocido al subir factura.";
    try {
      await setDoc(doc(db, "compras", transactionResult.id), {
        facturaEstado: "error",
        facturaError,
        actualizadoEn: serverTimestamp(),
      }, { merge: true });
    } catch (errorSecundario) {
      console.warn("No se pudo marcar la factura como pendiente/error:", errorSecundario);
    }
  }

  return {
    ...transactionResult,
    facturaSubida,
    facturaError,
  };
}

// ── CORRECCIÓN DE VENTAS Y COMPRAS ────────────────────────────────────────────
// Permite a CEO corregir una venta/compra ya registrada por error de captura,
// sin tocar la base de datos a mano. En vez de reescribir los movimientos ya
// existentes (stock/fondos), se calcula la diferencia neta entre lo anterior y
// lo corregido y se aplica como un ajuste adicional dentro de una única
// transacción atómica. Los movimientos originales quedan intactos y se agrega
// un movimiento de "corrección" nuevo, para conservar un rastro de auditoría
// completo. El documento de venta/compra sí se actualiza con los valores
// corregidos (es lo que el usuario ve), guardando además el estado anterior en
// `historialCorrecciones`.

function agruparCantidadPorProducto(items) {
  const mapa = new Map();
  (items || []).forEach((item) => {
    const productoId = item?.productoId;
    if (!productoId) return;
    const cantidad = Math.trunc(aNumero(item.cantidad, 0));
    mapa.set(productoId, (mapa.get(productoId) || 0) + cantidad);
  });
  return mapa;
}

function validarItemsCorreccion(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agrega al menos un producto.");
  }
  items.forEach((item) => {
    if (!item.productoId) throw new Error("Falta el producto en una de las líneas.");
    const cantidad = Math.trunc(aNumero(item.cantidad, 0));
    if (cantidad <= 0) throw new Error(`Cantidad inválida para ${item.nombre || item.productoId}.`);
    const precio = aNumero(item.precioUnitario, NaN);
    if (!Number.isFinite(precio) || precio < 0) throw new Error(`Precio inválido para ${item.nombre || item.productoId}.`);
  });
}

// Los items de compra se capturan igual que en compras2.js: por paquete
// (cantidadPaquete × unidadesPorPaquete) y precio por paquete, no por unidad
// suelta — así una corrección puede editarse con las mismas unidades con que
// se registró originalmente.
function normalizarItemsCorreccionCompra(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Agrega al menos un producto.");
  }
  return items.map((item) => {
    if (!item.productoId) throw new Error("Falta el producto en una de las líneas.");
    const cantidadPaquete = Math.trunc(aNumero(item.cantidadPaquete, 0));
    const unidadesPorPaquete = Math.trunc(aNumero(item.unidadesPorPaquete, 0));
    const precioPaquete = aNumero(item.precioPaquete, NaN);
    if (cantidadPaquete <= 0) throw new Error(`Cantidad de paquetes inválida para ${item.nombre || item.productoId}.`);
    if (unidadesPorPaquete <= 0) throw new Error(`Unidades por paquete inválidas para ${item.nombre || item.productoId}.`);
    if (!Number.isFinite(precioPaquete) || precioPaquete <= 0) throw new Error(`Precio por paquete inválido para ${item.nombre || item.productoId}.`);

    const cantidad = cantidadPaquete * unidadesPorPaquete;
    const subtotal = r2(precioPaquete * cantidadPaquete);
    return {
      productoId: item.productoId,
      nombre: item.nombre,
      cantidadPaquete,
      unidadesPorPaquete,
      precioPaquete: r2(precioPaquete),
      cantidad,
      subtotal,
      precioUnitario: r2(subtotal / cantidad),
    };
  });
}

async function leerProductosPorIds(tx, productoIds, cache) {
  const lecturas = await leerProductosTx(tx, [...productoIds].map((productoId) => ({ productoId })), cache);
  const mapa = new Map();
  lecturas.forEach(({ ref, snap, item }) => mapa.set(item.productoId, { ref, snap }));
  return mapa;
}

export async function corregirVenta({ ventaId, usuarioId, usuarioNombre = "", items, metodoPago, nota = "", motivoCorreccion }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!ventaId) throw new Error("No se especificó la venta a corregir.");
  if (!String(motivoCorreccion || "").trim()) throw new Error("Debes indicar el motivo de la corrección.");
  if (!String(metodoPago || "").trim()) throw new Error("Selecciona un método de pago.");
  validarItemsCorreccion(items);

  const ventaRef = doc(db, "ventas", ventaId);
  const fondoMovimientoRef = crearMovimientoFondoRef();

  return runTransaction(db, async (tx) => {
    const ventaSnap = await tx.get(ventaRef);
    if (!ventaSnap.exists()) throw new Error("La venta ya no existe.");
    const ventaActual = ventaSnap.data();
    const oldItems = Array.isArray(ventaActual.items) ? ventaActual.items : [];

    const cantidadesAntes = agruparCantidadPorProducto(oldItems);
    const cantidadesDespues = agruparCantidadPorProducto(items);
    const productoIds = new Set([...cantidadesAntes.keys(), ...cantidadesDespues.keys()]);

    const productos = await leerProductosPorIds(tx, productoIds, new Map());

    // Calcular el stock resultante por producto: se revierte la venta anterior
    // (se devuelve lo vendido) y se aplica la venta corregida (se descuenta lo nuevo).
    const stockResultante = new Map();
    productos.forEach(({ snap }, productoId) => {
      if (!snap.exists()) throw new Error(`El producto ${productoId} ya no existe.`);
      const producto = snap.data();
      const stockActual = aNumero(producto.stock, 0);
      const antes = cantidadesAntes.get(productoId) || 0;
      const despues = cantidadesDespues.get(productoId) || 0;
      const nuevoStock = stockActual + antes - despues;
      if (nuevoStock < 0) {
        throw new Error(`Stock insuficiente para ${producto.nombre || productoId} tras la corrección.`);
      }
      stockResultante.set(productoId, { antes: stockActual, despues: nuevoStock, producto });
    });

    // Reconstruir las líneas de la venta corregida. Si el item trae su propio
    // costoUnitario (editado a mano en el modal de corrección) se respeta tal
    // cual; si no, se toma el costo actual del producto.
    const lineasNuevas = [];
    let total = 0;
    let utilidadTotal = 0;
    items.forEach((item) => {
      const producto = stockResultante.get(item.productoId)?.producto || null;
      const cantidad = Math.trunc(aNumero(item.cantidad, 0));
      const unitario = precioItem(item, producto, "precioVenta");
      const costoUnitario = costoItem(item, producto);
      const utilidadUnit = utilidadUnitaria(unitario, costoUnitario);
      const subtotal = r2(unitario * cantidad);
      const utilidadLinea = r2(utilidadUnit * cantidad);
      lineasNuevas.push({
        productoId: item.productoId,
        nombre: nombreProducto(item, producto),
        cantidad,
        precioUnitario: unitario,
        costoUnitario,
        utilidadUnitaria: utilidadUnit,
        utilidadTotal: utilidadLinea,
        subtotal,
        tipo: "venta",
      });
      total += subtotal;
      utilidadTotal += utilidadLinea;
    });
    total = r2(total);
    utilidadTotal = r2(utilidadTotal);

    // Aplicar cambios de stock + un movimiento de inventario por producto afectado.
    stockResultante.forEach(({ antes, despues, producto }, productoId) => {
      if (despues === antes) return;
      tx.update(productos.get(productoId).ref, { stock: despues, actualizadoEn: serverTimestamp() });
      tx.set(crearMovimientoInventarioRef(), {
        tipo: despues > antes ? "entrada" : "salida",
        origen: "correccion_venta",
        productoId,
        nombre: producto.nombre || "Producto",
        cantidad: Math.abs(despues - antes),
        antes,
        despues,
        motivo: `Corrección de venta: ${motivoCorreccion.trim()}`,
        referenciaId: ventaId,
        usuarioId,
        creadoEn: serverTimestamp(),
      });
    });

    // Ajustar el fondo por la diferencia entre el total anterior y el corregido.
    const totalAnterior = r2(aNumero(ventaActual.total, 0));
    const deltaFondo = r2(total - totalAnterior);
    if (Math.abs(deltaFondo) >= 0.005) {
      tx.set(fondoRef(), { balance: increment(deltaFondo), actualizadoEn: serverTimestamp() }, { merge: true });
      tx.set(fondoMovimientoRef, {
        tipo: deltaFondo > 0 ? "ingreso" : "salida",
        origen: "correccion_venta",
        monto: Math.abs(deltaFondo),
        descripcion: `Corrección de venta: ${motivoCorreccion.trim()}`,
        titulo: "Corrección de venta",
        referenciaId: ventaId,
        usuarioId,
        usuarioNombre,
        creadoEn: serverTimestamp(),
      });
    }

    const historial = Array.isArray(ventaActual.historialCorrecciones) ? [...ventaActual.historialCorrecciones] : [];
    historial.push({
      fecha: new Date(),
      usuarioId,
      usuarioNombre,
      motivo: motivoCorreccion.trim(),
      itemsAnteriores: oldItems,
      totalAnterior,
      metodoPagoAnterior: ventaActual.metodoPago || null,
      notaAnterior: ventaActual.nota || null,
    });

    tx.update(ventaRef, {
      items: lineasNuevas,
      total,
      utilidadTotal,
      metodoPago,
      nota,
      historialCorrecciones: historial,
      ultimaCorreccion: {
        fecha: serverTimestamp(),
        usuarioId,
        usuarioNombre,
        motivo: motivoCorreccion.trim(),
      },
      actualizadoEn: serverTimestamp(),
    });

    return { id: ventaId, total, utilidadTotal };
  });
}

// Cuando corregir una compra cambia el costo de un producto, las ventas ya
// registradas de ese producto entre la fecha de esa compra y ahora quedaron
// con la utilidad calculada sobre el costo equivocado (el costo se "fotografía"
// al momento de vender, no se recalcula solo). Este paso, best-effort y
// posterior a la transacción principal, busca esas ventas y corrige la
// utilidad de las líneas que coinciden exactamente con el costo anterior — no
// mueve stock ni fondos, solo corrige la métrica de utilidad ya guardada.
//
// Supuesto: como el costo de un producto es un solo valor "vigente" (no hay
// lotes/costeo por compra), esto asume que no hubo OTRA compra del mismo
// producto entre la compra corregida y ahora; si la hubo, esas ventas ya
// tendrían un costo distinto guardado y no calzarán con `costoAnterior`, así
// que quedarán sin tocar (más seguro que corregir de más).
async function recalcularUtilidadVentasPorCambioCosto(cambiosCosto, desde) {
  if (!Array.isArray(cambiosCosto) || cambiosCosto.length === 0 || !desde) return;

  const cambiosPorProducto = new Map(cambiosCosto.map((c) => [c.productoId, c]));

  let snap;
  try {
    snap = await getDocs(query(collection(db, "ventas"), where("creadoEn", ">=", desde)));
  } catch (error) {
    console.warn("No se pudieron buscar ventas afectadas por el cambio de costo:", error);
    return;
  }

  function recalcularLinea(linea, esMerma) {
    const cambio = cambiosPorProducto.get(linea.productoId);
    if (!cambio) return linea;
    if (Math.abs(aNumero(linea.costoUnitario, 0) - cambio.costoAnterior) >= 0.005) return linea;

    const costoUnitario = cambio.costoNuevo;
    const cantidad = aNumero(linea.cantidad, 0);
    const esMermaSinVender = esMerma && linea.tipo !== "vendida";
    const utilidadUnit = esMermaSinVender
      ? -costoUnitario
      : utilidadUnitaria(aNumero(linea.precioUnitario, 0), costoUnitario);

    return { ...linea, costoUnitario, utilidadUnitaria: utilidadUnit, utilidadTotal: r2(utilidadUnit * cantidad), _cambiado: true };
  }

  for (const ventaDoc of snap.docs) {
    // Prefiltro barato con los datos ya traídos por la query, para no abrir
    // una transacción (lectura+posible escritura) por cada venta del rango de
    // fechas — solo por las que de verdad podrían tener el producto afectado.
    const ventaData = ventaDoc.data();
    const posibleCambio = (ventaData.items || []).some((it) => cambiosPorProducto.has(it.productoId))
      || (ventaData.mermas || []).some((m) => cambiosPorProducto.has(m.productoId));
    if (!posibleCambio) continue;

    const ventaRef = ventaDoc.ref;
    try {
      await runTransaction(db, async (tx) => {
        const freshSnap = await tx.get(ventaRef);
        if (!freshSnap.exists()) return;
        const venta = freshSnap.data();

        const items = (venta.items || []).map((it) => recalcularLinea(it, false));
        const mermas = (venta.mermas || []).map((m) => recalcularLinea(m, true));

        const huboCambio = items.some((it) => it._cambiado) || mermas.some((m) => m._cambiado);
        if (!huboCambio) return;

        let utilidadTotal = 0;
        let perdidaTotal = 0;
        items.forEach((it) => { utilidadTotal += aNumero(it.utilidadTotal, 0); delete it._cambiado; });
        mermas.forEach((m) => {
          utilidadTotal += aNumero(m.utilidadTotal, 0);
          if (m.tipo !== "vendida") perdidaTotal += r2(aNumero(m.costoUnitario, 0) * aNumero(m.cantidad, 0));
          delete m._cambiado;
        });

        tx.update(ventaRef, {
          items,
          ...(venta.mermas ? { mermas } : {}),
          utilidadTotal: r2(utilidadTotal),
          ...(venta.mermas ? { perdidaTotal: r2(perdidaTotal) } : {}),
          actualizadoEn: serverTimestamp(),
        });
      });
    } catch (error) {
      console.warn(`No se pudo recalcular la utilidad de la venta ${ventaDoc.id}:`, error);
    }
  }
}

export async function corregirCompra({ compraId, usuarioId, usuarioNombre = "", proveedor, items, metodoPago, nota = "", motivoCorreccion }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!compraId) throw new Error("No se especificó la compra a corregir.");
  if (!String(motivoCorreccion || "").trim()) throw new Error("Debes indicar el motivo de la corrección.");
  if (!String(proveedor || "").trim()) throw new Error("El proveedor es obligatorio.");
  if (!String(metodoPago || "").trim()) throw new Error("Selecciona un método de pago.");
  const itemsNormalizados = normalizarItemsCorreccionCompra(items);

  const compraRef = doc(db, "compras", compraId);
  const fondoMovimientoRef = crearMovimientoFondoRef();

  const resultado = await runTransaction(db, async (tx) => {
    const compraSnap = await tx.get(compraRef);
    if (!compraSnap.exists()) throw new Error("La compra ya no existe.");
    const compraActual = compraSnap.data();
    const oldItems = Array.isArray(compraActual.items) ? compraActual.items : [];

    const cantidadesAntes = agruparCantidadPorProducto(oldItems);
    const cantidadesDespues = agruparCantidadPorProducto(itemsNormalizados);
    const productoIds = new Set([...cantidadesAntes.keys(), ...cantidadesDespues.keys()]);

    const productos = await leerProductosPorIds(tx, productoIds, new Map());

    // Se revierte la compra anterior (se resta lo comprado) y se aplica la
    // compra corregida (se suma lo nuevo). Puede fallar si parte de ese stock
    // ya se vendió y la corrección reduce la cantidad comprada.
    const stockResultante = new Map();
    productos.forEach(({ snap }, productoId) => {
      if (!snap.exists()) throw new Error(`El producto ${productoId} ya no existe.`);
      const producto = snap.data();
      const stockActual = aNumero(producto.stock, 0);
      const antes = cantidadesAntes.get(productoId) || 0;
      const despues = cantidadesDespues.get(productoId) || 0;
      const nuevoStock = stockActual - antes + despues;
      if (nuevoStock < 0) {
        throw new Error(`La corrección dejaría stock negativo en ${producto.nombre || productoId} (es probable que ya se haya vendido parte de esta compra).`);
      }
      stockResultante.set(productoId, { antes: stockActual, despues: nuevoStock, producto });
    });

    // Reconstruir líneas de la compra corregida y juntar, por producto, todos
    // los campos a actualizar (stock + costo) en un solo update por documento.
    const productoUpdates = new Map();
    stockResultante.forEach(({ antes, despues }, productoId) => {
      if (despues !== antes) productoUpdates.set(productoId, { stock: despues });
    });

    const lineasNuevas = [];
    const cambiosCosto = [];
    let total = 0;
    itemsNormalizados.forEach((item) => {
      const producto = stockResultante.get(item.productoId)?.producto || null;
      lineasNuevas.push({
        productoId: item.productoId,
        nombre: nombreProducto(item, producto),
        cantidad: item.cantidad,
        cantidadPaquete: item.cantidadPaquete,
        unidadesPorPaquete: item.unidadesPorPaquete,
        precioPaquete: item.precioPaquete,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
      });
      total += item.subtotal;

      const costoAnterior = r2(aNumero(producto?.precioCompra ?? producto?.ultimoCosto, 0));
      if (Math.abs(costoAnterior - item.precioUnitario) >= 0.005) {
        cambiosCosto.push({ productoId: item.productoId, costoAnterior, costoNuevo: item.precioUnitario });
      }

      const existente = productoUpdates.get(item.productoId) || {};
      existente.precioCompra = item.precioUnitario;
      existente.ultimoCosto = item.precioUnitario;
      productoUpdates.set(item.productoId, existente);
    });
    total = r2(total);

    productoUpdates.forEach((data, productoId) => {
      tx.update(productos.get(productoId).ref, { ...data, actualizadoEn: serverTimestamp() });
    });

    stockResultante.forEach(({ antes, despues, producto }, productoId) => {
      if (despues === antes) return;
      tx.set(crearMovimientoInventarioRef(), {
        tipo: despues > antes ? "entrada" : "salida",
        origen: "correccion_compra",
        productoId,
        nombre: producto.nombre || "Producto",
        cantidad: Math.abs(despues - antes),
        antes,
        despues,
        motivo: `Corrección de compra: ${motivoCorreccion.trim()}`,
        referenciaId: compraId,
        usuarioId,
        creadoEn: serverTimestamp(),
      });
    });

    // Ajustar el fondo: si el nuevo total es mayor, se descuenta más; si es
    // menor, se devuelve la diferencia.
    const totalAnterior = r2(aNumero(compraActual.total, 0));
    const deltaFondo = r2(total - totalAnterior);
    if (Math.abs(deltaFondo) >= 0.005) {
      tx.set(fondoRef(), { balance: increment(-deltaFondo), actualizadoEn: serverTimestamp() }, { merge: true });
      tx.set(fondoMovimientoRef, {
        tipo: deltaFondo > 0 ? "salida" : "ingreso",
        origen: "correccion_compra",
        monto: Math.abs(deltaFondo),
        descripcion: `Corrección de compra: ${motivoCorreccion.trim()}`,
        titulo: "Corrección de compra",
        referenciaId: compraId,
        usuarioId,
        usuarioNombre,
        creadoEn: serverTimestamp(),
      });
    }

    const historial = Array.isArray(compraActual.historialCorrecciones) ? [...compraActual.historialCorrecciones] : [];
    historial.push({
      fecha: new Date(),
      usuarioId,
      usuarioNombre,
      motivo: motivoCorreccion.trim(),
      itemsAnteriores: oldItems,
      totalAnterior,
      proveedorAnterior: compraActual.proveedor || null,
      metodoPagoAnterior: compraActual.metodoPago || null,
      notaAnterior: compraActual.nota || null,
    });

    tx.update(compraRef, {
      items: lineasNuevas,
      total,
      proveedor: proveedor.trim(),
      metodoPago,
      nota,
      historialCorrecciones: historial,
      ultimaCorreccion: {
        fecha: serverTimestamp(),
        usuarioId,
        usuarioNombre,
        motivo: motivoCorreccion.trim(),
      },
      actualizadoEn: serverTimestamp(),
    });

    return { id: compraId, total, cambiosCosto, compraCreadoEn: compraActual.creadoEn };
  });

  // Best-effort y fuera de la transacción principal: si cambió el costo de
  // algún producto, corrige la utilidad de las ventas ya registradas de ese
  // producto que quedaron calculadas con el costo equivocado. Si esto falla,
  // no se revierte la corrección de la compra (stock/fondo), que ya quedó
  // bien — solo quedaría pendiente ajustar la utilidad mostrada en ventas.
  try {
    await recalcularUtilidadVentasPorCambioCosto(resultado.cambiosCosto, resultado.compraCreadoEn);
  } catch (error) {
    console.warn("No se pudo recalcular la utilidad de ventas posteriores:", error);
  }

  return resultado;
}

export async function ajustarStock({ usuarioId, productoId, cantidad, tipo, motivo = "" }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!productoId) throw new Error("Selecciona un producto.");

  const cantidadNormalizada = cantidadItem({ cantidad });
  const delta = tipo === "salida" ? -cantidadNormalizada : cantidadNormalizada;
  const movimientoRef = crearMovimientoInventarioRef();
  const productoRef = doc(db, "productos", productoId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(productoRef);
    if (!snap.exists()) throw new Error("El producto seleccionado ya no existe.");

    const producto = snap.data();
    const stockActual = aNumero(producto.stock, 0);
    const nuevoStock = stockActual + delta;

    if (nuevoStock < 0) {
      throw new Error("El ajuste dejaría stock negativo.");
    }

    tx.update(productoRef, {
      stock: nuevoStock,
      actualizadoEn: serverTimestamp(),
    });

    tx.set(movimientoRef, {
      tipo: delta >= 0 ? "entrada" : "salida",
      origen: "ajuste",
      productoId,
      nombre: producto.nombre || "Producto",
      cantidad: cantidadNormalizada,
      antes: stockActual,
      despues: nuevoStock,
      motivo: motivo || "Ajuste manual",
      referenciaId: movimientoRef.id,
      usuarioId,
      creadoEn: serverTimestamp(),
    });

    return { id: movimientoRef.id, stock: nuevoStock };
  });
}

// ── MERMA ─────────────────────────────────────────────────────────────────────
// Descuenta stock de cada producto y registra en movimientos_inventario
// y en bitácora como merma. NO mueve fondos.
export async function registrarMerma({ usuarioId, usuarioNombre = "", items, motivo = "" }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!Array.isArray(items) || items.length === 0) throw new Error("Agrega al menos un producto.");
  if (!motivo.trim()) throw new Error("El motivo de la merma es requerido.");

  return runTransaction(db, async (tx) => {
    // Leer y validar stock de todos los productos
    const refs   = items.map(it => doc(db, "productos", it.productoId));
    const snaps  = await Promise.all(refs.map(r => tx.get(r)));

    snaps.forEach((snap, i) => {
      if (!snap.exists()) throw new Error(`Producto ${items[i].nombre} no existe.`);
      const stockActual = Number(snap.data().stock || 0);
      if (stockActual < items[i].cantidad) {
        throw new Error(`Stock insuficiente para ${items[i].nombre} (disponible: ${stockActual}).`);
      }
    });

    const mermaRef = doc(collection(db, "mermas"));

    // Documento principal de merma (para bitácora)
    tx.set(mermaRef, {
      usuarioId,
      usuarioNombre,
      items: items.map(it => ({
        productoId:    it.productoId,
        nombre:        it.nombre,
        cantidad:      it.cantidad,
        descripcion:   it.descripcion || "",
        tipo:          it.tipo || (it.fueVendido ? "vendida" : "sin_vender"),
        fueVendido:    Boolean(it.fueVendido),
        precioUnitario:aNumero(it.precioUnitario, 0),
        costoUnitario: aNumero(it.costoUnitario, 0),
        utilidadUnitaria: aNumero(it.utilidadUnitaria, 0),
        utilidadTotal: aNumero(it.utilidadTotal, 0),
      })),
      motivo: motivo.trim(),
      creadoEn: serverTimestamp(),
    });

    // Descontar stock y crear movimiento por ítem
    snaps.forEach((snap, i) => {
      const it          = items[i];
      const stockActual = Number(snap.data().stock || 0);
      const nuevoStock  = stockActual - it.cantidad;
      const movRef      = doc(collection(db, "movimientos_inventario"));

      tx.update(refs[i], { stock: nuevoStock, actualizadoEn: serverTimestamp() });
      tx.set(movRef, {
        tipo:         "salida",
        origen:       "merma",
        productoId:   it.productoId,
        nombre:       it.nombre,
        cantidad:     it.cantidad,
        antes:        stockActual,
        despues:      nuevoStock,
        motivo:       motivo.trim(),
        referenciaId: mermaRef.id,
        usuarioId,
        creadoEn:     serverTimestamp(),
      });
    });

    return { id: mermaRef.id };
  });
}

export async function registrarMovimientoFondo({ usuarioId, usuarioNombre = "", tipo, monto, descripcion = "", referenciaId = null, titulo = "Movimiento" }) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  const montoNormalizado = aNumero(monto, 0);
  if (montoNormalizado <= 0) throw new Error("El monto debe ser mayor que cero.");

  const fondoMovimientoRef = crearMovimientoFondoRef();

  return runTransaction(db, async (tx) => {
    const balanceActual = await asegurarFondo(tx);
    const delta = tipo === "salida" ? -montoNormalizado : montoNormalizado;
    const nuevoBalance = balanceActual + delta;

    if (nuevoBalance < 0) {
      throw new Error("El fondo no puede quedar negativo.");
    }

    tx.set(fondoRef(), {
      balance: nuevoBalance,
      actualizadoEn: serverTimestamp(),
    }, { merge: true });

    tx.set(fondoMovimientoRef, {
      tipo: delta >= 0 ? "ingreso" : "salida",
      origen: "manual",
      monto: montoNormalizado,
      descripcion,
      titulo,
      referenciaId,
      usuarioId,
      usuarioNombre,
      creadoEn: serverTimestamp(),
    });

    return { id: fondoMovimientoRef.id, balance: nuevoBalance };
  });
}

// ── VENTA + MERMA (registro unificado) ────────────────────────────────────────
// Registra la venta normalmente (descuenta stock + suma fondos) y, si hay
// ítems de merma, los descuenta del inventario SIN mover fondos, todo en
// una sola transacción atómica.
export async function registrarVentaConMerma({
  usuarioId,
  usuarioNombre = "",
  items,                 // items de venta (array)
  nota = "",
  metodoPago = "efectivo",
  mermaItems = [],       // items de merma (array, puede estar vacío)
  motivoMerma = "",
  actividadVentaId = "",
  actividadVentaNombre = "",
}) {
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");
  if (!Array.isArray(items)) items = [];
  if (!Array.isArray(mermaItems)) mermaItems = [];
  if (items.length === 0 && mermaItems.length === 0) throw new Error("Agrega al menos un producto.");
  if (mermaItems.length > 0 && !motivoMerma.trim()) throw new Error("El motivo de la merma es requerido.");

  const tieneVentaBase = items.length > 0;
  const tieneMermaVendida = mermaItems.some((it) => String(it.tipo || (it.fueVendido ? "vendida" : "sin_vender")) === "vendida");
  const tieneMovimientoVenta = tieneVentaBase || tieneMermaVendida;

  const ventaRef = tieneMovimientoVenta ? doc(collection(db, "ventas")) : null;
  const fondoMovimientoRef = tieneMovimientoVenta ? crearMovimientoFondoRef() : null;
  const movVentaRefs = items.map(() => crearMovimientoInventarioRef());
  const movMermaRefs = mermaItems.map(() => crearMovimientoInventarioRef());
  const mermaRef = mermaItems.length > 0 ? doc(collection(db, "mermas")) : null;

  return runTransaction(db, async (tx) => {
    const cacheProductos = new Map();
    const lectVenta = items.length > 0 ? await leerProductosTx(tx, items, cacheProductos) : [];
    const lectMerma = mermaItems.length > 0 ? await leerProductosTx(tx, mermaItems, cacheProductos) : [];

    const lineas = [];
    const lineasMerma = [];
    let total = 0;
    let utilidadTotal = 0;
    let perdidaTotal = 0;
    const stockPorProducto = new Map();

    for (let i = 0; i < lectVenta.length; i += 1) {
      const { ref: prodRef, snap: prodSnap, item } = lectVenta[i];
      if (!prodSnap.exists()) throw new Error(`Producto ${item.nombre || ""} no encontrado.`);

      const prod = prodSnap.data();
      const cantidad = cantidadItem(item);
      const stockActual = tomarStockActual(stockPorProducto, item.productoId, prod);
      if (stockActual < cantidad) throw new Error(`Stock insuficiente para ${nombreProducto(item, prod)}.`);

      const unitario = precioItem(item, prod, "precioVenta");
      const costo = costoItem(item, prod);
      const utilidadUnit = utilidadUnitaria(unitario, costo);
      const subtotal = r2(unitario * cantidad);
      const utilidadLinea = r2(utilidadUnit * cantidad);
      const nuevoStock = stockActual - cantidad;
      stockPorProducto.set(item.productoId, nuevoStock);

      tx.update(prodRef, { stock: nuevoStock, actualizadoEn: serverTimestamp() });
      tx.set(movVentaRefs[i], {
        tipo: "salida",
        origen: "venta",
        productoId: item.productoId,
        nombre: nombreProducto(item, prod),
        cantidad,
        antes: stockActual,
        despues: nuevoStock,
        motivo: item.motivo || "Venta registrada",
        referenciaId: ventaRef ? ventaRef.id : null,
        usuarioId,
        creadoEn: serverTimestamp(),
        precioUnitario: unitario,
        costoUnitario: costo,
        utilidadUnitaria: utilidadUnit,
        utilidadTotal: utilidadLinea,
        tipoLinea: "venta",
      });

      lineas.push({
        productoId: item.productoId,
        nombre: nombreProducto(item, prod),
        cantidad,
        precioUnitario: unitario,
        costoUnitario: costo,
        utilidadUnitaria: utilidadUnit,
        utilidadTotal: utilidadLinea,
        subtotal,
        tipo: "venta",
      });

      total += subtotal;
      utilidadTotal += utilidadLinea;
    }

    for (let i = 0; i < lectMerma.length; i += 1) {
      const { ref: prodRef, snap: prodSnap, item } = lectMerma[i];
      if (!prodSnap.exists()) throw new Error(`Producto de merma ${item.nombre || ""} no encontrado.`);

      const prod = prodSnap.data();
      const cantidad = cantidadItem(item);
      const stockActual = tomarStockActual(stockPorProducto, item.productoId, prod);
      if (stockActual < cantidad) throw new Error(`Stock insuficiente para merma de ${nombreProducto(item, prod)}.`);

      const tipoMerma = String(item.tipo || (item.fueVendido ? "vendida" : "sin_vender"));
      const costo = costoItem(item, prod);
      const precioCobro = tipoMerma === "vendida" ? precioItem(item, prod, "precioVenta") : 0;
      const utilidadUnit = tipoMerma === "vendida" ? utilidadUnitaria(precioCobro, costo) : -costo;
      const utilidadLinea = r2(utilidadUnit * cantidad);
      const subtotal = r2(precioCobro * cantidad);
      const nuevoStock = stockActual - cantidad;
      stockPorProducto.set(item.productoId, nuevoStock);
      const descripcion = String(item.descripcion || item.motivo || "").trim();

      tx.update(prodRef, { stock: nuevoStock, actualizadoEn: serverTimestamp() });
      tx.set(movMermaRefs[i], {
        tipo: "salida",
        origen: "merma",
        productoId: item.productoId,
        nombre: nombreProducto(item, prod),
        cantidad,
        antes: stockActual,
        despues: nuevoStock,
        motivo: descripcion || motivoMerma.trim(),
        referenciaId: mermaRef ? mermaRef.id : null,
        usuarioId,
        creadoEn: serverTimestamp(),
        descripcion,
        tipoLinea: tipoMerma,
        fueVendido: tipoMerma === "vendida",
        precioUnitario: precioCobro,
        costoUnitario: costo,
        utilidadUnitaria: utilidadUnit,
        utilidadTotal: utilidadLinea,
      });

      lineasMerma.push({
        productoId: item.productoId,
        nombre: nombreProducto(item, prod),
        cantidad,
        descripcion,
        tipo: tipoMerma,
        fueVendido: tipoMerma === "vendida",
        precioUnitario: precioCobro,
        costoUnitario: costo,
        utilidadUnitaria: utilidadUnit,
        utilidadTotal: utilidadLinea,
        subtotal,
      });

      total += subtotal;
      utilidadTotal += utilidadLinea;
      if (tipoMerma === "sin_vender") {
        perdidaTotal += r2(costo * cantidad);
      }
    }
    total = r2(total);
    utilidadTotal = r2(utilidadTotal);
    perdidaTotal = r2(perdidaTotal);

    if (tieneMovimientoVenta) {
      // increment() evita tener que leer antes el balance, para que roles sin
      // acceso de lectura a /fondos puedan completar esta transacción.
      tx.set(fondoRef(), { balance: increment(total), actualizadoEn: serverTimestamp() }, { merge: true });
      tx.set(fondoMovimientoRef, {
        tipo: "ingreso",
        origen: "venta",
        monto: total,
        descripcion: nota || resumenItemPrincipal(lineas),
        titulo: resumenItemPrincipal(lineas),
        referenciaId: ventaRef ? ventaRef.id : null,
        usuarioId,
        usuarioNombre,
        creadoEn: serverTimestamp(),
      });
    }

    if (ventaRef) {
      tx.set(ventaRef, {
        usuarioId,
        usuarioNombre,
        items: lineas,
        total,
        utilidadTotal,
        perdidaTotal,
        metodoPago,
        nota,
        mermas: lineasMerma,
        motivoMerma: motivoMerma.trim() || null,
        actividadVentaId: actividadVentaId || null,
        actividadVentaNombre: actividadVentaNombre || null,
        creadoEn: serverTimestamp(),
      });
    }

    if (mermaRef && lineasMerma.length > 0) {
      tx.set(mermaRef, {
        usuarioId,
        usuarioNombre,
        items: lineasMerma,
        motivo: motivoMerma.trim(),
        referenciaVenta: ventaRef ? ventaRef.id : null,
        totalPerdida: perdidaTotal,
        utilidadTotal,
        creadoEn: serverTimestamp(),
      });
    }

    return {
      id: ventaRef ? ventaRef.id : (mermaRef ? mermaRef.id : null),
      total,
      utilidadTotal,
      perdidaTotal,
      items: lineas,
      mermas: lineasMerma,
    };
  });
}

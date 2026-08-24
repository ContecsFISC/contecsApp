const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

const db = getFirestore();

const ROLES_VENTA = new Set([
  "ceo", "junta_principal", "junta", "coordinador", "finanzas",
  "logistica", "ventas", "secretario", "actividades", "patrocinios",
  "investigacion", "voluntariado", "giras", "comunicaciones", "miembro",
]);
const ROLES_COMPRA = new Set([
  "ceo", "junta_principal", "junta", "finanzas", "ventas", "logistica",
]);
const ROLES_INVENTARIO = new Set([
  "ceo", "junta_principal", "junta", "ventas", "logistica",
]);
const ROLES_FONDOS = new Set(["ceo", "junta_principal", "finanzas"]);
const METODOS_PAGO = new Set([
  "efectivo", "yappy", "transferencia", "tarjeta", "otro",
]);

function numero(valor, fallback = 0) {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : fallback;
}

function dinero(valor) {
  return Math.round(numero(valor) * 100) / 100;
}

function dineroOpcional(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? dinero(resultado) : null;
}

function texto(valor, campo, max = 200, requerido = false) {
  const resultado = typeof valor === "string" ? valor.trim() : "";
  if (requerido && !resultado) {
    throw new HttpsError("invalid-argument", `${campo} es obligatorio.`);
  }
  const controlInvalido = [...resultado].some((caracter) => {
    const codigo = caracter.charCodeAt(0);
    return codigo === 127 ||
      (codigo < 32 && codigo !== 9 && codigo !== 10 && codigo !== 13);
  });
  if (resultado.length > max || resultado.includes("<") ||
      resultado.includes(">") || controlInvalido) {
    throw new HttpsError(
        "invalid-argument",
        `${campo} contiene caracteres no permitidos o es demasiado largo.`,
    );
  }
  return resultado;
}

function enteroPositivo(valor, campo) {
  const resultado = numero(valor, NaN);
  if (!Number.isInteger(resultado) || resultado <= 0 || resultado > 100000) {
    throw new HttpsError("invalid-argument", `${campo} no es válido.`);
  }
  return resultado;
}

function validarId(valor, campo) {
  const resultado = texto(valor, campo, 200, true);
  if (resultado.includes("/")) {
    throw new HttpsError("invalid-argument", `${campo} no es válido.`);
  }
  return resultado;
}

function normalizarItems(valor, nombre = "productos") {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > 100) {
    throw new HttpsError(
        "invalid-argument",
        `Agrega entre 1 y 100 ${nombre}.`,
    );
  }
  const items = valor.map((item, indice) => ({
    productoId: validarId(item?.productoId, `producto ${indice + 1}`),
    cantidad: enteroPositivo(item?.cantidad, `cantidad ${indice + 1}`),
    precioUnitario: dineroOpcional(item?.precioUnitario),
    cantidadPaquete: Math.trunc(numero(item?.cantidadPaquete, 0)),
    precioPaquete: dineroOpcional(item?.precioPaquete),
    subtotal: dineroOpcional(item?.subtotal),
    motivo: texto(item?.motivo, "motivo", 300),
    descripcion: texto(item?.descripcion, "descripción", 300),
    tipo: item?.tipo === "vendida" || item?.fueVendido === true ?
      "vendida" : "sin_vender",
  }));
  if (new Set(items.map((item) => item.productoId)).size !== items.length) {
    throw new HttpsError(
        "invalid-argument",
        `No repitas un producto dentro de la lista de ${nombre}.`,
    );
  }
  return items;
}

function metodoPagoValido(valor) {
  const metodo = texto(valor || "efectivo", "método de pago", 30, true)
      .toLowerCase();
  if (!METODOS_PAGO.has(metodo)) {
    throw new HttpsError("invalid-argument", "Método de pago no válido.");
  }
  return metodo;
}

async function obtenerActor(request, roles) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const usuarioSnap = await db.collection("usuarios")
      .doc(request.auth.uid).get();
  const usuario = usuarioSnap.data();
  if (!usuarioSnap.exists || !roles.has(usuario?.rol)) {
    throw new HttpsError(
        "permission-denied",
        "No tienes permiso para realizar esta operación.",
    );
  }
  return {
    id: request.auth.uid,
    nombre: texto(
        usuario.nombre || request.auth.token?.name ||
        request.auth.token?.email || "Usuario",
        "nombre de usuario",
        150,
    ),
    rol: usuario.rol,
  };
}

async function cargarProductos(tx, items) {
  const ids = [...new Set(items.map((item) => item.productoId))];
  const refs = ids.map((id) => db.collection("productos").doc(id));
  const snaps = await tx.getAll(...refs);
  const productos = new Map();
  snaps.forEach((snap) => {
    if (!snap.exists) {
      throw new HttpsError(
          "failed-precondition",
          "Uno de los productos ya no existe.",
      );
    }
    productos.set(snap.id, {ref: snap.ref, datos: snap.data()});
  });
  return productos;
}

function costoProducto(producto) {
  return dinero(
      producto.precioCompra ?? producto.ultimoCosto ??
      producto.costoUnitario ?? producto.precioVenta ?? 0,
  );
}

function precioVenta(item, producto) {
  const catalogo = dinero(producto.precioVenta);
  const solicitado = item.precioUnitario === null ? catalogo : item.precioUnitario;
  if (!Number.isFinite(solicitado) || solicitado < 0 || solicitado > 100000) {
    throw new HttpsError("invalid-argument", "El precio de venta no es válido.");
  }
  return {
    valor: solicitado,
    catalogo,
    modificado: solicitado !== catalogo,
  };
}

function nombreProducto(producto) {
  return texto(producto.nombre || "Producto", "nombre de producto", 150);
}

function resumen(items) {
  if (!items.length) return "Movimiento";
  if (items.length === 1) return items[0].nombre;
  return `${items[0].nombre} +${items.length - 1} más`;
}

function nuevoMovimientoInventario() {
  return db.collection("movimientos_inventario").doc();
}

function nuevoMovimientoFondo() {
  return db.collection("fondos_entrada").doc();
}

function aplicarStock(tx, estados) {
  estados.forEach((estado) => {
    tx.update(estado.ref, {
      stock: estado.stock,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
  });
}

async function ejecutarVenta(request, conMerma = false) {
  const actor = await obtenerActor(request, ROLES_VENTA);
  const data = request.data || {};
  const items = Array.isArray(data.items) && data.items.length ?
    normalizarItems(data.items) : [];
  const mermas = conMerma && Array.isArray(data.mermaItems) &&
    data.mermaItems.length ? normalizarItems(data.mermaItems, "mermas") : [];
  if (!items.length && !mermas.length) {
    throw new HttpsError("invalid-argument", "Agrega una venta o una merma.");
  }

  const actividadIdCrudo = texto(
      data.actividadVentaId,
      "actividad de venta",
      200,
  );
  let actividadId = null;
  let actividadNombre = "Merma manual";
  if (actividadIdCrudo) {
    actividadId = validarId(actividadIdCrudo, "actividad de venta");
    const actividadSnap = await db.collection("actividades_ventas")
        .doc(actividadId).get();
    if (!actividadSnap.exists || actividadSnap.data()?.activo === false) {
      throw new HttpsError(
          "failed-precondition",
          "La actividad de venta no existe o está desactivada.",
      );
    }
    actividadNombre = texto(
        actividadSnap.data()?.nombre || data.actividadVentaNombre || "Actividad",
        "nombre de actividad",
        150,
    );
  } else if (items.length) {
    throw new HttpsError(
        "invalid-argument",
        "Selecciona una actividad de venta.",
    );
  }
  const nota = texto(data.nota, "nota", 500);
  const motivoMerma = mermas.length ?
    texto(data.motivoMerma, "motivo de merma", 300, true) : "";
  const metodoPago = metodoPagoValido(data.metodoPago);
  const ventaRef = items.length || mermas.some((item) => item.tipo === "vendida") ?
    db.collection("ventas").doc() : null;
  const mermaRef = mermas.length ? db.collection("mermas").doc() : null;

  return db.runTransaction(async (tx) => {
    const productos = await cargarProductos(tx, [...items, ...mermas]);
    const estados = new Map();
    productos.forEach((entrada, id) => {
      estados.set(id, {
        ref: entrada.ref,
        stock: numero(entrada.datos.stock),
      });
    });

    const lineas = [];
    const lineasMerma = [];
    let total = 0;
    let utilidadTotal = 0;
    let perdidaTotal = 0;

    items.forEach((item) => {
      const entrada = productos.get(item.productoId);
      const producto = entrada.datos;
      if (producto.activo === false) {
        throw new HttpsError("failed-precondition", "Un producto está inactivo.");
      }
      const estado = estados.get(item.productoId);
      const antes = estado.stock;
      estado.stock -= item.cantidad;
      const precio = precioVenta(item, producto);
      const costo = costoProducto(producto);
      const subtotal = dinero(precio.valor * item.cantidad);
      const utilidadUnitaria = dinero(precio.valor - costo);
      const utilidadLinea = dinero(utilidadUnitaria * item.cantidad);
      const nombre = nombreProducto(producto);
      const movimientoRef = nuevoMovimientoInventario();

      tx.set(movimientoRef, {
        tipo: "salida",
        origen: "venta",
        productoId: item.productoId,
        nombre,
        cantidad: item.cantidad,
        antes,
        despues: estado.stock,
        motivo: item.motivo || "Venta registrada",
        referenciaId: ventaRef?.id || null,
        usuarioId: actor.id,
        precioUnitario: precio.valor,
        costoUnitario: costo,
        utilidadUnitaria,
        utilidadTotal: utilidadLinea,
        precioCatalogo: precio.catalogo,
        precioModificado: precio.modificado,
        creadoEn: FieldValue.serverTimestamp(),
      });
      lineas.push({
        productoId: item.productoId,
        nombre,
        cantidad: item.cantidad,
        precioUnitario: precio.valor,
        precioCatalogo: precio.catalogo,
        precioModificado: precio.modificado,
        costoUnitario: costo,
        utilidadUnitaria,
        utilidadTotal: utilidadLinea,
        subtotal,
        tipo: "venta",
      });
      total += subtotal;
      utilidadTotal += utilidadLinea;
    });

    mermas.forEach((item) => {
      const entrada = productos.get(item.productoId);
      const producto = entrada.datos;
      const estado = estados.get(item.productoId);
      const antes = estado.stock;
      estado.stock -= item.cantidad;
      const costo = costoProducto(producto);
      const precio = item.tipo === "vendida" ?
        precioVenta(item, producto) : {valor: 0, catalogo: 0, modificado: false};
      const subtotal = dinero(precio.valor * item.cantidad);
      const utilidadUnitaria = item.tipo === "vendida" ?
        dinero(precio.valor - costo) : -costo;
      const utilidadLinea = dinero(utilidadUnitaria * item.cantidad);
      const nombre = nombreProducto(producto);
      const movimientoRef = nuevoMovimientoInventario();

      tx.set(movimientoRef, {
        tipo: "salida",
        origen: "merma",
        productoId: item.productoId,
        nombre,
        cantidad: item.cantidad,
        antes,
        despues: estado.stock,
        motivo: item.descripcion || motivoMerma,
        referenciaId: mermaRef?.id || null,
        usuarioId: actor.id,
        descripcion: item.descripcion,
        tipoLinea: item.tipo,
        fueVendido: item.tipo === "vendida",
        precioUnitario: precio.valor,
        costoUnitario: costo,
        utilidadUnitaria,
        utilidadTotal: utilidadLinea,
        creadoEn: FieldValue.serverTimestamp(),
      });
      lineasMerma.push({
        productoId: item.productoId,
        nombre,
        cantidad: item.cantidad,
        descripcion: item.descripcion,
        tipo: item.tipo,
        fueVendido: item.tipo === "vendida",
        precioUnitario: precio.valor,
        costoUnitario: costo,
        utilidadUnitaria,
        utilidadTotal: utilidadLinea,
        subtotal,
      });
      total += subtotal;
      utilidadTotal += utilidadLinea;
      if (item.tipo === "sin_vender") perdidaTotal += costo * item.cantidad;
    });

    estados.forEach((estado) => {
      if (estado.stock < 0) {
        throw new HttpsError(
            "failed-precondition",
            "No hay stock suficiente para completar la operación.",
        );
      }
    });

    aplicarStock(tx, estados);
    total = dinero(total);
    utilidadTotal = dinero(utilidadTotal);
    perdidaTotal = dinero(perdidaTotal);

    if (ventaRef) {
      const fondoMovimientoRef = nuevoMovimientoFondo();
      tx.set(db.doc("fondos/principal"), {
        balance: FieldValue.increment(total),
        actualizadoEn: FieldValue.serverTimestamp(),
      }, {merge: true});
      tx.set(fondoMovimientoRef, {
        tipo: "ingreso",
        origen: "venta",
        monto: total,
        descripcion: nota || resumen(lineas),
        titulo: resumen(lineas),
        referenciaId: ventaRef.id,
        usuarioId: actor.id,
        usuarioNombre: actor.nombre,
        creadoEn: FieldValue.serverTimestamp(),
      });
      tx.set(ventaRef, {
        usuarioId: actor.id,
        usuarioNombre: actor.nombre,
        items: lineas,
        total,
        utilidadTotal,
        perdidaTotal,
        metodoPago,
        nota,
        mermas: lineasMerma,
        motivoMerma: motivoMerma || null,
        actividadVentaId: actividadId,
        actividadVentaNombre: actividadNombre,
        creadoEn: FieldValue.serverTimestamp(),
      });
    }
    if (mermaRef) {
      tx.set(mermaRef, {
        usuarioId: actor.id,
        usuarioNombre: actor.nombre,
        items: lineasMerma,
        motivo: motivoMerma,
        referenciaVenta: ventaRef?.id || null,
        totalPerdida: perdidaTotal,
        utilidadTotal,
        creadoEn: FieldValue.serverTimestamp(),
      });
    }
    return {
      id: ventaRef?.id || mermaRef?.id || null,
      total,
      utilidadTotal,
      perdidaTotal,
      items: lineas,
      mermas: lineasMerma,
    };
  });
}

async function ejecutarCompra(request) {
  const actor = await obtenerActor(request, ROLES_COMPRA);
  const data = request.data || {};
  const items = normalizarItems(data.items);
  const proveedor = texto(data.proveedor, "proveedor", 150, true);
  const nota = texto(data.nota, "nota", 500);
  const metodoPago = metodoPagoValido(data.metodoPago);
  const compraRef = db.collection("compras").doc();

  return db.runTransaction(async (tx) => {
    const productos = await cargarProductos(tx, items);
    const fondoRef = db.doc("fondos/principal");
    const fondoSnap = await tx.get(fondoRef);
    const estados = new Map();
    productos.forEach((entrada, id) => estados.set(id, {
      ref: entrada.ref,
      stock: numero(entrada.datos.stock),
      costo: null,
    }));
    const lineas = [];
    let total = 0;

    items.forEach((item) => {
      const entrada = productos.get(item.productoId);
      const estado = estados.get(item.productoId);
      const antes = estado.stock;
      let subtotal;
      if (Number.isFinite(item.precioPaquete) && item.precioPaquete > 0 &&
          item.cantidadPaquete > 0) {
        subtotal = dinero(item.precioPaquete * item.cantidadPaquete);
      } else {
        subtotal = item.subtotal;
      }
      if (!Number.isFinite(subtotal) || subtotal <= 0 || subtotal > 1000000) {
        throw new HttpsError("invalid-argument", "El costo de compra no es válido.");
      }
      const unitario = dinero(subtotal / item.cantidad);
      estado.stock += item.cantidad;
      estado.costo = unitario;
      const nombre = nombreProducto(entrada.datos);
      const movimientoRef = nuevoMovimientoInventario();
      tx.set(movimientoRef, {
        tipo: "entrada",
        origen: "compra",
        productoId: item.productoId,
        nombre,
        cantidad: item.cantidad,
        antes,
        despues: estado.stock,
        motivo: item.motivo || "Compra registrada",
        referenciaId: compraRef.id,
        usuarioId: actor.id,
        creadoEn: FieldValue.serverTimestamp(),
      });
      lineas.push({
        productoId: item.productoId,
        nombre,
        cantidad: item.cantidad,
        precioUnitario: unitario,
        subtotal,
      });
      total += subtotal;
    });

    estados.forEach((estado) => tx.update(estado.ref, {
      stock: estado.stock,
      precioCompra: estado.costo,
      ultimoCosto: estado.costo,
      actualizadoEn: FieldValue.serverTimestamp(),
    }));
    total = dinero(total);
    const balanceAntes = fondoSnap.exists ? numero(fondoSnap.data().balance) : 0;
    const balanceDespues = dinero(balanceAntes - total);
    if (balanceDespues < 0) {
      throw new HttpsError(
          "failed-precondition",
          "El fondo no tiene saldo suficiente para registrar la compra.",
      );
    }
    const fondoMovimientoRef = nuevoMovimientoFondo();
    tx.set(fondoRef, {
      balance: balanceDespues,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, {merge: true});
    tx.set(fondoMovimientoRef, {
      tipo: "salida",
      origen: "compra",
      monto: total,
      descripcion: nota || resumen(lineas),
      titulo: resumen(lineas),
      referenciaId: compraRef.id,
      usuarioId: actor.id,
      usuarioNombre: actor.nombre,
      creadoEn: FieldValue.serverTimestamp(),
    });
    tx.set(compraRef, {
      usuarioId: actor.id,
      usuarioNombre: actor.nombre,
      proveedor,
      items: lineas,
      total,
      metodoPago,
      nota,
      factura: null,
      facturaEstado: "pendiente",
      facturaError: null,
      creadoEn: FieldValue.serverTimestamp(),
    });
    return {id: compraRef.id, total, items: lineas};
  });
}

async function ejecutarAjuste(request) {
  const actor = await obtenerActor(request, ROLES_INVENTARIO);
  const data = request.data || {};
  const productoId = validarId(data.productoId, "producto");
  const cantidad = enteroPositivo(data.cantidad, "cantidad");
  const tipo = data.tipo === "salida" ? "salida" : "entrada";
  const motivo = texto(data.motivo, "motivo", 300);
  const productoRef = db.collection("productos").doc(productoId);
  const movimientoRef = nuevoMovimientoInventario();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(productoRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "El producto ya no existe.");
    }
    const antes = numero(snap.data().stock);
    const despues = antes + (tipo === "salida" ? -cantidad : cantidad);
    if (despues < 0) {
      throw new HttpsError("failed-precondition", "El stock quedaría negativo.");
    }
    tx.update(productoRef, {
      stock: despues,
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    tx.set(movimientoRef, {
      tipo,
      origen: "ajuste",
      productoId,
      nombre: nombreProducto(snap.data()),
      cantidad,
      antes,
      despues,
      motivo: motivo || "Ajuste manual",
      referenciaId: movimientoRef.id,
      usuarioId: actor.id,
      creadoEn: FieldValue.serverTimestamp(),
    });
    return {id: movimientoRef.id, stock: despues};
  });
}

async function ejecutarMerma(request) {
  const solicitud = {...request, data: {
    ...(request.data || {}),
    actividadVentaId: request.data?.actividadVentaId,
    mermaItems: request.data?.items,
    items: [],
    motivoMerma: request.data?.motivo,
  }};
  return ejecutarVenta(solicitud, true);
}

async function ejecutarMovimientoFondo(request) {
  const actor = await obtenerActor(request, ROLES_FONDOS);
  const data = request.data || {};
  const tipo = data.tipo === "salida" ? "salida" : "entrada";
  const monto = dinero(data.monto);
  if (monto <= 0 || monto > 1000000) {
    throw new HttpsError("invalid-argument", "El monto no es válido.");
  }
  const descripcion = texto(data.descripcion, "descripción", 500);
  const titulo = texto(data.titulo || "Movimiento", "título", 150);
  const referenciaId = data.referenciaId ?
    validarId(data.referenciaId, "referencia") : null;
  const fondoRef = db.doc("fondos/principal");
  const movimientoRef = nuevoMovimientoFondo();

  return db.runTransaction(async (tx) => {
    const fondoSnap = await tx.get(fondoRef);
    const antes = fondoSnap.exists ? numero(fondoSnap.data().balance) : 0;
    const balance = dinero(antes + (tipo === "salida" ? -monto : monto));
    if (balance < 0) {
      throw new HttpsError("failed-precondition", "El fondo quedaría negativo.");
    }
    tx.set(fondoRef, {
      balance,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, {merge: true});
    tx.set(movimientoRef, {
      tipo: tipo === "salida" ? "salida" : "ingreso",
      origen: "manual",
      monto,
      descripcion,
      titulo,
      referenciaId,
      usuarioId: actor.id,
      usuarioNombre: actor.nombre,
      creadoEn: FieldValue.serverTimestamp(),
    });
    return {id: movimientoRef.id, balance};
  });
}

async function ejecutarOperacionFinanciera(request) {
  const operacion = request.data?.operacion;
  switch (operacion) {
    case "venta": return ejecutarVenta(request, false);
    case "venta_merma": return ejecutarVenta(request, true);
    case "compra": return ejecutarCompra(request);
    case "ajuste_stock": return ejecutarAjuste(request);
    case "merma": return ejecutarMerma(request);
    case "movimiento_fondo": return ejecutarMovimientoFondo(request);
    default:
      throw new HttpsError("invalid-argument", "Operación no reconocida.");
  }
}

module.exports = {ejecutarOperacionFinanciera};

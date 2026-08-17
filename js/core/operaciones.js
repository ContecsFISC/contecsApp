import { app, auth, db, storage } from "./firebase-config.js";
import {
  doc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";

const functions = getFunctions(app, "us-central1");
const ejecutarOperacion = httpsCallable(
  functions,
  "ejecutarOperacionFinanciera",
);

function aNumero(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
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

export async function esperarAuthListo(timeout = 10000) {
  if (auth.currentUser) return;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout);
    const cancelar = onAuthStateChanged(auth, () => {
      clearTimeout(timer);
      cancelar();
      resolve();
    });
  });
}

async function llamarOperacion(tipo, datos = {}) {
  await esperarAuthListo();
  if (!auth.currentUser) {
    throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
  }

  try {
    const respuesta = await ejecutarOperacion({tipo, ...datos});
    return respuesta.data || {};
  } catch (error) {
    const mensaje = String(error?.message || "")
      .replace(/^Firebase:\s*/i, "")
      .replace(/^Error:\s*/i, "")
      .trim();
    throw new Error(mensaje || "No se pudo completar la operación.");
  }
}

function validarFacturaArchivo(factura) {
  if (!factura) throw new Error("Selecciona una factura.");

  const tiposPermitidos = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  if (!tiposPermitidos.includes(factura.type || "")) {
    throw new Error("La factura debe ser un PDF o una imagen válida.");
  }
  if (factura.size > 10 * 1024 * 1024) {
    throw new Error("La factura no puede superar 10 MB.");
  }
}

function limpiarNombreArchivo(nombre) {
  return String(nombre || "factura")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function descripcionErrorStorage(error, ruta) {
  const bucket = storage.app.options.storageBucket || "storage";
  const codigo = error?.code || "desconocido";
  return `No se pudo subir la factura a ${bucket}/${ruta} (${codigo}).`;
}

export async function subirFacturaAStorage({compraId, factura, usuarioId}) {
  if (!compraId) throw new Error("No se pudo preparar la factura.");
  if (!usuarioId) throw new Error("No se pudo identificar al usuario.");

  validarFacturaArchivo(factura);
  await esperarAuthListo();
  if (auth.currentUser?.uid !== usuarioId) {
    throw new Error("La sesión no coincide con el usuario de la compra.");
  }

  const nombreSeguro = limpiarNombreArchivo(factura.name);
  const ruta = `compras/${compraId}/facturas/${Date.now()}_${nombreSeguro}`;
  const archivoRef = storageRef(storage, ruta);

  try {
    const resultado = await uploadBytes(archivoRef, factura, {
      contentType: factura.type || "application/octet-stream",
    });
    const url = await getDownloadURL(resultado.ref);
    return {
      url,
      ruta,
      name: factura.name,
      size: factura.size,
      contentType: factura.type || "application/octet-stream",
      uploadedAt: serverTimestamp(),
      uploadedBy: usuarioId,
    };
  } catch (error) {
    throw new Error(descripcionErrorStorage(error, ruta));
  }
}

export async function registrarVenta({
  items,
  metodoPago = "efectivo",
  nota = "",
  actividadVentaId = "",
  actividadVentaNombre = "",
}) {
  return llamarOperacion("venta", {
    items,
    metodoPago,
    nota,
    actividadVentaId,
    actividadVentaNombre,
  });
}

export async function registrarCompra({
  proveedor = "",
  items,
  metodoPago = "efectivo",
  nota = "",
  factura = null,
}) {
  // La contabilidad se confirma primero en el servidor. La factura se sube
  // después; si falla, la compra conserva explícitamente el estado pendiente.
  const resultado = await llamarOperacion("compra", {
    proveedor,
    items,
    metodoPago,
    nota,
  });

  resultado.facturaSubida = false;
  resultado.facturaError = null;
  if (!factura) return resultado;

  try {
    const facturaInfo = await subirFacturaAStorage({
      compraId: resultado.id,
      factura,
      usuarioId: auth.currentUser.uid,
    });
    await setDoc(doc(db, "compras", resultado.id), {
      factura: facturaInfo,
      facturaEstado: "subida",
      facturaError: null,
      actualizadoEn: serverTimestamp(),
    }, {merge: true});
    resultado.facturaSubida = true;
  } catch (error) {
    resultado.facturaError = error?.message || String(error);
  }
  return resultado;
}

export async function ajustarStock({productoId, cantidad, tipo, motivo = ""}) {
  return llamarOperacion("ajuste_stock", {
    productoId,
    cantidad,
    tipo,
    motivo,
  });
}

export async function registrarMerma({items, motivo = ""}) {
  return llamarOperacion("merma", {items, motivo});
}

export async function registrarMovimientoFondo({
  tipo,
  monto,
  descripcion = "",
  referenciaId = null,
  titulo = "Movimiento",
}) {
  return llamarOperacion("movimiento_fondo", {
    tipo,
    monto,
    descripcion,
    referenciaId,
    titulo,
  });
}

export async function registrarVentaConMerma({
  items,
  metodoPago = "efectivo",
  nota = "",
  mermaItems = [],
  motivoMerma = "",
  actividadVentaId = "",
  actividadVentaNombre = "",
}) {
  return llamarOperacion("venta_merma", {
    items,
    metodoPago,
    nota,
    mermaItems,
    motivoMerma,
    actividadVentaId,
    actividadVentaNombre,
  });
}

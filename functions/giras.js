// Lógica de motivos de aviso de una gira, aparte de index.js para poder
// probarla sin cargar las Cloud Functions (ver test/giras.test.js).
//
// Un error aquí no rompe nada visiblemente: simplemente le llega a alguien el
// motivo de otro. Por eso está aislada y probada.

// Cuál motivo le corresponde a una entrada de `noSeleccionados`.
//
// `motivos` es un Map id -> motivo. Si la entrada no trae `motivoId` y solo hay
// un motivo definido, se asume ese: es el caso de las giras guardadas con el
// formato anterior, que tenían un único motivo suelto para toda la lista.
// Si no trae motivo y hay varios, devuelve null — es preferible no enviarle
// nada y avisar al staff que mandarle el motivo de otra persona.
function motivoDeEntrada(entrada, motivos) {
  const id = String(entrada?.motivoId || "").trim();
  if (id && motivos.has(id)) return motivos.get(id);
  if (!id && motivos.size === 1) return [...motivos.values()][0];
  return null;
}

// Convierte el formato anterior (un `motivoNoSeleccionados` suelto en el
// documento de la gira) en la forma nueva. Devuelve las entradas crudas; la
// validación de longitud y contenido la hace quien llama, que es donde vive
// HttpsError.
function motivosCrudosDeGira(gira) {
  const lista = Array.isArray(gira?.motivosAviso) ? gira.motivosAviso : [];
  const conId = lista.filter((m) => String(m?.id || "").trim());
  if (conId.length) return conId;

  if (String(gira?.motivoNoSeleccionados || "").trim()) {
    return [{
      id: "principal",
      titulo: gira.motivoNoSeleccionados,
      mensaje: gira.mensajeNoSeleccionados,
    }];
  }
  return [];
}

module.exports = {motivoDeEntrada, motivosCrudosDeGira};

// Importación de participantes desde la lista (Excel o CSV) que manda un
// profesor con sus estudiantes. Cada fila queda igual que si la persona se
// hubiera inscrito en registro.html — código de la misma secuencia, token y
// locks de identidad — con el pago pendiente (efectivo) para que Finanzas lo
// apruebe después.
//
// Las listas llegan incompletas: solo se exige el nombre y algo que
// identifique a la persona (cédula o correo). Una fila con problemas se omite
// y se informa el motivo; no tumba al resto del lote.
//
// Vive aparte de index.js por lo mismo que eliminaciones.js, y para poder
// probarla contra el emulador (test/importaciones.integration.js).

const {HttpsError} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {esCorreoValido, generarDocId} = require("./identidad");
const {usuarioPuede} = require("./permisos");
const {
  CATEGORIAS_REGISTRO,
  generarToken,
  generarCodigos,
  crearParticipantesUnicos,
} = require("./registro");

const db = getFirestore();

// Mismo set que "importar_participantes" en js/core/permisos.js.
const ROLES_IMPORTAR_PARTICIPANTES = new Set(["ceo", "junta_principal"]);

// El panel parte las listas largas en llamadas de este tamaño.
const MAX_FILAS_POR_LLAMADA = 100;
const CREACIONES_SIMULTANEAS = 8;

// "colegio" no se importa: exige tutor y grupo, que se arman en registro.html.
const CATEGORIAS_IMPORTABLES = Object.keys(CATEGORIAS_REGISTRO).filter((c) => c !== "colegio");

// Campos de registro.html que la lista puede traer por columna, o el panel
// fijar para todo el lote. Cualquier otro se descarta.
const CAMPOS_EXTRA_IMPORTABLES = new Set([
  "correo-inst", "centro", "facultad", "carrera", "anio", "universidad",
  "rol", "departamento", "empresa", "cargo", "area", "ocupacion",
]);

const CAMPOS_FILA = [
  ["nombre", "nombre", 100],
  ["apellido", "apellido", 100],
  ["cedula", "cédula", 30],
  ["correo", "correo", 254],
  ["telefono", "teléfono", 30],
];

const limpiar = (valor) => String(valor ?? "").replace(/\s+/g, " ").trim();

// Misma comparación que los locks de identidad (idBloqueoParticipante).
const clave = (valor) => String(valor || "").trim().toLowerCase();

// Misma regla que validarTexto de index.js, pero devuelve el problema en vez
// de lanzar: una fila mala se reporta y el lote sigue.
function problemaDeTexto(texto, max) {
  if (texto.length > max) return "es demasiado largo";
  const contieneControl = [...texto].some((caracter) => {
    const codigo = caracter.charCodeAt(0);
    return codigo === 127 || (codigo < 32 && codigo !== 9 && codigo !== 10 && codigo !== 13);
  });
  if (texto.includes("<") || texto.includes(">") || contieneControl) {
    return "contiene caracteres no permitidos";
  }
  return null;
}

function normalizarCamposExtra(valor) {
  const datos = {};
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {datos};
  for (const [campo, contenido] of Object.entries(valor)) {
    if (!CAMPOS_EXTRA_IMPORTABLES.has(campo)) continue;
    const texto = limpiar(contenido);
    if (!texto) continue;
    const problema = problemaDeTexto(texto, 500);
    if (problema) return {error: `El campo ${campo} ${problema}.`};
    datos[campo] = texto;
  }
  return {datos};
}

// Devuelve {datos} listos para guardar o {error} con el motivo para el panel.
function normalizarFila(fila) {
  const datos = {};
  for (const [campo, etiqueta, max] of CAMPOS_FILA) {
    const texto = limpiar(fila?.[campo]);
    const problema = problemaDeTexto(texto, max);
    if (problema) return {error: `El campo ${etiqueta} ${problema}.`};
    datos[campo] = texto;
  }
  datos.correo = datos.correo.toLowerCase();
  if (!datos.nombre) return {error: "Falta el nombre."};
  if (!datos.cedula && !datos.correo) {
    return {error: "Falta la cédula o el correo para identificar a la persona."};
  }
  if (datos.correo && !esCorreoValido(datos.correo)) {
    return {error: `El correo ${datos.correo} no es válido.`};
  }
  const extra = normalizarCamposExtra(fila?.camposExtra);
  if (extra.error) return {error: extra.error};
  datos.camposExtra = extra.datos;
  return {datos};
}

// Deja pasar la primera aparición de cada cédula y correo; las siguientes se
// omiten señalando con qué fila chocan.
function separarRepetidas(filas) {
  const vistas = {cedula: new Map(), correo: new Map()};
  const unicas = [];
  const repetidas = [];
  for (const fila of filas) {
    const campo = ["cedula", "correo"].find((c) => fila[c] && vistas[c].has(clave(fila[c])));
    if (campo) {
      const etiqueta = campo === "cedula" ? "la cédula" : "el correo";
      repetidas.push({
        fila: fila.fila,
        motivo: `Repite ${etiqueta} de la fila ${vistas[campo].get(clave(fila[campo]))}.`,
      });
      continue;
    }
    ["cedula", "correo"].forEach((c) => {
      if (fila[c]) vistas[c].set(clave(fila[c]), fila.fila);
    });
    unicas.push(fila);
  }
  return {unicas, repetidas};
}

function enGrupos(lista, tamano) {
  const grupos = [];
  for (let i = 0; i < lista.length; i += tamano) grupos.push(lista.slice(i, i + tamano));
  return grupos;
}

// Busca en /participantes las cédulas y correos del lote. Igual que
// registrarParticipante: los registros antiguos no tienen documento-lock.
async function buscarYaInscritos(filas) {
  const inscritos = {cedula: new Map(), correo: new Map()};
  const consultas = ["cedula", "correo"].flatMap((campo) => {
    const valores = [...new Set(filas.map((f) => f[campo]).filter(Boolean))];
    // "in" admite hasta 30 valores por consulta.
    return enGrupos(valores, 30).map((grupo) => ({campo, grupo}));
  });
  await Promise.all(consultas.map(async ({campo, grupo}) => {
    const snap = await db.collection("participantes").where(campo, "in", grupo).get();
    snap.forEach((d) => inscritos[campo].set(clave(d.data()[campo]), d.data().codigo || d.id));
  }));
  return inscritos;
}

async function validarRol(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const snap = await db.collection("usuarios").doc(request.auth.uid).get();
  const usuario = snap.exists ? snap.data() : null;
  if (!usuarioPuede(usuario, "importar_participantes",
      ROLES_IMPORTAR_PARTICIPANTES)) {
    throw new HttpsError("permission-denied", "No tienes permiso para importar participantes.");
  }
  return request.auth.uid;
}

function leerLote(data) {
  const categoria = String(data.categoria || "");
  if (!CATEGORIAS_IMPORTABLES.includes(categoria)) {
    throw new HttpsError("invalid-argument", "Elige una categoría válida para el lote.");
  }
  const referencia = limpiar(data.referencia);
  if (problemaDeTexto(referencia, 200)) {
    throw new HttpsError("invalid-argument", "La referencia del lote no es válida.");
  }
  const loteId = String(data.loteId || "");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(loteId)) {
    throw new HttpsError("invalid-argument", "Falta el identificador del lote.");
  }
  const comunes = normalizarCamposExtra(data.camposComunes);
  if (comunes.error) throw new HttpsError("invalid-argument", comunes.error);
  if (!Array.isArray(data.filas) || !data.filas.length) {
    throw new HttpsError("invalid-argument", "La lista no trae filas para importar.");
  }
  if (data.filas.length > MAX_FILAS_POR_LLAMADA) {
    throw new HttpsError("invalid-argument", `Envía como máximo ${MAX_FILAS_POR_LLAMADA} filas por llamada.`);
  }
  return {categoria, referencia, loteId, comunes: comunes.datos};
}

// Mismo documento que arma registrarParticipante para una inscripción
// individual en efectivo, más `importacion` para saber de qué lista vino.
async function crearDesdeFila(fila, codigo, lote, uid) {
  const config = CATEGORIAS_REGISTRO[lote.categoria];
  const docRef = db.collection("participantes").doc(generarDocId(fila.cedula, fila.correo));
  const participante = {
    codigo,
    token: generarToken(),
    nombre: fila.nombre,
    apellido: fila.apellido,
    nombreCompleto: [fila.nombre, fila.apellido].filter(Boolean).join(" "),
    cedula: fila.cedula,
    correo: fila.correo,
    telefono: fila.telefono,
    categoria: lote.categoria,
    categoriaNombre: config.nombre,
    camposExtra: {...lote.comunes, ...fila.camposExtra},
    pago: {
      metodo: "efectivo",
      estado: "pendiente_efectivo",
      comprobanteRuta: null,
      monto: config.precio,
      aprobadoPor: null,
      aprobadoEn: null,
      notas: null,
    },
    esColegio: false,
    tutor: null,
    colegio: null,
    estudiantes: [],
    estadoRegistro: "activo",
    asistencias: {},
    correo_enviado: false,
    correo_pendiente: true,
    importacion: {
      loteId: lote.loteId,
      referencia: lote.referencia || null,
      fila: fila.fila,
      por: uid,
      en: FieldValue.serverTimestamp(),
    },
    fechaRegistro: FieldValue.serverTimestamp(),
    actualizadoEn: FieldValue.serverTimestamp(),
  };
  await crearParticipantesUnicos([{docRef, participante, correo: fila.correo, cedula: fila.cedula}]);
  return docRef.id;
}

async function importarParticipantes(request) {
  const uid = await validarRol(request);
  const data = request.data || {};
  const lote = leerLote(data);

  const omitidos = [];
  const validas = [];
  data.filas.forEach((fila, i) => {
    const numero = Number.isInteger(fila?.fila) ? fila.fila : i + 1;
    const resultado = normalizarFila(fila);
    if (resultado.error) omitidos.push({fila: numero, motivo: resultado.error});
    else validas.push({...resultado.datos, fila: numero});
  });

  const {unicas, repetidas} = separarRepetidas(validas);
  omitidos.push(...repetidas);

  const inscritos = await buscarYaInscritos(unicas);
  const nuevas = unicas.filter((fila) => {
    const campo = ["cedula", "correo"].find((c) => fila[c] && inscritos[c].has(clave(fila[c])));
    if (!campo) return true;
    const etiqueta = campo === "cedula" ? "la cédula" : "el correo";
    omitidos.push({
      fila: fila.fila,
      motivo: `Ya está inscrito con ${etiqueta} ${fila[campo]} (${inscritos[campo].get(clave(fila[campo]))}).`,
    });
    return false;
  });

  // Los códigos se reservan juntos y en el orden del archivo. Si alguien se
  // inscribe con la misma identidad justo durante la importación, su fila
  // falla en la transacción y ese código queda sin usar (igual que pasaría
  // con dos registros simultáneos en registro.html).
  const creados = [];
  if (nuevas.length) {
    const codigos = await generarCodigos(nuevas.length);
    const pares = nuevas.map((fila, i) => ({fila, codigo: codigos[i]}));
    for (const grupo of enGrupos(pares, CREACIONES_SIMULTANEAS)) {
      const resultados = await Promise.allSettled(
          grupo.map(({fila, codigo}) => crearDesdeFila(fila, codigo, lote, uid)),
      );
      resultados.forEach((r, i) => {
        const {fila, codigo} = grupo[i];
        if (r.status === "fulfilled") {
          creados.push({fila: fila.fila, codigo, docId: r.value, nombre: [fila.nombre, fila.apellido].filter(Boolean).join(" ")});
        } else if (r.reason instanceof HttpsError && r.reason.code === "already-exists") {
          omitidos.push({fila: fila.fila, motivo: r.reason.message});
        } else {
          console.error("importarParticipantes: fila", fila.fila, r.reason);
          omitidos.push({fila: fila.fila, motivo: "No se pudo guardar. Vuelve a importar esta fila."});
        }
      });
    }
  }

  const porFila = (a, b) => a.fila - b.fila;
  console.log("importarParticipantes:", lote.loteId, "creados", creados.length, "omitidos", omitidos.length);
  return {creados: creados.sort(porFila), omitidos: omitidos.sort(porFila)};
}

module.exports = {
  ROLES_IMPORTAR_PARTICIPANTES,
  MAX_FILAS_POR_LLAMADA,
  CATEGORIAS_IMPORTABLES,
  normalizarFila,
  separarRepetidas,
  importarParticipantes,
};

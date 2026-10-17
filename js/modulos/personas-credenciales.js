// =============================================
// CONTECS — Quién lleva credencial (módulo Credenciales)
// =============================================
// Convierte participantes, voluntarios y checkpoints en "personas" que el
// motor de dibujo (credenciales.js) sabe imprimir. Sin Firebase ni DOM, para
// probarlo con el código real (functions/test/credenciales-personas.test.mjs).
//
// Cada persona trae:
//   _clave  id estable para la selección y el historial de impresión
//   _tipo   participante | voluntario | comite | expositor
//   _sub    texto corto para la lista
//   _buscar texto normalizado para el buscador
//   _centro, _facultad  centro regional y facultad (UTP) para los filtros;
//           vacíos si la persona no los tiene
//   cred    (todas menos participante) QR, código, etiqueta y tema de color
//   _orden  (opcional) nombre para ordenar y agrupar por letra cuando el que
//           se imprime lleva título ("Dr. Tomás…" va en la T)

import { textoQr, tieneCredencial, categoriaDe, nombreDe } from "./credenciales.js";

export const TIPOS = {
  participante: { nombre: "Participantes", singular: "Participante", color: "#00722e" },
  voluntario: { nombre: "Voluntarios", singular: "Voluntario", color: "#a87400" },
  comite: { nombre: "Comité organizador", singular: "Comité organizador", color: "#c62828" },
  expositor: { nombre: "Expositores", singular: "Expositor", color: "#1565c0" },
};

export const normalizar = texto => String(texto || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();

const slug = texto => normalizar(texto).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);

const nombreVol = v => [v.nombre, v.apellido].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || v.id || "Voluntario";

// Centro regional y facultad: en participantes van en camposExtra (registro e
// importación), en voluntarios en el documento. Los expositores sin
// inscripción no los tienen.
const datosUtp = d => ({
  _centro: String(d?.centro || "").trim(),
  _facultad: String(d?.facultad || "").trim(),
});

// ── Participantes ──────────────────────────────────────────────────────────
// Tal cual: el motor ya sabe dibujarlos. Solo se marca si pueden llevar QR.
export function personaParticipante(p) {
  return {
    ...p,
    _clave: `participante_${p.id}`,
    _tipo: "participante",
    _sub: [p.codigo, categoriaDe(p)].filter(Boolean).join(" · "),
    _buscar: normalizar([nombreDe(p), p.cedula, p.codigo, p.correo].join(" ")),
    ...datosUtp(p.camposExtra),
    _imprimible: tieneCredencial(p),
    _aprobado: p.pago?.estado === "aprobado",
  };
}

// ── Voluntarios y comité organizador ───────────────────────────────────────
// Con token (functions/personal.js) el QR abre su perfil
// (public/perfil-personal.html); Lectura QR de voluntarios saca de ese enlace
// el documento para marcar horas, así que el comité también registra las
// suyas. Sin token el QR es la cédula (campo `id`), como antes.
// Misma URL que la constante de public/perfil-personal.html.
const URL_BASE_PERFIL_PERSONAL = "https://contecs-app.vercel.app/public/perfil-personal.html";

export function qrPersonal(v) {
  const docId = v._docId || v.docId || "";
  if (docId && v.token) {
    return `${URL_BASE_PERFIL_PERSONAL}?id=${encodeURIComponent(docId)}&t=${encodeURIComponent(v.token)}`;
  }
  return String(v.id || "").trim();
}

// La clave usa el documento, no el grupo: si alguien pasa de voluntario a
// comité, conserva su historial de impresión.
export function personaVoluntario(v) {
  const comite = v.grupo === "comite";
  const cedula = String(v.id || "").trim();
  return {
    nombre: v.nombre || "", apellido: v.apellido || "",
    nombreCompleto: nombreVol(v),
    cedula: "", // ya va en la etiqueta bajo el QR
    cred: {
      tema: comite ? "comite" : "voluntario",
      qr: cedula ? qrPersonal(v) : "",
      codigo: cedula,
      etiqueta: comite ? "Comité organizador" : "Voluntario",
      cabecera: comite ? "COMITÉ ORGANIZADOR" : "VOLUNTARIADO",
      institucion: v.carrera || "",
      titulo: comite ? "Comité Organizador" : "¡Gracias por tu apoyo!",
      subtitulo: "Presenta este QR para registrar tus horas de voluntariado",
    },
    _clave: `voluntario_${v._docId || v.docId || cedula}`,
    _tipo: comite ? "comite" : "voluntario",
    _sub: [cedula, v.carrera, v.horario].filter(Boolean).join(" · "),
    _buscar: normalizar([nombreVol(v), cedula, v.correo, v.carrera].join(" ")),
    ...datosUtp(v),
    _imprimible: !!cedula,
    _aviso: cedula ? "" : "Sin cédula: no tiene QR",
  };
}

// ── Docentes del comité organizador ───────────────────────────────────────
// Se agregan en el módulo Credenciales (colección `comite_docentes`). No son
// voluntarios: no marcan horas, así que van sin QR y en su lugar la
// credencial muestra el cargo o comité que ejercen.
export function personaDocente(d) {
  const sinTitulo = [d.nombre, d.apellido].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const nombre = [d.titulo, sinTitulo].filter(Boolean).join(" ");
  return {
    nombre: d.nombre || "", apellido: d.apellido || "", nombreCompleto: nombre,
    cedula: "",
    cred: {
      tema: "comite", qr: "", codigo: "",
      etiqueta: "Comité organizador", cabecera: "COMITÉ ORGANIZADOR",
      institucion: "",
      titulo: "Comité Organizador", subtitulo: "",
      // El cargo va solo, sin rótulo, y con el nombre más grandes (destacado).
      detalleTitulo: "", detalle: d.cargo ? [d.cargo] : [], destacado: true,
    },
    _clave: `comite_doc_${d.id}`,
    _tipo: "comite",
    _orden: sinTitulo,
    _sub: [d.cargo, "docente"].filter(Boolean).join(" · "),
    _buscar: normalizar([nombre, d.cargo].join(" ")),
    _centro: "", _facultad: "",
    _imprimible: true,
    _origen: "docente",
    _doc: d,
  };
}

// Una línea de la lista tal como viene en el documento del comité:
//   "• Dr. Tomás Concepción – Asesor Académico"
// Separa título, nombre y cargo. El guion que separa el cargo lleva espacios
// (o es una raya – —): así "Rodríguez-Chong" no se parte. Copiado de Excel,
// el cargo puede venir en otra columna (tabulador). Null si está vacía o es
// un encabezado ("Docentes:").
const RE_TITULO = /^((?:dra?|ing|lic(?:da)?|mgtr|msc|m\.sc|prof(?:a)?|mtr[oa]|arq)\.?)\s+/i;
export function leerLineaDocente(linea) {
  const limpia = String(linea || "").replace(/^[\s•·▪◦*\-–—]+|^\d+[.)]\s*/g, "")
    .replace(/\t+/g, " – ").replace(/\s+/g, " ").trim();
  if (!limpia || limpia.endsWith(":")) return null;
  const sep = /\s+[-–—]\s+|\s*[–—]\s*/.exec(limpia);
  let nombre = sep ? limpia.slice(0, sep.index).trim() : limpia;
  const cargo = sep ? limpia.slice(sep.index + sep[0].length).trim() : "";
  let titulo = "";
  const t = RE_TITULO.exec(nombre);
  if (t) {
    titulo = t[1].endsWith(".") ? t[1] : `${t[1]}.`;
    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
    nombre = nombre.slice(t[0].length).trim();
  }
  return { titulo, nombreCompleto: nombre, cargo };
}

// ── Expositores ────────────────────────────────────────────────────────────
// Dos fuentes:
//   - participantes que exponen (marcaron ponencia en el registro o están
//     elegidos como ponente en un checkpoint): su QR sigue siendo el de
//     acceso al congreso;
//   - nombres escritos a mano en el checkpoint (exponente sin inscripción):
//     van sin QR, con lo que exponen en su lugar;
//   - los agregados o importados en el módulo Credenciales (colección
//     `expositores`), para quien no se inscribió: igual, sin QR. Si su nombre
//     coincide con un exponente de una actividad, se le suman esas
//     actividades; si no tiene ninguna, se muestra el tema de su charla.
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function diaCorto(dia) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia || "");
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

export function lineaCharla(cp) {
  const cuando = [diaCorto(cp.dia), cp.horaInicio].filter(Boolean).join(", ");
  return [cp.nombre || "Actividad", cuando].filter(Boolean).join(" — ");
}

const ordenCharla = (a, b) => `${a.dia || ""} ${a.horaInicio || ""}`.localeCompare(`${b.dia || ""} ${b.horaInicio || ""}`);
const operativo = cp => cp && cp.estado !== "cancelado" && cp.activo !== false;

// Una actividad con varios expositores lleva sus nombres en un solo
// `exponente`: "Ana Ríos y Luis Gómez" o "Ana Ríos, Luis Gómez y Eva Paz".
export const nombresExponente = texto => String(texto || "")
  .split(/\s*[,;]\s*|\s+y\s+/i)
  .map(n => n.replace(/\s+/g, " ").trim())
  .filter(Boolean);

export function personasExpositores({ participantes = [], checkpoints = [], manuales = [] }) {
  const charlas = checkpoints.filter(operativo).sort(ordenCharla);
  const porId = new Map(participantes.map(p => [p.id, p]));
  const charlasDe = new Map(); // participanteId -> checkpoints
  const externos = new Map(); // nombre normalizado -> { nombre, charlas }

  charlas.forEach(cp => {
    if (cp.ponenteId && porId.has(cp.ponenteId)) {
      if (!charlasDe.has(cp.ponenteId)) charlasDe.set(cp.ponenteId, []);
      charlasDe.get(cp.ponenteId).push(cp);
    } else {
      nombresExponente(cp.exponente).forEach(nombre => {
        const k = normalizar(nombre);
        if (!externos.has(k)) externos.set(k, { nombre, charlas: [] });
        externos.get(k).charlas.push(cp);
      });
    }
  });

  // Un nombre escrito a mano que coincide con un inscrito que expone se le
  // suma a ese inscrito en vez de salir como otra persona.
  const expone = p => p.camposExtra?.ponencia === "si" || charlasDe.has(p.id);
  const inscritoPorNombre = new Map(participantes.filter(expone).map(p => [normalizar(nombreDe(p)), p.id]));
  externos.forEach((e, k) => {
    const id = inscritoPorNombre.get(k);
    if (!id) return;
    if (!charlasDe.has(id)) charlasDe.set(id, []);
    charlasDe.get(id).push(...e.charlas);
    charlasDe.get(id).sort(ordenCharla);
    externos.delete(k);
  });

  const inscritos = participantes
    .filter(expone)
    .map(p => {
      const suyas = charlasDe.get(p.id) || [];
      const conQr = tieneCredencial(p);
      return {
        ...p,
        cred: {
          tema: "expositor",
          qr: conQr ? textoQr(p) : "",
          codigo: p.codigo || "",
          etiqueta: "Expositor",
          cabecera: "EXPOSITOR",
          titulo: "¡Gracias por compartir!",
          subtitulo: conQr ? "Este QR también es tu acceso al Congreso" : "",
          detalleTitulo: "Expone",
          detalle: suyas.map(lineaCharla),
        },
        _clave: `expositor_${p.id}`,
        _tipo: "expositor",
        _sub: [p.codigo, suyas.length ? `${suyas.length} actividad${suyas.length !== 1 ? "es" : ""}` : "Ponencia en el registro"].filter(Boolean).join(" · "),
        _buscar: normalizar([nombreDe(p), p.cedula, p.codigo, ...suyas.map(c => c.nombre)].join(" ")),
        ...datosUtp(p.camposExtra),
        _imprimible: true,
        _origen: "inscrito",
      };
    });

  // Los agregados a mano: se quedan con las actividades de su mismo nombre.
  const agregados = manuales
    .filter(m => !inscritoPorNombre.has(normalizar([m.nombre, m.apellido].join(" "))))
    .map(m => {
      const nombre = [m.nombre, m.apellido].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const k = normalizar(nombre);
      const suyas = externos.get(k)?.charlas || [];
      externos.delete(k);
      const detalle = suyas.length ? suyas.map(lineaCharla) : m.tema ? [m.tema] : [];
      return {
        nombre: m.nombre || "", apellido: m.apellido || "", nombreCompleto: nombre,
        cedula: "",
        cred: {
          tema: "expositor", qr: "", codigo: "",
          etiqueta: "Expositor", cabecera: "EXPOSITOR",
          institucion: m.institucion || "",
          titulo: "¡Gracias por compartir!", subtitulo: "",
          detalleTitulo: suyas.length ? "Expone" : "Tema", detalle,
        },
        _clave: `expositor_man_${m.id}`,
        _tipo: "expositor",
        _sub: [m.institucion, suyas.length ? `${suyas.length} actividad${suyas.length !== 1 ? "es" : ""}` : m.tema, "agregado a mano"].filter(Boolean).join(" · "),
        _buscar: normalizar([nombre, m.cedula, m.institucion, m.tema, ...suyas.map(c => c.nombre)].join(" ")),
        _imprimible: true,
        _origen: "manual",
        _doc: m,
      };
    });

  const sinInscripcion = [...externos.values()]
    .map(e => ({
      nombreCompleto: e.nombre,
      cedula: "",
      cred: {
        tema: "expositor",
        qr: "",
        codigo: "",
        etiqueta: "Expositor",
        cabecera: "EXPOSITOR",
        institucion: "",
        titulo: "¡Gracias por compartir!",
        subtitulo: "",
        detalleTitulo: "Expone",
        detalle: e.charlas.map(lineaCharla),
      },
      _clave: `expositor_ext_${slug(e.nombre)}`,
      _tipo: "expositor",
      _sub: `${e.charlas.length} actividad${e.charlas.length !== 1 ? "es" : ""} · sin inscripción (sin QR)`,
      _buscar: normalizar([e.nombre, ...e.charlas.map(c => c.nombre)].join(" ")),
      _imprimible: true,
      _origen: "externo",
    }));

  return [...inscritos, ...agregados, ...sinInscripcion]
    .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), "es"));
}

// ── Grupos para la entrega ─────────────────────────────────────────────────
// Para repartir las credenciales en mesas: la lista se parte en N grupos
// seguidos (por nombre A–Z o por cédula) con la cantidad de personas lo más
// pareja posible. Nunca se parte una letra ni un tomo de cédula: en la mesa
// basta mirar la inicial o los dos primeros números.

const LETRAS = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

// Letra inicial del nombre tal como sale en la lista. Sin tildes (Á → A),
// pero la Ñ va aparte; lo que no empieza con letra se agrupa en "#".
export const nombreOrden = p => p._orden || nombreDe(p);

export function inicialDe(p) {
  const c = nombreOrden(p).trim().charAt(0).toUpperCase();
  if (c === "Ñ") return c;
  const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return /^[A-Z]$/.test(base) ? base : "#";
}

// La cédula está en sitios distintos según el tipo de persona.
export function cedulaDe(p) {
  const deVoluntario = p._tipo === "voluntario" || p._tipo === "comite" ? p.cred?.codigo : "";
  return String(p.cedula || deVoluntario || p._doc?.cedula || "").trim();
}

// Cédula panameña: provincia (1–13) o E/N/PE, a veces con AV/PI, tomo y
// asiento. Misma lectura que normalizarCedula() de functions/registro-voluntarios.js.
// Lo que no encaja (pasaportes, cédulas mal escritas) devuelve null.
export function partesCedula(texto) {
  const t = String(texto || "").toUpperCase()
    .replace(/[‐-―−]/g, "-").trim()
    .replace(/\s*-\s*/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const m = /^(\d{1,2}|PE|E|N)(?:-(AV|PI))?-(\d{1,4})-(\d{1,6})$/.exec(t);
  if (!m) return null;
  const provincia = /^\d+$/.test(m[1]) ? Number(m[1]) : { E: 100, N: 101, PE: 102 }[m[1]];
  return {
    prefijo: [/^\d+$/.test(m[1]) ? String(provincia) : m[1], m[2]].filter(Boolean).join("-"),
    orden: provincia * 3 + ({ AV: 1, PI: 2 }[m[2]] || 0),
    tomo: Number(m[3]),
    asiento: Number(m[4]),
  };
}

function unidadDe(p, modo) {
  if (modo === "nombre") {
    const l = inicialDe(p);
    return l === "#"
      ? { clave: "#", orden: [1], etiqueta: "otros", especial: true }
      : { clave: l, orden: [0, LETRAS.indexOf(l)], etiqueta: l };
  }
  const c = partesCedula(cedulaDe(p));
  if (c) return { clave: `${c.orden}-${c.tomo}`, orden: [0, c.orden, c.tomo], etiqueta: `${c.prefijo}-${c.tomo}`, prefijo: c.prefijo, tomo: c.tomo };
  return cedulaDe(p)
    ? { clave: "otro", orden: [1], etiqueta: "pasaportes y otros", especial: true }
    : { clave: "sin", orden: [2], etiqueta: "sin cédula", especial: true };
}

const compararOrden = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

// Corta `conteos` (en orden) en `k` tramos seguidos con la menor suma de
// (tamaño − promedio)²: programación dinámica. Como el costo es convexo, el
// mejor corte avanza con j y se busca por divide y vencerás: O(k·n·log n).
// Devuelve dónde termina cada tramo.
function partir(conteos, k) {
  const n = conteos.length;
  const suma = [0];
  conteos.forEach(c => suma.push(suma[suma.length - 1] + c));
  const meta = suma[n] / k;
  let previo = Array(n + 1).fill(Infinity);
  previo[0] = 0;
  const desde = [];
  for (let g = 1; g <= k; g++) {
    const actual = Array(n + 1).fill(Infinity);
    const corte = Array(n + 1).fill(0);
    const resolver = (lo, hi, optLo, optHi) => {
      if (lo > hi) return;
      const j = (lo + hi) >> 1;
      for (let i = optLo; i <= Math.min(j - 1, optHi); i++) {
        const v = previo[i] + (suma[j] - suma[i] - meta) ** 2;
        if (v < actual[j]) { actual[j] = v; corte[j] = i; }
      }
      resolver(lo, j - 1, optLo, corte[j]);
      resolver(j + 1, hi, corte[j], optHi);
    };
    resolver(g, n - (k - g), g - 1, n - 1);
    desde.push(corte);
    previo = actual;
  }
  const fines = [n];
  for (let g = k; g > 1; g--) fines.unshift(desde[g - 1][fines[0]]);
  return fines;
}

// Rango que se escribe en el cartel de la mesa. Llega hasta justo antes de
// donde empieza el grupo siguiente, para que nadie quede entre dos mesas.
function etiquetaGrupo(modo, unidades, siguiente, primero) {
  const normales = unidades.filter(u => !u.especial);
  const especiales = unidades.filter(u => u.especial).map(u => u.etiqueta);
  let rango = "";
  if (normales.length) {
    const a = normales[0], z = normales[normales.length - 1];
    let inicio = a.etiqueta, fin = z.etiqueta;
    if (modo === "nombre") {
      if (primero) inicio = LETRAS[0];
      fin = siguiente && !siguiente.especial ? LETRAS[LETRAS.indexOf(siguiente.etiqueta) - 1] : LETRAS[LETRAS.length - 1];
    } else if (siguiente && !siguiente.especial && siguiente.prefijo === z.prefijo) {
      fin = `${z.prefijo}-${siguiente.tomo - 1}`;
    }
    rango = inicio === fin ? inicio : `${inicio}${modo === "nombre" ? "–" : " a "}${fin}`;
  }
  return [rango, ...especiales].filter(Boolean).join(" + ");
}

// grupos: [{ etiqueta, personas }] en orden de entrega; grupoDe: _clave → índice;
// posicion: _clave → lugar en ese orden (para imprimir la pila ya ordenada).
export function gruposEquilibrados(personas, modo, cuantos) {
  const unidades = new Map();
  personas.forEach(p => {
    const u = unidadDe(p, modo);
    if (!unidades.has(u.clave)) unidades.set(u.clave, { ...u, personas: [] });
    unidades.get(u.clave).personas.push(p);
  });
  const lista = [...unidades.values()].sort((a, b) => compararOrden(a.orden, b.orden));
  const porNombre = (a, b) => nombreOrden(a).localeCompare(nombreOrden(b), "es");
  lista.forEach(u => u.personas.sort(modo === "cedula" && !u.especial
    ? (a, b) => partesCedula(cedulaDe(a)).asiento - partesCedula(cedulaDe(b)).asiento || porNombre(a, b)
    : porNombre));
  const k = Math.max(0, Math.min(Math.floor(cuantos) || 1, lista.length));
  const fines = k ? partir(lista.map(u => u.personas.length), k) : [];
  const grupos = fines.map((fin, i) => {
    const suyas = lista.slice(i ? fines[i - 1] : 0, fin);
    return { etiqueta: etiquetaGrupo(modo, suyas, lista[fin], i === 0), personas: suyas.flatMap(u => u.personas) };
  });
  const grupoDe = new Map(), posicion = new Map();
  grupos.forEach((g, i) => g.personas.forEach(p => { grupoDe.set(p._clave, i); posicion.set(p._clave, posicion.size); }));
  return { modo, grupos, grupoDe, posicion };
}

// ── Historial de impresión ─────────────────────────────────────────────────
// credenciales_impresas/{_clave}: cuántas veces y cuándo se imprimió.
export function estadoImpresion(persona, impresas) {
  const r = impresas.get(persona._clave);
  return r ? { impresa: true, veces: r.veces || 1, ultima: r.ultimaEn || null } : { impresa: false, veces: 0, ultima: null };
}

// =============================================
// CONTECS — Campus, facultades y carreras de la UTP
// =============================================
// Una sola lista para el registro público de voluntarios
// (public/registro-voluntarios.html), la plantilla de Excel y la importación
// (importar-voluntarios.js): así lo que se escribe a mano, lo que se elige en
// el Excel y lo que se importa queda con el mismo texto.

export const CAMPUS = [
  "Campus Central Dr. Víctor Levi Sasso (Panamá)", "Centro Regional de Azuero", "Centro Regional de Bocas del Toro",
  "Centro Regional de Chiriquí", "Centro Regional de Coclé", "Centro Regional de Colón",
  "Centro Regional de Panamá Oeste", "Centro Regional de Veraguas",
];

// Facultad → carreras que ofrece.
export const CARRERAS = {
  "Facultad de Ingeniería de Sistemas Computacionales": [
    "Licenciatura en Desarrollo y Gestión de Software",
    "Licenciatura en Ingeniería de Sistemas de Información Gerencial",
    "Licenciatura en Ciberseguridad",
    "Licenciatura en Ingeniería de Sistemas de Información",
    "Licenciatura en Ingeniería de Sistemas y Computación",
    "Licenciatura en Ingeniería de Software",
    "Licenciatura en Desarrollo de Software",
    "Licenciatura en Informática Aplicada a la Educación",
    "Licenciatura en Redes Informáticas",
    "Técnico en Informática para la Gestión Empresarial",
  ],
  "Facultad de Ciencias y Tecnología": [
    "Licenciatura en Ingeniería Forestal",
    "Licenciatura en Ingeniería en Alimentos",
    "Licenciatura en Comunicación Ejecutiva Bilingüe",
    "Licenciatura en Ingeniería Química",
  ],
  "Facultad de Ingeniería Civil": [
    "Licenciatura en Ingeniería Civil",
    "Licenciatura en Topografía",
    "Licenciatura en Edificaciones",
    "Licenciatura en Dibujo Automatizado",
    "Licenciatura en Ingeniería Geomática",
    "Licenciatura en Ingeniería Marítima Portuaria",
    "Licenciatura en Ingeniería Ambiental",
    "Licenciatura en Saneamiento y Ambiente",
    "Licenciatura en Operaciones Marítimas y Portuarias",
    "Licenciatura en Ingeniería Geológica",
    "Licenciatura en Ingeniería en Administración de Proyectos de Construcción",
    "Licenciatura en Modelado y Gestión Digital en Proyectos",
  ],
  "Facultad de Ingeniería Eléctrica": [
    "Licenciatura en Ingeniería de Control y Automatización",
    "Licenciatura en Ingeniería Eléctrica",
    "Licenciatura en Ingeniería Eléctrica y Electrónica",
    "Licenciatura en Ingeniería Electromecánica",
    "Licenciatura en Ingeniería Electrónica",
    "Licenciatura en Ingeniería Electrónica Industrial",
    "Licenciatura en Ingeniería Electrónica y Telecomunicaciones",
    "Licenciatura en Ingeniería en Telecomunicaciones",
    "Licenciatura en Electrónica y Sistemas de Comunicación",
    "Licenciatura en Sistemas Eléctricos y Automatización",
    "Técnico en Autotrónica",
    "Técnico en Ingeniería Electromecánica Industrial",
    "Técnico en Electrónica Biomédica",
    "Técnico en Sistemas Eléctricos",
    "Técnico en Telecomunicaciones",
  ],
  "Facultad de Ingeniería Industrial": [
    "Licenciatura en Ingeniería en Seguridad Industrial e Higiene Ocupacional",
    "Licenciatura en Ingeniería Industrial",
    "Licenciatura en Gestión Administrativa",
    "Licenciatura en Ingeniería Mecánica Industrial",
    "Licenciatura en Logística y Transporte Multimodal",
    "Licenciatura en Gestión de la Producción Industrial",
    "Licenciatura en Mercadeo y Comercio Internacional",
    "Licenciatura en Recursos Humanos y Gestión de la Productividad",
    "Licenciatura en Ingeniería Logística y Cadena de Suministro",
    "Licenciatura en Mercadeo y Negocios Internacionales",
  ],
  "Facultad de Ingeniería Mecánica": [
    "Licenciatura en Ingeniería Mecánica",
    "Licenciatura en Ingeniería de Mantenimiento",
    "Licenciatura en Ingeniería Naval",
    "Licenciatura en Ingeniería Aeronáutica",
    "Licenciatura en Ingeniería de Energía y Ambiente",
    "Licenciatura en Mecánica Industrial",
    "Licenciatura en Refrigeración y Aire Acondicionado",
    "Licenciatura en Mecánica Automotriz",
    "Licenciatura en Soldadura",
    "Licenciatura en Administración de Aviación con Opción a Vuelo (Piloto)",
    "Licenciatura en Administración de Aviación",
    "Técnico en Ingeniería de Mantenimiento de Aeronaves con Especialización en Motores y Fuselaje",
  ],
};

export const FACULTADES = Object.keys(CARRERAS);

// Siglas con las que se suele escribir la facultad.
export const SIGLAS_FACULTAD = {
  FISC: "Facultad de Ingeniería de Sistemas Computacionales",
  FCT: "Facultad de Ciencias y Tecnología",
  FIC: "Facultad de Ingeniería Civil",
  FIE: "Facultad de Ingeniería Eléctrica",
  FII: "Facultad de Ingeniería Industrial",
  FIM: "Facultad de Ingeniería Mecánica",
};

// [lo que se guarda, lo que se muestra]. registrarVoluntario solo acepta estos valores.
export const ANIOS = [
  ["1", "Primer año"], ["2", "Segundo año"], ["3", "Tercer año"],
  ["4", "Cuarto año"], ["5", "Quinto año"], ["Egresado", "Egresado"],
];

// ── NORMALIZAR ─────────────────────────────────────────────────────────────
// Lleva lo escrito al texto exacto del catálogo: sin importar tildes ni
// mayúsculas, y si no es igual, la única opción que lo contiene ("Azuero" →
// "Centro Regional de Azuero"). Si no hay una sola opción, devuelve el texto
// tal cual y quien importa lo avisa. Lo usan la importación de voluntarios y
// la de participantes, y la normalización de los participantes inscritos.
const normalizar = texto => String(texto || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sinGrado = texto => normalizar(texto).replace(/^(licenciatura|lic|tecnico|tec) (en )?/, "");

function delCatalogo(texto, lista, comparar = normalizar) {
  const t = comparar(texto);
  if (!t) return texto;
  const exacta = lista.find(opcion => comparar(opcion) === t);
  if (exacta) return exacta;
  const contienen = lista.filter(opcion => ` ${comparar(opcion)} `.includes(` ${t} `));
  return contienen.length === 1 ? contienen[0] : texto;
}

export const TODAS_LAS_CARRERAS = Object.values(CARRERAS).flat();
export const FACULTAD_DE_CARRERA = new Map(Object.entries(CARRERAS).flatMap(([facultad, carreras]) => carreras.map(c => [c, facultad])));
export const ANIOS_VALIDOS = new Set(ANIOS.map(([valor]) => valor));
const ORDINALES = { primer: "1", primero: "1", segundo: "2", tercer: "3", tercero: "3", cuarto: "4", quinto: "5" };
const ROMANOS = { i: "1", ii: "2", iii: "3", iv: "4", v: "5" };

export function normalizarCentro(texto) {
  return delCatalogo(texto, CAMPUS);
}

export function normalizarFacultad(texto) {
  return SIGLAS_FACULTAD[String(texto || "").trim().toUpperCase()] || delCatalogo(texto, FACULTADES);
}

// Busca primero entre las carreras de la facultad y, si no está, entre todas.
export function normalizarCarrera(texto, facultad = "") {
  const propia = delCatalogo(texto, CARRERAS[facultad] || [], sinGrado);
  return CARRERAS[facultad]?.includes(propia) ? propia : delCatalogo(texto, TODAS_LAS_CARRERAS, sinGrado);
}

// "3", "3er año", "Tercer año", "III"… → "3"; "egresada" → "Egresado".
export function normalizarAnio(texto) {
  const t = normalizar(texto);
  if (!t) return "";
  if (/\begresad/.test(t)) return "Egresado";
  const digito = t.match(/\b([1-5])(?:er|ro|do|to|o)?\b/);
  if (digito) return digito[1];
  const palabras = t.split(" ");
  const ordinal = palabras.find(p => ORDINALES[p]);
  return ordinal ? ORDINALES[ordinal] : ROMANOS[palabras[0]] || texto;
}

// "3" → "Tercer año"; lo que no es del catálogo, tal cual.
export function textoAnio(valor) {
  return ANIOS.find(([v]) => v === valor)?.[1] || valor || "";
}

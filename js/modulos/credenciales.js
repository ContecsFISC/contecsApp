// =============================================
// CONTECS — Credenciales imprimibles
// =============================================
// Un mismo dibujo en canvas alimenta la vista previa, el PNG, el PDF y la
// impresión, para que lo que se ve en pantalla sea lo que sale en la etiqueta.
//
// Las medidas parten de la Epson ColorWorks CW-C4000: acepta papel de 1" a
// 4.4" de ancho e imprime hasta 4.25", así que la etiqueta es de 4" de ancho.
// Todo el diseño se mide en "u" = 1 % del ancho, de modo que escala igual en
// cualquier tamaño vertical.
//
// La credencial oficial es doblada: la impresora saca una tira de 4 × 10 in
// (o 4 × 13 in) que se dobla a la mitad y queda con dos caras de 4 × 5 in (o
// 4 × 6.5 in). En `TAMANOS`, ancho y alto son siempre los de una cara;
// `doblez` duplica el alto impreso.

import { URL_BASE_PERFIL } from "../core/sso-config.js";
import { cargarLibreria } from "../core/librerias.js";

export const TAMANOS = {
  doblada: {
    nombre: "4 × 10 in doblada · frente y reverso de 4 × 5 in (recomendado)",
    ancho: 101.6, alto: 127, doblez: true,
  },
  doblada13: {
    nombre: "4 × 13 in doblada · frente y reverso de 4 × 6.5 in",
    ancho: 101.6, alto: 165.1, doblez: true,
  },
  carta: {
    nombre: "4 × 10 in doblada sobre hoja Carta (impresora común)",
    ancho: 101.6, alto: 127, doblez: true,
    hoja: { ancho: 215.9, alto: 279.4 },
  },
  "4x6": { nombre: "4 × 6 in · 101.6 × 152.4 mm, una cara", ancho: 101.6, alto: 152.4 },
  "4x5": { nombre: "4 × 5 in · 101.6 × 127 mm, una cara", ancho: 101.6, alto: 127 },
  "3x4": { nombre: "3 × 4 in · 76.2 × 101.6 mm, una cara", ancho: 76.2, alto: 101.6 },
};

// Lo que sale de la impresora: una cara o, si es doblada, las dos una sobre otra.
export function medidaImpresa(tamano) {
  return { ancho: tamano.ancho, alto: tamano.doblez ? tamano.alto * 2 : tamano.alto };
}

// Ancho: lo que admite la CW-C4000. Proporción: por debajo de 1.25 el diseño
// vertical ya no deja sitio suficiente para un QR legible.
export const LIMITES = { anchoMin: 25.4, anchoMax: 108, altoMax: 300, proporcionMin: 1.25 };

const DPI = 300;
const EVENTO = "CONTECS 2026";
const LEMA = "Congress on Technologies in Computer Sciences";
const PIE = "Facultad de Ingeniería de Sistemas Computacionales · UTP";

const CATEGORIAS = {
  estudiante_utp: "Estudiante UTP",
  estudiante_externo: "Estudiante externo",
  academico_utp: "Académico UTP",
  academico_externo: "Académico externo",
  academico: "Académico",
  profesional: "Profesional",
  autor: "Autor científico",
  otros: "Participante",
  colegio: "Tutor de colegio",
  colegio_estudiante: "Estudiante de colegio",
};

const C = {
  verdeOscuro: "#045223",
  verde: "#00722e",
  verdeClaro: "#39b54a",
  tinte: "#e3f2e8",
  bordeQr: "#cfe6d6",
  tinta: "#0d2617",
  texto: "#4f5559",
  suave: "#7a8085",
  separador: "#c3cec7",
  qr: "#062b16",
};
const FUENTE = "Inter, 'Segoe UI', system-ui, sans-serif";
const FUENTE_TITULO = "'Space Grotesk', Inter, 'Segoe UI', sans-serif";
const FUENTE_CODIGO = "'Courier New', Courier, monospace";

// ── DATOS ──────────────────────────────────────────────────────────────────
export function textoQr(p) {
  return `${URL_BASE_PERFIL}?c=${encodeURIComponent(p.codigo)}&t=${encodeURIComponent(p.token)}`;
}

// Sin código y token el QR no abriría ninguna credencial.
export function tieneCredencial(p) {
  return !!(p?.codigo && p?.token);
}

export function nombreDe(p) {
  return (p.nombreCompleto || `${p.nombre || ""} ${p.apellido || ""}`).replace(/\s+/g, " ").trim() ||
    p.codigo || "Participante";
}

export function categoriaDe(p) {
  return CATEGORIAS[p.categoria] || p.categoriaNombre || "Participante";
}

function institucionDe(p) {
  const ex = p.camposExtra || {};
  if (p.esColegio || p.categoria === "colegio" || p.categoria === "colegio_estudiante") {
    return p.colegio || p.tutor?.colegio || "";
  }
  if (p.categoria === "estudiante_utp" || p.categoria === "academico_utp") {
    return "Universidad Tecnológica de Panamá";
  }
  return ex.universidad || ex.empresa || p.institucion || "";
}

export function validarTamano({ ancho, alto }) {
  const { anchoMin, anchoMax, altoMax, proporcionMin } = LIMITES;
  if (!Number.isFinite(ancho) || !Number.isFinite(alto)) return "Escribe el ancho y el alto en milímetros.";
  if (ancho < anchoMin || ancho > anchoMax) {
    return `El ancho debe estar entre ${anchoMin} y ${anchoMax} mm, lo que admite la CW-C4000.`;
  }
  if (alto > altoMax) return `El alto no puede pasar de ${altoMax} mm.`;
  if (alto < ancho * proporcionMin) {
    return `La credencial es vertical: con ${ancho} mm de ancho, el alto debe ser de al menos ${Math.ceil(ancho * proporcionMin)} mm.`;
  }
  return null;
}

// ── RECURSOS ───────────────────────────────────────────────────────────────
const rutaRaiz = archivo => new URL(`../../${archivo}`, import.meta.url).href;
function cargarImagen(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// El canvas no espera a las fuentes web: si se dibuja antes de que Inter
// termine de cargar, sale con la fuente del sistema.
async function cargarFuentes() {
  if (!document.fonts?.load) return;
  const muestra = "ÁÉÍÓÚáéíóúÑñ¡Aa0";
  await Promise.allSettled([
    "400 20px Inter", "500 20px Inter", "700 20px Inter", "800 20px Inter",
    "700 20px 'Space Grotesk'",
  ].map(f => document.fonts.load(f, muestra)));
}

let recursos = null;
function prepararRecursos() {
  recursos ??= Promise.all([
    cargarImagen(rutaRaiz("logocontecsheader.png")),
    cargarLibreria("QRCode", "qrcode.min.js"),
    cargarFuentes(),
  ]).then(([logo]) => ({ logo }));
  return recursos;
}

// ── TEXTO ──────────────────────────────────────────────────────────────────
const fuente = (peso, tam, familia = FUENTE) => `${peso} ${tam}px ${familia}`;

function partirLineas(ctx, texto, anchoMax) {
  const lineas = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (actual && ctx.measureText(prueba).width > anchoMax) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function recortar(ctx, texto, anchoMax) {
  if (ctx.measureText(texto).width <= anchoMax) return texto;
  let t = texto;
  while (t && ctx.measureText(`${t}…`).width > anchoMax) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// Busca el tamaño más grande (de tamMax a tamMin) con el que el texto cabe en
// maxLineas; si ni al mínimo cabe, recorta con "…". Deja ctx.font puesto.
function ajustarTexto(ctx, texto, { anchoMax, maxLineas = 1, tamMax, tamMin, peso = 400, familia = FUENTE }) {
  const paso = Math.max(0.5, (tamMax - tamMin) / 16);
  for (let tam = tamMax; tam >= tamMin; tam -= paso) {
    ctx.font = fuente(peso, tam, familia);
    const lineas = partirLineas(ctx, texto, anchoMax);
    if (lineas.length <= maxLineas && lineas.every(l => ctx.measureText(l).width <= anchoMax)) {
      return { tam, lineas };
    }
  }
  ctx.font = fuente(peso, tamMin, familia);
  const lineas = partirLineas(ctx, texto, anchoMax);
  const visibles = lineas.slice(0, maxLineas);
  if (lineas.length > maxLineas) visibles[maxLineas - 1] = lineas.slice(maxLineas - 1).join(" ");
  return { tam: tamMin, lineas: visibles.map(l => recortar(ctx, l, anchoMax)) };
}

function anchoEspaciado(ctx, texto, espacio) {
  const chars = [...texto];
  return chars.reduce((suma, c) => suma + ctx.measureText(c).width, 0) + espacio * (chars.length - 1);
}

function textoEspaciado(ctx, texto, x, y, espacio, alineacion = "center") {
  const total = anchoEspaciado(ctx, texto, espacio);
  let cx = alineacion === "center" ? x - total / 2 : x;
  const previa = ctx.textAlign;
  ctx.textAlign = "left";
  for (const c of texto) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + espacio;
  }
  ctx.textAlign = previa;
}

function rectRedondeado(ctx, x, y, w, h, r) {
  const radio = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + w, y, x + w, y + h, radio);
  ctx.arcTo(x + w, y + h, x, y + h, radio);
  ctx.arcTo(x, y + h, x, y, radio);
  ctx.arcTo(x, y, x + w, y, radio);
  ctx.closePath();
}

// ── QR ─────────────────────────────────────────────────────────────────────
// Se toma la matriz de módulos de qrcode.min.js y se pinta a mano con
// módulos de tamaño entero: escalar su canvas emborronaría los bordes.
function dibujarQr(ctx, texto, x, y, lado) {
  const QR = window.QRCode;
  const modelo = new QR(document.createElement("div"), {
    text: texto, width: 64, height: 64, correctLevel: QR.CorrectLevel.M,
  })._oQRCode;
  if (!modelo?.getModuleCount) throw new Error("La librería de QR no es compatible.");
  const n = modelo.getModuleCount();
  const modulo = Math.max(1, Math.floor(lado / n));
  const ox = Math.round(x + (lado - modulo * n) / 2);
  const oy = Math.round(y + (lado - modulo * n) / 2);
  ctx.fillStyle = C.qr;
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (modelo.isDark(fila, col)) ctx.fillRect(ox + col * modulo, oy + fila * modulo, modulo, modulo);
    }
  }
}

// ── DIBUJO ─────────────────────────────────────────────────────────────────
// Motivo de red del logo (nodos y enlaces) en blanco translúcido: [x, y, radio] en u.
const RED_NODOS = [
  [85, 5, 1.3], [92, 9, 1.7], [87, 16, 1.4], [96, 19, 1], [82.5, 12.5, 0.9],
  [94, 2.6, 0.7], [99, 12, 0.8], [76, 3.8, 0.5], [74, 20.5, 0.6], [81, 21.5, 0.5],
];
const RED_ENLACES = [[0, 1], [1, 2], [2, 3], [0, 4], [4, 2], [1, 6], [0, 5]];

function dibujarRed(ctx, u) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.17)";
  ctx.lineWidth = 0.35 * u;
  for (const [a, b] of RED_ENLACES) {
    ctx.beginPath();
    ctx.moveTo(RED_NODOS[a][0] * u, RED_NODOS[a][1] * u);
    ctx.lineTo(RED_NODOS[b][0] * u, RED_NODOS[b][1] * u);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (const [x, y, r] of RED_NODOS) {
    ctx.beginPath();
    ctx.arc(x * u, y * u, r * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function dibujarCabecera(ctx, W, u, logo) {
  const alto = 24 * u;
  const franja = 1.1 * u;
  const fondo = ctx.createLinearGradient(0, 0, W, alto);
  fondo.addColorStop(0, C.verdeOscuro);
  fondo.addColorStop(1, C.verde);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, W, alto);
  dibujarRed(ctx, u);
  ctx.fillStyle = C.verdeClaro;
  ctx.fillRect(0, alto, W, franja);

  let xTexto = 6 * u;
  if (logo) {
    const h = 18 * u;
    const w = h * logo.naturalWidth / logo.naturalHeight;
    ctx.drawImage(logo, 6 * u, (alto - h) / 2, w, h);
    xTexto += w + 4 * u;
  }
  const anchoTexto = W - xTexto - 4 * u;
  const cy = alto / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#fff";
  const titulo = ajustarTexto(ctx, EVENTO, {
    anchoMax: anchoTexto, tamMax: 6.4 * u, tamMin: 4 * u, peso: 700, familia: FUENTE_TITULO,
  });
  ctx.fillText(titulo.lineas[0], xTexto, cy - 5.2 * u);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const lema = ajustarTexto(ctx, LEMA, { anchoMax: anchoTexto, tamMax: 2.3 * u, tamMin: 1.8 * u, peso: 500 });
  ctx.fillText(lema.lineas[0], xTexto, cy + 0.4 * u);

  const etiqueta = "CREDENCIAL DE ACCESO";
  const espacio = 0.32 * u;
  ctx.font = fuente(700, 2.4 * u);
  const altoEtq = 4.8 * u;
  const anchoEtq = anchoEspaciado(ctx, etiqueta, espacio) + 5 * u;
  const yEtq = cy + 3.4 * u;
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  rectRedondeado(ctx, xTexto, yEtq, anchoEtq, altoEtq, altoEtq / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  textoEspaciado(ctx, etiqueta, xTexto + 2.5 * u, yEtq + altoEtq / 2, espacio, "left");

  return alto + franja;
}

function dibujarPie(ctx, W, H, u) {
  const alto = 6 * u;
  const y = H - alto;
  const fondo = ctx.createLinearGradient(0, 0, W, 0);
  fondo.addColorStop(0, C.verdeOscuro);
  fondo.addColorStop(1, C.verde);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, y, W, alto);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const pie = ajustarTexto(ctx, PIE, { anchoMax: 88 * u, tamMax: 2.1 * u, tamMin: 1.6 * u, peso: 600 });
  ctx.fillText(pie.lineas[0], W / 2, y + alto / 2);
  return alto;
}

// Si el QR queda chico, se prueba una versión más compacta del texto antes de
// encogerlo más: el QR es lo que tiene que funcionar en la puerta.
const VARIANTES = [
  { nombreMax: 7.6, instLineas: 2, titulo: true, subtitulo: true },
  { nombreMax: 6.4, instLineas: 1, titulo: true, subtitulo: false },
  { nombreMax: 5.6, instLineas: 1, titulo: false, subtitulo: false },
];
const QR_MIN = 20;
const QR_COMODO = 36;
const QR_MAX = 54;
const SUBTITULO = "Permite que los Staff escaneen tu QR de acceso al Congreso";

// Mide todos los bloques y reparte el alto: el QR se queda con lo que sobre.
function medirCuerpo(ctx, p, u, disponible, v) {
  const anchoMax = 88 * u;
  const m = { v };

  m.nombre = ajustarTexto(ctx, nombreDe(p), {
    anchoMax, maxLineas: 2, tamMax: v.nombreMax * u, tamMin: 4.4 * u, peso: 800,
  });
  m.lhNombre = m.nombre.tam * 1.15;
  const altoNombre = m.nombre.lineas.length * m.lhNombre;

  // Cédula bajo el nombre, con el mismo estilo que la institución.
  const cedula = String(p.cedula || "").trim();
  m.cedula = cedula
    ? ajustarTexto(ctx, cedula, { anchoMax, tamMax: 3.1 * u, tamMin: 2.5 * u, peso: 500 })
    : null;
  m.lhCedula = m.cedula ? m.cedula.tam * 1.3 : 0;

  m.categoria = categoriaDe(p).toLocaleUpperCase("es");
  m.espCat = 0.3 * u;
  m.tamCat = 2.8 * u;
  m.altoCat = 5.6 * u;
  ctx.font = fuente(700, m.tamCat);
  m.anchoCat = Math.min(anchoMax, anchoEspaciado(ctx, m.categoria, m.espCat) + 6 * u);

  const institucion = institucionDe(p);
  m.inst = institucion
    ? ajustarTexto(ctx, institucion, { anchoMax, maxLineas: v.instLineas, tamMax: 3.1 * u, tamMin: 2.5 * u, peso: 500 })
    : null;
  m.lhInst = m.inst ? m.inst.tam * 1.3 : 0;
  const altoInst = m.inst ? m.inst.lineas.length * m.lhInst : 0;

  m.espCodigo = 0.6 * u;
  m.tamCodigo = 4.6 * u;
  ctx.font = fuente(700, m.tamCodigo, FUENTE_CODIGO);
  const anchoCodigoMax = 72 * u;
  const anchoCodigoTxt = anchoEspaciado(ctx, p.codigo, m.espCodigo);
  if (anchoCodigoTxt > anchoCodigoMax) m.tamCodigo *= anchoCodigoMax / anchoCodigoTxt;
  m.altoCodigo = 8 * u;
  m.anchoCodigo = Math.min(anchoCodigoTxt, anchoCodigoMax) + 9 * u;

  m.tamTitulo = 3.7 * u;
  m.altoTitulo = v.titulo ? m.tamTitulo * 1.2 : 0;
  m.sub = v.subtitulo
    ? ajustarTexto(ctx, SUBTITULO, { anchoMax: 84 * u, maxLineas: 2, tamMax: 2.55 * u, tamMin: 2.2 * u })
    : null;
  m.lhSub = m.sub ? m.sub.tam * 1.35 : 0;
  const altoSub = m.sub ? m.sub.lineas.length * m.lhSub : 0;

  m.huecos = {
    arriba: 4.5, nombreCedula: m.cedula ? 0.6 : 0, nombreCat: 2.6, catInst: m.inst ? 1.8 : 0, infoQr: 3.8, qrCodigo: 2.8,
    codigoSep: v.titulo ? 3.8 : 0, sepTitulo: v.titulo ? 3.4 : 0, tituloSub: m.sub ? 1.2 : 0, abajo: 3,
  };
  for (const k in m.huecos) m.huecos[k] *= u;
  const sumaHuecos = Object.values(m.huecos).reduce((a, b) => a + b, 0);
  const contenido = altoNombre + m.lhCedula + m.altoCat + altoInst + m.altoCodigo + m.altoTitulo + altoSub;
  const libre = disponible - contenido - sumaHuecos;
  m.ladoQr = Math.max(QR_MIN * u, Math.min(QR_MAX * u, libre));
  const sobra = libre - m.ladoQr;
  if (sobra >= 0) {
    const reparto = v.titulo
      ? { arriba: 0.3, infoQr: 0.25, codigoSep: 0.25, abajo: 0.2 }
      : { arriba: 0.35, infoQr: 0.3, abajo: 0.35 };
    for (const k in reparto) m.huecos[k] += sobra * reparto[k];
  } else {
    const factor = Math.max(0.4, 1 + sobra / sumaHuecos);
    for (const k in m.huecos) m.huecos[k] *= factor;
  }
  return m;
}

function dibujarCuerpo(ctx, p, { W, u, arriba, abajo }) {
  let m;
  for (const v of VARIANTES) {
    m = medirCuerpo(ctx, p, u, abajo - arriba, v);
    if (m.ladoQr >= QR_COMODO * u) break;
  }
  const { huecos } = m;
  const cx = W / 2;
  let y = arriba + huecos.arriba;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = C.tinta;
  ctx.font = fuente(800, m.nombre.tam);
  m.nombre.lineas.forEach((linea, i) => ctx.fillText(linea, cx, y + m.lhNombre * (i + 0.5)));
  y += m.nombre.lineas.length * m.lhNombre + huecos.nombreCedula;

  if (m.cedula) {
    ctx.fillStyle = C.texto;
    ctx.font = fuente(500, m.cedula.tam);
    ctx.fillText(m.cedula.lineas[0], cx, y + m.lhCedula / 2);
    y += m.lhCedula;
  }
  y += huecos.nombreCat;

  ctx.fillStyle = C.tinte;
  rectRedondeado(ctx, cx - m.anchoCat / 2, y, m.anchoCat, m.altoCat, m.altoCat / 2);
  ctx.fill();
  ctx.fillStyle = C.verde;
  ctx.font = fuente(700, m.tamCat);
  textoEspaciado(ctx, m.categoria, cx, y + m.altoCat / 2, m.espCat);
  y += m.altoCat + huecos.catInst;

  if (m.inst) {
    ctx.fillStyle = C.texto;
    ctx.font = fuente(500, m.inst.tam);
    m.inst.lineas.forEach((linea, i) => ctx.fillText(linea, cx, y + m.lhInst * (i + 0.5)));
    y += m.inst.lineas.length * m.lhInst;
  }
  y += huecos.infoQr;

  const xQr = cx - m.ladoQr / 2;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = C.bordeQr;
  ctx.lineWidth = 0.6 * u;
  rectRedondeado(ctx, xQr, y, m.ladoQr, m.ladoQr, 3 * u);
  ctx.fill();
  ctx.stroke();
  const margenQr = m.ladoQr * 0.075;
  dibujarQr(ctx, textoQr(p), xQr + margenQr, y + margenQr, m.ladoQr - 2 * margenQr);
  y += m.ladoQr + huecos.qrCodigo;

  ctx.fillStyle = C.tinte;
  rectRedondeado(ctx, cx - m.anchoCodigo / 2, y, m.anchoCodigo, m.altoCodigo, 2 * u);
  ctx.fill();
  ctx.fillStyle = C.verdeOscuro;
  ctx.font = fuente(700, m.tamCodigo, FUENTE_CODIGO);
  textoEspaciado(ctx, p.codigo, cx, y + m.altoCodigo / 2, m.espCodigo);
  y += m.altoCodigo + huecos.codigoSep;

  if (!m.v.titulo) return;
  ctx.save();
  ctx.strokeStyle = C.separador;
  ctx.lineWidth = 0.25 * u;
  ctx.setLineDash([1.4 * u, 1 * u]);
  ctx.beginPath();
  ctx.moveTo(6 * u, y);
  ctx.lineTo(W - 6 * u, y);
  ctx.stroke();
  ctx.restore();
  y += huecos.sepTitulo;

  ctx.fillStyle = C.verdeOscuro;
  ctx.font = fuente(800, m.tamTitulo);
  ctx.fillText("¡Disfruta del Congreso!", cx, y + m.altoTitulo / 2);
  y += m.altoTitulo + huecos.tituloSub;

  if (!m.sub) return;
  ctx.fillStyle = C.suave;
  ctx.font = fuente(400, m.sub.tam);
  m.sub.lineas.forEach((linea, i) => ctx.fillText(linea, cx, y + m.lhSub * (i + 0.5)));
}

async function dibujarCara(p, tamano, dpi) {
  const { logo } = await prepararRecursos();
  const W = Math.round(tamano.ancho / 25.4 * dpi);
  const H = Math.round(tamano.alto / 25.4 * dpi);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const u = W / 100;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const arriba = dibujarCabecera(ctx, W, u, logo);
  const altoPie = dibujarPie(ctx, W, H, u);
  dibujarCuerpo(ctx, p, { W, u, arriba, abajo: H - altoPie });
  return canvas;
}

// Frente arriba y reverso abajo girado 180°: al doblar por la mitad y voltear
// la credencial (como gira colgada del cordón), el reverso queda derecho. Los
// pies verdes de las dos caras se juntan en el doblez, así que si el doblez
// queda un poco corrido no se nota. Las dos caras llevan nombre y QR para que
// se pueda escanear por cualquier lado.
function dibujarDoblada(cara) {
  const W = cara.width;
  const H = cara.height;
  const hoja = document.createElement("canvas");
  hoja.width = W;
  hoja.height = H * 2;
  const ctx = hoja.getContext("2d");
  ctx.drawImage(cara, 0, 0);
  ctx.save();
  ctx.translate(W, H * 2);
  ctx.rotate(Math.PI);
  ctx.drawImage(cara, 0, 0);
  ctx.restore();

  // Marcas cortas en los bordes que indican dónde doblar.
  const u = W / 100;
  const largo = 5 * u;
  const grosor = Math.max(1, 0.3 * u);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, H - grosor / 2, largo, grosor);
  ctx.fillRect(W - largo, H - grosor / 2, largo, grosor);
  return hoja;
}

export async function dibujarCredencial(p, tamano, { dpi = DPI } = {}) {
  const cara = await dibujarCara(p, tamano, dpi);
  return tamano.doblez ? dibujarDoblada(cara) : cara;
}

// ── SALIDAS ────────────────────────────────────────────────────────────────
function slug(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function nombreArchivo(p, ext) {
  return `Credencial_${slug(p.codigo)}_${slug(nombreDe(p))}.${ext}`;
}

// CONTECS_credenciales_2026-10-08_14-05-09.pdf: con la hora, cada descarga
// tiene un nombre distinto y no se pisa con la anterior.
export function nombreLote(ext, sufijo = "") {
  const ahora = new Date();
  const dos = n => String(n).padStart(2, "0");
  const fecha = [ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate()].map(dos).join("-");
  const hora = [ahora.getHours(), ahora.getMinutes(), ahora.getSeconds()].map(dos).join("-");
  return `CONTECS_credenciales_${fecha}_${hora}${sufijo ? `_${sufijo}` : ""}.${ext}`;
}

export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Se usa toDataURL y no toBlob: Chrome agenda toBlob en tiempo ocioso y, si
// la pestaña queda en segundo plano durante un lote, cada imagen tarda ~1 s.
function bytesPng(canvas) {
  const url = canvas.toDataURL("image/png");
  const binario = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

let tablaCrc = null;
function crc32(bytes) {
  tablaCrc ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = tablaCrc[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// canvas.toBlob no guarda la resolución: sin el bloque pHYs, Windows abre el
// PNG a 96 ppp y lo imprime enorme. Se inserta justo después de IHDR.
function pngConDpi(datos, dpi) {
  const vista = new DataView(datos.buffer);
  for (let pos = 8; pos + 8 <= datos.length;) {
    const tipo = String.fromCharCode(...datos.subarray(pos + 4, pos + 8));
    if (tipo === "pHYs") return new Blob([datos], { type: "image/png" });
    if (tipo === "IDAT") break;
    pos += 12 + vista.getUint32(pos);
  }
  const ppm = Math.round(dpi / 0.0254);
  const bloque = new Uint8Array(21);
  const v = new DataView(bloque.buffer);
  v.setUint32(0, 9);
  bloque.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  bloque[16] = 1; // unidad: metro
  v.setUint32(17, crc32(bloque.subarray(4, 17)));
  const finIhdr = 8 + 25; // firma PNG + IHDR (largo, tipo, 13 bytes de datos, CRC)
  return new Blob([datos.subarray(0, finIhdr), bloque, datos.subarray(finIhdr)], { type: "image/png" });
}

// Cede el hilo para que la barra de progreso se pinte. MessageChannel en vez
// de setTimeout: los temporizadores se frenan a 1 por segundo en segundo plano.
function ceder() {
  return new Promise(resolve => {
    const canal = new MessageChannel();
    canal.port1.onmessage = () => resolve();
    canal.port2.postMessage(null);
  });
}

async function recorrer(lista, { alProgresar, cancelado } = {}, trabajo) {
  for (let i = 0; i < lista.length; i++) {
    if (cancelado?.()) throw new DOMException("Generación cancelada", "AbortError");
    await trabajo(lista[i], i);
    alProgresar?.(i + 1, lista.length);
    await ceder();
  }
}

export async function generarPng(p, tamano) {
  return pngConDpi(bytesPng(await dibujarCredencial(p, tamano)), DPI);
}

function guiaDeCorte(pdf, x, y, medida, doblez) {
  pdf.setDrawColor(160, 160, 160);
  pdf.setLineWidth(0.2);
  pdf.setLineDashPattern([2, 1.5], 0);
  pdf.rect(x, y, medida.ancho, medida.alto);
  pdf.setLineDashPattern([], 0);
  pdf.setFontSize(8);
  pdf.setTextColor(140, 140, 140);
  const aviso = doblez
    ? "Recorta por la línea punteada y dobla por las marcas blancas del centro"
    : "Recorta por la línea punteada";
  pdf.text(aviso, x + medida.ancho / 2, y + medida.alto + 5, { align: "center" });
}

// Una credencial por página. El tamaño de página es el de lo que se imprime
// (o la hoja Carta con la credencial centrada), así la impresora no tiene que
// escalar.
export async function generarPdf(lista, tamano, control = {}) {
  const { jsPDF } = await cargarLibreria("jspdf", "jspdf.umd.min.js");
  const medida = medidaImpresa(tamano);
  const hoja = tamano.hoja || medida;
  const formato = [hoja.ancho, hoja.alto];
  const pdf = new jsPDF({ unit: "mm", format: formato, orientation: "portrait", compress: true });
  pdf.setProperties({ title: `Credenciales ${EVENTO}`, creator: "CONTECS" });
  if (typeof pdf.viewerPreferences === "function") pdf.viewerPreferences({ PrintScaling: "None" });
  const x = (hoja.ancho - medida.ancho) / 2;
  const y = (hoja.alto - medida.alto) / 2;
  await recorrer(lista, control, async (p, i) => {
    if (i > 0) pdf.addPage(formato, "portrait");
    const canvas = await dibujarCredencial(p, tamano);
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", x, y, medida.ancho, medida.alto, `cred${i}`);
    if (tamano.hoja) guiaDeCorte(pdf, x, y, medida, tamano.doblez);
  });
  return pdf.output("blob");
}

export async function generarZip(lista, tamano, formato, control = {}) {
  const JSZip = await cargarLibreria("JSZip", "jszip.min.js");
  const zip = new JSZip();
  await recorrer(lista, control, async p => {
    const blob = formato === "png" ? await generarPng(p, tamano) : await generarPdf([p], tamano);
    zip.file(nombreArchivo(p, formato), blob);
  });
  // PNG y PDF ya vienen comprimidos: volver a comprimir solo gasta tiempo.
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

// ── IMPRESIÓN ──────────────────────────────────────────────────────────────
// El navegador no puede listar las impresoras: se carga el PDF en un iframe
// oculto y se llama a print(), que abre el diálogo del sistema donde se
// elige la impresora (por ejemplo la Epson CW-C4000).
let impresion = null;

export function limpiarImpresion() {
  if (!impresion) return;
  impresion.iframe.remove();
  URL.revokeObjectURL(impresion.url);
  impresion = null;
}

export function imprimirPdf(blob) {
  limpiarImpresion();
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.title = "Impresión de credenciales";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  impresion = { iframe, url };
  return new Promise((resolve, reject) => {
    iframe.onload = () => {
      // El visor de PDF necesita un instante para montar el documento.
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 400);
    };
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

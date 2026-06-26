import { db, auth } from "../core/firebase-config.js";
import {
  collection, addDoc, getDocs, orderBy, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";
import { ROLES } from "../core/permisos.js";

const el = id => document.getElementById(id);
const usuario = getUsuarioActual();
let imagenesSeleccionadas = [];
let _solicitudesInforme  = [];
let _actividadesInforme  = [];
let _usuariosComite      = [];

// ── Número de informe automático ──────────────────────────────────────────────
async function cargarNumeroInforme() {
  try {
    const snap = await getDocs(collection(db, "informes_actividad"));
    const siguiente = String(snap.size + 1).padStart(3, "0");
    el("inf-numero").textContent = `2026-${siguiente}`;
    return `2026-${siguiente}`;
  } catch {
    el("inf-numero").textContent = "2026-001";
    return "2026-001";
  }
}

// ── Alerta ────────────────────────────────────────────────────────────────────
function mostrarAlerta(msg, tipo = "error") {
  const a = el("alerta-global");
  a.textContent = msg;
  a.className = "alerta show " + tipo;
  setTimeout(() => a.classList.remove("show"), 5000);
}

// ── Previsualización de imágenes ──────────────────────────────────────────────
el("inf-imagenes").addEventListener("change", function () {
  imagenesSeleccionadas = [...this.files];
  const container = el("img-preview-container");
  container.innerHTML = "";
  imagenesSeleccionadas.forEach(file => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    container.appendChild(img);
  });
});

// ── Recoger datos ─────────────────────────────────────────────────────────────
function recogerDatos(numeroInforme) {
  const checkedArr = selector => [...document.querySelectorAll(selector + ":checked")].map(c => c.value);
  return {
    informeNumero: numeroInforme,
    nombreActividad: el("inf-nombre").value.trim(),
    responsable: el("inf-responsable").value.trim(),
    departamentos: checkedArr('input[name="depto"]'),
    asignatura: el("inf-asignatura").value.trim(),
    codigoAsignatura: el("inf-codigo-asig").value.trim(),
    carreras: checkedArr('input[name="carrera"]'),
    fecha: el("inf-fecha").value,
    horaInicio: el("inf-hora-inicio").value,
    horaFin: el("inf-hora-fin").value,
    lugar: el("inf-lugar").value.trim(),
    gruposParticipantes: el("inf-grupos").value.trim(),
    totalParticipantes: parseInt(el("inf-total-participantes").value) || 0,
    desglose: {
      estudiantes: parseInt(el("inf-p-estudiantes").value) || 0,
      profesores: parseInt(el("inf-p-profesores").value) || 0,
      administrativos: parseInt(el("inf-p-administrativos").value) || 0,
      empresas: parseInt(el("inf-p-empresas").value) || 0,
      egresados: parseInt(el("inf-p-egresados").value) || 0,
    },
    objetivo: el("inf-objetivo").value.trim(),
    descripcion: el("inf-descripcion").value.trim(),
    logros: el("inf-logros").value.trim(),
  };
}

function validar(datos) {
  if (!datos.nombreActividad) return "El nombre de la actividad es requerido.";
  if (!datos.responsable) return "El responsable es requerido.";
  if (!datos.fecha) return "La fecha es requerida.";
  if (!datos.lugar) return "El lugar es requerido.";
  if (!datos.objetivo) return "El objetivo es requerido.";
  if (!datos.logros) return "Los logros alcanzados son requeridos.";
  return null;
}

// ── Guardar en Firestore ──────────────────────────────────────────────────────
async function guardar(estado, btn) {
  const numero = el("inf-numero").textContent;
  const datos = recogerDatos(numero);
  const error = validar(datos);
  if (error) { mostrarAlerta(error); return null; }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";

  try {
    const ref = await addDoc(collection(db, "informes_actividad"), {
      ...datos,
      estado,
      creadoEn: serverTimestamp(),
      creadoPor: usuario.uid,
    });
    return { ref, datos };
  } catch (e) {
    console.error(e);
    mostrarAlerta("Error al guardar. Verifica tu conexión e intenta de nuevo.");
    return null;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

// ── Botón: Guardar borrador ───────────────────────────────────────────────────
el("btn-guardar-borrador-inf").addEventListener("click", async () => {
  const result = await guardar("borrador", el("btn-guardar-borrador-inf"));
  if (result) mostrarAlerta("Borrador guardado correctamente.", "exito");
});

// ── Botón: Generar .docx ──────────────────────────────────────────────────────
el("btn-generar-informe").addEventListener("click", async () => {
  const btn = el("btn-generar-informe");
  const result = await guardar("generado", btn);
  if (!result) return;

  btn.disabled = true;
  btn.textContent = "Generando documento...";
  try {
    await generarDocxInforme(result.datos, imagenesSeleccionadas);
    mostrarAlerta("Informe generado y guardado correctamente.", "exito");
  } catch (e) {
    console.error(e);
    mostrarAlerta("El informe se guardó pero hubo un error al generar el .docx.");
  } finally {
    btn.disabled = false;
    btn.textContent = "📄 Generar informe .docx";
  }
});

// ── Leer imagen como ArrayBuffer ──────────────────────────────────────────────
function leerImagen(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── Generación del documento .docx ───────────────────────────────────────────
async function generarDocxInforme(datos, imagenes) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    ImageRun, AlignmentType, BorderStyle, WidthType, ShadingType
  } = await import("https://esm.sh/docx@9");

  const borde = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const bordes = { top: borde, bottom: borde, left: borde, right: borde };
  const celda = (texto, opts = {}) => new TableCell({
    borders: bordes,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shade ? { fill: "E8F5EC", type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: texto || "", bold: !!opts.bold, size: opts.size || 20 })]
    })]
  });

  const check = marcado => marcado ? "☑" : "☐";

  const LICENCIATURAS = [
    "Lic. En Ing. de Sistemas y Computación",
    "Lic. En Ing. de Sistemas de Información",
    "Lic. En Ing. de Software",
    "Lic. En Desarrollo de Software",
    "Lic. En Redes Informáticas",
    "Lic. En Ciberseguridad",
    "Lic. En Informática Aplicada a la Educación",
    "Téc. En Informática para la Gestión Empresarial",
  ];
  const MAESTRIAS = [
    "Post./Maestría en Informática Educativa",
    "Post./Maestría en Ingeniería del Software",
    "Post./Maestría en Auditoría de Sistemas",
    "Maestría en Seguridad Informática",
  ];
  const DEPTOS = [
    "Depto. de Sistemas de Información",
    "Depto. de Ingeniería de Software",
    "Depto. de Programación de Computadoras",
    "Depto. de Arquitectura y Redes de Computadoras",
    "Depto. Computación y Simulación de Sistemas",
  ];

  // Cargar imágenes
  const imagenesDoc = [];
  for (const file of imagenes.slice(0, 6)) {
    try {
      const buf = await leerImagen(file);
      const ext = file.type.split("/")[1] || "jpeg";
      imagenesDoc.push({ data: buf, type: ext, name: file.name });
    } catch { /* ignorar imagen con error */ }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
      },
      children: [
        // Encabezado
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", bold: true, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "FACULTAD DE INGENIERÍA DE SISTEMAS COMPUTACIONALES", bold: true, size: 20 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "VICEDECANATO DE INVESTIGACIÓN, POSTGRADO Y EXTENSIÓN", size: 18 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "COORDINACIÓN DE EXTENSIÓN", size: 18 })] }),
        new Paragraph({ children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "INFORME DE ACTIVIDADES", bold: true, size: 28 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Solicitud Nº ${datos.informeNumero}`, size: 20 })] }),
        new Paragraph({ children: [] }),

        // Tabla: nombre, responsable, fecha, hora, lugar
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2500, 6860],
          rows: [
            new TableRow({ children: [celda("NOMBRE DE ACTIVIDAD:", { width: 2500, bold: true, shade: true }), celda(datos.nombreActividad, { width: 6860 })] }),
            new TableRow({ children: [celda("RESPONSABLE(S):", { width: 2500, bold: true, shade: true }), celda(datos.responsable, { width: 6860 })] }),
            new TableRow({ children: [celda("FECHA:", { width: 2500, bold: true, shade: true }), celda(datos.fecha, { width: 6860 })] }),
            new TableRow({ children: [celda("HORA:", { width: 2500, bold: true, shade: true }), celda(`${datos.horaInicio} – ${datos.horaFin}`, { width: 6860 })] }),
            new TableRow({ children: [celda("LUGAR:", { width: 2500, bold: true, shade: true }), celda(datos.lugar, { width: 6860 })] }),
          ]
        }),
        new Paragraph({ children: [] }),

        // Departamentos
        new Paragraph({ children: [new TextRun({ text: "DEPARTAMENTOS:", bold: true, size: 20 })] }),
        ...DEPTOS.map(d => new Paragraph({ children: [new TextRun({ text: `  ${check(datos.departamentos.includes(d))} ${d}`, size: 18 })] })),
        new Paragraph({ children: [] }),

        // Asignatura
        new Paragraph({ children: [new TextRun({ text: `ASIGNATURA: ${datos.asignatura || "—"}   CÓDIGO: ${datos.codigoAsignatura || "—"}`, size: 18 })] }),
        new Paragraph({ children: [] }),

        // Carreras — tabla dos columnas
        new Paragraph({ children: [new TextRun({ text: "CARRERAS:", bold: true, size: 20 })] }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          rows: [
            new TableRow({ children: [
              celda("LICENCIATURAS", { width: 4680, bold: true, shade: true, center: true }),
              celda("MAESTRÍAS", { width: 4680, bold: true, shade: true, center: true }),
            ]}),
            new TableRow({ children: [
              new TableCell({
                borders: bordes,
                width: { size: 4680, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: LICENCIATURAS.map(l => new Paragraph({ children: [new TextRun({ text: `${check(datos.carreras.includes(l))} ${l}`, size: 17 })] }))
              }),
              new TableCell({
                borders: bordes,
                width: { size: 4680, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: MAESTRIAS.map(m => new Paragraph({ children: [new TextRun({ text: `${check(datos.carreras.includes(m))} ${m}`, size: 17 })] }))
              }),
            ]}),
          ]
        }),
        new Paragraph({ children: [] }),

        // Participantes
        new Paragraph({ children: [new TextRun({ text: "PARTICIPANTES EN TOTAL:", bold: true, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: `${datos.totalParticipantes} personas`, size: 18 })] }),
        new Paragraph({
          children: [new TextRun({
            text: `Estudiantes: ${datos.desglose.estudiantes}   Profesores: ${datos.desglose.profesores}   Administrativos: ${datos.desglose.administrativos}   Empresas: ${datos.desglose.empresas}   Egresados: ${datos.desglose.egresados}`,
            size: 18
          })]
        }),
        new Paragraph({ children: [] }),

        // Objetivo, Descripción, Logros
        new Paragraph({ children: [new TextRun({ text: "OBJETIVO:", bold: true, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: datos.objetivo, size: 18 })] }),
        new Paragraph({ children: [] }),
        new Paragraph({ children: [new TextRun({ text: "DESCRIPCIÓN:", bold: true, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: datos.descripcion, size: 18 })] }),
        new Paragraph({ children: [] }),
        new Paragraph({ children: [new TextRun({ text: "LOGROS ALCANZADOS:", bold: true, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: datos.logros, size: 18 })] }),
        new Paragraph({ children: [] }),

        // Imágenes
        ...(imagenesDoc.length > 0 ? [
          new Paragraph({ children: [new TextRun({ text: "IMÁGENES DE LA ACTIVIDAD:", bold: true, size: 20 })] }),
          new Paragraph({ children: [] }),
          ...imagenesDoc.map(img => new Paragraph({
            children: [new ImageRun({
              data: img.data,
              type: img.type,
              transformation: { width: 300, height: 200 },
              altText: { title: img.name, description: img.name, name: img.name }
            })]
          })),
        ] : []),
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Informe_Actividad_${datos.informeNumero}_${datos.nombreActividad.replace(/\s+/g, "_")}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Autocomplete de nombre ────────────────────────────────────────────────────
async function cargarFuentesAutocompleteInforme() {
  try {
    const [snapSol, snapAct] = await Promise.all([
      getDocs(collection(db, "solicitudes_actividad")),
      getDocs(query(collection(db, "actividades_voluntarios"), orderBy("creadoEn", "desc"))),
    ]);
    _solicitudesInforme = snapSol.docs.map(d => ({ id: d.id, ...d.data() }));
    _actividadesInforme = snapAct.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    _solicitudesInforme = [];
    _actividadesInforme = [];
  }
}

(function iniciarAutocompleteInforme() {
  const input = el("inf-nombre");
  if (!input) return;

  const dropdown = document.createElement("div");
  dropdown.id = "inf-nombre-suggestions";
  dropdown.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1.5px solid #bbf7d0;border-radius:10px;box-shadow:0 6px 24px rgba(4,82,35,0.13);max-height:280px;overflow-y:auto;display:none;";
  document.body.appendChild(dropdown);

  function posicionar() {
    const r = input.getBoundingClientRect();
    dropdown.style.top   = (r.bottom + 2) + "px";
    dropdown.style.left  = r.left + "px";
    dropdown.style.width = r.width + "px";
  }

  function renderSugerencias(texto) {
    if (!texto) { dropdown.style.display = "none"; return; }
    const lower = texto.toLowerCase();

    const deSolicitudes = _solicitudesInforme
      .filter(s => s.nombreActividad?.toLowerCase().includes(lower))
      .slice(0, 5)
      .map(s => ({
        id: s.id, fuente: "solicitud",
        nombre: s.nombreActividad,
        fecha: s.fecha || "",
        horaInicio: s.horaInicio || "",
        horaFin: s.horaFin || "",
        lugar: s.lugar || "",
        descripcion: s.descripcion || "",
        objetivo: s.objetivo || "",
      }));

    const deActividades = _actividadesInforme
      .filter(a => a.nombre?.toLowerCase().includes(lower))
      .slice(0, 5)
      .map(a => {
        let fechaStr = "";
        if (a.fecha) {
          const d = a.fecha.toDate ? a.fecha.toDate() : new Date(a.fecha);
          fechaStr = d.toISOString().split("T")[0];
        }
        return {
          id: a.id, fuente: "actividad",
          nombre: a.nombre,
          fecha: fechaStr,
          horaInicio: "",
          horaFin: "",
          lugar: a.lugar || "",
          descripcion: a.descripcion || "",
          objetivo: "",
        };
      });

    const nombresVistos = new Set(deSolicitudes.map(x => x.nombre?.toLowerCase()));
    const actFiltradas  = deActividades.filter(a => !nombresVistos.has(a.nombre?.toLowerCase()));
    const matches       = [...deSolicitudes, ...actFiltradas].slice(0, 8);

    if (!matches.length) { dropdown.style.display = "none"; return; }

    dropdown.innerHTML = "";
    matches.forEach(m => {
      const badge = m.fuente === "solicitud"
        ? `<span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 9px;border-radius:10px;white-space:nowrap;font-weight:600;border:1px solid #6ee7b7;">Solicitada</span>`
        : `<span style="font-size:11px;background:#eff6ff;color:#1e40af;padding:2px 9px;border-radius:10px;white-space:nowrap;font-weight:600;border:1px solid #bfdbfe;">Actividad</span>`;
      const item = document.createElement("div");
      item.className = "inf-sug-item";
      item.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0fdf4;font-size:14px;";
      item.innerHTML = `<span style="flex:1;color:#1f2937;">${m.nombre}</span>${badge}`;
      item.addEventListener("mouseenter", () => { item.style.background = "#f0fdf4"; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        autorellenarInformeDesde(m);
        dropdown.style.display = "none";
      });
      dropdown.appendChild(item);
    });

    posicionar();
    dropdown.style.display = "block";
  }

  input.addEventListener("input",  e => renderSugerencias(e.target.value.trim()));
  input.addEventListener("focus",  e => { if (e.target.value.trim()) renderSugerencias(e.target.value.trim()); });
  input.addEventListener("blur",   () => setTimeout(() => { dropdown.style.display = "none"; }, 160));
  window.addEventListener("scroll", () => { dropdown.style.display = "none"; }, true);
})();

function autorellenarInformeDesde(match) {
  el("inf-nombre").value = match.nombre || "";
  if (match.fecha)      el("inf-fecha").value       = match.fecha;
  if (match.horaInicio) el("inf-hora-inicio").value = match.horaInicio;
  if (match.horaFin)    el("inf-hora-fin").value    = match.horaFin;
  if (match.lugar)      el("inf-lugar").value       = match.lugar;
  if (match.descripcion) el("inf-descripcion").value = match.descripcion;
  if (match.objetivo)    el("inf-objetivo").value    = match.objetivo;
}

// ── Autocomplete de responsable ───────────────────────────────────────────────
async function cargarUsuariosComite() {
  try {
    const snap = await getDocs(collection(db, "usuarios"));
    _usuariosComite = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.nombre && u.rol && u.rol !== "sin_rol")
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  } catch {
    _usuariosComite = [];
  }
}

(function iniciarAutocompleteResponsable() {
  const input = el("inf-responsable");
  if (!input) return;

  const dropdown = document.createElement("div");
  dropdown.id = "inf-responsable-suggestions";
  dropdown.style.cssText = "position:fixed;z-index:9999;background:#fff;border:1.5px solid #bbf7d0;border-radius:10px;box-shadow:0 6px 24px rgba(4,82,35,0.13);max-height:260px;overflow-y:auto;display:none;";
  document.body.appendChild(dropdown);

  function posicionar() {
    const r = input.getBoundingClientRect();
    dropdown.style.top   = (r.bottom + 2) + "px";
    dropdown.style.left  = r.left + "px";
    dropdown.style.width = r.width + "px";
  }

  function tokenActual(valor) {
    const partes = valor.split(",");
    return partes[partes.length - 1].trim();
  }

  function insertarNombre(valorActual, nombreElegido) {
    const partes = valorActual.split(",");
    partes[partes.length - 1] = " " + nombreElegido;
    const resultado = partes.join(",").replace(/^\s*,\s*/, "").trim();
    return resultado + ", ";
  }

  function renderSugerencias() {
    const token = tokenActual(input.value);
    if (!token || token.length < 1) { dropdown.style.display = "none"; return; }

    const lower = token.toLowerCase();
    const yaIngresados = input.value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

    const matches = _usuariosComite.filter(u => {
      if (yaIngresados.includes(u.nombre.toLowerCase())) return false;
      return u.nombre.toLowerCase().includes(lower) || (u.email || "").toLowerCase().includes(lower);
    }).slice(0, 8);

    if (!matches.length) { dropdown.style.display = "none"; return; }

    dropdown.innerHTML = "";
    matches.forEach(u => {
      const rolInfo  = ROLES[u.rol];
      const rolColor = rolInfo?.color || "#717D7E";
      const rolLabel = rolInfo?.label || u.rol;
      const item = document.createElement("div");
      item.className = "resp-sug-item";
      item.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0fdf4;";
      item.innerHTML = `
        <div style="flex:1;">
          <div style="font-size:14px;color:#1f2937;font-weight:500;">${u.nombre}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:1px;">${u.email || ""}</div>
        </div>
        <span style="font-size:11px;background:${rolColor}22;color:${rolColor};padding:2px 9px;border-radius:10px;white-space:nowrap;font-weight:600;border:1px solid ${rolColor}44;">${rolLabel}</span>`;
      item.addEventListener("mouseenter", () => { item.style.background = "#f0fdf4"; });
      item.addEventListener("mouseleave", () => { item.style.background = ""; });
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        input.value = insertarNombre(input.value, u.nombre);
        dropdown.style.display = "none";
        input.focus();
        renderSugerencias();
      });
      dropdown.appendChild(item);
    });

    posicionar();
    dropdown.style.display = "block";
  }

  input.addEventListener("input",  () => renderSugerencias());
  input.addEventListener("focus",  () => { if (tokenActual(input.value)) renderSugerencias(); });
  input.addEventListener("blur",   () => setTimeout(() => { dropdown.style.display = "none"; }, 160));
  input.addEventListener("keydown", e => {
    if (e.key === "," || e.key === "Backspace") setTimeout(renderSugerencias, 10);
  });
  window.addEventListener("scroll", () => { dropdown.style.display = "none"; }, true);
})();

// ── Inicializar ───────────────────────────────────────────────────────────────
cargarNumeroInforme();
cargarFuentesAutocompleteInforme();
cargarUsuariosComite();

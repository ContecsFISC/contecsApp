import { db, auth } from "../core/firebase-config.js";
import {
  collection, addDoc, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";

const el = id => document.getElementById(id);
const usuario = getUsuarioActual();

// ── Número de solicitud automático ───────────────────────────────────────────
async function cargarNumeroSolicitud() {
  try {
    const snap = await getDocs(collection(db, "solicitudes_actividad"));
    const siguiente = String(snap.size + 1).padStart(3, "0");
    el("sol-numero").textContent = `2026-${siguiente}`;
    return `2026-${siguiente}`;
  } catch {
    el("sol-numero").textContent = "2026-001";
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

// ── Toggle campos de Gira ─────────────────────────────────────────────────────
el("tipo-gira").addEventListener("change", function () {
  el("gira-extra-fields").style.display = this.checked ? "block" : "none";
});

// ── Tabla de programa dinámica ────────────────────────────────────────────────
function nuevaFilaPrograma() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" placeholder="ej. 8:00 – 9:00 am"/></td>
    <td><input type="text" placeholder="Tema o actividad"/></td>
    <td><input type="text" placeholder="Sala / lugar"/></td>
    <td><button class="btn-fila-del" type="button" title="Eliminar fila">✕</button></td>
  `;
  tr.querySelector(".btn-fila-del").addEventListener("click", () => {
    if (el("programa-tbody").rows.length > 1) tr.remove();
  });
  return tr;
}

el("btn-add-fila").addEventListener("click", () => {
  el("programa-tbody").appendChild(nuevaFilaPrograma());
});

el("programa-tbody").querySelector(".btn-fila-del").addEventListener("click", function () {
  if (el("programa-tbody").rows.length > 1) this.closest("tr").remove();
});

// ── Recoger datos del formulario ──────────────────────────────────────────────
function recogerDatos(numeroSolicitud) {
  const checkedArr = selector => [...document.querySelectorAll(selector + ":checked")].map(c => c.value);

  const programa = [...el("programa-tbody").rows].map(tr => {
    const inputs = tr.querySelectorAll("input[type='text']");
    return { horario: inputs[0].value, tema: inputs[1].value, lugar: inputs[2].value };
  }).filter(r => r.horario || r.tema);

  const esGira = !!el("tipo-gira").checked;

  return {
    solicitudNumero: numeroSolicitud,
    nombreActividad: el("sol-nombre").value.trim(),
    fecha: el("sol-fecha").value,
    horaInicio: el("sol-hora-inicio").value,
    horaFin: el("sol-hora-fin").value,
    lugar: el("sol-lugar").value.trim(),
    objetivo: el("sol-objetivo").value.trim(),
    descripcion: el("sol-descripcion").value.trim(),
    tiposActividad: checkedArr('input[name="tipo"]'),
    tipoOtroTexto: el("tipo-otro-texto").value.trim(),
    areaActividad: document.querySelector('input[name="area"]:checked')?.value || "",
    esGira,
    gira: esGira ? {
      salida: el("gira-salida").value,
      retorno: el("gira-retorno").value,
      puntoSalida: el("gira-punto-salida").value,
      lugar: el("gira-lugar").value,
      estudiantes: parseInt(el("gira-estudiantes").value) || 0,
      profesores: parseInt(el("gira-profesores").value) || 0,
    } : null,
    expositores: [
      { nombre: el("exp1-nombre").value.trim(), contacto: el("exp1-contacto").value.trim() },
      { nombre: el("exp2-nombre").value.trim(), contacto: el("exp2-contacto").value.trim() },
    ].filter(e => e.nombre),
    instituciones: [
      { nombre: el("inst1-nombre").value.trim(), contacto: el("inst1-contacto").value.trim() },
      { nombre: el("inst2-nombre").value.trim(), contacto: el("inst2-contacto").value.trim() },
    ].filter(i => i.nombre),
    profesorResponsable: el("prof-nombre").value.trim(),
    correoProfesor: el("prof-correo").value.trim(),
    telefonoProfesor: el("prof-telefono").value.trim(),
    departamento: el("sol-departamento").value,
    carrera: el("sol-carrera").value,
    gruposAutorizados: el("sol-grupos").value.trim(),
    dirigidoA: checkedArr('input[name="dirigido"]'),
    dirigidoOtros: el("dirigido-otros-texto").value.trim(),
    mobiliario: checkedArr('input[name="mobiliario"]'),
    mobiliarioDetalle: {
      sillasPlasticas: parseInt(el("mob-sillas-plasticas").value) || 0,
      sillasAcolchadas: parseInt(el("mob-sillas-acolchadas").value) || 0,
      mesaPeq: parseInt(el("mob-mesa-peq").value) || 0,
      mesaMed: parseInt(el("mob-mesa-med").value) || 0,
      mesaGran: parseInt(el("mob-mesa-gran").value) || 0,
      cerchas: parseInt(el("mob-cerchas").value) || 0,
      mamparas: parseInt(el("mob-mamparas").value) || 0,
    },
    programa,
    presupuesto: el("sol-presupuesto").value.trim(),
    procedencia: el("sol-procedencia").value.trim(),
  };
}

function validar(datos) {
  if (!datos.nombreActividad) return "El nombre de la actividad es requerido.";
  if (!datos.fecha) return "La fecha es requerida.";
  if (!datos.horaInicio) return "La hora de inicio es requerida.";
  if (!datos.lugar) return "El lugar es requerido.";
  if (!datos.objetivo) return "El objetivo es requerido.";
  if (datos.tiposActividad.length === 0) return "Selecciona al menos un tipo de actividad.";
  if (!datos.areaActividad) return "Selecciona el área de la actividad.";
  if (!datos.profesorResponsable) return "El nombre del profesor responsable es requerido.";
  if (!datos.correoProfesor) return "El correo del profesor responsable es requerido.";
  return null;
}

// ── Guardar en Firestore ──────────────────────────────────────────────────────
async function guardar(estado, btn) {
  const numero = el("sol-numero").textContent;
  const datos = recogerDatos(numero);
  const error = validar(datos);
  if (error) { mostrarAlerta(error); return null; }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";

  try {
    const ref = await addDoc(collection(db, "solicitudes_actividad"), {
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
el("btn-guardar-borrador").addEventListener("click", async () => {
  const result = await guardar("borrador", el("btn-guardar-borrador"));
  if (result) mostrarAlerta("Borrador guardado correctamente.", "exito");
});

// ── Botón: Generar .docx ──────────────────────────────────────────────────────
el("btn-generar-solicitud").addEventListener("click", async () => {
  const btn = el("btn-generar-solicitud");
  const result = await guardar("generada", btn);
  if (!result) return;

  btn.disabled = true;
  btn.textContent = "Generando documento...";
  try {
    await generarDocxSolicitud(result.datos);
    mostrarAlerta("Solicitud generada y guardada correctamente.", "exito");
  } catch (e) {
    console.error(e);
    mostrarAlerta("El documento se guardó pero hubo un error al generar el .docx.");
  } finally {
    btn.disabled = false;
    btn.textContent = "📄 Generar solicitud .docx";
  }
});

// ── Generación del documento .docx ───────────────────────────────────────────
async function generarDocxSolicitud(datos) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    ImageRun, AlignmentType, BorderStyle, WidthType, ShadingType, Header
  } = await import("https://esm.sh/docx@9");

  // Cargar logos UTP y FISC
  let utpLogo = null, fiscLogo = null;
  try {
    const [r1, r2] = await Promise.all([
      fetch(new URL("../../assets/img/utp-logo.png", import.meta.url)),
      fetch(new URL("../../assets/img/fisc-logo.png", import.meta.url)),
    ]);
    utpLogo = await r1.arrayBuffer();
    fiscLogo = await r2.arrayBuffer();
  } catch { /* logos opcionales */ }

  // ── Constantes de layout ──────────────────────────────────────────────────
  // Tabla principal: 6 columnas de 1560 DXA cada una = 9360 total
  const COL = 1560;
  const W   = COL * 6; // 9360
  const LW  = COL * 2; // 3120 — ancho de columna de etiqueta
  const VW  = COL * 4; // 6240 — ancho de columna de valor

  const check = v => v ? "☑" : "☐";

  // ── Borders ───────────────────────────────────────────────────────────────
  const bN = { style: BorderStyle.NONE };
  const bS = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
  const bThin = { style: BorderStyle.SINGLE, size: 2, color: "999999" };
  const allB  = { top: bS, bottom: bS, left: bS, right: bS };
  const allBt = { top: bThin, bottom: bThin, left: bThin, right: bThin };
  const noB   = { top: bN, bottom: bN, left: bN, right: bN };

  // ── Helpers de texto / párrafo ─────────────────────────────────────────────
  const r = (text, bold = false, size = 18, color = "000000") =>
    new TextRun({ text: text || "", bold, size, color });

  const p = (runs, center = false) => new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 0 },
    children: Array.isArray(runs) ? runs : [r(runs)],
  });

  const pEmpty = () => new Paragraph({ spacing: { after: 60 }, children: [] });

  // ── Helper: celda de etiqueta (fondo gris claro, texto negro) ────────────
  const lCell = (text, cs = 2, rs) => new TableCell({
    borders: allB,
    shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
    width: { size: COL * cs, type: WidthType.DXA },
    columnSpan: cs,
    rowSpan: rs,
    verticalAlign: "top",
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [p([r(text, true, 17, "000000")])]
  });

  // ── Helper: celda de valor ────────────────────────────────────────────────
  const vCell = (content, cs = 4, opts = {}) => new TableCell({
    borders: allB,
    shading: opts.shade ? { fill: "F0FAF3", type: ShadingType.CLEAR } : undefined,
    width: { size: COL * cs, type: WidthType.DXA },
    columnSpan: cs,
    rowSpan: opts.rs,
    verticalAlign: "top",
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: Array.isArray(content) ? content : [p([r(content || "—")])]
  });

  // ── Listas de opciones ────────────────────────────────────────────────────
  const TIPOS   = ["Seminario","Conferencia","Exposición","Taller","Debate","Conversatorio",
                   "Foro","Mesa Redonda","Curso","Diplomado","Servicio Social","Deporte",
                   "Cultura","Gira","Otro"];
  const AREAS   = ["Académica","Estudiantil","Investigación","Complementaria","Extensión"];
  const DIRIGIDO = ["Docentes","Estudiantes","Investigadores","Administrativos","Otros"];

  // Tipos: 4 por línea
  const tiposParagraphs = [];
  for (let i = 0; i < TIPOS.length; i += 4) {
    tiposParagraphs.push(p(
      TIPOS.slice(i, i + 4).flatMap(t => [r(`${check(datos.tiposActividad.includes(t))} ${t}   `)])
    ));
  }
  if (datos.tipoOtroTexto) {
    tiposParagraphs.push(p([r(`Especificar: ${datos.tipoOtroTexto}`, false, 16)]));
  }

  const mob = datos.mobiliario;
  const md  = datos.mobiliarioDetalle;

  // ── Encabezado de página con logos ────────────────────────────────────────
  const mkHeader = () => {
    const innerB = { insideH: bThin, insideV: bThin };
    let hdrTable;

    if (utpLogo && fiscLogo) {
      const filaLogos = new TableRow({
        children: [
          new TableCell({
            borders: allBt,
            width: { size: 1100, type: WidthType.DXA },
            rowSpan: 2,
            verticalAlign: "center",
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: [p([new ImageRun({ data: utpLogo, type: "png", transformation: { width: 62, height: 63 } })], true)],
          }),
          new TableCell({
            borders: { top: bThin, bottom: bN, left: bN, right: bN },
            width: { size: 7160, type: WidthType.DXA },
            verticalAlign: "center",
            margins: { top: 40, bottom: 10, left: 80, right: 80 },
            children: [
              p([r("UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", true, 20)], true),
              p([r("FACULTAD DE INGENIERÍA DE SISTEMAS COMPUTACIONALES", true, 17)], true),
              p([r("VICEDECANATO DE INVESTIGACIÓN, POSTGRADO Y EXTENSIÓN", false, 15)], true),
              p([r("COORDINACIÓN DE EXTENSIÓN", false, 15)], true),
            ],
          }),
          new TableCell({
            borders: allBt,
            width: { size: 1100, type: WidthType.DXA },
            rowSpan: 2,
            verticalAlign: "center",
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: [p([new ImageRun({ data: fiscLogo, type: "png", transformation: { width: 62, height: 63 } })], true)],
          }),
        ],
      });

      const filaTitulo = new TableRow({
        children: [
          new TableCell({
            borders: { top: bN, bottom: bThin, left: bN, right: bN },
            width: { size: 7160, type: WidthType.DXA },
            verticalAlign: "center",
            margins: { top: 10, bottom: 40, left: 80, right: 80 },
            children: [
              p([r("FORMULARIO DE SOLICITUD DE ACTIVIDADES", true, 18)], true),
              p([r("FISC-VDIPE-CE", false, 14)], true),
            ],
          }),
        ],
      });

      hdrTable = new Table({
        width: { size: W, type: WidthType.DXA },
        borders: { ...allBt, ...innerB },
        columnWidths: [1100, 7160, 1100],
        rows: [filaLogos, filaTitulo],
      });
    } else {
      hdrTable = new Table({
        width: { size: W, type: WidthType.DXA },
        borders: { ...allBt, ...innerB },
        columnWidths: [W],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: allBt,
                width: { size: W, type: WidthType.DXA },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [
                  p([r("UNIVERSIDAD TECNOLÓGICA DE PANAMÁ", true, 22)], true),
                  p([r("FACULTAD DE INGENIERÍA DE SISTEMAS COMPUTACIONALES", true, 18)], true),
                  p([r("FORMULARIO DE SOLICITUD DE ACTIVIDADES", true, 20)], true),
                ],
              }),
            ],
          }),
        ],
      });
    }

    return new Header({ children: [hdrTable] });
  };

  // ── Filas del programa ────────────────────────────────────────────────────
  const filasProg = datos.programa.length > 0
    ? datos.programa.map(row => new TableRow({ children: [
        new TableCell({ borders: allBt, width: { size: 2200, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [p([r(row.horario)])] }),
        new TableCell({ borders: allBt, width: { size: 4960, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [p([r(row.tema)])] }),
        new TableCell({ borders: allBt, width: { size: 2200, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [p([r(row.lugar)])] }),
      ]}))
    : [new TableRow({ children: [new TableCell({
        borders: allBt, columnSpan: 3,
        width: { size: 9360, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [p([r("Sin programa definido")])]
      })] })];

  // ── Documento ─────────────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1200, right: 1080, bottom: 1080, left: 1080, header: 708 }
        }
      },
      headers: { default: mkHeader() },

      children: [
        // ── SOLICITUD Nº / FECHA ────────────────────────────────────────────
        new Paragraph({
          spacing: { before: 120, after: 200 },
          children: [
            r("SOLICITUD   Nº ", true, 22),
            r(datos.solicitudNumero, false, 22),
            r("                         FECHA: ", true, 22),
            r(datos.fecha, false, 22),
          ]
        }),

        // ── TABLA PRINCIPAL DEL FORMULARIO ──────────────────────────────────
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [COL, COL, COL, COL, COL, COL],
          rows: [

            // Fila 1 — Nombre de la actividad
            new TableRow({ children: [
              lCell("NOMBRE DE LA ACTIVIDAD (título)"),
              vCell(datos.nombreActividad),
            ]}),

            // Fila 2 — Fecha / Hora / Lugar
            new TableRow({ children: [
              new TableCell({
                borders: allB, columnSpan: 2, width: { size: LW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("FECHA: ", true), r(datos.fecha)])]
              }),
              new TableCell({
                borders: allB, columnSpan: 2, width: { size: LW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("HORA: ", true), r(`${datos.horaInicio} – ${datos.horaFin}`)])]
              }),
              new TableCell({
                borders: allB, columnSpan: 2, width: { size: LW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("LUGAR: ", true), r(datos.lugar)])]
              }),
            ]}),

            // Fila 3 — Objetivo
            new TableRow({ children: [
              lCell("OBJETIVO DE LA ACTIVIDAD"),
              vCell(datos.objetivo),
            ]}),

            // Fila 4 — Descripción
            new TableRow({ children: [
              lCell("DESCRIPCIÓN DE LA ACTIVIDAD"),
              vCell(datos.descripcion || "—"),
            ]}),

            // Fila 5 — Tipo de actividad
            new TableRow({ children: [
              lCell("TIPO DE ACTIVIDAD"),
              vCell(tiposParagraphs),
            ]}),

            // Fila 6 — Gira (condicional)
            ...(datos.esGira && datos.gira ? [new TableRow({ children: [
              new TableCell({
                borders: allB, columnSpan: 6, width: { size: W, type: WidthType.DXA },
                shading: { fill: "F0FAF3", type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [
                  p([r("GIRA — Hora Salida: ", true), r(datos.gira.salida),
                     r("   Hora Retorno: ", true), r(datos.gira.retorno)]),
                  p([r("Punto de Salida: ", true), r(datos.gira.puntoSalida),
                     r("   Lugar: ", true), r(datos.gira.lugar)]),
                  p([r("# Estudiantes: ", true), r(String(datos.gira.estudiantes)),
                     r("   # Profesores: ", true), r(String(datos.gira.profesores))]),
                ]
              })
            ]})] : []),

            // Fila 7 — Área de la actividad
            new TableRow({ children: [
              lCell("ÁREA DE LA ACTIVIDAD"),
              vCell([p(AREAS.map(a => r(`${check(datos.areaActividad === a)} ${a}   `)))]),
            ]}),

            // Fila 8 — Expositor(es)
            new TableRow({ children: [
              lCell("EXPOSITOR (ES)"),
              vCell(
                datos.expositores.length > 0
                  ? datos.expositores.map(e =>
                      p([r("Nombre: ", true), r(e.nombre), r("   Contacto: ", true), r(e.contacto)]))
                  : [p([r("—")])]
              ),
            ]}),

            // Fila 9 — Instituciones / Empresas
            new TableRow({ children: [
              lCell("INSTITUCIÓN /\nEMPRESAS PARTICIPANTES"),
              vCell(
                datos.instituciones.length > 0
                  ? datos.instituciones.map(inst =>
                      p([r("Nombre: ", true), r(inst.nombre), r("   Contacto: ", true), r(inst.contacto)]))
                  : [p([r("—")])]
              ),
            ]}),

            // Fila 10 — Profesor responsable
            new TableRow({ children: [
              lCell("PROFESOR\nRESPONSABLE (S)"),
              vCell([
                p([r("NOMBRE: ", true),   r(datos.profesorResponsable)]),
                p([r("CORREO: ", true),   r(datos.correoProfesor)]),
                p([r("TELÉFONO: ", true), r(datos.telefonoProfesor)]),
                p([r("FIRMA DEL PROFESOR RESPONSABLE: ", true), r("_________________________________")]),
              ]),
            ]}),

            // Fila 11 — Depto / Carrera / Grupos (3 celdas iguales)
            new TableRow({ children: [
              new TableCell({
                borders: allB, columnSpan: 2,
                shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                width: { size: LW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [
                  p([r("DEPTO. SOLICITANTE:", true, 16, "000000")]),
                  p([r(datos.departamento || "—", false, 16, "000000")]),
                ]
              }),
              new TableCell({
                borders: allB, columnSpan: 2,
                shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                width: { size: LW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [
                  p([r("CARRERA:", true, 16, "000000")]),
                  p([r(datos.carrera || "—", false, 16, "000000")]),
                ]
              }),
              new TableCell({
                borders: allB, columnSpan: 2,
                width: { size: LW, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [
                  p([r("GRUPOS AUTORIZADOS:", true, 16)]),
                  p([r(datos.gruposAutorizados || "—", false, 16)]),
                ]
              }),
            ]}),

            // Fila 12 — Dirigido a
            new TableRow({ children: [
              lCell("DIRIGIDO A:"),
              vCell([
                p(DIRIGIDO.map(d => r(`${check(datos.dirigidoA.includes(d))} ${d}   `))),
                ...(datos.dirigidoOtros ? [p([r(`Otros: ${datos.dirigidoOtros}`, false, 16)])] : []),
              ]),
            ]}),
          ]
        }),

        pEmpty(),

        // ── MOBILIARIO ────────────────────────────────────────────────────────
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [COL, COL, COL, COL, COL, COL],
          rows: [new TableRow({ children: [
            lCell("MOBILIARIO"),
            vCell([
              p([r(`${check(mob.includes("Cafetera"))} Cafetera   `),
                 r(`${check(mob.includes("Tetera"))} Tetera   `),
                 r(`${check(mob.includes("Pódium"))} Pódium`)]),
              p([r(`${check(mob.includes("Sillas Plásticas"))} Sillas Plásticas: ${md.sillasPlasticas}   `),
                 r(`${check(mob.includes("Sillas Acolchadas"))} Sillas Acolchadas: ${md.sillasAcolchadas}`)]),
              p([r(`${check(mob.includes("Mesa Pequeña"))} Mesa Pequeña: ${md.mesaPeq}   `),
                 r(`${check(mob.includes("Mesa Mediana"))} Mesa Mediana: ${md.mesaMed}   `),
                 r(`${check(mob.includes("Mesa Grande"))} Mesa Grande: ${md.mesaGran}`)]),
              p([r(`${check(mob.includes("Cerchas"))} Cerchas: ${md.cerchas}   `),
                 r(`${check(mob.includes("Cocteleras"))} Cocteleras   `),
                 r(`${check(mob.includes("Equipo de Sonido"))} Equipo de Sonido`)]),
              p([r(`${check(mob.includes("Fotografía"))} Fotografía   `),
                 r(`${check(mob.includes("Publicación en Web"))} Publicación en Web   `),
                 r(`${check(mob.includes("Mamparas"))} Mamparas: ${md.mamparas}`)]),
            ]),
          ]})]
        }),

        pEmpty(),

        // ── PROPUESTA DE PROGRAMA ─────────────────────────────────────────────
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [2200, 4960, 2200],
          rows: [
            // Título sección
            new TableRow({ children: [new TableCell({
              borders: allB, columnSpan: 3, width: { size: W, type: WidthType.DXA },
              shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [p([r("PROPUESTA DE PROGRAMA DE LA ACTIVIDAD", true, 17, "000000")], true)]
            })] }),
            // Header columnas
            new TableRow({ children: [
              new TableCell({ borders: allB, width: { size: 2200, type: WidthType.DXA },
                shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
                children: [p([r("HORARIO", true, 17)])] }),
              new TableCell({ borders: allB, width: { size: 4960, type: WidthType.DXA },
                shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
                children: [p([r("TEMA", true, 17)])] }),
              new TableCell({ borders: allB, width: { size: 2200, type: WidthType.DXA },
                shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
                children: [p([r("LUGAR", true, 17)])] }),
            ]}),
            ...filasProg,
          ]
        }),

        pEmpty(),

        // ── PRESUPUESTO Y PROCEDENCIA ─────────────────────────────────────────
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [Math.round(W / 2), W - Math.round(W / 2)],
          rows: [
            new TableRow({ children: [
              new TableCell({
                borders: allB, shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                width: { size: Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("POSIBLE PRESUPUESTO PARA LLEVAR A CABO LA ACTIVIDAD", true, 16, "000000")])]
              }),
              new TableCell({
                borders: allB, shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                width: { size: W - Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("PROCEDENCIA (Patrocinio)", true, 16, "000000")])]
              }),
            ]}),
            new TableRow({ children: [
              new TableCell({
                borders: allB,
                width: { size: Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [p([r(datos.presupuesto || "—")])]
              }),
              new TableCell({
                borders: allB,
                width: { size: W - Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 100, bottom: 100, left: 120, right: 120 },
                children: [p([r(datos.procedencia || "—")])]
              }),
            ]}),
          ]
        }),

        pEmpty(),

        // ── FIRMAS ────────────────────────────────────────────────────────────
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [Math.round(W / 2), W - Math.round(W / 2)],
          rows: [
            new TableRow({ children: [
              new TableCell({
                borders: allB, shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                width: { size: Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("VoBo  Vicedecanato IPE", true, 18)], true)]
              }),
              new TableCell({
                borders: allB, shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
                width: { size: W - Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [p([r("VoBo  Jefe de Departamento", true, 18)], true)]
              }),
            ]}),
            new TableRow({ children: [
              new TableCell({
                borders: allB,
                width: { size: Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 340, bottom: 80, left: 120, right: 120 },
                children: [p([r("__________________________")], true)]
              }),
              new TableCell({
                borders: allB,
                width: { size: W - Math.round(W / 2), type: WidthType.DXA },
                margins: { top: 340, bottom: 80, left: 120, right: 120 },
                children: [p([r("__________________________")], true)]
              }),
            ]}),
          ]
        }),
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Solicitud_Actividad_${datos.solicitudNumero}_${datos.nombreActividad.replace(/\s+/g, "_")}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Inicializar ───────────────────────────────────────────────────────────────
cargarNumeroSolicitud();

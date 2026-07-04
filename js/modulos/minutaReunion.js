import { db } from "../core/firebase-config.js";
import {
  doc, getDoc, updateDoc, getDocs, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getUsuarioActual } from "../core/auth.js";
import { resolverInvitados, formatearDuracion } from "./reuniones-utils.js";

const el = id => document.getElementById(id);
const usuario = getUsuarioActual();
const reunionId = new URLSearchParams(window.location.search).get("id");

let reunion = null;
let listaUsuarios = [];
let invitadosResueltos = [];

function mostrarAlerta(tipo, mensaje) {
  const a = el("alerta-global");
  a.textContent = mensaje;
  a.className = `alerta alerta-${tipo} show`;
  setTimeout(() => a.classList.remove("show"), 5000);
}

function fmtFecha(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-PA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function fmtHora(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("es-PA", { hour: "2-digit", minute: "2-digit" });
}

// ── Parser Markdown compartido (preview HTML y export .docx) ─────────────────
function parsearLineaMarkdown(linea) {
  if (linea.startsWith("## ")) return { tipo: "h2", texto: linea.slice(3) };
  if (linea.startsWith("# ")) return { tipo: "h1", texto: linea.slice(2) };
  if (linea.startsWith("- ")) return { tipo: "bullet", texto: linea.slice(2) };
  if (linea.trim() === "") return { tipo: "vacio", texto: "" };
  return { tipo: "parrafo", texto: linea };
}

function escaparHtml(texto) {
  const d = document.createElement("div");
  d.textContent = texto;
  return d.innerHTML;
}

function negritaAHtml(texto) {
  return escaparHtml(texto).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderPreview(markdown) {
  const lineas = (markdown || "").split("\n").map(parsearLineaMarkdown);
  let html = "";
  let enLista = false;
  const cerrarLista = () => { if (enLista) { html += "</ul>"; enLista = false; } };

  if (lineas.every(l => l.tipo === "vacio")) {
    el("minuta-preview").innerHTML = `<p class="vacio">Esta minuta aún no tiene contenido.</p>`;
    return;
  }

  for (const l of lineas) {
    if (l.tipo === "bullet") {
      if (!enLista) { html += "<ul>"; enLista = true; }
      html += `<li>${negritaAHtml(l.texto)}</li>`;
      continue;
    }
    cerrarLista();
    if (l.tipo === "h1") html += `<h1>${negritaAHtml(l.texto)}</h1>`;
    else if (l.tipo === "h2") html += `<h2>${negritaAHtml(l.texto)}</h2>`;
    else if (l.tipo === "parrafo") html += `<p>${negritaAHtml(l.texto)}</p>`;
  }
  cerrarLista();
  el("minuta-preview").innerHTML = html;
}

// ── Carga inicial ──────────────────────────────────────────────────────────────
async function cargar() {
  if (!reunionId) {
    mostrarAlerta("error", "No se especificó una reunión.");
    setTimeout(() => { window.location.href = "minutas.html"; }, 1200);
    return;
  }

  try {
    const [snapReunion, snapUsuarios] = await Promise.all([
      getDoc(doc(db, "reuniones", reunionId)),
      getDocs(collection(db, "usuarios")),
    ]);

    if (!snapReunion.exists()) {
      mostrarAlerta("error", "La reunión no existe.");
      setTimeout(() => { window.location.href = "minutas.html"; }, 1200);
      return;
    }

    reunion = { id: snapReunion.id, ...snapReunion.data() };
    listaUsuarios = snapUsuarios.docs.map(d => ({ id: d.id, ...d.data() }));
    invitadosResueltos = resolverInvitados(reunion, listaUsuarios);

    renderPagina();
  } catch (e) {
    console.error(e);
    mostrarAlerta("error", "Error al cargar la reunión.");
  }
}

function renderPagina() {
  document.title = `CONTECS — Minuta: ${reunion.titulo}`;
  el("minuta-titulo").textContent = `Minuta — ${reunion.titulo} (${fmtFecha(reunion.fechaInicio)})`;
  el("link-editar-reunion").href = `agendarReunion.html?id=${reunion.id}`;

  el("meta-grid").innerHTML = `
    <div><strong>Fecha</strong>${fmtFecha(reunion.fechaInicio)}</div>
    <div><strong>Duración</strong>${formatearDuracion(reunion.fechaInicio, reunion.fechaFin)}</div>
    <div><strong>Hora</strong>${fmtHora(reunion.fechaInicio)} – ${fmtHora(reunion.fechaFin)}</div>
    <div><strong>Lugar</strong>${reunion.esVirtual ? `Virtual — <a href="${reunion.linkVirtual}" target="_blank" rel="noopener">${reunion.linkVirtual}</a>` : (reunion.lugar || "—")}</div>
    <div style="grid-column:1/-1;"><strong>Agenda</strong>${reunion.agenda || "—"}</div>
  `;

  if (invitadosResueltos.length === 0) {
    el("grid-asistencia").innerHTML = `<span style="color:var(--gris-medio);font-size:13px;">No hay invitados resueltos para esta reunión.</span>`;
  } else {
    el("grid-asistencia").innerHTML = invitadosResueltos.map(u => `
      <label class="check-item">
        <input type="checkbox" data-uid="${u.id}" ${reunion.asistencia?.[u.id] ? "checked" : ""}/>
        ${u.nombre || u.email || "Sin nombre"}
      </label>
    `).join("");
  }

  el("minuta-md").value = reunion.minuta?.contenidoMarkdown || "";
  renderPreview(el("minuta-md").value);
}

el("minuta-md").addEventListener("input", () => renderPreview(el("minuta-md").value));

// ── Guardar asistencia ─────────────────────────────────────────────────────────
el("btn-guardar-asistencia").addEventListener("click", async () => {
  const btn = el("btn-guardar-asistencia");
  const asistencia = {};
  document.querySelectorAll("#grid-asistencia input[type='checkbox']").forEach(chk => {
    asistencia[chk.dataset.uid] = chk.checked;
  });
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "reuniones", reunionId), { asistencia, actualizadoEn: serverTimestamp() });
    reunion.asistencia = asistencia;
    mostrarAlerta("success", "Asistencia guardada.");
  } catch (e) {
    console.error(e);
    mostrarAlerta("error", "Error al guardar la asistencia.");
  } finally {
    btn.disabled = false;
  }
});

// ── Guardar minuta ──────────────────────────────────────────────────────────────
el("btn-guardar-minuta").addEventListener("click", async () => {
  const btn = el("btn-guardar-minuta");
  const contenidoMarkdown = el("minuta-md").value;
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Guardando...";
  try {
    await updateDoc(doc(db, "reuniones", reunionId), {
      "minuta.contenidoMarkdown": contenidoMarkdown,
      "minuta.actualizadoEn": serverTimestamp(),
      "minuta.actualizadoPorUid": usuario.uid,
      "minuta.actualizadoPorNombre": usuario.nombre,
      actualizadoEn: serverTimestamp(),
    });
    reunion.minuta = { ...reunion.minuta, contenidoMarkdown };
    mostrarAlerta("success", "Minuta guardada correctamente.");
  } catch (e) {
    console.error(e);
    mostrarAlerta("error", "Error al guardar la minuta.");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

// ── Exportar a .docx (ver docs/IMPLEMENTACION_MINUTAS_DOCX.md) ─────────────────
el("btn-exportar-docx").addEventListener("click", async () => {
  const btn = el("btn-exportar-docx");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Generando documento...";
  try {
    await generarDocxMinuta(reunion, invitadosResueltos, el("minuta-md").value);
  } catch (e) {
    console.error(e);
    mostrarAlerta("error", "Error al generar el .docx.");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

async function generarDocxMinuta(reunion, invitados, contenidoMarkdown) {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    ImageRun, AlignmentType, BorderStyle, WidthType, ShadingType
  } = await import("https://esm.sh/docx@9");

  let logoContecs = null;
  try {
    const resp = await fetch(new URL("../../logocontecs.png", import.meta.url));
    logoContecs = await resp.arrayBuffer();
  } catch { /* logo opcional */ }

  const bS = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
  const allB = { top: bS, bottom: bS, left: bS, right: bS };

  const r = (text, bold = false, size = 18, color = "000000") =>
    new TextRun({ text: text || "", bold, size, color });

  const p = (runs, center = false) => new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 0 },
    children: Array.isArray(runs) ? runs : [r(runs)],
  });

  const pEmpty = () => new Paragraph({ spacing: { after: 60 }, children: [] });

  const lCell = (text, cs = 2) => new TableCell({
    borders: allB,
    shading: { fill: "D9D9D9", type: ShadingType.CLEAR },
    width: { size: 1560 * cs, type: WidthType.DXA },
    columnSpan: cs,
    verticalAlign: "top",
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [p([r(text, true, 17, "000000")])]
  });

  const vCell = (content, cs = 4) => new TableCell({
    borders: allB,
    width: { size: 1560 * cs, type: WidthType.DXA },
    columnSpan: cs,
    verticalAlign: "top",
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: Array.isArray(content) ? content : [p([r(content || "—")])]
  });

  function runsConNegrita(texto, tamanoBase = 18, color = "000000") {
    const partes = texto.split(/(\*\*.+?\*\*)/g).filter(Boolean);
    return partes.map(parte => {
      const esNegrita = parte.startsWith("**") && parte.endsWith("**");
      const limpio = esNegrita ? parte.slice(2, -2) : parte;
      return r(limpio, esNegrita, tamanoBase, color);
    });
  }

  // ── Encabezado ────────────────────────────────────────────────────────────
  const encabezado = [
    ...(logoContecs ? [p([new ImageRun({ data: logoContecs, type: "png", transformation: { width: 70, height: 70 } })], true)] : []),
    p([r("CONTECS", true, 26, "045223")], true),
    p([r("Minuta de Reunión", true, 20, "045223")], true),
    pEmpty(),
  ];

  // ── Metadatos ─────────────────────────────────────────────────────────────
  const lugarTexto = reunion.esVirtual ? `Virtual — ${reunion.linkVirtual}` : (reunion.lugar || "—");
  const fechaTexto = fmtFecha(reunion.fechaInicio);
  const horaTexto = `${fmtHora(reunion.fechaInicio)} – ${fmtHora(reunion.fechaFin)}`;

  const tablaMetadatos = new Table({
    width: { size: 9360, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [lCell("TÍTULO"), vCell(reunion.titulo)] }),
      new TableRow({ children: [lCell("FECHA"), vCell(fechaTexto)] }),
      new TableRow({ children: [lCell("HORA"), vCell(horaTexto)] }),
      new TableRow({ children: [lCell("DURACIÓN"), vCell(formatearDuracion(reunion.fechaInicio, reunion.fechaFin))] }),
      new TableRow({ children: [lCell("LUGAR"), vCell(lugarTexto)] }),
      new TableRow({ children: [lCell("AGENDA"), vCell(reunion.agenda || "—")] }),
    ]
  });

  // ── Asistentes ────────────────────────────────────────────────────────────
  const bloqueAsistentes = [
    p([r("ASISTENTES", true, 20, "045223")]),
    pEmpty(),
    invitados.length > 0
      ? new Table({
          width: { size: 9360, type: WidthType.DXA },
          rows: [
            new TableRow({ children: [lCell("NOMBRE", 4), lCell("ASISTIÓ", 2)] }),
            ...invitados.map(u => new TableRow({ children: [
              vCell(u.nombre || u.email || "—", 4),
              vCell(reunion.asistencia?.[u.id] ? "☑ Sí" : "☐ No", 2),
            ]})),
          ]
        })
      : p([r("Sin invitados registrados.", false, 18, "999999")]),
  ];

  // ── Cuerpo Markdown ───────────────────────────────────────────────────────
  const lineas = (contenidoMarkdown || "").split("\n").map(parsearLineaMarkdown);
  let cuerpoMarkdown = [];
  if (lineas.every(l => l.tipo === "vacio")) {
    cuerpoMarkdown = [p([r("Esta minuta aún no tiene contenido.", false, 18, "999999")])];
  } else {
    for (const l of lineas) {
      if (l.tipo === "h1") {
        cuerpoMarkdown.push(new Paragraph({ spacing: { before: 200, after: 120 }, children: runsConNegrita(l.texto, 24, "045223") }));
      } else if (l.tipo === "h2") {
        cuerpoMarkdown.push(new Paragraph({ spacing: { before: 160, after: 100 }, children: runsConNegrita(l.texto, 20, "045223") }));
      } else if (l.tipo === "bullet") {
        cuerpoMarkdown.push(new Paragraph({ bullet: { level: 0 }, children: runsConNegrita(l.texto) }));
      } else if (l.tipo === "vacio") {
        cuerpoMarkdown.push(pEmpty());
      } else {
        cuerpoMarkdown.push(new Paragraph({ spacing: { after: 80 }, children: runsConNegrita(l.texto) }));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
      },
      children: [
        ...encabezado,
        tablaMetadatos,
        pEmpty(),
        ...bloqueAsistentes,
        pEmpty(),
        p([r("CONTENIDO DE LA MINUTA", true, 20, "045223")]),
        pEmpty(),
        ...cuerpoMarkdown,
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const tituloSlug = (reunion.titulo || "reunion").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");
  const fechaISO = (reunion.fechaInicio?.toDate ? reunion.fechaInicio.toDate() : new Date(reunion.fechaInicio)).toISOString().slice(0, 10);
  a.download = `Minuta_${tituloSlug}_${fechaISO}.docx`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarAlerta("success", "Documento generado correctamente.");
}

cargar();

#!/usr/bin/env python3
"""
AlphaToolGraph.py
----------------------
Analizador local de arquitectura para proyectos JS (CONTECS: vanilla JS +
ES Modules + Firebase). Sin IA, sin internet, sin costo.

Novedades sobre v2:
  - Extrae los SIMBOLOS exportados de cada archivo (funciones, const, class),
    asi el grafo dice no solo "que existe" sino "que expone" cada archivo.
  - Extrae un "proposito" (primer comentario /** */ o // del archivo) si existe.
  - Detecta acoplamiento IMPLICITO via variables globales (window.X = ... y
    usos de window.X en otros archivos) - lo marca como "posible_acople",
    NUNCA como certeza, porque este tipo de deteccion es heuristica.
  - Detecta Cloud Functions (functions.https.onCall / onRequest / triggers
    de Firestore) y las etiqueta aparte.
  - Calcula un "risk_score" por archivo (conexiones + si esta en un ciclo +
    tamaño) para priorizar que archivos revisar antes de tocarlos.
  - Modo consulta rapida: --lookup archivo.js te dice en la terminal,
    sin abrir el JSON, con que otros archivos se conecta.

LIMITE HONESTO (leelo antes de confiar ciegamente):
  Esto analiza imports/exports de ES Modules y CommonJS via texto, no via un
  compilador real. Para el 95%+ de codigo JS normal es exacto. Puede fallarle
  a: imports dinamicos con nombres construidos en runtime (`import(x+'.js')`),
  codigo minificado, y acoplamiento via variables globales complejas (por eso
  esas se reportan aparte, como "posible", no como certeza). Para logica
  interna de una funcion, esto NUNCA reemplaza leer el archivo real.

Uso:
    python AlphaToolGraph.py "C:\\ruta\\a\\CONTECS"
    python AlphaToolGraph.py "C:\\ruta\\a\\CONTECS" --out reporte_contecs
    python AlphaToolGraph.py "C:\\ruta\\a\\CONTECS" --lookup panel/auth.js
"""

import argparse
import json
import re
import sys
from pathlib import Path
from collections import defaultdict

CODE_EXTENSIONS = {".js", ".mjs", ".jsx", ".ts", ".tsx", ".html"}

IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", "coverage",
    "graph-out", ".vscode", ".idea", "__pycache__", "vendor", "lib",
}

IMPORT_PATTERNS = [
    re.compile(r"""import\s+(?:[\w*${}\s,]+from\s+)?['"]([^'"]+)['"]"""),
    re.compile(r"""export\s+(?:[\w*${}\s,]+from\s+)?['"]([^'"]+)['"]"""),
    re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)"""),
    re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)"""),
    re.compile(r"""<script[^>]+src=["']([^"']+\.m?js)["']"""),
]

FIRESTORE_PATTERNS = [
    re.compile(r"""collection\(\s*[\w.]+\s*,\s*['"]([\w\-]+)['"]"""),
    re.compile(r"""doc\(\s*[\w.]+\s*,\s*['"]([\w\-]+)['"]"""),
]

EXPORT_SYMBOL_PATTERNS = [
    re.compile(r"""export\s+(?:async\s+)?function\s+(\w+)"""),
    re.compile(r"""export\s+(?:const|let|var)\s+(\w+)"""),
    re.compile(r"""export\s+class\s+(\w+)"""),
    re.compile(r"""export\s+default\s+(?:async\s+)?function\s+(\w+)?"""),
]
EXPORT_BLOCK_PATTERN = re.compile(r"""export\s*\{([^}]+)\}""")
COMMONJS_EXPORT_PATTERN = re.compile(r"""exports\.(\w+)\s*=""")
COMMONJS_MODULE_EXPORTS_KEYS = re.compile(r"""module\.exports\s*=\s*\{([^}]+)\}""", re.DOTALL)

WINDOW_ASSIGN_PATTERN = re.compile(r"""window\.(\w+)\s*=""")
WINDOW_READ_PATTERN = re.compile(r"""window\.(\w+)""")

CLOUD_FUNCTION_TRIGGER_NAMES = [
    "onCall", "onRequest",
    "onDocumentCreated", "onDocumentUpdated", "onDocumentDeleted", "onDocumentWritten",
    "onObjectFinalized", "onObjectArchived", "onObjectDeleted", "onObjectMetadataUpdated",
    "onSchedule",
    "onValueCreated", "onValueUpdated", "onValueDeleted", "onValueWritten",
    "onMessagePublished", "onTaskDispatched",
]
_TRIGGER_ALT = "|".join(CLOUD_FUNCTION_TRIGGER_NAMES)

CLOUD_FUNCTION_PATTERNS = [
    # export const nombre = onCall(...) / exports.nombre = onCall(...)
    # cubre v1 (functions.https.onCall) y v2 (onCall importado directo),
    # con o sin saltos de linea entre el '=' y la funcion trigger
    re.compile(r"""(?:export\s+const|exports\.)\s*(\w+)\s*=\s*(?:functions[\w.]*\.(?:https|firestore|storage|pubsub|database)\.[\w.]*)?(?:""" + _TRIGGER_ALT + r""")\s*\("""),
]


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    out_lines = []
    for line in text.split("\n"):
        idx, i, in_str = None, 0, None
        while i < len(line):
            ch = line[i]
            if in_str:
                if ch == in_str and line[i-1] != "\\":
                    in_str = None
            elif ch in ("'", '"', "`"):
                in_str = ch
            elif ch == "/" and i+1 < len(line) and line[i+1] == "/" and not in_str:
                idx = i
                break
            i += 1
        if idx is not None:
            line = line[:idx]
        out_lines.append(line)
    return "\n".join(out_lines)


def extract_purpose(raw_text: str) -> str:
    """Primer comentario de bloque o linea del archivo, como pista de proposito."""
    block = re.match(r"\s*/\*\*(.*?)\*/", raw_text, re.DOTALL)
    if block:
        cleaned = re.sub(r"^\s*\*\s?", "", block.group(1), flags=re.MULTILINE).strip()
        return cleaned[:180].replace("\n", " ")
    CODE_LIKE = re.compile(r"^(import\b|export\b|require\(|const\b|let\b|var\b|function\b|class\b)")
    lines = raw_text.split("\n")[:8]
    comment_lines = []
    for l in lines:
        s = l.strip()
        if not s.startswith("//"):
            continue
        content = s.strip("/ ").strip()
        if CODE_LIKE.match(content):
            continue  # es codigo comentado, no una descripcion real
        if content:
            comment_lines.append(content)
    if comment_lines:
        return " ".join(comment_lines)[:180]
    return ""


def extract_exports(text: str) -> list:
    symbols = set()
    for pat in EXPORT_SYMBOL_PATTERNS:
        for m in pat.finditer(text):
            if m.group(1):
                symbols.add(m.group(1))
    for m in EXPORT_BLOCK_PATTERN.finditer(text):
        for part in m.group(1).split(","):
            name = part.strip().split(" as ")[0].strip()
            if name and re.match(r"^\w+$", name):
                symbols.add(name)
    for m in COMMONJS_EXPORT_PATTERN.finditer(text):
        symbols.add(m.group(1))
    for m in COMMONJS_MODULE_EXPORTS_KEYS.finditer(text):
        for part in m.group(1).split(","):
            name = part.strip().split(":")[0].strip()
            if name and re.match(r"^\w+$", name):
                symbols.add(name)
    return sorted(symbols)


def detect_cloud_functions(text: str) -> list:
    names = set()
    for pat in CLOUD_FUNCTION_PATTERNS:
        for m in pat.finditer(text):
            names.add(m.group(1))
    return sorted(names)


def find_source_files(root: Path):
    files = []
    for p in root.rglob("*"):
        if p.is_dir():
            continue
        if any(part in IGNORE_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in CODE_EXTENSIONS:
            files.append(p)
    return files


def resolve_import(from_file: Path, raw_path: str, root: Path):
    if not (raw_path.startswith("./") or raw_path.startswith("../")):
        return None
    base = (from_file.parent / raw_path).resolve()
    candidates = [
        base, base.with_suffix(".js"), base.with_suffix(".mjs"), base.with_suffix(".ts"),
        base / "index.js", base / "index.mjs",
    ]
    for c in candidates:
        try:
            if c.is_file():
                return c.resolve()
        except OSError:
            continue
    return None


def top_folder(rel_path: str) -> str:
    parts = Path(rel_path).parts
    return parts[0] if len(parts) > 1 else "(raiz)"


def find_cycles(adj: dict) -> list:
    WHITE, GRAY, BLACK = 0, 1, 2
    color = defaultdict(int)
    cycles = []
    path_stack = []

    def dfs(u):
        color[u] = GRAY
        path_stack.append(u)
        for v in adj.get(u, []):
            if color[v] == GRAY and v in path_stack:
                i = path_stack.index(v)
                cycles.append(path_stack[i:] + [v])
            elif color[v] == WHITE:
                dfs(v)
        path_stack.pop()
        color[u] = BLACK

    for node in list(adj.keys()):
        if color[node] == WHITE:
            dfs(node)
    return cycles


def build_graph(root: Path):
    files = find_source_files(root)
    file_set = set(f.resolve() for f in files)

    nodes = {}
    edges = []
    external_deps = defaultdict(set)
    firestore_refs = defaultdict(set)
    in_degree = defaultdict(int)
    out_degree = defaultdict(int)
    adj = defaultdict(list)

    window_assigns = defaultdict(set)  # varName -> archivos que la asignan
    window_reads = defaultdict(set)    # varName -> archivos que la leen
    cloud_functions = []

    for f in files:
        rel = str(f.resolve().relative_to(root)).replace("\\", "/")
        nodes[str(f.resolve())] = {
            "id": str(f.resolve()), "label": rel, "folder": top_folder(rel),
            "ext": f.suffix, "size_bytes": f.stat().st_size, "loc": 0,
            "exports": [], "purpose": "",
        }

    for f in files:
        try:
            raw_text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        node_id = str(f.resolve())
        node = nodes[node_id]
        node["loc"] = raw_text.count("\n") + 1
        node["purpose"] = extract_purpose(raw_text)

        text = strip_comments(raw_text)
        node["exports"] = extract_exports(text)

        cf = detect_cloud_functions(text)
        if cf:
            cloud_functions.append({"file": node["label"], "functions": cf})

        for m in WINDOW_ASSIGN_PATTERN.finditer(text):
            window_assigns[m.group(1)].add(node["label"])
        for m in WINDOW_READ_PATTERN.finditer(text):
            window_reads[m.group(1)].add(node["label"])

        found_internal, found_external = set(), set()
        for pattern in IMPORT_PATTERNS:
            for match in pattern.finditer(text):
                raw_path = match.group(1)
                resolved = resolve_import(f, raw_path, root)
                if resolved and resolved in file_set:
                    found_internal.add(resolved)
                elif not raw_path.startswith((".", "/")):
                    found_external.add(raw_path)

        for target in found_internal:
            tgt_id = str(target)
            edges.append({"source": node_id, "target": tgt_id, "type": "imports"})
            out_degree[node_id] += 1
            in_degree[tgt_id] += 1
            adj[node_id].append(tgt_id)

        for pkg in found_external:
            external_deps[pkg].add(node["label"])
        for pattern in FIRESTORE_PATTERNS:
            for match in pattern.finditer(text):
                firestore_refs[match.group(1)].add(node["label"])

    # Acoplamiento implicito via window.X: si un archivo la asigna y OTRO la lee,
    # sin que haya un import formal entre ambos, es un candidato a "posible acople"
    possible_implicit_links = []
    for var, assigners in window_assigns.items():
        readers = window_reads.get(var, set()) - assigners
        if readers and assigners:
            for a in assigners:
                for r in readers:
                    possible_implicit_links.append({
                        "variable": f"window.{var}", "define_en": a, "usado_en": r,
                    })

    for node_id, node in nodes.items():
        node["in_degree"] = in_degree.get(node_id, 0)
        node["out_degree"] = out_degree.get(node_id, 0)
        node["degree"] = node["in_degree"] + node["out_degree"]

    cycles_raw = find_cycles(adj)
    id_to_label = {nid: n["label"] for nid, n in nodes.items()}
    cycles, seen = [], set()
    nodes_in_cycles = set()
    for c in cycles_raw:
        key = frozenset(c)
        if key in seen:
            continue
        seen.add(key)
        cycles.append([id_to_label.get(x, x) for x in c])
        nodes_in_cycles.update(c)

    for node_id, node in nodes.items():
        in_cycle = node_id in nodes_in_cycles
        node["in_cycle"] = in_cycle
        node["risk_score"] = round(node["degree"] * 2 + (10 if in_cycle else 0) + node["loc"] / 100, 1)

    god_nodes = sorted(nodes.values(), key=lambda n: -n["degree"])[:15]
    orphans = sorted([n["label"] for n in nodes.values() if n["degree"] == 0])
    top_risk = sorted(nodes.values(), key=lambda n: -n["risk_score"])[:15]

    graph = {
        "root": str(root),
        "stats": {
            "total_files": len(nodes), "total_edges": len(edges),
            "total_orphans": len(orphans), "total_cycles": len(cycles),
            "total_external_packages": len(external_deps),
            "total_firestore_collections": len(firestore_refs),
            "total_cloud_functions": len(cloud_functions),
            "total_possible_implicit_links": len(possible_implicit_links),
        },
        "god_nodes": [{"label": n["label"], "degree": n["degree"], "in": n["in_degree"],
                        "out": n["out_degree"], "exports": n["exports"]}
                       for n in god_nodes if n["degree"] > 0],
        "top_risk_files": [{"label": n["label"], "risk_score": n["risk_score"],
                             "degree": n["degree"], "in_cycle": n["in_cycle"], "loc": n["loc"]}
                            for n in top_risk if n["risk_score"] > 0],
        "orphans": orphans,
        "circular_dependencies": cycles,
        "external_packages": {k: sorted(v) for k, v in sorted(external_deps.items())},
        "firestore_collections": {k: sorted(v) for k, v in sorted(firestore_refs.items())},
        "cloud_functions": cloud_functions,
        "possible_implicit_links": possible_implicit_links,
        "nodes": list(nodes.values()),
        "edges": edges,
    }
    return graph


def write_report(graph: dict, out_path: Path, project_name: str):
    s = graph["stats"]
    L = []
    L.append(f"# Mapa de arquitectura — {project_name}\n")
    L.append(f"- Archivos analizados: **{s['total_files']}**")
    L.append(f"- Conexiones internas (imports): **{s['total_edges']}**")
    L.append(f"- Paquetes externos usados: **{s['total_external_packages']}**")
    L.append(f"- Colecciones de Firestore detectadas: **{s['total_firestore_collections']}**")
    L.append(f"- Cloud Functions detectadas: **{s['total_cloud_functions']}**")
    L.append(f"- Archivos huerfanos: **{s['total_orphans']}**")
    L.append(f"- Dependencias circulares: **{s['total_cycles']}**")
    L.append(f"- Posibles acoples implicitos (via window.X, sin confirmar): **{s['total_possible_implicit_links']}**\n")

    L.append("## Archivos de mayor RIESGO al modificar\n")
    L.append("Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.\n")
    for n in graph["top_risk_files"]:
        flag = " ⚠️ EN CICLO" if n["in_cycle"] else ""
        L.append(f"- `{n['label']}` — riesgo {n['risk_score']} (conexiones: {n['degree']}, {n['loc']} lineas){flag}")
    L.append("")

    L.append("## God nodes (mas conectados) y que exponen\n")
    for n in graph["god_nodes"]:
        exp = ", ".join(n["exports"][:8]) if n["exports"] else "(sin exports detectados)"
        L.append(f"- `{n['label']}` — grado {n['degree']} | exporta: {exp}")
    L.append("")

    if graph["circular_dependencies"]:
        L.append("## ⚠️ Dependencias circulares\n")
        for c in graph["circular_dependencies"]:
            L.append(f"- {' → '.join(c)}")
        L.append("")

    if graph["possible_implicit_links"]:
        L.append("## 🟡 Posibles acoples implicitos (via variables globales `window.X`)\n")
        L.append("Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:\n")
        for link in graph["possible_implicit_links"][:25]:
            L.append(f"- `{link['variable']}` definida en `{link['define_en']}`, leida en `{link['usado_en']}`")
        L.append("")

    if graph["cloud_functions"]:
        L.append("## Cloud Functions detectadas\n")
        for cf in graph["cloud_functions"]:
            L.append(f"- `{cf['file']}`: {', '.join(cf['functions'])}")
        L.append("")

    if graph["orphans"]:
        L.append("## Archivos huerfanos\n")
        for o in graph["orphans"][:40]:
            L.append(f"- `{o}`")
        if len(graph["orphans"]) > 40:
            L.append(f"- ...y {len(graph['orphans'])-40} mas")
        L.append("")

    if graph["firestore_collections"]:
        L.append("## Colecciones de Firestore y quien las usa\n")
        for col, users in graph["firestore_collections"].items():
            L.append(f"### `{col}`")
            for u in users[:10]:
                L.append(f"- `{u}`")
            if len(users) > 10:
                L.append(f"- ...y {len(users)-10} archivos mas")
            L.append("")

    if graph["external_packages"]:
        L.append("## Paquetes/SDKs externos\n")
        for pkg, users in graph["external_packages"].items():
            L.append(f"- `{pkg}` — usado en {len(users)} archivo(s)")
        L.append("")

    out_path.write_text("\n".join(L), encoding="utf-8")


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Mapa — {title}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
<style>
html,body{{margin:0;height:100%;background:#0b0d12;font-family:-apple-system,Segoe UI,sans-serif;overflow:hidden}}
#info{{position:fixed;top:12px;left:12px;color:#e6e6e6;background:rgba(20,22,28,.85);padding:12px 16px;border-radius:10px;max-width:360px;font-size:13px;line-height:1.5;z-index:10}}
#info b{{color:#7dd3fc}}
#search{{position:fixed;top:12px;right:12px;z-index:10}}
#search input{{padding:8px 12px;border-radius:8px;border:1px solid #333;background:#14161c;color:#eee;width:220px}}
.link{{stroke:#3a3f4b;stroke-opacity:.6}}
.link.cycle{{stroke:#ef4444;stroke-opacity:.85;stroke-width:2.2px}}
.node circle{{stroke:#0b0d12;stroke-width:1.5px;cursor:pointer}}
.node circle.risky{{stroke:#f59e0b;stroke-width:2.5px}}
.node text{{fill:#cfd3da;font-size:9px;pointer-events:none}}
.node.dim circle{{opacity:.12}} .node.dim text{{opacity:.08}} .link.dim{{opacity:.05}}
</style></head><body>
<div id="info"><b>{title}</b><br>{n_files} archivos · {n_edges} conexiones · {n_cycles} ciclos<br>
<span style="color:#888">Color=carpeta · borde naranja=alto riesgo · clic=resaltar · dblclic=limpiar</span></div>
<div id="search"><input id="q" placeholder="Buscar archivo..." /></div>
<svg id="graph"></svg>
<script>
const data = {data_json};
const cycleEdgeSet = new Set({cycle_edges_json});
const width = innerWidth, height = innerHeight;
const svg = d3.select("#graph").attr("width",width).attr("height",height);
const g = svg.append("g");
svg.call(d3.zoom().scaleExtent([.1,6]).on("zoom",ev=>g.attr("transform",ev.transform)));
const folders = [...new Set(data.nodes.map(d=>d.folder))];
const color = d3.scaleOrdinal(d3.schemeTableau10).domain(folders);
const maxDeg = d3.max(data.nodes,d=>d.degree)||1;
const maxRisk = d3.max(data.nodes,d=>d.risk_score)||1;
const radius = d => 4+10*Math.sqrt((d.degree||0)/maxDeg);
const sim = d3.forceSimulation(data.nodes)
  .force("link",d3.forceLink(data.edges).id(d=>d.id).distance(70).strength(.25))
  .force("charge",d3.forceManyBody().strength(-90))
  .force("center",d3.forceCenter(width/2,height/2))
  .force("collision",d3.forceCollide().radius(d=>radius(d)+6));
const link = g.append("g").selectAll("line").data(data.edges).join("line")
  .attr("class",d=>cycleEdgeSet.has(d.source+"::"+d.target)?"link cycle":"link");
const node = g.append("g").selectAll("g").data(data.nodes).join("g").attr("class","node")
  .call(d3.drag()
    .on("start",(ev,d)=>{{if(!ev.active)sim.alphaTarget(.2).restart();d.fx=d.x;d.fy=d.y;}})
    .on("drag",(ev,d)=>{{d.fx=ev.x;d.fy=ev.y;}})
    .on("end",(ev,d)=>{{if(!ev.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}}));
node.append("circle").attr("r",radius).attr("fill",d=>color(d.folder))
  .attr("class",d=> (d.risk_score/maxRisk)>0.6 ? "risky" : "");
node.append("title").text(d=>d.label+"\\n"+d.degree+" conexiones · "+d.loc+" lineas · riesgo "+d.risk_score+(d.purpose?"\\n"+d.purpose:""));
node.append("text").attr("dx",d=>radius(d)+3).attr("dy",3).text(d=>d.label.split("/").pop());
const neighbors = new Map();
data.edges.forEach(e=>{{const s=e.source.id||e.source,t=e.target.id||e.target;
  if(!neighbors.has(s))neighbors.set(s,new Set()); if(!neighbors.has(t))neighbors.set(t,new Set());
  neighbors.get(s).add(t); neighbors.get(t).add(s);}});
node.on("click",(ev,d)=>{{const c=neighbors.get(d.id)||new Set();
  node.classed("dim",n=>n.id!==d.id&&!c.has(n.id));
  link.classed("dim",l=>(l.source.id||l.source)!==d.id&&(l.target.id||l.target)!==d.id);}});
svg.on("dblclick",()=>{{node.classed("dim",false);link.classed("dim",false);}});
sim.on("tick",()=>{{link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
  node.attr("transform",d=>`translate(${{d.x}},${{d.y}})`);}});
document.getElementById("q").addEventListener("input",e=>{{const t=e.target.value.toLowerCase();
  if(!t){{node.classed("dim",false);link.classed("dim",false);return;}}
  node.classed("dim",d=>!d.label.toLowerCase().includes(t)); link.classed("dim",true);}});
</script></body></html>
"""


def do_lookup(graph: dict, target_label: str):
    target_label = target_label.replace("\\", "/")
    label_to_id = {n["label"]: n["id"] for n in graph["nodes"]}
    if target_label not in label_to_id:
        candidates = [l for l in label_to_id if target_label in l]
        print(f"No encontre '{target_label}' exacto.")
        if candidates:
            print("Quisiste decir:")
            for c in candidates[:10]:
                print(f"  - {c}")
        return
    tid = label_to_id[target_label]
    imports_to = [e["target"] for e in graph["edges"] if e["source"] == tid]
    imported_by = [e["source"] for e in graph["edges"] if e["target"] == tid]
    id_to_label = {n["id"]: n["label"] for n in graph["nodes"]}

    print(f"\n=== {target_label} ===")
    node = next(n for n in graph["nodes"] if n["id"] == tid)
    if node["purpose"]:
        print(f"Proposito: {node['purpose']}")
    if node["exports"]:
        print(f"Exporta: {', '.join(node['exports'])}")
    print(f"Riesgo: {node['risk_score']}  (en ciclo: {'SI' if node['in_cycle'] else 'no'})")

    print(f"\nEste archivo IMPORTA ({len(imports_to)}):")
    for i in imports_to:
        print(f"  -> {id_to_label.get(i,i)}")

    print(f"\nEste archivo ES IMPORTADO POR ({len(imported_by)}):")
    for i in imported_by:
        print(f"  <- {id_to_label.get(i,i)}")

    related_implicit = [l for l in graph["possible_implicit_links"]
                         if l["define_en"] == target_label or l["usado_en"] == target_label]
    if related_implicit:
        print(f"\nPosibles acoples implicitos (via window.X, sin confirmar):")
        for l in related_implicit:
            print(f"  ~ {l['variable']}: definido en {l['define_en']}, usado en {l['usado_en']}")

    print(f"\nRECOMENDACION: si vas a modificar {target_label}, considera pasar tambien:")
    all_related = set(id_to_label.get(i, i) for i in imports_to + imported_by)
    all_related |= {l["define_en"] for l in related_implicit} | {l["usado_en"] for l in related_implicit}
    all_related.discard(target_label)
    for r in sorted(all_related):
        print(f"  - {r}")
    if not all_related:
        print("  (ninguno mas — este archivo esta aislado)")


def main():
    parser = argparse.ArgumentParser(description="Mapea arquitectura de un proyecto JS localmente, sin IA ni costo.")
    parser.add_argument("path", nargs="?", default=".", help="Ruta a la carpeta del proyecto")
    parser.add_argument("--out", default="graph-out", help="Carpeta de salida")
    parser.add_argument("--lookup", help="Consulta rapida: con que se conecta un archivo (ruta relativa)")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.is_dir():
        print(f"Error: '{root}' no es una carpeta valida.")
        sys.exit(1)

    out_dir = Path(args.out)

    if args.lookup:
        json_path = out_dir / "graph.json"
        if not json_path.exists():
            print(f"No existe {json_path} todavia. Corre primero sin --lookup para generarlo.")
            sys.exit(1)
        graph = json.loads(json_path.read_text(encoding="utf-8"))
        do_lookup(graph, args.lookup)
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Analizando: {root}")
    graph = build_graph(root)

    (out_dir / "graph.json").write_text(json.dumps(graph, indent=2, ensure_ascii=False), encoding="utf-8")
    write_report(graph, out_dir / "REPORTE.md", root.name)

    id_by_label = {n["label"]: n["id"] for n in graph["nodes"]}
    cycle_edges = set()
    for cyc in graph["circular_dependencies"]:
        for i in range(len(cyc) - 1):
            a, b = id_by_label.get(cyc[i]), id_by_label.get(cyc[i+1])
            if a and b:
                cycle_edges.add(f"{a}::{b}")

    html = HTML_TEMPLATE.format(
        title=root.name, n_files=graph["stats"]["total_files"],
        n_edges=graph["stats"]["total_edges"], n_cycles=graph["stats"]["total_cycles"],
        data_json=json.dumps({"nodes": graph["nodes"], "edges": graph["edges"]}),
        cycle_edges_json=json.dumps(list(cycle_edges)),
    )
    (out_dir / "graph.html").write_text(html, encoding="utf-8")

    s = graph["stats"]
    print(f"\nListo.")
    print(f"  Archivos: {s['total_files']}  |  Conexiones: {s['total_edges']}  |  Ciclos: {s['total_cycles']}  |  "
          f"Huerfanos: {s['total_orphans']}  |  Acoples implicitos posibles: {s['total_possible_implicit_links']}")
    print(f"\n  -> {out_dir / 'graph.json'}")
    print(f"  -> {out_dir / 'graph.html'}")
    print(f"  -> {out_dir / 'REPORTE.md'}")
    print(f"\n  Tip: 'python AlphaToolGraph.py {args.path} --lookup panel/auth.js' "
          f"te dice al toque con que se conecta un archivo, sin abrir el JSON.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
AlphaToolGraph.py
----------------------
Analizador local de arquitectura para proyectos JS (CONTECS: vanilla JS +
ES Modules + Firebase). Sin IA, sin internet, sin costo.

Version 4:
  - Reconstruye siempre el mapa completo con huella SHA-256 reproducible.
  - Mapea archivos, imports, simbolos, llamadas importadas, paginas HTML,
    scripts, estilos, assets, navegacion, DOM, CSS, Firebase y Cloud Functions.
  - Registra procedencia en las relaciones y diagnostica rutas, IDs DOM,
    funciones remotas y colecciones sin reglas detectables.
  - Genera un indice de impacto por archivo para orientar revisiones de cambios.
  - Publica todos los JSON de forma atomica: un fallo no deja archivos a medias.
  - Incluye un visor profesional con busqueda, filtros, metricas e inspector.
  - Deriva GraphCompacto, GraphCompleto y GraphProfundo desde un solo escaneo.
  - Usa IDs relativos portables y añade contexto Git sin ruido generado.
  - Incluye instrucciones de escalado para que una IA consuma menos tokens.
  - Conserva --lookup para consultas rapidas desde la terminal.

LIMITE HONESTO:
  Es analisis estatico local y conservador, no ejecuta la aplicacion ni reemplaza
  pruebas. Imports construidos en runtime, reflexion y datos reales de Firebase
  requieren inspeccion adicional. Los hallazgos inciertos se etiquetan y el
  codigo fuente sigue siendo la fuente de verdad.

Uso:
    python AlphaToolGraph.py "C:\\ruta\\a\\CONTECS"
    python AlphaToolGraph.py "C:\\ruta\\a\\CONTECS" --out reporte_contecs
    python AlphaToolGraph.py "C:\\ruta\\a\\CONTECS" --lookup panel/auth.js
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from collections import defaultdict
from urllib.parse import unquote, urlsplit

VERSION = "4.0.0"
SCHEMA_VERSION = 4

SOURCE_EXTENSIONS = {
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html", ".htm",
    ".css", ".json", ".rules", ".md",
}
CODE_EXTENSIONS = {".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".html", ".htm"}

IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", "coverage",
    "graph-out", "alphagraph-out", ".vscode", ".idea", "__pycache__", "vendor", "lib",
}

SKIP_LARGE_BYTES = 2_500_000
MINIFIED_NAMES = re.compile(r"(?:\.min\.(?:js|css)$|^bundle\.)", re.I)

JS_EXTENSIONS = {".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"}
HTML_EXTENSIONS = {".html", ".htm"}

JS_DEFINITION_PATTERNS = [
    ("function", re.compile(r"\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")),
    ("class", re.compile(r"\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)")),
    ("function", re.compile(r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>")),
]
JS_CALL_PATTERN = re.compile(r"(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(")
JS_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "function", "return", "typeof",
    "new", "super", "import", "export", "setTimeout", "setInterval",
}

DOM_ID_PATTERNS = [
    re.compile(r"(?:document\.)?getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)"),
    re.compile(r"\bel\(\s*['\"]([^'\"]+)['\"]\s*\)"),
    re.compile(r"(?<![\w$])\$\(\s*['\"]([^'\"]+)['\"]\s*\)"),
]
DOM_SELECTOR_PATTERN = re.compile(r"(?:querySelector|querySelectorAll)\(\s*['\"]([^'\"]+)['\"]\s*\)")
LOCAL_STORAGE_PATTERN = re.compile(r"\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['\"]([^'\"]+)['\"]")
CUSTOM_EVENT_PATTERN = re.compile(r"(?:new\s+CustomEvent|dispatchEvent\s*\(\s*new\s+(?:Custom)?Event)\s*\(\s*['\"]([^'\"]+)['\"]")
EVENT_LISTENER_PATTERN = re.compile(r"addEventListener\(\s*['\"]([^'\"]+)['\"]")
NAVIGATION_PATTERN = re.compile(r"(?:window\.)?location(?:\.href)?\s*=\s*[`'\"]([^`'\"]+)|location\.(?:assign|replace)\(\s*[`'\"]([^`'\"]+)")
HTTPS_CALLABLE_PATTERN = re.compile(
    r"httpsCallable\(\s*(?:getFunctions\([^)]*\)|[^,]+)\s*,\s*['\"]([^'\"]+)['\"]"
)

FIRESTORE_COLLECTION_PATTERNS = [
    re.compile(r"\bcollection\(\s*[^,()]+\s*,\s*['\"]([\w-]+)['\"]"),
    re.compile(r"\bdoc\(\s*[^,()]+\s*,\s*['\"]([\w-]+)['\"]"),
    re.compile(r"\.collection\(\s*['\"]([\w-]+)['\"]\s*\)"),
]
FIRESTORE_OPERATION_NAMES = {
    "getDoc": "read", "getDocs": "read", "onSnapshot": "listen",
    "addDoc": "create", "setDoc": "write", "updateDoc": "update",
    "deleteDoc": "delete", "writeBatch": "write", "runTransaction": "transaction",
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


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


def unique_records(records: list, keys: tuple) -> list:
    seen, result = set(), []
    for record in records:
        key = tuple(record.get(k) for k in keys)
        if key not in seen:
            seen.add(key)
            result.append(record)
    return result


def clean_reference(value: str) -> str:
    """Quita query/hash y decodifica una ruta sin tocar data:, http: ni templates."""
    value = (value or "").strip()
    if not value or value.startswith(("data:", "mailto:", "tel:", "javascript:", "#")):
        return ""
    if "${" in value or "{{" in value:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return ""
    return unquote(parsed.path).replace("\\", "/")


def resolve_reference(from_file: Path, raw_path: str, root: Path):
    cleaned = clean_reference(raw_path)
    if not cleaned:
        return None
    base = (root / cleaned.lstrip("/")) if cleaned.startswith("/") else (from_file.parent / cleaned)
    try:
        return base.resolve()
    except OSError:
        return None


class ArchitectureHTMLParser(HTMLParser):
    """Extractor tolerante: HTML real suele estar incompleto mientras se edita."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.classes = []
        self.references = []
        self.inline_handlers = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        line, _ = self.getpos()
        if attrs.get("id"):
            self.ids.append({"name": attrs["id"], "line": line, "tag": tag})
        for name in (attrs.get("class") or "").split():
            if name:
                self.classes.append({"name": name, "line": line, "tag": tag})
        mapping = {
            "script": ("src", "loads_script"), "link": ("href", "loads_stylesheet"),
            "img": ("src", "loads_asset"), "source": ("src", "loads_asset"),
            "a": ("href", "navigates_to"), "form": ("action", "submits_to"),
        }
        if tag in mapping:
            attr, relation = mapping[tag]
            value = attrs.get(attr)
            if value:
                if tag == "link" and attrs.get("rel", "").lower() != "stylesheet":
                    relation = "loads_asset"
                self.references.append({"path": value, "type": relation, "line": line})
        for key, value in attrs.items():
            if key.lower().startswith("on") and value:
                self.inline_handlers.append({"event": key[2:].lower(), "line": line})


def parse_html(text: str) -> dict:
    parser = ArchitectureHTMLParser()
    try:
        parser.feed(text)
    except Exception:
        pass
    return {
        "ids": unique_records(parser.ids, ("name", "line")),
        "classes": unique_records(parser.classes, ("name", "line")),
        "references": unique_records(parser.references, ("path", "type", "line")),
        "inline_handlers": parser.inline_handlers,
    }


def extract_imports(text: str) -> list:
    records = []
    patterns = [
        re.compile(r"\bimport\s+(.+?)\s+from\s+['\"]([^'\"]+)['\"]", re.DOTALL),
        re.compile(r"\bimport\s*['\"]([^'\"]+)['\"]"),
        re.compile(r"\brequire\(\s*['\"]([^'\"]+)['\"]\s*\)"),
        re.compile(r"\bimport\(\s*['\"]([^'\"]+)['\"]\s*\)"),
    ]
    for match in patterns[0].finditer(text):
        clause, path = match.group(1).strip(), match.group(2)
        symbols = []
        block = re.search(r"\{([^}]+)\}", clause)
        if block:
            symbols = [p.strip().split(" as ")[0].strip() for p in block.group(1).split(",")]
        elif clause and not clause.startswith("*"):
            symbols = [clause.split(",", 1)[0].strip()]
        records.append({"path": path, "symbols": [s for s in symbols if s], "line": line_number(text, match.start()), "dynamic": False})
    for index, pattern in enumerate(patterns[1:], 1):
        for match in pattern.finditer(text):
            records.append({"path": match.group(1), "symbols": [], "line": line_number(text, match.start()), "dynamic": index == 3})
    return unique_records(records, ("path", "line"))


def extract_js_symbols(text: str) -> list:
    symbols = []
    for kind, pattern in JS_DEFINITION_PATTERNS:
        for match in pattern.finditer(text):
            symbols.append({
                "name": match.group(1), "kind": kind,
                "line": line_number(text, match.start()),
                "exported": bool(re.search(r"\bexport\b", match.group(0))),
            })
    for match in re.finditer(r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", text):
        if not any(s["name"] == match.group(1) and s["line"] == line_number(text, match.start()) for s in symbols):
            symbols.append({"name": match.group(1), "kind": "variable", "line": line_number(text, match.start()), "exported": "export" in match.group(0)})
    return sorted(unique_records(symbols, ("name", "kind", "line")), key=lambda x: (x["line"], x["name"]))


def extract_js_calls(text: str) -> list:
    result = []
    for match in JS_CALL_PATTERN.finditer(text):
        name = match.group(1)
        if name not in JS_KEYWORDS:
            result.append({"name": name, "line": line_number(text, match.start())})
    return unique_records(result, ("name", "line"))


def extract_dom_usage(text: str) -> dict:
    ids, selectors, generated_ids, generated_prefixes = [], [], [], []
    for pattern in DOM_ID_PATTERNS:
        for match in pattern.finditer(text):
            ids.append({"name": match.group(1), "line": line_number(text, match.start())})
    for match in DOM_SELECTOR_PATTERN.finditer(text):
        selectors.append({"selector": match.group(1), "line": line_number(text, match.start())})
    for pattern in (re.compile(r"\bid\s*=\s*['\"]([^'\"$<>]+)['\"]"), re.compile(r"\.id\s*=\s*['\"]([^'\"]+)['\"]")):
        for match in pattern.finditer(text):
            generated_ids.append({"name": match.group(1), "line": line_number(text, match.start())})
    for match in re.finditer(r"\bid\s*=\s*['\"]([^'\"]*?)\$\{[^}]+\}[^'\"]*['\"]", text):
        prefix = match.group(1)
        if prefix:
            generated_prefixes.append({"prefix": prefix, "line": line_number(text, match.start())})
    return {
        "ids": unique_records(ids, ("name", "line")),
        "selectors": unique_records(selectors, ("selector", "line")),
        "generated_ids": unique_records(generated_ids, ("name", "line")),
        "generated_prefixes": unique_records(generated_prefixes, ("prefix", "line")),
    }


def dom_use_is_guarded(text: str, use_line: int) -> bool:
    lines = text.splitlines()
    nearby = "\n".join(lines[max(0, use_line - 1):min(len(lines), use_line + 4)])
    return bool(re.search(r"\?\.|if\s*\(\s*!\s*[\w$]+\s*\)\s*(?:return|\{)", nearby))


def extract_css(text: str) -> dict:
    clean = strip_comments(text)
    ids, classes, assets = [], [], []
    for match in re.finditer(r"(?<![\w-])#([A-Za-z_][\w-]*)", clean):
        ids.append({"name": match.group(1), "line": line_number(clean, match.start())})
    for match in re.finditer(r"(?<![\w-])\.([A-Za-z_][\w-]*)", clean):
        classes.append({"name": match.group(1), "line": line_number(clean, match.start())})
    for match in re.finditer(r"url\(\s*['\"]?([^)'\"]+)", clean):
        assets.append({"path": match.group(1), "line": line_number(clean, match.start()), "type": "loads_asset"})
    return {
        "ids": unique_records(ids, ("name", "line")),
        "classes": unique_records(classes, ("name", "line")),
        "references": unique_records(assets, ("path", "line")),
    }


def extract_firestore(text: str) -> dict:
    collections = []
    for pattern in FIRESTORE_COLLECTION_PATTERNS:
        for match in pattern.finditer(text):
            collections.append({"name": match.group(1), "line": line_number(text, match.start())})
    operations = []
    for name, kind in FIRESTORE_OPERATION_NAMES.items():
        for match in re.finditer(r"\b" + re.escape(name) + r"\s*\(", text):
            window = text[match.start():match.start() + 500]
            col = None
            for pattern in FIRESTORE_COLLECTION_PATTERNS:
                found = pattern.search(window)
                if found:
                    col = found.group(1)
                    break
            operations.append({"operation": name, "kind": kind, "collection": col, "line": line_number(text, match.start())})
    return {
        "collections": unique_records(collections, ("name", "line")),
        "operations": unique_records(operations, ("operation", "collection", "line")),
    }


def extract_rules(text: str) -> dict:
    matches, permissions = [], []
    for match in re.finditer(r"match\s+/([\w-]+)(?:/\{[^}]+\})?\s*\{", text):
        collection_name = match.group(1)
        if collection_name in {"databases"}:
            continue
        matches.append({"collection": collection_name, "line": line_number(text, match.start())})
        block = text[match.end():text.find("\n    }", match.end()) if text.find("\n    }", match.end()) != -1 else len(text)]
        for allow in re.finditer(r"allow\s+([^:]+):\s*if\s+([^;]+);", block):
            permissions.append({"collection": collection_name, "operations": allow.group(1).strip(), "condition": " ".join(allow.group(2).split())[:240], "line": line_number(text, match.end() + allow.start())})
    return {"collections": matches, "permissions": permissions}


def extract_literal_records(pattern: re.Pattern, text: str, key: str) -> list:
    records = []
    for match in pattern.finditer(text):
        value = next((g for g in match.groups() if g is not None), "")
        records.append({key: value, "line": line_number(text, match.start())})
    return unique_records(records, (key, "line"))


def find_source_files(root: Path, ignored_paths=None):
    ignored_paths = {Path(p).resolve() for p in (ignored_paths or [])}
    # No permitir que una salida vieja (aunque use un --out personalizado) se
    # convierta en entrada del siguiente mapa.
    markers = list(root.rglob("GraphCompleto.json")) + list(root.rglob("graph.json"))
    for marker in markers:
        try:
            candidate = json.loads(marker.read_text(encoding="utf-8"))
            is_our_graph = isinstance(candidate, dict) and "nodes" in candidate and "edges" in candidate and (
                candidate.get("generator", {}).get("name") == "AlphaToolGraph" or "stats" in candidate
            )
            if is_our_graph:
                ignored_paths.add(marker.parent.resolve())
        except (OSError, ValueError, TypeError):
            continue
    files = []
    for p in root.rglob("*"):
        if p.is_dir():
            continue
        resolved = p.resolve()
        if any(resolved == ignored or ignored in resolved.parents for ignored in ignored_paths):
            continue
        if any(part in IGNORE_DIRS for part in p.parts):
            continue
        if p.name in {"package-lock.json"} or p.stat().st_size > SKIP_LARGE_BYTES:
            continue
        if p.suffix.lower() in SOURCE_EXTENSIONS or p.suffix.lower() in {".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".pdf"}:
            files.append(p)
    return sorted(files, key=lambda p: str(p).lower())


def resolve_import(from_file: Path, raw_path: str, root: Path):
    cleaned = clean_reference(raw_path)
    if not cleaned or not (cleaned.startswith("./") or cleaned.startswith("../") or cleaned.startswith("/")):
        return None
    base = resolve_reference(from_file, cleaned, root)
    if base is None:
        return None
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


def build_graph(root: Path, ignored_paths=None):
    files = find_source_files(root, ignored_paths)
    file_set = set(f.resolve() for f in files)
    source_files = [f for f in files if f.suffix.lower() in SOURCE_EXTENSIONS]

    nodes, contents, analyses = {}, {}, {}
    edges, diagnostics = [], []
    external_deps = defaultdict(set)
    firestore_refs = defaultdict(set)
    firestore_operations = defaultdict(list)
    in_degree = defaultdict(int)
    out_degree = defaultdict(int)
    adj = defaultdict(list)
    window_assigns = defaultdict(set)
    window_reads = defaultdict(set)
    cloud_functions = []
    remote_function_calls = defaultdict(set)
    dom_definitions = defaultdict(list)
    css_definitions = {"ids": defaultdict(list), "classes": defaultdict(list)}
    rule_collections, rule_permissions = set(), []
    all_symbols = []
    entity_counts = defaultdict(int)

    def rel_of(path: Path) -> str:
        return str(path.resolve().relative_to(root)).replace("\\", "/")

    def add_edge(source: Path, target: Path, edge_type: str, line=None, provenance="extracted", detail=None):
        source, target = source.resolve(), target.resolve()
        if str(source) not in nodes or str(target) not in nodes:
            return
        edge = {"source": str(source), "target": str(target), "type": edge_type, "provenance": provenance}
        if line:
            edge["line"] = line
        if detail:
            edge["detail"] = detail
        edges.append(edge)

    def add_missing(file: Path, category: str, message: str, line=None, severity="warning", evidence=None):
        item = {"severity": severity, "category": category, "file": rel_of(file), "message": message, "provenance": "extracted"}
        if line:
            item["line"] = line
        if evidence:
            item["evidence"] = evidence
        diagnostics.append(item)

    for f in files:
        rel = rel_of(f)
        try:
            raw = f.read_text(encoding="utf-8", errors="ignore") if f.suffix.lower() in SOURCE_EXTENSIONS or f.suffix.lower() == ".svg" else ""
        except OSError:
            raw = ""
        contents[f.resolve()] = raw
        nodes[str(f.resolve())] = {
            "id": str(f.resolve()), "label": rel, "folder": top_folder(rel),
            "ext": f.suffix, "size_bytes": f.stat().st_size, "loc": 0,
            "sha256": sha256_text(raw) if raw else None,
            "exports": [], "purpose": "", "kind": "asset" if f.suffix.lower() not in SOURCE_EXTENSIONS else "source",
            "minified_or_vendor": bool(MINIFIED_NAMES.search(f.name) or "libs" in f.parts),
        }

    for f in source_files:
        raw_text = contents[f.resolve()]
        if not raw_text:
            continue
        node_id = str(f.resolve())
        node = nodes[node_id]
        node["loc"] = raw_text.count("\n") + 1
        node["purpose"] = extract_purpose(raw_text)
        text = strip_comments(raw_text)
        node["exports"] = extract_exports(text)
        analysis = {
            "imports": [], "symbols": [], "calls": [], "dom": {"ids": [], "selectors": []},
            "html": {"ids": [], "classes": [], "references": [], "inline_handlers": []},
            "css": {"ids": [], "classes": [], "references": []},
            "firestore": {"collections": [], "operations": []},
            "storage_keys": [], "events_listened": [], "events_dispatched": [],
            "navigation": [], "remote_functions": [],
        }

        deep_parse = not node["minified_or_vendor"]
        if deep_parse and (f.suffix.lower() in JS_EXTENSIONS or f.suffix.lower() in HTML_EXTENSIONS):
            analysis["imports"] = extract_imports(text)
            analysis["symbols"] = extract_js_symbols(text)
            analysis["calls"] = extract_js_calls(text)
            analysis["dom"] = extract_dom_usage(text)
            analysis["firestore"] = extract_firestore(text)
            analysis["storage_keys"] = extract_literal_records(LOCAL_STORAGE_PATTERN, text, "key")
            analysis["events_listened"] = extract_literal_records(EVENT_LISTENER_PATTERN, text, "event")
            analysis["events_dispatched"] = extract_literal_records(CUSTOM_EVENT_PATTERN, text, "event")
            analysis["navigation"] = extract_literal_records(NAVIGATION_PATTERN, text, "path")
            analysis["remote_functions"] = extract_literal_records(HTTPS_CALLABLE_PATTERN, text, "name")
        if f.suffix.lower() in HTML_EXTENSIONS:
            analysis["html"] = parse_html(raw_text)
        if f.suffix.lower() == ".css":
            analysis["css"] = extract_css(raw_text)
        if f.suffix.lower() == ".rules":
            rules = extract_rules(raw_text)
            rule_collections.update(r["collection"] for r in rules["collections"])
            rule_permissions.extend({**r, "file": node["label"]} for r in rules["permissions"])

        analyses[f.resolve()] = analysis
        node["symbols"] = analysis["symbols"]
        node["dom_ids_used"] = analysis["dom"]["ids"]
        node["firestore_collections"] = sorted({r["name"] for r in analysis["firestore"]["collections"]})
        all_symbols.extend({**symbol, "file": node["label"]} for symbol in analysis["symbols"])
        for key in ("symbols", "calls", "storage_keys", "events_listened", "events_dispatched", "remote_functions"):
            entity_counts[key] += len(analysis[key])

        for record in analysis["html"]["ids"]:
            dom_definitions[record["name"]].append({"file": node["label"], "line": record["line"]})
        for record in analysis["css"]["ids"]:
            css_definitions["ids"][record["name"]].append({"file": node["label"], "line": record["line"]})
        for record in analysis["css"]["classes"]:
            css_definitions["classes"][record["name"]].append({"file": node["label"], "line": record["line"]})

        cf = detect_cloud_functions(text)
        if cf:
            cloud_functions.append({"file": node["label"], "functions": cf})
        for call in analysis["remote_functions"]:
            remote_function_calls[call["name"]].add(node["label"])

        for m in WINDOW_ASSIGN_PATTERN.finditer(text):
            window_assigns[m.group(1)].add(node["label"])
        for m in WINDOW_READ_PATTERN.finditer(text):
            window_reads[m.group(1)].add(node["label"])

        for record in analysis["imports"]:
            raw_path = record["path"]
            resolved = resolve_import(f, raw_path, root)
            if resolved and resolved in file_set:
                add_edge(f, resolved, "imports", record["line"], detail={"symbols": record["symbols"], "dynamic": record["dynamic"]})
            elif not raw_path.startswith((".", "/")):
                external_deps[raw_path].add(node["label"])
            else:
                add_missing(f, "missing_import", f"Import local no encontrado: {raw_path}", record["line"], "error")

        for record in analysis["html"]["references"] + analysis["css"]["references"]:
            cleaned = clean_reference(record["path"])
            if not cleaned:
                if record["path"].startswith(("http://", "https://")):
                    external_deps[record["path"]].add(node["label"])
                continue
            target = resolve_reference(f, cleaned, root)
            if target in file_set:
                add_edge(f, target, record["type"], record["line"])
            elif Path(cleaned).suffix:
                add_missing(f, "missing_path", f"Ruta local no encontrada: {record['path']}", record["line"], "error")

        for record in analysis["navigation"] if f.suffix.lower() in HTML_EXTENSIONS else []:
            target = resolve_reference(f, record["path"], root)
            if target in file_set:
                add_edge(f, target, "navigates_to", record["line"])
            elif clean_reference(record["path"]) and Path(clean_reference(record["path"])).suffix:
                add_missing(f, "missing_navigation", f"Destino de navegación no encontrado: {record['path']}", record["line"], "warning")

        for record in analysis["firestore"]["collections"]:
            firestore_refs[record["name"]].add(node["label"])
        for operation in analysis["firestore"]["operations"]:
            if operation["collection"]:
                firestore_operations[operation["collection"]].append({"file": node["label"], **operation})

    # Desduplicar aristas antes de calcular grados.
    deduped, seen_edges = [], set()
    for edge in edges:
        detail_key = json.dumps(edge.get("detail"), sort_keys=True, ensure_ascii=False)
        key = (edge["source"], edge["target"], edge["type"], edge.get("line"), detail_key)
        if key not in seen_edges:
            seen_edges.add(key)
            deduped.append(edge)
    edges = deduped

    structural_types = {"imports", "loads_script", "loads_stylesheet"}
    for edge in edges:
        in_degree[edge["target"]] += 1
        out_degree[edge["source"]] += 1
        if edge["type"] in structural_types:
            adj[edge["source"]].append(edge["target"])

    # Enlaza llamadas de símbolos importados con su archivo proveedor.
    for f, analysis in analyses.items():
        called = {r["name"] for r in analysis["calls"]}
        for record in analysis["imports"]:
            target = resolve_import(f, record["path"], root)
            if target not in file_set:
                continue
            for symbol in set(record["symbols"]) & called:
                add_edge(f, target, "calls_imported_symbol", record["line"], detail={"symbol": symbol})

    # Las relaciones de símbolos se agregaron después de la primera pasada.
    # Recalcular grados desde la lista final mantiene risk_score e impact_index coherentes.
    deduped, seen_edges = [], set()
    for edge in edges:
        key = (edge["source"], edge["target"], edge["type"], edge.get("line"), json.dumps(edge.get("detail"), sort_keys=True, ensure_ascii=False))
        if key not in seen_edges:
            seen_edges.add(key)
            deduped.append(edge)
    edges = deduped
    in_degree.clear()
    out_degree.clear()
    adj.clear()
    for edge in edges:
        in_degree[edge["target"]] += 1
        out_degree[edge["source"]] += 1
        if edge["type"] in structural_types:
            adj[edge["source"]].append(edge["target"])

    # Módulos JS ↔ páginas HTML: valida IDs únicamente contra las páginas que cargan el módulo.
    pages_by_script = defaultdict(set)
    for edge in edges:
        if edge["type"] == "loads_script":
            pages_by_script[Path(edge["target"]).resolve()].add(Path(edge["source"]).resolve())
    for f, analysis in analyses.items():
        if f.suffix.lower() not in JS_EXTENSIONS:
            continue
        pages = pages_by_script.get(f, set())
        if not pages:
            continue
        page_ids = {r["name"] for page in pages for r in analyses.get(page, {}).get("html", {}).get("ids", [])}
        generated_ids = {r["name"] for r in analysis["dom"].get("generated_ids", [])}
        generated_prefixes = {r["prefix"] for r in analysis["dom"].get("generated_prefixes", [])}
        for use in analysis["dom"]["ids"]:
            generated = use["name"] in generated_ids or any(use["name"].startswith(prefix) for prefix in generated_prefixes)
            if use["name"] not in page_ids and not generated:
                guarded = dom_use_is_guarded(contents[f], use["line"])
                category = "optional_dom_id" if guarded else "missing_dom_id"
                severity = "info" if guarded else "warning"
                message = (f"ID DOM opcional #{use['name']} no está en las páginas anfitrionas (uso protegido)" if guarded
                           else f"ID DOM #{use['name']} no existe en las páginas que cargan este módulo")
                add_missing(f, category, message, use["line"], severity, {"pages": sorted(rel_of(p) for p in pages)})

        for navigation in analysis["navigation"]:
            resolved_any = False
            for page in pages:
                target = resolve_reference(page, navigation["path"], root)
                if target in file_set:
                    add_edge(f, target, "navigates_to", navigation["line"], detail={"runtime_page": rel_of(page)})
                    resolved_any = True
            cleaned = clean_reference(navigation["path"])
            if pages and not resolved_any and cleaned and Path(cleaned).suffix:
                add_missing(f, "missing_navigation", f"Destino de navegación no encontrado desde sus páginas: {navigation['path']}", navigation["line"], "warning", {"pages": sorted(rel_of(p) for p in pages)})

    # Pase definitivo: las navegaciones de módulos se resolvieron contra su HTML anfitrión.
    deduped, seen_edges = [], set()
    for edge in edges:
        key = (edge["source"], edge["target"], edge["type"], edge.get("line"), json.dumps(edge.get("detail"), sort_keys=True, ensure_ascii=False))
        if key not in seen_edges:
            seen_edges.add(key)
            deduped.append(edge)
    edges = deduped
    in_degree.clear()
    out_degree.clear()
    adj.clear()
    for edge in edges:
        in_degree[edge["target"]] += 1
        out_degree[edge["source"]] += 1
        if edge["type"] in structural_types:
            adj[edge["source"]].append(edge["target"])

    defined_cloud_functions = {name for group in cloud_functions for name in group["functions"]}
    for name, callers in remote_function_calls.items():
        if name not in defined_cloud_functions:
            for caller in callers:
                diagnostics.append({"severity": "warning", "category": "missing_cloud_function", "file": caller, "message": f"httpsCallable referencia una función no detectada: {name}", "provenance": "extracted"})

    for collection_name, users in firestore_refs.items():
        if rule_collections and collection_name not in rule_collections:
            diagnostics.append({"severity": "warning", "category": "missing_firestore_rule", "file": sorted(users)[0], "message": f"Colección '{collection_name}' usada por código pero sin match explícito en firestore.rules", "evidence": {"users": sorted(users)}, "provenance": "extracted"})

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
        node_diagnostics = sum(1 for d in diagnostics if d["file"] == node["label"])
        node["diagnostic_count"] = node_diagnostics
        node["risk_score"] = round(node["degree"] * 2 + (10 if in_cycle else 0) + node["loc"] / 100 + node_diagnostics * 1.5, 1)

    god_nodes = sorted(nodes.values(), key=lambda n: -n["degree"])[:15]
    orphans = sorted([n["label"] for n in nodes.values() if n["degree"] == 0])
    top_risk = sorted(nodes.values(), key=lambda n: -n["risk_score"])[:15]

    file_hashes = sorted((n["label"], n.get("sha256") or f"binary:{n['size_bytes']}") for n in nodes.values())
    fingerprint = hashlib.sha256(json.dumps(file_hashes, ensure_ascii=False).encode("utf-8")).hexdigest()
    impact_index = {}
    id_to_label = {n["id"]: n["label"] for n in nodes.values()}
    for node in nodes.values():
        nid, label = node["id"], node["label"]
        outgoing = [e for e in edges if e["source"] == nid]
        incoming = [e for e in edges if e["target"] == nid]
        impact_index[label] = {
            "depends_on": sorted({id_to_label[e["target"]] for e in outgoing}),
            "used_by": sorted({id_to_label[e["source"]] for e in incoming}),
            "relations": sorted({e["type"] for e in outgoing + incoming}),
            "firestore_collections": node.get("firestore_collections", []),
            "diagnostics": [d for d in diagnostics if d["file"] == label],
        }

    # Los IDs serializados son rutas relativas estables. Esto reduce tokens,
    # evita filtrar rutas de usuario y permite mover/clonar el proyecto sin
    # invalidar todas las relaciones.
    portable_nodes = [{**node, "id": node["label"]} for node in nodes.values()]
    portable_edges = [{
        **edge,
        "source": id_to_label[edge["source"]],
        "target": id_to_label[edge["target"]],
    } for edge in edges]
    analysis_by_file = {
        rel_of(path): analysis for path, analysis in sorted(analyses.items(), key=lambda item: rel_of(item[0]))
    }

    graph = {
        "schema_version": SCHEMA_VERSION,
        "generator": {"name": "AlphaToolGraph", "version": VERSION, "engine": "stdlib-static-analysis"},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_fingerprint": fingerprint,
        "root": str(root),
        "stats": {
            "total_files": len(nodes), "total_edges": len(edges),
            "total_orphans": len(orphans), "total_cycles": len(cycles),
            "total_external_packages": len(external_deps),
            "total_firestore_collections": len(firestore_refs),
            "total_cloud_functions": sum(len(group["functions"]) for group in cloud_functions),
            "total_possible_implicit_links": len(possible_implicit_links),
            "total_symbols": len(all_symbols),
            "total_function_calls": entity_counts["calls"],
            "total_dom_ids": sum(len(v) for v in dom_definitions.values()),
            "total_diagnostics": len(diagnostics),
            "errors": sum(d["severity"] == "error" for d in diagnostics),
            "warnings": sum(d["severity"] == "warning" for d in diagnostics),
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
        "firestore_operations": {k: v for k, v in sorted(firestore_operations.items())},
        "firestore_rules": {"collections": sorted(rule_collections), "permissions": rule_permissions},
        "cloud_functions": cloud_functions,
        "remote_function_calls": {k: sorted(v) for k, v in sorted(remote_function_calls.items())},
        "possible_implicit_links": possible_implicit_links,
        "symbols": all_symbols,
        "dom": {"definitions": dict(sorted(dom_definitions.items()))},
        "css": {"ids": dict(sorted(css_definitions["ids"].items())), "classes": dict(sorted(css_definitions["classes"].items()))},
        "storage_keys": sorted({r["key"] for a in analyses.values() for r in a["storage_keys"]}),
        "events": {
            "listened": sorted({r["event"] for a in analyses.values() for r in a["events_listened"]}),
            "dispatched": sorted({r["event"] for a in analyses.values() for r in a["events_dispatched"]}),
        },
        "diagnostics": sorted(diagnostics, key=lambda d: ({"error": 0, "warning": 1, "info": 2}.get(d["severity"], 3), d["file"], d.get("line", 0))),
        "impact_index": impact_index,
        "nodes": portable_nodes,
        "edges": portable_edges,
        "analysis_by_file": analysis_by_file,
    }
    return graph


def git_snapshot(root: Path, ignored_paths=None) -> dict:
    """Estado Git local para orientar impacto; nunca modifica el repositorio."""
    def run(*args):
        try:
            result = subprocess.run(
                ["git", "-C", str(root), *args], capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=8, check=False,
            )
            return result.stdout.rstrip() if result.returncode == 0 else ""
        except (OSError, subprocess.SubprocessError):
            return ""

    head = run("rev-parse", "HEAD")
    if not head:
        return {"available": False, "changed_files": []}
    ignored_rel = []
    for ignored in ignored_paths or []:
        try:
            ignored_rel.append(str(Path(ignored).resolve().relative_to(root)).replace("\\", "/").rstrip("/") + "/")
        except ValueError:
            continue
    changed = []
    for line in run("status", "--porcelain=v1", "--untracked-files=all").splitlines():
        if len(line) < 4:
            continue
        status, path = line[:2], line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        path = path.replace("\\", "/")
        generated_names = {
            "GraphCompacto.json", "GraphCompleto.json", "GraphProfundo.json",
            "graph.json", "graph.html", "REPORTE.md", "AGENTS.md",
        }
        if (path == "AlphaToolGraph.py" or path.startswith("__pycache__/")
                or Path(path).name in generated_names
                or any(path.startswith(prefix) for prefix in ignored_rel)):
            continue
        changed.append({"file": path, "status": status})
    return {
        "available": True,
        "branch": run("branch", "--show-current") or None,
        "head": head,
        "changed_files": changed,
        "changed_count": len(changed),
    }


def estimate_tokens(value) -> int:
    """Estimación deliberadamente simple; sirve para comparar vistas, no facturación."""
    return max(1, round(len(json.dumps(value, ensure_ascii=False, separators=(",", ":"))) / 4))


def build_graph_views(graph: dict, root: Path, ignored_paths=None) -> dict:
    """Deriva tres niveles desde el mismo análisis, sin volver a leer el proyecto."""
    analysis_by_file = graph.get("analysis_by_file", {})
    git = git_snapshot(root, ignored_paths)
    common_meta = {
        "schema_version": graph["schema_version"],
        "generator": graph["generator"],
        "generated_at": graph["generated_at"],
        "project_fingerprint": graph["project_fingerprint"],
        "project": root.name,
    }

    lean_nodes = []
    for node in graph["nodes"]:
        lean_nodes.append({
            key: node[key] for key in (
                "id", "label", "folder", "ext", "kind", "size_bytes", "loc",
                "exports", "purpose", "minified_or_vendor", "firestore_collections",
                "in_degree", "out_degree", "degree", "in_cycle",
                "diagnostic_count", "risk_score",
            ) if key in node
        })

    complete = {
        **common_meta,
        "root": ".",
        "view": "complete",
        "stats": graph["stats"],
        "god_nodes": graph["god_nodes"],
        "top_risk_files": graph["top_risk_files"],
        "orphans": graph["orphans"],
        "circular_dependencies": graph["circular_dependencies"],
        "external_packages": graph["external_packages"],
        "firestore_collections": graph["firestore_collections"],
        "firestore_operations": graph["firestore_operations"],
        "firestore_rules": graph["firestore_rules"],
        "cloud_functions": graph["cloud_functions"],
        "remote_function_calls": graph["remote_function_calls"],
        "possible_implicit_links": graph["possible_implicit_links"],
        "diagnostics": graph["diagnostics"],
        "nodes": lean_nodes,
        "edges": graph["edges"],
        "git": git,
        "ai_usage": {
            "purpose": "Mapa arquitectónico normal. Abrir después de GraphCompacto.json cuando se necesiten relaciones exactas.",
            "next_view": "GraphProfundo.json",
            "source_of_truth": "El código real; este archivo es un índice estático.",
        },
    }

    domains = defaultdict(lambda: {"files": [], "collections": set(), "risk_total": 0.0, "diagnostics": 0})
    compact_files = []
    for node in graph["nodes"]:
        label = node["label"]
        impact = graph["impact_index"].get(label, {})
        item = {
            "file": label,
            "risk": node["risk_score"],
            "relations": node["degree"],
        }
        if node.get("purpose"):
            item["purpose"] = node["purpose"]
        if node.get("exports"):
            item["exports"] = node["exports"][:12]
        if impact.get("firestore_collections"):
            item["collections"] = impact["firestore_collections"]
        if impact.get("diagnostics"):
            item["diagnostics"] = len(impact["diagnostics"])
        # Vecinos sólo para archivos de mayor riesgo: el compacto enruta; el
        # completo contiene todas las 395 relaciones sin duplicarlas aquí.
        if node["risk_score"] >= 20 or impact.get("diagnostics"):
            neighbors = sorted(set(impact.get("depends_on", [])) | set(impact.get("used_by", [])))
            if neighbors:
                item["key_neighbors"] = neighbors[:12]
        # Assets aislados no ayudan al enrutamiento inicial; permanecen en las
        # vistas completa/profunda y aparecen aquí sólo si tienen conexiones.
        if node["kind"] != "asset" or node["degree"] > 0:
            compact_files.append(item)
        domain = domains[node["folder"]]
        domain["files"].append((label, node["risk_score"]))
        domain["collections"].update(impact.get("firestore_collections", []))
        domain["risk_total"] += node["risk_score"]
        domain["diagnostics"] += len(impact.get("diagnostics", []))

    compact_domains = []
    for name, domain in sorted(domains.items()):
        compact_domains.append({
            "name": name,
            "file_count": len(domain["files"]),
            "key_files": [label for label, _ in sorted(domain["files"], key=lambda item: -item[1])[:10]],
            "collections": sorted(domain["collections"]),
            "average_risk": round(domain["risk_total"] / max(1, len(domain["files"])), 1),
            "diagnostics": domain["diagnostics"],
        })

    compact = {
        **common_meta,
        "view": "compact",
        "ai_usage": {
            "read_first": True,
            "purpose": "Enrutador de bajo consumo. Localiza archivos y dependencias antes de abrir código o mapas mayores.",
            "workflow": [
                "1. Buscar aquí el dominio, archivo, colección o export relacionado con la tarea.",
                "2. Abrir el archivo objetivo y, cuando aparezcan, sus key_neighbors.",
                "3. Consultar GraphCompleto.json si faltan relaciones exactas.",
                "4. Consultar GraphProfundo.json únicamente para evidencia por línea o auditoría exhaustiva.",
            ],
            "do_not": "No cargar GraphCompleto/GraphProfundo completos si esta vista y el código relevante bastan.",
        },
        "stats": graph["stats"],
        "git": git,
        "domains": compact_domains,
        "critical_files": graph["top_risk_files"],
        "files": sorted(compact_files, key=lambda item: item["file"]),
        "firestore_collections": graph["firestore_collections"],
        "cloud_functions": graph["cloud_functions"],
        "diagnostics": graph["diagnostics"],
    }

    important_symbols = [
        symbol for symbol in graph["symbols"]
        if symbol["kind"] in {"function", "class"} or symbol["exported"]
    ]
    symbol_index = defaultdict(list)
    for symbol in important_symbols:
        # Formato posicional documentado abajo: evita repetir cuatro nombres de
        # campo cientos de veces sin perder evidencia.
        symbol_index[symbol["name"]].append([
            symbol["file"], symbol["line"], symbol["kind"], symbol["exported"],
        ])
    exported_names = {symbol["name"] for symbol in important_symbols if symbol["exported"]}
    evidence_by_file = {}
    retained_calls = 0
    for file_label, analysis in analysis_by_file.items():
        local_names = {
            symbol["name"] for symbol in analysis.get("symbols", [])
            if symbol["kind"] in {"function", "class"}
        }
        relevant_calls = [
            call for call in analysis.get("calls", [])
            if call["name"] in local_names or call["name"] in exported_names
        ]
        retained_calls += len(relevant_calls)
        def group_lines(records, value_key):
            grouped = defaultdict(list)
            for record in records:
                grouped[record[value_key]].append(record["line"])
            return {name: sorted(set(lines)) for name, lines in sorted(grouped.items())}

        def summarize_occurrences(records, value_key):
            grouped = defaultdict(list)
            for record in records:
                grouped[record[value_key]].append(record["line"])
            return {
                name: [min(lines), len(lines)]
                for name, lines in sorted(grouped.items())
            }

        evidence = {}
        if relevant_calls:
            evidence["architectural_calls"] = summarize_occurrences(relevant_calls, "name")
        html = analysis.get("html", {})
        html_evidence = {}
        if html.get("ids"):
            html_evidence["ids"] = group_lines(html["ids"], "name")
        if html.get("inline_handlers"):
            html_evidence["inline_handlers"] = group_lines(html["inline_handlers"], "event")
        if html_evidence:
            evidence["html"] = html_evidence
        dom = analysis.get("dom", {})
        dom_evidence = {}
        for source_key, value_key in (
            ("ids", "name"), ("selectors", "selector"),
            ("generated_ids", "name"), ("generated_prefixes", "prefix"),
        ):
            if dom.get(source_key):
                dom_evidence[source_key] = group_lines(dom[source_key], value_key)
        if dom_evidence:
            evidence["dom"] = dom_evidence
        for source_key, target_key, value_key in (
            ("storage_keys", "storage_keys", "key"),
            ("events_listened", "events_listened", "event"),
            ("events_dispatched", "events_dispatched", "event"),
        ):
            records = analysis.get(source_key, [])
            if records:
                evidence[target_key] = group_lines(records, value_key)
        if evidence:
            evidence_by_file[file_label] = evidence
    diagnostic_index = defaultdict(list)
    for diagnostic in graph["diagnostics"]:
        diagnostic_index[diagnostic["category"]].append(diagnostic)

    deep = dict(complete)
    deep.update({
        "view": "deep",
        "ai_usage": {
            "read_last": True,
            "purpose": "Evidencia exhaustiva para depuración, auditoría y reconstrucción de flujos.",
            "warning": "Archivo grande. Consultar secciones o claves concretas; no cargarlo entero sin necesidad.",
        },
        "evidence_by_file": evidence_by_file,
        "deep_indexes": {
            "symbol_record_schema": ["file", "line", "kind", "exported"],
            "architectural_call_schema": ["first_line", "occurrence_count"],
            "symbols": dict(sorted(symbol_index.items())),
            "diagnostics_by_category": dict(sorted(diagnostic_index.items())),
            "files_by_hash": {n.get("sha256") or f"binary:{n['size_bytes']}": n["label"] for n in graph["nodes"]},
        },
        "retention": {
            "symbols_detected": len(graph["symbols"]),
            "architectural_symbols_retained": len(important_symbols),
            "calls_detected": graph["stats"]["total_function_calls"],
            "architectural_calls_retained": retained_calls,
            "policy": "Conserva funciones, clases, exports y llamadas a funciones locales/exportadas; descarta ruido léxico trivial.",
        },
        "storage_keys": graph["storage_keys"],
        "events": graph["events"],
    })

    for view in (compact, complete, deep):
        view["estimated_tokens"] = estimate_tokens(view)
    return {"compact": compact, "complete": complete, "deep": deep}


def write_report(graph: dict, out_path: Path, project_name: str, views=None):
    s = graph["stats"]
    L = []
    L.append(f"# Mapa de arquitectura — {project_name}\n")
    L.append(f"- Generado: **{graph['generated_at']}**")
    L.append(f"- AlphaToolGraph: **v{graph['generator']['version']}** · esquema **{graph['schema_version']}**")
    L.append(f"- Huella del proyecto: `{graph['project_fingerprint'][:16]}…`")
    L.append(f"- Archivos analizados: **{s['total_files']}**")
    L.append(f"- Relaciones internas tipadas: **{s['total_edges']}**")
    L.append(f"- Símbolos detectados: **{s['total_symbols']}**")
    L.append(f"- Llamadas detectadas: **{s['total_function_calls']}**")
    L.append(f"- IDs DOM definidos: **{s['total_dom_ids']}**")
    L.append(f"- Paquetes externos usados: **{s['total_external_packages']}**")
    L.append(f"- Colecciones de Firestore detectadas: **{s['total_firestore_collections']}**")
    L.append(f"- Cloud Functions detectadas: **{s['total_cloud_functions']}**")
    L.append(f"- Archivos huerfanos: **{s['total_orphans']}**")
    L.append(f"- Dependencias circulares: **{s['total_cycles']}**")
    L.append(f"- Posibles acoples implicitos (via window.X, sin confirmar): **{s['total_possible_implicit_links']}**\n")
    L.append(f"- Diagnósticos: **{s['errors']} errores · {s['warnings']} advertencias**\n")

    if views:
        compact_tokens = views["compact"]["estimated_tokens"]
        complete_tokens = views["complete"]["estimated_tokens"]
        deep_tokens = views["deep"]["estimated_tokens"]
        reduction = round((1 - compact_tokens / max(1, deep_tokens)) * 100, 1)
        L.append("## Cerebro para IA: tres niveles\n")
        L.append(f"- `GraphCompacto.json` — ~**{compact_tokens:,} tokens** · leer primero")
        L.append(f"- `GraphCompleto.json` — ~**{complete_tokens:,} tokens** · relaciones exactas")
        L.append(f"- `GraphProfundo.json` — ~**{deep_tokens:,} tokens** · evidencia exhaustiva")
        L.append(f"- Reducción estimada al empezar por el compacto: **{reduction}%** frente al profundo\n")

    if graph["diagnostics"]:
        L.append("## Diagnósticos de integridad\n")
        L.append("Hallazgos estáticos: deben confirmarse en código cuando intervienen rutas o valores dinámicos.\n")
        icons = {"error": "🔴", "warning": "🟡", "info": "🔵"}
        for item in graph["diagnostics"][:80]:
            location = f":{item['line']}" if item.get("line") else ""
            L.append(f"- {icons.get(item['severity'], '•')} `{item['file']}{location}` — {item['message']}")
        if len(graph["diagnostics"]) > 80:
            L.append(f"- …y {len(graph['diagnostics']) - 80} diagnósticos más; consulta `GraphCompleto.json`.")
        L.append("")

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

    if graph["firestore_rules"]["collections"]:
        L.append("## Cobertura de reglas de Firestore\n")
        for collection_name in graph["firestore_rules"]["collections"]:
            operation_count = len(graph["firestore_operations"].get(collection_name, []))
            L.append(f"- `{collection_name}` — regla explícita · {operation_count} operaciones detectadas")
        L.append("")

    relation_counts = defaultdict(int)
    for edge in graph["edges"]:
        relation_counts[edge["type"]] += 1
    if relation_counts:
        L.append("## Tipos de relaciones\n")
        for relation, count in sorted(relation_counts.items(), key=lambda item: (-item[1], item[0])):
            L.append(f"- `{relation}`: {count}")
        L.append("")

    if graph["external_packages"]:
        L.append("## Paquetes/SDKs externos\n")
        for pkg, users in graph["external_packages"].items():
            L.append(f"- `{pkg}` — usado en {len(users)} archivo(s)")
        L.append("")

    atomic_write_text(out_path, "\n".join(L))


HTML_TEMPLATE = r"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AlphaGraph Intelligence · __TITLE__</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
<style>
:root{--bg:#030711;--panel:#08111eea;--panel2:#0b1727e8;--line:#8db8e619;--line2:#8db8e62b;--text:#eaf4ff;--muted:#7890aa;--cyan:#2dd4ff;--cyan2:#0ea5e9;--green:#2ee6a6;--amber:#ffca62;--red:#ff6685;--violet:#a78bfa;--shadow:0 24px 70px #0009}*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}body:before,body:after{content:"";position:fixed;pointer-events:none}body:before{inset:0;background:radial-gradient(circle at 18% 8%,#0e749044,transparent 29%),radial-gradient(circle at 78% 85%,#0f766e33,transparent 30%),linear-gradient(135deg,#050915 0%,#02050c 58%,#06101b 100%)}body:after{inset:0;opacity:.18;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.14'/%3E%3C/svg%3E")}.app{height:100%;display:grid;grid-template:84px 1fr/308px minmax(420px,1fr) 372px;position:relative}.topbar{grid-column:1/-1;display:flex;align-items:center;gap:18px;padding:13px 20px;border-bottom:1px solid var(--line);background:#050b15df;backdrop-filter:blur(24px);z-index:20;box-shadow:0 12px 40px #0004}.brand{min-width:270px;display:flex;align-items:center;gap:13px}.logo{width:46px;height:46px;border:1px solid #67e8f955;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#12475f,#092538);color:#bff7ff;font:900 17px ui-monospace,Consolas;box-shadow:inset 0 0 22px #2dd4ff22,0 0 30px #2dd4ff1d;position:relative}.logo:after{content:"";position:absolute;inset:-5px;border:1px solid #2dd4ff15;border-radius:19px}.brand h1{font-size:15px;letter-spacing:.04em;margin:0}.brand p{font-size:10px;color:var(--muted);margin:4px 0 0;letter-spacing:.04em}.status-dot{display:inline-block;width:6px;height:6px;background:var(--green);border-radius:50%;box-shadow:0 0 10px var(--green);margin-right:6px}.stats{display:flex;gap:7px;flex:1;justify-content:center}.stat{min-width:78px;padding:8px 10px;border:1px solid var(--line);border-radius:11px;background:linear-gradient(145deg,#ffffff08,#ffffff03)}.stat b{display:block;font-size:15px}.stat span,.label{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.14em}.stamp{text-align:right;font:9px ui-monospace,Consolas;color:var(--muted);min-width:180px}.stamp b{display:block;color:var(--green);margin-bottom:5px;letter-spacing:.12em}.side{background:linear-gradient(180deg,var(--panel2),var(--panel));backdrop-filter:blur(22px);overflow:auto;z-index:10;padding:18px;scrollbar-width:thin;scrollbar-color:#31506a transparent}.left{border-right:1px solid var(--line)}.right{border-left:1px solid var(--line)}.section{margin-bottom:22px}.section>.label{display:block;margin:0 0 10px;font-weight:850}.search-wrap{position:relative}.search-icon{position:absolute;left:12px;top:11px;width:13px;height:13px;border:1.5px solid #6f8ca7;border-radius:50%;pointer-events:none}.search-icon:after{content:"";position:absolute;width:6px;height:1px;background:#6f8ca7;right:-5px;bottom:-3px;transform:rotate(45deg)}input,select,button{width:100%;border:1px solid #243950;background:#091422;color:var(--text);border-radius:10px;padding:10px;font:11px inherit;outline:none}input{padding-left:35px}input:focus,select:focus{border-color:#2dd4ff88;box-shadow:0 0 0 3px #2dd4ff12}.suggestions{display:none;position:absolute;left:0;right:0;top:43px;max-height:240px;overflow:auto;background:#07121ff7;border:1px solid #2c4a63;border-radius:11px;box-shadow:var(--shadow);z-index:40;padding:5px}.suggestions.open{display:block}.suggestion{padding:9px;border-radius:7px;cursor:pointer;font:10px ui-monospace,Consolas;color:#bdd1e3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.suggestion:hover{background:#2dd4ff12;color:var(--cyan)}.row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}button{cursor:pointer;font-weight:750;transition:.18s ease}button:hover{border-color:#4f718e;background:#102239}.primary{border-color:#2dd4ff55;background:linear-gradient(135deg,#083951,#0b473f);color:#baf8ff}.ghost{background:#ffffff04}.health{display:grid;grid-template-columns:1fr 1fr;gap:7px}.health div,.metric{padding:10px;border:1px solid var(--line);background:#ffffff05;border-radius:10px}.health b,.metric b{display:block;font-size:18px}.health span,.metric span{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}.legend{display:grid;gap:7px}.legend div{display:flex;align-items:center;gap:9px;font-size:10px;color:#a9bdd0}.dot{width:8px;height:8px;border-radius:50%;box-shadow:0 0 11px currentColor;flex:0 0 auto}.bar{width:20px;height:2px;border-radius:3px;flex:0 0 auto}.history{display:grid;gap:5px}.history-item{width:100%;padding:7px 9px;border:0;border-left:2px solid #2dd4ff44;border-radius:0 7px 7px 0;background:#ffffff04;color:#9db2c6;text-align:left;font:9px ui-monospace,Consolas;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history-item:hover{border-left-color:var(--cyan);color:var(--cyan)}main{position:relative;overflow:hidden;background:radial-gradient(circle at center,#0c21325c,transparent 62%)}.grid{position:absolute;inset:0;background-image:linear-gradient(#7dc4ee0a 1px,transparent 1px),linear-gradient(90deg,#7dc4ee0a 1px,transparent 1px);background-size:34px 34px;mask-image:radial-gradient(circle,#000 35%,transparent 92%)}.scanline{position:absolute;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#2dd4ff45,transparent);box-shadow:0 0 12px #2dd4ff33;animation:scan 9s linear infinite;opacity:.38}@keyframes scan{from{top:8%}to{top:92%}}#graph{position:absolute;inset:0;width:100%;height:100%}.modebar{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:4px;padding:5px;border:1px solid var(--line2);border-radius:13px;background:#07111de8;backdrop-filter:blur(18px);box-shadow:0 14px 40px #0006;z-index:6}.mode{width:auto;min-width:82px;padding:8px 10px;border:0;background:transparent;color:#8099b1;border-radius:9px;font-size:9px;letter-spacing:.04em}.mode:hover{background:#ffffff08}.mode.active{color:#c9fbff;background:linear-gradient(135deg,#0e435d,#0c3a39);box-shadow:inset 0 0 0 1px #2dd4ff33}.mode kbd{font:8px ui-monospace,Consolas;color:#557087;margin-right:4px}.crumbs{position:absolute;top:68px;left:18px;display:flex;gap:6px;align-items:center;z-index:5;font:9px ui-monospace,Consolas;color:#63809a}.crumb{padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:#07111dcc;color:#8da9c0;cursor:pointer}.crumb:last-child{color:var(--cyan);border-color:#2dd4ff33}.mode-info{position:absolute;top:68px;right:18px;z-index:5;padding:6px 9px;border:1px solid var(--line);border-radius:7px;background:#07111dcc;color:#7893aa;font-size:9px}.link{stroke:#506780;stroke-width:1.05;stroke-opacity:.36;transition:opacity .2s}.link.calls_imported_symbol{stroke-dasharray:3 3}.link.cycle{stroke:var(--red);stroke-width:2.5}.node{cursor:pointer;transition:opacity .2s}.node circle.core{filter:drop-shadow(0 0 6px #2dd4ff55)}.node circle{stroke:#04101b;stroke-width:2;transition:.2s}.node:hover circle{stroke:#d8faff;filter:drop-shadow(0 0 9px #2dd4ff88)}.node circle.risky{stroke:var(--amber);stroke-width:2.5;filter:drop-shadow(0 0 7px #ffca6255)}.node circle.error{stroke:var(--red);stroke-width:3;filter:drop-shadow(0 0 8px #ff668566)}.node circle.selected{stroke:#fff;stroke-width:3;filter:drop-shadow(0 0 13px #2dd4ff)}.node text{fill:#c8d9e8;font-size:8.5px;font-weight:650;paint-order:stroke;stroke:#030711;stroke-width:3px;pointer-events:none}.dim{opacity:.055!important}.hidden{display:none!important}.navtools{position:absolute;right:18px;bottom:18px;display:flex;gap:5px;z-index:6}.navtools button{width:34px;height:34px;padding:0;background:#07111de8;border-color:var(--line2);font:700 14px ui-monospace;color:#9ab2c8}.navtools button:hover{color:var(--cyan)}.minimap{position:absolute;left:18px;bottom:18px;width:180px;height:112px;border:1px solid var(--line2);border-radius:11px;background:#050d17e8;box-shadow:0 15px 40px #0007;overflow:hidden;z-index:5}.minimap:before{content:"MINIMAPA";position:absolute;top:7px;left:9px;color:#53718c;font:7px ui-monospace;letter-spacing:.14em}.minimap svg{width:100%;height:100%}.hint{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);padding:7px 11px;background:#07111ddd;border:1px solid var(--line);border-radius:99px;color:#69839a;font-size:8px;z-index:5}.empty{padding:24px 4px;color:var(--muted);font-size:11px;line-height:1.7}.empty strong{display:block;color:#bfd2e4;font-size:14px;margin-bottom:8px}.path{font:10px ui-monospace,Consolas;color:var(--cyan);word-break:break-all}.title{font-size:18px;margin:8px 0}.pills{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0 15px}.pill{font-size:8px;padding:4px 7px;border:1px solid var(--line2);background:#ffffff07;border-radius:99px;color:#a8bed1}.purpose{font-size:11px;color:var(--muted);line-height:1.6}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:7px}.list{display:grid;gap:5px}.item{padding:8px 9px;border-left:2px solid var(--cyan);background:#ffffff05;border-radius:0 7px 7px 0;font-size:10px;line-height:1.4;word-break:break-word}.item.warn{border-color:var(--amber)}.item.error{border-color:var(--red)}.details-actions{display:flex;gap:6px;margin:12px 0}.details-actions button{font-size:9px}.tooltip{position:fixed;z-index:50;pointer-events:none;opacity:0;max-width:340px;padding:10px 12px;border:1px solid var(--line2);background:#050c16f2;backdrop-filter:blur(16px);border-radius:9px;box-shadow:var(--shadow);font-size:10px;line-height:1.5}.tooltip b{color:var(--cyan)}.toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);opacity:0;padding:9px 14px;background:#092033;border:1px solid #2dd4ff55;border-radius:9px;color:#bff7ff;font-size:10px;z-index:100;transition:.22s}.toast.show{opacity:1;transform:translate(-50%,0)}.modal{position:fixed;inset:0;z-index:90;display:none;place-items:center;background:#02050bc9;backdrop-filter:blur(10px)}.modal.open{display:grid}.shortcuts{width:min(520px,90vw);padding:22px;border:1px solid var(--line2);border-radius:17px;background:#081421;box-shadow:var(--shadow)}.shortcuts h2{margin:0 0 16px;font-size:16px}.shortcut-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.shortcut{display:flex;justify-content:space-between;padding:8px 10px;background:#ffffff05;border-radius:8px;color:#92a9bd;font-size:10px}.shortcut kbd{padding:2px 6px;border:1px solid #35516a;border-radius:5px;color:var(--cyan);font:9px ui-monospace}.shortcut-close{margin-top:14px}.mode-empty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;width:min(420px,75%);padding:20px;text-align:center;background:#07111de8;border:1px solid var(--line2);border-radius:14px;color:#819ab0;font-size:11px;line-height:1.6;z-index:7}.mode-empty.show{display:block}.mode-empty b{display:block;color:#c5d8e9;font-size:14px;margin-bottom:6px}
@media(max-width:1180px){.app{grid-template-columns:270px 1fr}.right{position:fixed;right:0;top:84px;bottom:0;width:350px;box-shadow:-25px 0 60px #0009}.stat:nth-child(n+4){display:none}.mode{min-width:64px}.stamp{display:none}}@media(max-width:820px){.app{display:block}.left,.right,.stats{display:none}.topbar{height:84px}.brand{min-width:0}.modebar{max-width:calc(100% - 20px);overflow:auto;justify-content:flex-start}.mode{min-width:76px}main{height:calc(100% - 84px)}.minimap{width:130px;height:84px}.hint{display:none}}
</style></head>
<body><div class="app">
<header class="topbar"><div class="brand"><div class="logo">A³</div><div><h1>ALPHAGRAPH INTELLIGENCE</h1><p><span class="status-dot"></span>Centro arquitectónico · __TITLE__</p></div></div><div class="stats" id="stats"></div><div class="stamp"><b>SISTEMA VERIFICADO</b><span id="fingerprint"></span></div></header>
<aside class="side left"><div class="section"><span class="label">Búsqueda inteligente</span><div class="search-wrap"><i class="search-icon"></i><input id="q" autocomplete="off" placeholder="Archivo, export o símbolo…"><div class="suggestions" id="suggestions"></div></div><div class="row"><select id="folder"><option value="">Todas las áreas</option></select><select id="relation"><option value="">Toda relación</option></select></div><div class="row"><button class="ghost" id="reset">Limpiar</button><button class="primary" id="fit">Centrar mapa</button></div></div><div class="section"><span class="label">Salud del sistema</span><div class="health"><div><b id="errors" style="color:var(--red)">0</b><span>Errores</span></div><div><b id="warnings" style="color:var(--amber)">0</b><span>Advertencias</span></div></div></div><div class="section"><span class="label">Historial de inspección</span><div class="history" id="history"><div class="empty">Aún no has inspeccionado archivos.</div></div></div><div class="section"><span class="label">Relaciones visibles</span><div class="legend" id="relLegend"></div></div><div class="section"><span class="label">Áreas del proyecto</span><div class="legend" id="folderLegend"></div></div></aside>
<main><div class="grid"></div><div class="scanline"></div><div class="modebar" id="modebar"></div><div class="crumbs" id="crumbs"><span class="crumb">proyecto</span></div><div class="mode-info" id="modeInfo"></div><svg id="graph"></svg><div class="mode-empty" id="modeEmpty"></div><div class="minimap"><svg id="minimap" viewBox="0 0 180 112"></svg></div><div class="hint">Clic para inspeccionar · rueda para zoom · <b>?</b> atajos</div><div class="navtools"><button id="zoomOut" title="Alejar">−</button><button id="zoomIn" title="Acercar">+</button><button id="fitMini" title="Centrar">⌖</button><button id="fullscreen" title="Pantalla completa">□</button><button id="help" title="Atajos">?</button></div></main>
<aside class="side right"><div id="empty" class="empty"><strong>Inspector de arquitectura</strong>Selecciona un archivo para conocer propósito, símbolos, colecciones, dependencias, consumidores, impacto y diagnósticos.</div><div id="details" class="hidden"></div></aside></div>
<div class="tooltip" id="tip"></div><div class="toast" id="toast"></div><div class="modal" id="shortcuts"><div class="shortcuts"><h2>Atajos del centro de mando</h2><div class="shortcut-grid"><div class="shortcut"><span>Buscar</span><kbd>/</kbd></div><div class="shortcut"><span>Centrar mapa</span><kbd>F</kbd></div><div class="shortcut"><span>Limpiar selección</span><kbd>ESC</kbd></div><div class="shortcut"><span>Ayuda</span><kbd>?</kbd></div><div class="shortcut"><span>Modo anterior</span><kbd>←</kbd></div><div class="shortcut"><span>Modo siguiente</span><kbd>→</kbd></div><div class="shortcut"><span>Elegir modo</span><kbd>1—6</kbd></div><div class="shortcut"><span>Pantalla completa</span><kbd>G</kbd></div></div><button class="shortcut-close" id="closeHelp">Cerrar</button></div></div>
<script>
const data=__DATA_JSON__,stats=data.stats,impact=data.impact||{},git=data.git||{changed_files:[]};
const $=s=>document.querySelector(s),q=$('#q'),folder=$('#folder'),relation=$('#relation'),suggestions=$('#suggestions'),empty=$('#empty'),detailsBox=$('#details'),modeEmpty=$('#modeEmpty');
const relColors={imports:'#2dd4ff',calls_imported_symbol:'#a78bfa',loads_script:'#2ee6a6',loads_stylesheet:'#22d3ee',loads_asset:'#64748b',navigates_to:'#ffca62',submits_to:'#fb923c'},relNames={imports:'Importa',calls_imported_symbol:'Llama símbolo',loads_script:'Carga script',loads_stylesheet:'Carga CSS',loads_asset:'Usa asset',navigates_to:'Navega',submits_to:'Envía formulario'};
const modes=[['architecture','Arquitectura','Todo el sistema'],['impact','Impacto','Vecindad del archivo'],['firebase','Firebase','Datos y backend'],['interface','Interfaz','HTML, CSS y DOM'],['risks','Riesgos','Puntos delicados'],['changes','Cambios','Estado de Git']];
const state={mode:'architecture',selected:null,history:[],historyIndex:-1},changed=new Set((git.changed_files||[]).map(x=>x.file));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),edgeId=x=>typeof x==='object'?x.id:x,main=()=>document.querySelector('main'),w=()=>main().clientWidth,h=()=>main().clientHeight;
$('#fingerprint').textContent=data.fingerprint.slice(0,16)+'… · '+data.generatedAt.slice(0,10);$('#errors').textContent=stats.errors;$('#warnings').textContent=stats.warnings;
$('#stats').innerHTML=[['Archivos',stats.total_files],['Relaciones',stats.total_edges],['Símbolos',stats.total_symbols],['Colecciones',stats.total_firestore_collections],['Ciclos',stats.total_cycles]].map(x=>`<div class="stat"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('');
$('#modebar').innerHTML=modes.map((m,i)=>`<button class="mode${i===0?' active':''}" data-mode="${m[0]}" title="${m[2]}"><kbd>${i+1}</kbd>${m[1]}</button>`).join('');
const folders=[...new Set(data.nodes.map(d=>d.folder))].sort(),palette=['#2dd4ff','#2ee6a6','#a78bfa','#ff6685','#ffca62','#22d3ee','#fb923c','#818cf8','#2dd4bf','#e879f9'],color=d3.scaleOrdinal(folders,palette),types=[...new Set(data.edges.map(e=>e.type))].sort();
folder.innerHTML+=folders.map(x=>`<option>${esc(x)}</option>`).join('');relation.innerHTML+=types.map(x=>`<option value="${x}">${relNames[x]||x}</option>`).join('');$('#relLegend').innerHTML=types.map(x=>`<div><i class="bar" style="background:${relColors[x]||'#64748b'}"></i>${relNames[x]||x}</div>`).join('');$('#folderLegend').innerHTML=folders.slice(0,14).map(x=>`<div><i class="dot" style="background:${color(x)};color:${color(x)}"></i>${esc(x)}</div>`).join('');
const svg=d3.select('#graph'),g=svg.append('g'),zoom=d3.zoom().scaleExtent([.07,8]).on('zoom',e=>g.attr('transform',e.transform));svg.call(zoom);
const maxD=d3.max(data.nodes,d=>d.degree)||1,maxR=d3.max(data.nodes,d=>d.risk_score)||1,radius=d=>d.kind==='asset'?3.2:4.8+10.5*Math.sqrt((d.degree||0)/maxD);
const sim=d3.forceSimulation(data.nodes).force('link',d3.forceLink(data.edges).id(d=>d.id).distance(d=>d.type==='calls_imported_symbol'?100:76).strength(.22)).force('charge',d3.forceManyBody().strength(d=>d.kind==='asset'?-24:-130)).force('center',d3.forceCenter(w()/2,h()/2)).force('collision',d3.forceCollide().radius(d=>radius(d)+5));
const link=g.append('g').selectAll('line').data(data.edges).join('line').attr('class',d=>`link ${d.type}${d.in_cycle?' cycle':''}`).attr('stroke',d=>relColors[d.type]||'#64748b');
const node=g.append('g').selectAll('g').data(data.nodes).join('g').attr('class','node').call(d3.drag().on('start',(e,d)=>{if(!e.active)sim.alphaTarget(.2).restart();d.fx=d.x;d.fy=d.y}).on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y}).on('end',(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null}));
node.append('circle').attr('r',radius).attr('fill',d=>color(d.folder)).attr('class',d=>(impact[d.label]?.diagnostics||[]).some(x=>x.severity==='error')?'error':d.risk_score/maxR>.58?'risky':d.degree>maxD*.55?'core':'');node.append('text').attr('dx',d=>radius(d)+4).attr('dy',3).text(d=>d.label.split('/').pop());
const mini=d3.select('#minimap'),miniNodes=mini.selectAll('circle').data(data.nodes).join('circle').attr('r',d=>Math.max(1,Math.min(2.8,radius(d)/4))).attr('fill',d=>color(d.folder)).attr('opacity',.75);
const tip=$('#tip');node.on('mouseenter',(e,d)=>{tip.innerHTML=`<b>${esc(d.label)}</b><br>${d.degree} relaciones · ${d.loc} líneas · riesgo ${d.risk_score}${(impact[d.label]?.firestore_collections||[]).length?'<br>Firebase · '+esc(impact[d.label].firestore_collections.join(', ')):''}`;tip.style.opacity=1}).on('mousemove',e=>{tip.style.left=e.clientX+14+'px';tip.style.top=e.clientY+14+'px'}).on('mouseleave',()=>tip.style.opacity=0).on('click',(e,d)=>{e.stopPropagation();selectNode(d,true)});
function isInterface(d){if(['.html','.css'].includes(d.ext)||(d.dom_ids_used||[]).length)return true;return data.edges.some(e=>(['loads_script','loads_stylesheet','loads_asset'].includes(e.type))&&(edgeId(e.source)===d.id||edgeId(e.target)===d.id))}
function nearSelected(d){if(!state.selected)return false;if(d.id===state.selected.id)return true;return data.edges.some(e=>(edgeId(e.source)===state.selected.id&&edgeId(e.target)===d.id)||(edgeId(e.target)===state.selected.id&&edgeId(e.source)===d.id))}
function modeMatch(d){const i=impact[d.label]||{};if(state.mode==='impact')return nearSelected(d);if(state.mode==='firebase')return (i.firestore_collections||[]).length||d.folder==='functions'||d.folder==='firebase_rules'||d.label==='firebase.json';if(state.mode==='interface')return isInterface(d);if(state.mode==='risks')return d.in_cycle||d.risk_score>=30||(i.diagnostics||[]).length;if(state.mode==='changes')return changed.has(d.label);return true}
function searchMatch(d,s){return !s||d.label.toLowerCase().includes(s)||(d.exports||[]).some(x=>x.toLowerCase().includes(s))||(d.symbols||[]).some(x=>x.name.toLowerCase().includes(s))}
function applyView(){const s=q.value.trim().toLowerCase(),f=folder.value,r=relation.value,visible=new Set(data.nodes.filter(d=>modeMatch(d)&&(!f||d.folder===f)&&searchMatch(d,s)).map(d=>d.id));node.classed('hidden',d=>!visible.has(d.id)).classed('dim',false);link.classed('hidden',e=>!visible.has(edgeId(e.source))||!visible.has(edgeId(e.target))||(r&&e.type!==r)).classed('dim',false);miniNodes.attr('opacity',d=>visible.has(d.id)?.78:.05);const mode=modes.find(x=>x[0]===state.mode);$('#modeInfo').textContent=`${mode[1]} · ${visible.size} nodos visibles`;let message='';if(state.mode==='impact'&&!state.selected)message='<b>Selecciona un archivo</b>El modo Impacto dibuja su radio de dependencias y consumidores directos.';if(state.mode==='changes'&&!changed.size)message='<b>Proyecto sin cambios pendientes</b>Git no reportó archivos modificados al construir este mapa.';if(!visible.size&&!message)message='<b>Sin resultados</b>Ajusta la búsqueda o los filtros para recuperar nodos.';modeEmpty.innerHTML=message;modeEmpty.classList.toggle('show',!!message)}
function setMode(name){state.mode=name;document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===name));if(name==='impact'&&state.selected)focusSelected();else applyView();updateHash()}
function focusSelected(){applyView();if(!state.selected)return;node.classed('dim',d=>!nearSelected(d));link.classed('dim',e=>edgeId(e.source)!==state.selected.id&&edgeId(e.target)!==state.selected.id)}
function listing(title,items,cls=''){return items?.length?`<div class="section"><span class="label">${title}</span><div class="list">${items.slice(0,30).map(x=>`<div class="item ${cls}">${esc(x)}</div>`).join('')}</div></div>`:''}
function renderDetails(d){empty.classList.add('hidden');detailsBox.classList.remove('hidden');const i=impact[d.label]||{},ds=i.diagnostics||[];detailsBox.innerHTML=`<div class="path">${esc(d.label)}</div><h2 class="title">${esc(d.label.split('/').pop())}</h2><div class="pills"><span class="pill">${esc(d.ext||'archivo')}</span><span class="pill">${esc(d.folder)}</span>${d.in_cycle?'<span class="pill">En ciclo</span>':''}${changed.has(d.label)?'<span class="pill">Modificado</span>':''}</div>${d.purpose?`<p class="purpose">${esc(d.purpose)}</p>`:''}<div class="details-actions"><button id="impactBtn" class="primary">Ver impacto</button><button id="copyBtn">Copiar ruta</button></div><div class="metrics section"><div class="metric"><b>${d.degree}</b><span>Relaciones</span></div><div class="metric"><b>${d.risk_score}</b><span>Riesgo</span></div><div class="metric"><b>${d.loc}</b><span>Líneas</span></div><div class="metric"><b>${d.symbols?.length||0}</b><span>Símbolos</span></div></div>${listing('Colecciones Firebase',i.firestore_collections)}${listing('Consumido por',i.used_by)}${listing('Depende de',i.depends_on)}${listing('Exports',d.exports)}${listing('Diagnósticos',ds.map(x=>x.severity.toUpperCase()+' · '+x.message),ds.some(x=>x.severity==='error')?'error':'warn')}`;$('#impactBtn').onclick=()=>setMode('impact');$('#copyBtn').onclick=()=>copyText(d.label)}
function selectNode(d,record=false){state.selected=d;node.selectAll('circle').classed('selected',n=>n.id===d.id);renderDetails(d);renderCrumbs(d);if(record)addHistory(d);if(state.mode==='impact')focusSelected();else applyView();centerNode(d);updateHash()}
function centerNode(d){const scale=1.25;svg.transition().duration(480).call(zoom.transform,d3.zoomIdentity.translate(w()/2-d.x*scale,h()/2-d.y*scale).scale(scale))}
function addHistory(d){state.history=state.history.filter(x=>x.id!==d.id);state.history.unshift(d);state.history=state.history.slice(0,7);state.historyIndex=0;renderHistory()}
function renderHistory(){$('#history').innerHTML=state.history.length?state.history.map(d=>`<button class="history-item" data-id="${esc(d.id)}">${esc(d.label)}</button>`).join(''):'<div class="empty">Aún no has inspeccionado archivos.</div>';document.querySelectorAll('.history-item').forEach(b=>b.onclick=()=>selectNode(data.nodes.find(d=>d.id===b.dataset.id)))}
function renderCrumbs(d){const parts=d.label.split('/'),chunks=['proyecto',...parts];$('#crumbs').innerHTML=chunks.map((x,i)=>`<span class="crumb" data-index="${i}">${esc(x)}</span>`).join('<span>›</span>');document.querySelectorAll('.crumb').forEach(c=>c.onclick=()=>{const i=+c.dataset.index;if(i===0){folder.value='';q.value=''}else if(i<chunks.length-1){folder.value=parts[0]}else{q.value=d.label}applyView()})}
function renderSuggestions(){const s=q.value.trim().toLowerCase();if(!s){suggestions.classList.remove('open');return}const found=data.nodes.filter(d=>searchMatch(d,s)).sort((a,b)=>a.label.length-b.label.length).slice(0,8);suggestions.innerHTML=found.map(d=>`<div class="suggestion" data-id="${esc(d.id)}">${esc(d.label)}</div>`).join('');suggestions.classList.toggle('open',!!found.length);document.querySelectorAll('.suggestion').forEach(x=>x.onclick=()=>{const d=data.nodes.find(n=>n.id===x.dataset.id);q.value=d.label;suggestions.classList.remove('open');selectNode(d,true)})}
function clearSelection(){state.selected=null;node.selectAll('circle').classed('selected',false);detailsBox.classList.add('hidden');empty.classList.remove('hidden');$('#crumbs').innerHTML='<span class="crumb">proyecto</span>';applyView();updateHash()}
function resetAll(){q.value='';folder.value='';relation.value='';suggestions.classList.remove('open');clearSelection();if(state.mode==='impact')setMode('architecture')}
function fitAll(){const visible=node.filter(function(){return !this.classList.contains('hidden')});if(!visible.size())return;const holder=g.append('g');visible.each(function(){holder.node().appendChild(this.cloneNode(true))});const b=holder.node().getBBox();holder.remove();if(!b.width)return;const scale=Math.min(1.15,Math.min(w()/b.width,h()/b.height)*.76),x=w()/2-scale*(b.x+b.width/2),y=h()/2-scale*(b.y+b.height/2);svg.transition().duration(600).call(zoom.transform,d3.zoomIdentity.translate(x,y).scale(scale))}
function updateMini(){const xs=data.nodes.map(d=>d.x||0),ys=data.nodes.map(d=>d.y||0),sx=d3.scaleLinear().domain(d3.extent(xs)).range([9,171]),sy=d3.scaleLinear().domain(d3.extent(ys)).range([19,103]);miniNodes.attr('cx',d=>sx(d.x||0)).attr('cy',d=>sy(d.y||0))}
function updateHash(){const p=new URLSearchParams();if(state.mode!=='architecture')p.set('mode',state.mode);if(state.selected)p.set('file',state.selected.id);history.replaceState(null,'','#'+p.toString())}
function restoreHash(){const p=new URLSearchParams(location.hash.slice(1)),m=p.get('mode'),file=p.get('file');if(m&&modes.some(x=>x[0]===m))setMode(m);if(file){const d=data.nodes.find(n=>n.id===file);if(d)setTimeout(()=>selectNode(d),700)}}
function copyText(text){navigator.clipboard?.writeText(text).then(()=>toast('Ruta copiada')).catch(()=>toast(text))}function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1700)}
function toggleHelp(open){$('#shortcuts').classList.toggle('open',open??!$('#shortcuts').classList.contains('open'))}
q.addEventListener('input',()=>{renderSuggestions();applyView()});[folder,relation].forEach(x=>x.addEventListener('change',applyView));document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))suggestions.classList.remove('open')});document.querySelectorAll('.mode').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$('#reset').onclick=resetAll;$('#fit').onclick=$('#fitMini').onclick=fitAll;$('#zoomIn').onclick=()=>svg.transition().call(zoom.scaleBy,1.35);$('#zoomOut').onclick=()=>svg.transition().call(zoom.scaleBy,.74);$('#fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();$('#help').onclick=()=>toggleHelp();$('#closeHelp').onclick=()=>toggleHelp(false);$('#shortcuts').onclick=e=>{if(e.target.id==='shortcuts')toggleHelp(false)};
document.addEventListener('keydown',e=>{if(e.target.matches('input,select')){if(e.key==='Escape'){e.target.blur();suggestions.classList.remove('open')}return}if(e.key==='/'){e.preventDefault();q.focus()}else if(e.key==='Escape')resetAll();else if(e.key.toLowerCase()==='f')fitAll();else if(e.key==='?')toggleHelp();else if(e.key.toLowerCase()==='g')$('#fullscreen').click();else if(/^[1-6]$/.test(e.key))setMode(modes[+e.key-1][0]);else if(['ArrowLeft','ArrowRight'].includes(e.key)){const i=modes.findIndex(x=>x[0]===state.mode)+(e.key==='ArrowRight'?1:-1);setMode(modes[(i+modes.length)%modes.length][0])}});
svg.on('dblclick.zoom',null).on('dblclick',clearSelection);sim.on('tick',()=>{link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);node.attr('transform',d=>`translate(${d.x},${d.y})`)}).on('end',updateMini);setInterval(updateMini,1500);setTimeout(()=>{fitAll();restoreHash()},1400);addEventListener('resize',()=>sim.force('center',d3.forceCenter(w()/2,h()/2)).alpha(.2).restart());applyView();
</script></body></html>"""


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
    outgoing = [e for e in graph["edges"] if e["source"] == tid]
    incoming = [e for e in graph["edges"] if e["target"] == tid]
    id_to_label = {n["id"]: n["label"] for n in graph["nodes"]}

    print(f"\n=== {target_label} ===")
    node = next(n for n in graph["nodes"] if n["id"] == tid)
    if node["purpose"]:
        print(f"Proposito: {node['purpose']}")
    if node["exports"]:
        print(f"Exporta: {', '.join(node['exports'])}")
    print(f"Riesgo: {node['risk_score']}  (en ciclo: {'SI' if node['in_cycle'] else 'no'})")

    print(f"\nRelaciones SALIENTES ({len(outgoing)}):")
    for edge in outgoing:
        detail = edge.get("detail", {})
        suffix = f" ({detail.get('symbol')})" if detail.get("symbol") else ""
        print(f"  -> [{edge['type']}] {id_to_label.get(edge['target'], edge['target'])}{suffix}")

    print(f"\nRelaciones ENTRANTES / RADIO DE IMPACTO ({len(incoming)}):")
    for edge in incoming:
        print(f"  <- [{edge['type']}] {id_to_label.get(edge['source'], edge['source'])}")

    collections = node.get("firestore_collections", [])
    if collections:
        print(f"\nColecciones Firestore: {', '.join(collections)}")

    node_diagnostics = graph.get("impact_index", {}).get(target_label, {}).get("diagnostics", [])
    if not node_diagnostics:
        node_diagnostics = [item for item in graph.get("diagnostics", []) if item.get("file") == target_label]
    if node_diagnostics:
        print(f"\nDiagnosticos ({len(node_diagnostics)}):")
        for item in node_diagnostics:
            where = f":{item['line']}" if item.get("line") else ""
            print(f"  ! {item['severity'].upper()} {target_label}{where}: {item['message']}")

    related_implicit = [l for l in graph["possible_implicit_links"]
                         if l["define_en"] == target_label or l["usado_en"] == target_label]
    if related_implicit:
        print(f"\nPosibles acoples implicitos (via window.X, sin confirmar):")
        for l in related_implicit:
            print(f"  ~ {l['variable']}: definido en {l['define_en']}, usado en {l['usado_en']}")

    print(f"\nRECOMENDACION: si vas a modificar {target_label}, considera pasar tambien:")
    all_related = {id_to_label.get(e["target"], e["target"]) for e in outgoing}
    all_related |= {id_to_label.get(e["source"], e["source"]) for e in incoming}
    all_related |= {l["define_en"] for l in related_implicit} | {l["usado_en"] for l in related_implicit}
    all_related.discard(target_label)
    for r in sorted(all_related):
        print(f"  - {r}")
    if not all_related:
        print("  (ninguno mas — este archivo esta aislado)")


def atomic_write_text(path: Path, content: str):
    """Publica el archivo completo sólo cuando la generación terminó correctamente."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


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
        json_path = out_dir / "GraphCompleto.json"
        if not json_path.exists():
            json_path = out_dir / "graph.json"
        if not json_path.exists():
            print(f"No existe {json_path} todavia. Corre primero sin --lookup para generarlo.")
            sys.exit(1)
        graph = json.loads(json_path.read_text(encoding="utf-8"))
        do_lookup(graph, args.lookup)
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Analizando: {root}")
    graph = build_graph(root, ignored_paths={out_dir.resolve()})
    views = build_graph_views(graph, root, ignored_paths={out_dir.resolve()})
    compact, complete, deep = views["compact"], views["complete"], views["deep"]

    serialized = {
        "GraphCompacto.json": json.dumps(compact, indent=2, ensure_ascii=False),
        "GraphCompleto.json": json.dumps(complete, indent=2, ensure_ascii=False),
        "GraphProfundo.json": json.dumps(deep, indent=2, ensure_ascii=False),
    }
    for filename, content in serialized.items():
        atomic_write_text(out_dir / filename, content)
    write_report(graph, out_dir / "REPORTE.md", root.name, views)
    agents_path = root / "AGENTS.md"
    if agents_path.is_file() and agents_path.resolve() != (out_dir / "AGENTS.md").resolve():
        atomic_write_text(out_dir / "AGENTS.md", agents_path.read_text(encoding="utf-8"))

    id_by_label = {n["label"]: n["id"] for n in graph["nodes"]}
    cycle_edges = set()
    for cyc in graph["circular_dependencies"]:
        for i in range(len(cyc) - 1):
            a, b = id_by_label.get(cyc[i]), id_by_label.get(cyc[i+1])
            if a and b:
                cycle_edges.add(f"{a}::{b}")

    visual_edges = []
    for edge in graph["edges"]:
        item = dict(edge)
        item["in_cycle"] = f"{edge['source']}::{edge['target']}" in cycle_edges
        visual_edges.append(item)
    visual_payload = {
        "nodes": graph["nodes"], "edges": visual_edges,
        "stats": graph["stats"], "impact": graph["impact_index"],
        "diagnostics": graph["diagnostics"], "fingerprint": graph["project_fingerprint"],
        "generatedAt": graph["generated_at"], "git": complete.get("git", {}),
    }
    embedded_json = json.dumps(visual_payload, ensure_ascii=False).replace("</", "<\\/")
    html = HTML_TEMPLATE.replace("__TITLE__", root.name).replace("__DATA_JSON__", embedded_json)
    atomic_write_text(out_dir / "graph.html", html)

    s = complete["stats"]
    print(f"\nListo.")
    print(f"  Archivos: {s['total_files']}  |  Conexiones: {s['total_edges']}  |  Ciclos: {s['total_cycles']}  |  "
          f"Huerfanos: {s['total_orphans']}  |  Acoples implicitos posibles: {s['total_possible_implicit_links']}")
    print(f"  Simbolos: {s['total_symbols']}  |  Relaciones tipadas: {s['total_edges']}  |  "
          f"Diagnosticos: {s['errors']} errores, {s['warnings']} advertencias")
    print(f"  Huella: {complete['project_fingerprint'][:16]}...  |  Esquema: v{complete['schema_version']}")
    print("\n  Cerebro IA (un análisis, tres niveles):")
    print(f"  -> {out_dir / 'GraphCompacto.json'}  (~{compact['estimated_tokens']:,} tokens)")
    print(f"  -> {out_dir / 'GraphCompleto.json'}  (~{complete['estimated_tokens']:,} tokens)")
    print(f"  -> {out_dir / 'GraphProfundo.json'}  (~{deep['estimated_tokens']:,} tokens)")
    print(f"  -> {out_dir / 'graph.html'}")
    print(f"  -> {out_dir / 'REPORTE.md'}")
    if (out_dir / "AGENTS.md").is_file():
        print(f"  -> {out_dir / 'AGENTS.md'}  (copia para compartir con otra IA)")
    print(f"\n  Tip: 'python AlphaToolGraph.py {args.path} --lookup panel/auth.js' "
          f"te dice al toque con que se conecta un archivo, sin abrir el JSON.")


if __name__ == "__main__":
    main()

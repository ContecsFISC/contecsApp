// =============================================
// CONTECS — Mapa del evento: maqueta 3D (Three.js)
// =============================================
// Convierte los planos (js/data/planos-edificio3.js) en una maqueta: cada
// espacio es un bloque extruido sobre la imagen del plano. La altura y el
// color cuentan qué pasa en el salón: bajo y blanco si está libre, de color
// si tiene actividades ese día y, si hay una actividad EN VIVO, un cristal
// alto que se va "llenando" según los asientos ocupados.
//
// No sabe nada de Firestore: mapa.js le pasa el estado de cada salón con
// actualizar(). Si el navegador no tiene WebGL o la librería no carga,
// crearVista3D devuelve null y mapa.js usa la vista 2D.

const ESCALA = 0.025;          // píxeles del plano -> unidades 3D
const ALTO_SALA = 2.2;          // cristal de un salón con actividad en vivo
const ALTURAS = {
  vivo: ALTO_SALA,
  programado: 1.0,
  finalizado: 0.45,
  cancelado: 0.35,
  libre: 0.55,
  vestibulo: 0.08,
  bano: 0.6,
  escalera: 0.9,
  servicio: 0.4,
};
const COLOR_FIJO = { bano: "#9cc7e8", escalera: "#b8c0c8", servicio: "#d5dad6", vestibulo: "#eef3ef" };
const COLOR_LIBRE = "#f7faf8";
const COLOR_SEL = "#ffc83d";
const SALTO_PISO = 9;

const ease = {
  salida: p => 1 - Math.pow(1 - p, 3),
  entradaSalida: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  rebote: p => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  },
};

function puntos(texto) {
  return String(texto).trim().split(/\s+/).map(par => par.split(",").map(Number));
}

export async function crearVista3D(contenedor, { planos, alElegir, reducido = false }) {
  let THREE, OrbitControls, CSS2DRenderer, CSS2DObject;
  try {
    THREE = await import("three");
    ({ OrbitControls } = await import("three/addons/controls/OrbitControls.js"));
    ({ CSS2DRenderer, CSS2DObject } = await import("three/addons/renderers/CSS2DRenderer.js"));
  } catch (e) {
    console.warn("Mapa 3D: no cargó Three.js, se usa la vista 2D.", e);
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    console.warn("Mapa 3D: sin WebGL, se usa la vista 2D.", e);
    return null;
  }
  const movil = window.matchMedia("(max-width: 760px)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, movil ? 1.5 : 2));
  renderer.shadowMap.enabled = !movil;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "mapa3d-lienzo";
  contenedor.appendChild(renderer.domElement);

  const etiquetas = new CSS2DRenderer();
  etiquetas.domElement.className = "mapa3d-etiquetas";
  contenedor.appendChild(etiquetas.domElement);

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  const controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.screenSpacePanning = false;
  controles.maxPolarAngle = Math.PI * 0.44;
  controles.minDistance = 6;
  controles.maxDistance = 90;

  escena.add(new THREE.HemisphereLight("#ffffff", "#c9d8cf", 1.15));
  const sol = new THREE.DirectionalLight("#ffffff", 1.6);
  sol.position.set(-18, 34, 22);
  sol.castShadow = !movil;
  sol.shadow.mapSize.set(1024, 1024);
  Object.assign(sol.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 });
  sol.shadow.bias = -0.0008;
  escena.add(sol);

  // ─── Animaciones ──────────────────────────────────────────────────────────
  const tweens = new Set();
  function animar(duracion, alAvanzar, { retraso = 0, curva = ease.salida } = {}) {
    if (reducido || duracion <= 0) { alAvanzar(1); return Promise.resolve(); }
    return new Promise(resolve => {
      tweens.add({ inicio: performance.now() + retraso, duracion, alAvanzar, curva, resolve });
    });
  }
  function avanzarTweens(ahora) {
    for (const tw of tweens) {
      const p = (ahora - tw.inicio) / tw.duracion;
      if (p < 0) continue;
      const fin = p >= 1;
      tw.alAvanzar(tw.curva(Math.min(1, p)));
      if (fin) { tweens.delete(tw); tw.resolve(); }
    }
  }

  // ─── Construcción de cada piso ────────────────────────────────────────────
  const pisos = new Map();     // id -> { grupo, salas: Map }
  const salasPorId = new Map(); // espacioId -> sala
  const cargadorTextura = new THREE.TextureLoader();

  function construirPiso(plano) {
    const grupo = new THREE.Group();
    grupo.visible = false;
    const ancho = plano.ancho * ESCALA;
    const alto = plano.alto * ESCALA;

    // Base de la maqueta y la imagen del plano encima.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(ancho + 1.2, 0.5, alto + 1.2),
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }),
    );
    base.position.y = -0.26;
    base.receiveShadow = true;
    grupo.add(base);

    const textura = cargadorTextura.load(plano.imagen);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const suelo = new THREE.Mesh(
      new THREE.PlaneGeometry(ancho, alto),
      new THREE.MeshStandardMaterial({ map: textura, transparent: true, opacity: 0.5, roughness: 1 }),
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.y = 0.005;
    suelo.receiveShadow = true;
    grupo.add(suelo);

    const salas = new Map();
    for (const esp of plano.espacios) {
      const [x1, y1, x2, y2] = esp.b;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const forma = new THREE.Shape(puntos(esp.p).map(([x, y]) => new THREE.Vector2((x - cx) * ESCALA, -(y - cy) * ESCALA)));
      const geo = new THREE.ExtrudeGeometry(forma, { depth: 1, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);

      // Baños, escaleras y servicios no se programan: solo dan contexto.
      const fijo = !["espacio", "vestibulo"].includes(esp.t);
      const colorInicial = COLOR_FIJO[esp.t] || COLOR_LIBRE;
      const material = new THREE.MeshStandardMaterial({
        color: colorInicial, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.95,
        emissive: new THREE.Color("#000000"),
      });
      const malla = new THREE.Mesh(geo, material);
      malla.position.set((cx - plano.ancho / 2) * ESCALA, 0, (cy - plano.alto / 2) * ESCALA);
      malla.scale.y = 0.001;
      malla.castShadow = !fijo;
      malla.receiveShadow = true;
      malla.userData.espacioId = esp.id;

      const bordes = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 35),
        new THREE.LineBasicMaterial({ color: "#2f4a3a", transparent: true, opacity: 0.35 }),
      );
      malla.add(bordes);

      // "Líquido" de ocupación dentro del cristal (solo en vivo).
      const relleno = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#00722e", roughness: 0.35, emissive: new THREE.Color("#000000") }));
      relleno.scale.set(0.9, 0.001, 0.9);
      relleno.visible = false;
      grupo.add(relleno);
      relleno.position.copy(malla.position);

      grupo.add(malla);

      let etiqueta = null;
      if (esp.t === "espacio" || esp.t === "vestibulo") {
        const div = document.createElement("button");
        div.type = "button";
        div.className = "etq3d";
        div.addEventListener("click", ev => { ev.stopPropagation(); alElegir?.(esp.id); });
        etiqueta = new CSS2DObject(div);
        etiqueta.position.set(malla.position.x, 0.6, malla.position.z);
        etiqueta.visible = false;
        grupo.add(etiqueta);
      }

      const sala = {
        id: esp.id, tipo: esp.t, malla, material, bordes, relleno, etiqueta,
        alto: ALTURAS[esp.t] ?? ALTURAS.libre, ratio: 0, estado: fijo ? "fijo" : "libre",
        hover: false, vivo: false, color: new THREE.Color(colorInicial),
      };
      salas.set(esp.id, sala);
      salasPorId.set(esp.id, sala);
    }
    escena.add(grupo);
    return { grupo, salas, ancho, alto };
  }

  function pisoDe(id) {
    if (!pisos.has(id)) {
      const plano = planos.find(p => p.id === id);
      if (!plano) return null;
      pisos.set(id, construirPiso(plano));
    }
    return pisos.get(id);
  }

  // ─── Estado de los salones ────────────────────────────────────────────────
  const colorTemp = new THREE.Color();
  function aplicarEstado(sala, est, { retraso = 0, duracion = 700 } = {}) {
    const estado = sala.estado === "fijo" ? "fijo" : est?.estado || "libre";
    // Libres o fijos usan la altura de su tipo (un vestíbulo libre es casi plano).
    const altoNuevo = estado === "fijo" || (estado === "libre" && ALTURAS[sala.tipo] != null && sala.tipo !== "espacio")
      ? (ALTURAS[sala.tipo] ?? 0.4)
      : ALTURAS[estado] ?? ALTURAS.libre;
    const colorNuevo = new THREE.Color(est?.color || COLOR_FIJO[sala.tipo] || COLOR_LIBRE);
    const ratioNuevo = Math.max(0, Math.min(1, est?.ratio ?? 0));
    const vivo = estado === "vivo";

    const desde = { alto: sala.malla.scale.y, ratio: sala.relleno.visible ? sala.relleno.scale.y / ALTO_SALA : 0, color: sala.material.color.clone() };
    sala.estado = estado;
    sala.vivo = vivo;
    sala.alto = altoNuevo;
    sala.ratio = ratioNuevo;
    sala.color.copy(colorNuevo);
    sala.material.opacity = vivo ? 0.28 : estado === "finalizado" || estado === "cancelado" ? 0.7 : 0.95;
    sala.material.depthWrite = !vivo;
    sala.relleno.visible = vivo;
    sala.relleno.material.color.copy(colorNuevo);
    sala.bordes.material.opacity = vivo ? 0.8 : 0.35;
    sala.bordes.material.color.set(vivo ? colorNuevo : "#2f4a3a");

    if (sala.etiqueta) {
      const div = sala.etiqueta.element;
      const mostrar = Boolean(est?.rotulo) && estado !== "fijo";
      sala.etiqueta.visible = mostrar && sala.malla.parent?.visible !== false;
      sala.etiqueta.userData.mostrar = mostrar;
      div.className = `etq3d etq3d-${estado}`;
      div.style.setProperty("--c", est?.color || "#00722e");
      div.innerHTML = "";
      const rot = document.createElement("span");
      rot.className = "etq3d-rotulo";
      rot.textContent = est?.rotulo || "";
      div.appendChild(rot);
      if (est?.chip) {
        const chip = document.createElement("span");
        chip.className = "etq3d-chip";
        chip.textContent = est.chip;
        div.appendChild(chip);
      }
      div.setAttribute("aria-label", est?.titulo || est?.rotulo || "Salón");
    }

    return animar(duracion, p => {
      sala.malla.scale.y = Math.max(0.001, desde.alto + (altoNuevo - desde.alto) * p);
      sala.material.color.copy(colorTemp.copy(desde.color).lerp(colorNuevo, p));
      if (vivo) sala.relleno.scale.y = Math.max(0.001, (desde.ratio + (ratioNuevo - desde.ratio) * p) * ALTO_SALA);
      if (sala.etiqueta) sala.etiqueta.position.y = sala.malla.scale.y + 0.35;
    }, { retraso, curva: retraso ? ease.rebote : ease.salida });
  }

  // ─── Cámara ───────────────────────────────────────────────────────────────
  function encuadre(piso) {
    const lado = Math.max(piso.ancho, piso.alto);
    return { pos: new THREE.Vector3(0, lado * 0.72, lado * 0.78), objetivo: new THREE.Vector3(0, 0, 0) };
  }

  function volarA(pos, objetivo, duracion = 1100) {
    const p0 = camara.position.clone();
    const o0 = controles.target.clone();
    return animar(duracion, p => {
      camara.position.lerpVectors(p0, pos, p);
      controles.target.lerpVectors(o0, objetivo, p);
    }, { curva: ease.entradaSalida });
  }

  // ─── Interacción ──────────────────────────────────────────────────────────
  const rayo = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  let pisoActual = null;
  let seleccion = null;
  let sobre = null;
  let presion = null;

  function salaBajo(evento) {
    if (!pisoActual) return null;
    const r = renderer.domElement.getBoundingClientRect();
    puntero.set(((evento.clientX - r.left) / r.width) * 2 - 1, -((evento.clientY - r.top) / r.height) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    const mallas = [...pisoActual.salas.values()].filter(s => s.estado !== "fijo").map(s => s.malla);
    const hit = rayo.intersectObjects(mallas, false)[0];
    return hit ? salasPorId.get(hit.object.userData.espacioId) : null;
  }

  renderer.domElement.addEventListener("pointermove", e => {
    const sala = salaBajo(e);
    if (sobre && sobre !== sala) sobre.hover = false;
    sobre = sala;
    if (sala) sala.hover = true;
    renderer.domElement.style.cursor = sala ? "pointer" : "grab";
  });
  renderer.domElement.addEventListener("pointerleave", () => { if (sobre) sobre.hover = false; sobre = null; });
  renderer.domElement.addEventListener("pointerdown", e => { presion = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener("pointerup", e => {
    // Arrastrar para girar no es un clic.
    if (!presion || Math.hypot(e.clientX - presion.x, e.clientY - presion.y) > 6) return;
    const sala = salaBajo(e);
    alElegir?.(sala ? sala.id : null);
  });

  // ─── Bucle de dibujo ──────────────────────────────────────────────────────
  let corriendo = true;
  let cuadro = 0;
  function dibujar(ahora) {
    if (!corriendo) return;
    cuadro = requestAnimationFrame(dibujar);
    if (document.hidden) return;
    avanzarTweens(ahora);
    const pulso = 0.5 + 0.5 * Math.sin(ahora / 420);
    for (const sala of salasPorId.values()) {
      const elegido = sala === seleccion;
      const objetivo = elegido ? 0.35 : sala.hover ? 0.18 : 0;
      sala.malla.position.y += (objetivo - sala.malla.position.y) * 0.18;
      sala.relleno.position.y = sala.malla.position.y;
      if (sala.etiqueta) sala.etiqueta.position.y = sala.malla.scale.y + sala.malla.position.y + 0.35;
      const brillo = elegido ? 0.35 : sala.vivo ? 0.12 + 0.22 * pulso : sala.hover ? 0.12 : 0;
      sala.material.emissive.copy(elegido ? colorTemp.set(COLOR_SEL) : sala.color).multiplyScalar(brillo);
      if (sala.vivo) sala.relleno.material.emissive.copy(sala.color).multiplyScalar(0.15 + 0.2 * pulso);
      if (elegido) sala.bordes.material.color.set(COLOR_SEL);
    }
    controles.update();
    renderer.render(escena, camara);
    etiquetas.render(escena, camara);
  }

  function redimensionar() {
    const { clientWidth: w, clientHeight: h } = contenedor;
    if (!w || !h) return;
    renderer.setSize(w, h);
    etiquetas.setSize(w, h);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  const observador = new ResizeObserver(redimensionar);
  observador.observe(contenedor);
  redimensionar();
  cuadro = requestAnimationFrame(dibujar);

  // ─── API para mapa.js ─────────────────────────────────────────────────────
  let primeraVez = true;
  let ultimoEstado = new Map();

  async function mostrarPiso(id) {
    const nuevo = pisoDe(id);
    if (!nuevo || nuevo === pisoActual) return;
    const anterior = pisoActual;
    pisoActual = nuevo;
    seleccion = null;

    if (anterior) {
      const g = anterior.grupo;
      animar(500, p => { g.position.y = -SALTO_PISO * p; }, { curva: ease.entradaSalida }).then(() => {
        if (pisoActual !== anterior) {
          g.visible = false;
          anterior.salas.forEach(s => { if (s.etiqueta) s.etiqueta.visible = false; });
        }
      });
    }

    nuevo.grupo.visible = true;
    nuevo.grupo.position.y = anterior ? SALTO_PISO : 0;
    nuevo.salas.forEach(s => { s.malla.scale.y = 0.001; if (s.relleno.visible) s.relleno.scale.y = 0.001; });
    const { pos, objetivo } = encuadre(nuevo);
    if (primeraVez) {
      // Entrada: la cámara baja desde arriba mientras la maqueta "crece".
      camara.position.set(0.01, Math.max(nuevo.ancho, nuevo.alto) * 1.6, 0.02);
      controles.target.set(0, 0, 0);
      volarA(pos, objetivo, 2200);
      primeraVez = false;
    } else {
      volarA(pos, objetivo, 900);
      await animar(600, p => { nuevo.grupo.position.y = SALTO_PISO * (1 - p); }, { curva: ease.entradaSalida });
    }
    // Cada bloque crece con un pequeño retraso según su distancia al centro.
    const diag = Math.hypot(nuevo.ancho, nuevo.alto) / 2;
    nuevo.salas.forEach(sala => {
      const d = Math.hypot(sala.malla.position.x, sala.malla.position.z) / diag;
      sala.malla.scale.y = 0.001;
      const est = ultimoEstado.get(sala.id);
      sala.firma = JSON.stringify(est || null);
      aplicarEstado(sala, est, { retraso: 120 + d * 650, duracion: 650 });
    });
  }

  function actualizar(estados) {
    ultimoEstado = estados;
    if (!pisoActual) return;
    pisoActual.salas.forEach(sala => {
      const est = estados.get(sala.id);
      // Solo se anima lo que cambió (cada 30 s llega el estado completo).
      const firma = JSON.stringify(est || null);
      if (sala.firma === firma) return;
      sala.firma = firma;
      aplicarEstado(sala, est);
    });
  }

  function seleccionar(id, { enfocar = true } = {}) {
    if (seleccion) seleccion.bordes.material.color.set(seleccion.vivo ? seleccion.color : "#2f4a3a");
    seleccion = id ? salasPorId.get(id) || null : null;
    if (!seleccion || !enfocar) return;
    const m = seleccion.malla.position;
    const objetivo = new THREE.Vector3(m.x, 0, m.z);
    const dir = camara.position.clone().sub(controles.target).normalize();
    volarA(objetivo.clone().add(dir.multiplyScalar(16)), objetivo, 900);
  }

  function reencuadrar() {
    if (!pisoActual) return;
    const { pos, objetivo } = encuadre(pisoActual);
    volarA(pos, objetivo, 900);
  }

  function destruir() {
    corriendo = false;
    cancelAnimationFrame(cuadro);
    observador.disconnect();
    controles.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    etiquetas.domElement.remove();
  }

  function pausar(pausado) {
    if (pausado) { corriendo = false; cancelAnimationFrame(cuadro); return; }
    if (!corriendo) { corriendo = true; redimensionar(); cuadro = requestAnimationFrame(dibujar); }
  }

  return { mostrarPiso, actualizar, seleccionar, reencuadrar, redimensionar, destruir, pausar };
}

# Mapa de arquitectura — t

- Generado: **2026-10-09T03:35:54.548583+00:00**
- AlphaToolGraph: **v4.0.0** · esquema **4**
- Huella del proyecto: `3b074a60a7d21830…`
- Archivos analizados: **197**
- Relaciones internas tipadas: **689**
- Símbolos detectados: **5174**
- Llamadas detectadas: **11476**
- IDs DOM definidos: **992**
- Paquetes externos usados: **31**
- Colecciones de Firestore detectadas: **29**
- Cloud Functions detectadas: **17**
- Archivos huerfanos: **71**
- Dependencias circulares: **0**
- Posibles acoples implicitos (via window.X, sin confirmar): **5**

- Diagnósticos: **0 errores · 0 advertencias**

## Cerebro para IA: tres niveles

- `GraphCompacto.json` — ~**12,219 tokens** · leer primero
- `GraphCompleto.json` — ~**64,136 tokens** · relaciones exactas
- `GraphProfundo.json` — ~**120,227 tokens** · evidencia exhaustiva
- Reducción estimada al empezar por el compacto: **89.8%** frente al profundo

## Diagnósticos de integridad

Hallazgos estáticos: deben confirmarse en código cuando intervienen rutas o valores dinámicos.

- 🔵 `js/modulos/voluntarios.js:329` — ID DOM opcional #sel-actividad no está en las páginas anfitrionas (uso protegido)

## Archivos de mayor RIESGO al modificar

Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.

- `js/core/auth.js` — riesgo 331.1 (conexiones: 164, 313 lineas)
- `js/core/seguridad.js` — riesgo 110.4 (conexiones: 55, 40 lineas)
- `panel/dashboard.html` — riesgo 108.4 (conexiones: 44, 2040 lineas)
- `panel/modulos/congreso/modulos_participantes.html` — riesgo 102.6 (conexiones: 40, 2262 lineas)
- `js/modulos/voluntarios.js` — riesgo 90.2 (conexiones: 29, 3071 lineas)
- `css/styles.css` — riesgo 76.3 (conexiones: 34, 831 lineas)
- `js/core/firebase-config.js` — riesgo 76.3 (conexiones: 38, 35 lineas)
- `js/modulos/inscripciones.js` — riesgo 73.6 (conexiones: 27, 1961 lineas)
- `js/core/permanencia.js` — riesgo 66.0 (conexiones: 32, 202 lineas)
- `panel/modulos/logistica/catalogo.html` — riesgo 62.9 (conexiones: 27, 893 lineas)
- `js/modulos/catalogo.js` — riesgo 59.5 (conexiones: 29, 150 lineas)
- `js/modulos/mapa.js` — riesgo 59.0 (conexiones: 25, 897 lineas)
- `js/core/iconos.js` — riesgo 56.9 (conexiones: 28, 88 lineas)
- `js/core/operaciones.js` — riesgo 56.5 (conexiones: 27, 255 lineas)
- `js/core/agenda-salones.js` — riesgo 55.1 (conexiones: 27, 107 lineas)

## God nodes (mas conectados) y que exponen

- `js/core/auth.js` — grado 164 | exporta: aplicarPermisosDom, cargarUsuario, cerrarSesion, escucharCambiosDeRol, esperarSesionLista, getUsuarioActual, guardRoute, loginConGoogle
- `js/core/seguridad.js` — grado 55 | exporta: escaparAtributo, escaparHtml, neutralizarFormulaHoja, urlHttpSegura, urlImagenSegura
- `panel/dashboard.html` — grado 44 | exporta: (sin exports detectados)
- `panel/modulos/congreso/modulos_participantes.html` — grado 40 | exporta: (sin exports detectados)
- `js/core/firebase-config.js` — grado 38 | exporta: analytics, app, auth, db, storage
- `css/styles.css` — grado 34 | exporta: (sin exports detectados)
- `js/core/permanencia.js` — grado 32 | exporta: MARGEN_APERTURA_MIN, PERMANENCIA_MINIMA_DEFECTO, checkpointsParaEscanear, contarValidas, enCurso, enPanama, estaCancelado, estaOperativo
- `js/modulos/catalogo.js` — grado 29 | exporta: ICONOS, ICONOS_CATEGORIA, ICONOS_PRODUCTO, TODOS_ICONOS, crearCategoria, crearProducto, desactivarProducto, editarCategoria
- `js/modulos/voluntarios.js` — grado 29 | exporta: (sin exports detectados)
- `js/core/iconos.js` — grado 28 | exporta: ICONOS_DISPONIBLES, estrellasImg, iconoComboImg, iconoImg, nombreIconoCombo, rutaIcono
- `js/core/agenda-salones.js` — grado 27 | exporta: RE_ESPACIO, ROTULO_MAX, TIPOS_PROGRAMABLES, buscarChoques, describirChoque, etiquetaSalon, nombrePiso, nombreSalon
- `js/core/operaciones.js` — grado 27 | exporta: ajustarStock, esperarAuthListo, formatearMoneda, registrarCompra, registrarMerma, registrarMovimientoFondo, registrarVenta, registrarVentaConMerma
- `js/modulos/inscripciones.js` — grado 27 | exporta: (sin exports detectados)
- `panel/modulos/logistica/catalogo.html` — grado 27 | exporta: (sin exports detectados)
- `js/modulos/mapa.js` — grado 25 | exporta: (sin exports detectados)

## 🟡 Posibles acoples implicitos (via variables globales `window.X`)

Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:

- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/voluntarios.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/actividadVentas.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/inscripciones.js`
- `window.eliminarActividad` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`
- `window.eliminarGira` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`

## Cloud Functions detectadas

- `functions/index.js`: accederGiraParticipante, accederParticipante, ejecutarOperacionFinanciera, ejecutarOperacionQr, eliminarParticipante, eliminarUsuario, enviarCorreoQrParticipante, importarParticipantes, liberarIdentidadParticipante, listarParticipantesParaGiras, marcarCheckpointGira, notificarNoSeleccionadosGira, notificarPagoAprobado, notificarParticipantesGira, registrarParticipante, subirFotoEfectivo, validarTokenSSO

## Archivos huerfanos

- `.claude/settings.json`
- `AGENTS.md`
- `assets/img/fisc-logo.png`
- `assets/img/utp-logo.png`
- `docs/Sprint 2 - bitacora_actualizaciones.md`
- `docs/arreglo-giras-correos.md`
- `docs/cambios recientes.md`
- `firebase.json`
- `firebase_rules/firebase_backup.json`
- `firebase_rules/firestore.indexes.json`
- `firebase_rules/firestore.rules`
- `firebase_rules/storage.rules`
- `functions/.eslintrc.js`
- `functions/package.json`
- `functions/templates/correo-no-seleccionado-gira.html`
- `functions/templates/correo-notificacion-gira.html`
- `functions/templates/correo-pago-aprobado.html`
- `functions/test/envios.test.js`
- `functions/test/permisos-reglas.integration.mjs`
- `icons/bebida-lata.svg`
- `img/iconos/activar.svg`
- `img/iconos/agua.svg`
- `img/iconos/bubble_tea.svg`
- `img/iconos/cafe.svg`
- `img/iconos/caja.svg`
- `img/iconos/cancelar.svg`
- `img/iconos/cat_bebidas.svg`
- `img/iconos/cat_comida.svg`
- `img/iconos/cat_dulces.svg`
- `img/iconos/cat_otros.svg`
- `img/iconos/cat_postres.svg`
- `img/iconos/cat_snacks.svg`
- `img/iconos/chocolate.svg`
- `img/iconos/combo.svg`
- `img/iconos/combo_hamburguesa_soda.svg`
- `img/iconos/combo_pizza_soda.svg`
- `img/iconos/desactivar.svg`
- `img/iconos/donut.svg`
- `img/iconos/dulce.svg`
- `img/iconos/dulce_alt.svg`
- ...y 31 mas

## Colecciones de Firestore y quien las usa

### `actividades_ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/ventaRapida.js`
- `js/modulos/voluntarios.js`
- `panel/modulos/finanzas/bitacora.html`

### `actividades_voluntarios`
- `functions/operaciones-qr.js`
- `js/modulos/informeActividad.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/mapa.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `asignaciones_voluntarios`
- `js/modulos/voluntarios.js`

### `asistencias_congreso`
- `functions/eliminaciones.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/mapa.js`
- `js/modulos/reportes_estadisticaCont.js`

### `asistencias_giras`
- `functions/eliminaciones.js`
- `functions/index.js`
- `functions/operaciones-qr.js`

### `asistencias_voluntarios`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`

### `categorias`
- `js/modulos/catalogo.js`
- `js/modulos/reporteFinancieroExcel.js`

### `checkpoints`
- `functions/eliminaciones.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/core/salones-firestore.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/mapa.js`
- `js/modulos/posper.js`
- `js/modulos/reportes_estadisticaCont.js`
- `panel/dashboard.html`

### `compras`
- `functions/operaciones-financieras.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `eventos`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/mapa.js`
- `js/modulos/posper.js`
- `js/modulos/randomizer.js`
- `js/modulos/randomizerint.js`
- `panel/dashboard.html`

### `fondos`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/dashboard.html`

### `fondos_entrada`
- `functions/operaciones-financieras.js`
- `js/modulos/detalleFondo.js`
- `js/modulos/fondo.js`
- `panel/modulos/finanzas/bitacora.html`

### `giras_voluntarios`
- `functions/eliminaciones.js`
- `functions/index.js`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRGiras.js`
- `js/modulos/voluntarios.js`

### `identificadores_participantes`
- `functions/eliminaciones.js`
- `functions/registro.js`
- `functions/test/importaciones.integration.js`

### `informes_actividad`
- `js/modulos/informeActividad.js`

### `inscripciones`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `inscripciones_checkpoint`
- `functions/eliminaciones.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/reportes_estadisticaCont.js`

### `limites_registro`
- `functions/index.js`

### `mermas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `movimientos_inventario`
- `functions/operaciones-financieras.js`
- `panel/modulos/finanzas/bitacora.html`

### `participantes`
- `functions/eliminaciones.js`
- `functions/importaciones.js`
- `functions/index.js`
- `functions/operaciones-qr.js`
- `functions/registro.js`
- `functions/test/importaciones.integration.js`
- `functions/test/operaciones-qr.integration.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- ...y 6 archivos mas

### `productos`
- `functions/operaciones-financieras.js`
- `js/modulos/actividadVentas.js`
- `js/modulos/catalogo.js`
- `js/modulos/compras.js`
- `js/modulos/compras2.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `js/modulos/ventaRapida.js`
- `panel/dashboard.html`
- `panel/modulos/finanzas/bitacora.html`
- ...y 1 archivos mas

### `reuniones`
- `js/modulos/agendarReunion.js`
- `js/modulos/minutaReunion.js`
- `js/modulos/minutas.js`
- `panel/dashboard.html`

### `rfid_participantes`
- `functions/eliminaciones.js`
- `functions/operaciones-qr.js`

### `salones`
- `js/core/salones-firestore.js`

### `solicitudes_actividad`
- `js/modulos/informeActividad.js`
- `js/modulos/solicitudActividad.js`
- `js/modulos/voluntarios.js`

### `usuarios`
- `functions/eliminaciones.js`
- `functions/importaciones.js`
- `functions/index.js`
- `functions/operaciones-financieras.js`
- `functions/operaciones-qr.js`
- `functions/test/importaciones.integration.js`
- `functions/test/operaciones-qr.integration.js`
- `functions/test/permisos-reglas.integration.mjs`
- `index.html`
- `js/core/auth.js`
- ...y 10 archivos mas

### `ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `voluntarios`
- `functions/operaciones-qr.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`
- `panel/dashboard.html`

## Cobertura de reglas de Firestore

- `actividades_ventas` — regla explícita · 7 operaciones detectadas
- `actividades_voluntarios` — regla explícita · 9 operaciones detectadas
- `asignaciones_voluntarios` — regla explícita · 3 operaciones detectadas
- `asistencias_congreso` — regla explícita · 5 operaciones detectadas
- `asistencias_giras` — regla explícita · 1 operaciones detectadas
- `asistencias_voluntarios` — regla explícita · 2 operaciones detectadas
- `categorias` — regla explícita · 4 operaciones detectadas
- `checkpoints` — regla explícita · 14 operaciones detectadas
- `compras` — regla explícita · 4 operaciones detectadas
- `comprobantes` — regla explícita · 0 operaciones detectadas
- `contadores` — regla explícita · 0 operaciones detectadas
- `eventos` — regla explícita · 12 operaciones detectadas
- `fondos` — regla explícita · 1 operaciones detectadas
- `fondos_entrada` — regla explícita · 6 operaciones detectadas
- `giras_voluntarios` — regla explícita · 5 operaciones detectadas
- `identificadores_participantes` — regla explícita · 0 operaciones detectadas
- `informes_actividad` — regla explícita · 2 operaciones detectadas
- `inscripciones` — regla explícita · 3 operaciones detectadas
- `inscripciones_checkpoint` — regla explícita · 7 operaciones detectadas
- `limites_registro` — regla explícita · 0 operaciones detectadas
- `mermas` — regla explícita · 3 operaciones detectadas
- `movimientos_inventario` — regla explícita · 1 operaciones detectadas
- `participantes` — regla explícita · 10 operaciones detectadas
- `productos` — regla explícita · 19 operaciones detectadas
- `reuniones` — regla explícita · 8 operaciones detectadas
- `rfid_participantes` — regla explícita · 1 operaciones detectadas
- `salones` — regla explícita · 3 operaciones detectadas
- `solicitudes_actividad` — regla explícita · 3 operaciones detectadas
- `usuarios` — regla explícita · 14 operaciones detectadas
- `ventas` — regla explícita · 4 operaciones detectadas
- `voluntarios` — regla explícita · 8 operaciones detectadas

## Tipos de relaciones

- `calls_imported_symbol`: 307
- `imports`: 222
- `navigates_to`: 65
- `loads_script`: 40
- `loads_stylesheet`: 34
- `loads_asset`: 21

## Paquetes/SDKs externos

- `crypto` — usado en 4 archivo(s)
- `firebase-admin/app` — usado en 5 archivo(s)
- `firebase-admin/auth` — usado en 2 archivo(s)
- `firebase-admin/firestore` — usado en 9 archivo(s)
- `firebase-admin/storage` — usado en 2 archivo(s)
- `firebase-functions/params` — usado en 1 archivo(s)
- `firebase-functions/v2/core` — usado en 1 archivo(s)
- `firebase-functions/v2/firestore` — usado en 1 archivo(s)
- `firebase-functions/v2/https` — usado en 7 archivo(s)
- `fs` — usado en 2 archivo(s)
- `https` — usado en 2 archivo(s)
- `https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js` — usado en 2 archivo(s)
- `https://contecsfisc.github.io/contecsApp/logocontecs.png` — usado en 4 archivo(s)
- `https://esm.sh/docx@9` — usado en 3 archivo(s)
- `https://esm.sh/qrcode@1.5.4` — usado en 1 archivo(s)
- `https://fonts.googleapis.com` — usado en 40 archivo(s)
- `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap` — usado en 40 archivo(s)
- `https://fonts.gstatic.com` — usado en 40 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js` — usado en 5 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js` — usado en 36 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js` — usado en 9 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js` — usado en 3 archivo(s)
- `node:assert/strict` — usado en 13 archivo(s)
- `node:module` — usado en 2 archivo(s)
- `path` — usado en 2 archivo(s)
- `three` — usado en 1 archivo(s)
- `three/addons/controls/OrbitControls.js` — usado en 1 archivo(s)
- `three/addons/renderers/CSS2DRenderer.js` — usado en 1 archivo(s)
- `vm` — usado en 1 archivo(s)

# Mapa de arquitectura — contecsApp

- Generado: **2026-10-09T16:06:56.552447+00:00**
- AlphaToolGraph: **v4.0.0** · esquema **4**
- Huella del proyecto: `ad624a9414605b47…`
- Archivos analizados: **219**
- Relaciones internas tipadas: **778**
- Símbolos detectados: **5904**
- Llamadas detectadas: **13191**
- IDs DOM definidos: **1133**
- Paquetes externos usados: **32**
- Colecciones de Firestore detectadas: **37**
- Cloud Functions detectadas: **24**
- Archivos huerfanos: **72**
- Dependencias circulares: **0**
- Posibles acoples implicitos (via window.X, sin confirmar): **5**

- Diagnósticos: **0 errores · 0 advertencias**

## Cerebro para IA: tres niveles

- `GraphCompacto.json` — ~**14,718 tokens** · leer primero
- `GraphCompleto.json` — ~**73,132 tokens** · relaciones exactas
- `GraphProfundo.json` — ~**137,070 tokens** · evidencia exhaustiva
- Reducción estimada al empezar por el compacto: **89.3%** frente al profundo

## Diagnósticos de integridad

Hallazgos estáticos: deben confirmarse en código cuando intervienen rutas o valores dinámicos.

- 🔵 `js/modulos/voluntarios.js:336` — ID DOM opcional #sel-actividad no está en las páginas anfitrionas (uso protegido)

## Archivos de mayor RIESGO al modificar

Combina: cuantas conexiones tiene, si esta metido en un ciclo, y su tamaño. Revisa estos primero.

- `js/core/auth.js` — riesgo 345.7 (conexiones: 171, 369 lineas)
- `js/core/seguridad.js` — riesgo 114.4 (conexiones: 57, 40 lineas)
- `panel/dashboard.html` — riesgo 110.4 (conexiones: 45, 2041 lineas)
- `panel/modulos/congreso/modulos_participantes.html` — riesgo 102.6 (conexiones: 40, 2262 lineas)
- `js/modulos/voluntarios.js` — riesgo 93.8 (conexiones: 30, 3229 lineas)
- `css/styles.css` — riesgo 80.3 (conexiones: 36, 831 lineas)
- `js/core/firebase-config.js` — riesgo 80.3 (conexiones: 40, 35 lineas)
- `js/modulos/credenciales.js` — riesgo 80.1 (conexiones: 36, 813 lineas)
- `js/modulos/inscripciones.js` — riesgo 74.5 (conexiones: 27, 2051 lineas)
- `js/modulos/gestorCredenciales.js` — riesgo 68.9 (conexiones: 31, 687 lineas)
- `js/core/permanencia.js` — riesgo 68.0 (conexiones: 33, 202 lineas)
- `panel/modulos/logistica/catalogo.html` — riesgo 62.9 (conexiones: 27, 893 lineas)
- `js/modulos/mapa.js` — riesgo 61.5 (conexiones: 26, 955 lineas)
- `js/modulos/catalogo.js` — riesgo 59.5 (conexiones: 29, 150 lineas)
- `js/core/permisos.js` — riesgo 57.8 (conexiones: 27, 376 lineas)

## God nodes (mas conectados) y que exponen

- `js/core/auth.js` — grado 171 | exporta: aplicarPermisosDom, cargarUsuario, cerrarSesion, escucharCambiosDeRol, esperarSesionLista, getUsuarioActual, guardRoute, loginConGoogle
- `js/core/seguridad.js` — grado 57 | exporta: escaparAtributo, escaparHtml, neutralizarFormulaHoja, urlHttpSegura, urlImagenSegura
- `panel/dashboard.html` — grado 45 | exporta: (sin exports detectados)
- `js/core/firebase-config.js` — grado 40 | exporta: analytics, app, auth, db, storage
- `panel/modulos/congreso/modulos_participantes.html` — grado 40 | exporta: (sin exports detectados)
- `css/styles.css` — grado 36 | exporta: (sin exports detectados)
- `js/modulos/credenciales.js` — grado 36 | exporta: LIMITES, TAMANOS, TEMAS, categoriaDe, codigoDe, descargarBlob, dibujarCredencial, generarPdf
- `js/core/permanencia.js` — grado 33 | exporta: MARGEN_APERTURA_MIN, PERMANENCIA_MINIMA_DEFECTO, checkpointsParaEscanear, contarValidas, enCurso, enPanama, estaCancelado, estaOperativo
- `js/modulos/gestorCredenciales.js` — grado 31 | exporta: (sin exports detectados)
- `js/modulos/voluntarios.js` — grado 30 | exporta: (sin exports detectados)
- `js/modulos/catalogo.js` — grado 29 | exporta: ICONOS, ICONOS_CATEGORIA, ICONOS_PRODUCTO, TODOS_ICONOS, crearCategoria, crearProducto, desactivarProducto, editarCategoria
- `js/core/iconos.js` — grado 28 | exporta: ICONOS_DISPONIBLES, estrellasImg, iconoComboImg, iconoImg, nombreIconoCombo, rutaIcono
- `js/core/agenda-salones.js` — grado 27 | exporta: RE_ESPACIO, ROTULO_MAX, TIPOS_PROGRAMABLES, buscarChoques, describirChoque, etiquetaSalon, nombrePiso, nombreSalon
- `js/core/operaciones.js` — grado 27 | exporta: ajustarStock, esperarAuthListo, formatearMoneda, registrarCompra, registrarMerma, registrarMovimientoFondo, registrarVenta, registrarVentaConMerma
- `js/core/permisos.js` — grado 27 | exporta: CATALOGO_PERMISOS, PERMISOS, ROLES, SUBPERMISOS, admiteAjustes, ajusteDePermiso, ajusteDelRol, infoRol

## 🟡 Posibles acoples implicitos (via variables globales `window.X`)

Esto es HEURISTICO, no certeza — revisalo a ojo antes de asumir que es real:

- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/actividadVentas.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/inscripciones.js`
- `window.XLSX` definida en `js/libs/xlsx.full.min.js`, leida en `js/modulos/voluntarios.js`
- `window.eliminarActividad` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`
- `window.eliminarGira` definida en `js/modulos/voluntarios.js`, leida en `docs/cambios recientes.md`

## Cloud Functions detectadas

- `functions/index.js`: accederGiraParticipante, accederParticipante, cambiarRolUsuario, desbloquearUsuarios, ejecutarOperacionFinanciera, ejecutarOperacionQr, eliminarEventoOCheckpoint, eliminarParticipante, eliminarUsuario, enviarCorreoQrParticipante, guardarPermisosRol, guardarPermisosUsuario, importarParticipantes, liberarIdentidadParticipante, listarParticipantesParaGiras, mapaPublico, marcarCheckpointGira, notificarNoSeleccionadosGira, notificarPagoAprobado, notificarParticipantesGira, registrarParticipante, registrarVoluntario, subirFotoEfectivo, validarTokenSSO

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
- ...y 32 mas

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
- `functions/mapa-publico.js`
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

### `cambios_permisos`
- `functions/permisos-admin.js`
- `functions/test/permisos-admin.integration.js`

### `cambios_rol`
- `functions/cambio-rol.js`
- `functions/test/cambio-rol.integration.js`

### `categorias`
- `js/modulos/catalogo.js`
- `js/modulos/reporteFinancieroExcel.js`

### `checkpoints`
- `functions/eliminaciones.js`
- `functions/eliminar-eventos.js`
- `functions/mapa-publico.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/core/salones-firestore.js`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/mapa.js`
- ...y 3 archivos mas

### `compras`
- `functions/operaciones-financieras.js`
- `functions/test/permisos-reglas.integration.mjs`
- `js/core/operaciones.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `config`
- `functions/permisos-admin.js`
- `js/core/auth.js`
- `js/modulos/usuarios.js`

### `credenciales_impresas`
- `js/modulos/gestorCredenciales.js`

### `eventos`
- `functions/eliminar-eventos.js`
- `functions/mapa-publico.js`
- `functions/operaciones-qr.js`
- `functions/test/operaciones-qr.integration.js`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`
- `js/modulos/lecturaQR.js`
- `js/modulos/mapa.js`
- `js/modulos/posper.js`
- `js/modulos/randomizer.js`
- ...y 2 archivos mas

### `expositores`
- `js/modulos/gestorCredenciales.js`

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

### `identificadores_voluntarios`
- `functions/registro-voluntarios.js`

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

### `intentos_cambio_rol`
- `functions/cambio-rol.js`

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
- `js/modulos/gestorCredenciales.js`
- `js/modulos/inscripciones.js`
- ...y 7 archivos mas

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

### `publico`
- `functions/mapa-publico.js`

### `reuniones`
- `js/modulos/agendarReunion.js`
- `js/modulos/minutaReunion.js`
- `js/modulos/minutas.js`
- `panel/dashboard.html`

### `rfid_participantes`
- `functions/eliminaciones.js`
- `functions/eliminar-eventos.js`
- `functions/operaciones-qr.js`

### `salones`
- `functions/mapa-publico.js`
- `js/core/salones-firestore.js`

### `solicitudes_actividad`
- `js/modulos/informeActividad.js`
- `js/modulos/solicitudActividad.js`
- `js/modulos/voluntarios.js`

### `usuarios`
- `functions/cambio-rol.js`
- `functions/eliminaciones.js`
- `functions/eliminar-eventos.js`
- `functions/importaciones.js`
- `functions/index.js`
- `functions/operaciones-financieras.js`
- `functions/operaciones-qr.js`
- `functions/permisos-admin.js`
- `functions/test/importaciones.integration.js`
- `functions/test/operaciones-qr.integration.js`
- ...y 13 archivos mas

### `ventas`
- `functions/operaciones-financieras.js`
- `js/modulos/reporteFinancieroExcel.js`
- `js/modulos/reportes_financieros.js`
- `panel/modulos/finanzas/bitacora.html`

### `voluntarios`
- `functions/operaciones-qr.js`
- `functions/registro-voluntarios.js`
- `functions/test/registro-voluntarios.integration.js`
- `js/modulos/gestorCredenciales.js`
- `js/modulos/lecturaQRVoluntarios.js`
- `js/modulos/reportes_estadisticaCont.js`
- `js/modulos/voluntarios.js`
- `panel/dashboard.html`

## Cobertura de reglas de Firestore

- `actividades_ventas` — regla explícita · 7 operaciones detectadas
- `actividades_voluntarios` — regla explícita · 9 operaciones detectadas
- `asignaciones_voluntarios` — regla explícita · 3 operaciones detectadas
- `asistencias_congreso` — regla explícita · 3 operaciones detectadas
- `asistencias_giras` — regla explícita · 1 operaciones detectadas
- `asistencias_voluntarios` — regla explícita · 2 operaciones detectadas
- `cambios_permisos` — regla explícita · 0 operaciones detectadas
- `cambios_rol` — regla explícita · 0 operaciones detectadas
- `categorias` — regla explícita · 4 operaciones detectadas
- `checkpoints` — regla explícita · 13 operaciones detectadas
- `compras` — regla explícita · 4 operaciones detectadas
- `comprobantes` — regla explícita · 0 operaciones detectadas
- `config` — regla explícita · 1 operaciones detectadas
- `contadores` — regla explícita · 0 operaciones detectadas
- `credenciales_impresas` — regla explícita · 3 operaciones detectadas
- `eventos` — regla explícita · 11 operaciones detectadas
- `expositores` — regla explícita · 5 operaciones detectadas
- `fondos` — regla explícita · 1 operaciones detectadas
- `fondos_entrada` — regla explícita · 6 operaciones detectadas
- `giras_voluntarios` — regla explícita · 5 operaciones detectadas
- `identificadores_participantes` — regla explícita · 0 operaciones detectadas
- `identificadores_voluntarios` — regla explícita · 0 operaciones detectadas
- `informes_actividad` — regla explícita · 2 operaciones detectadas
- `inscripciones` — regla explícita · 3 operaciones detectadas
- `inscripciones_checkpoint` — regla explícita · 6 operaciones detectadas
- `intentos_cambio_rol` — regla explícita · 0 operaciones detectadas
- `limites_registro` — regla explícita · 0 operaciones detectadas
- `mermas` — regla explícita · 3 operaciones detectadas
- `movimientos_inventario` — regla explícita · 1 operaciones detectadas
- `participantes` — regla explícita · 9 operaciones detectadas
- `productos` — regla explícita · 19 operaciones detectadas
- `publico` — regla explícita · 0 operaciones detectadas
- `reuniones` — regla explícita · 8 operaciones detectadas
- `rfid_participantes` — regla explícita · 1 operaciones detectadas
- `salones` — regla explícita · 3 operaciones detectadas
- `solicitudes_actividad` — regla explícita · 3 operaciones detectadas
- `usuarios` — regla explícita · 12 operaciones detectadas
- `ventas` — regla explícita · 4 operaciones detectadas
- `voluntarios` — regla explícita · 10 operaciones detectadas

## Tipos de relaciones

- `calls_imported_symbol`: 342
- `imports`: 271
- `navigates_to`: 66
- `loads_script`: 41
- `loads_stylesheet`: 36
- `loads_asset`: 22

## Paquetes/SDKs externos

- `crypto` — usado en 5 archivo(s)
- `firebase-admin/app` — usado en 9 archivo(s)
- `firebase-admin/auth` — usado en 2 archivo(s)
- `firebase-admin/firestore` — usado en 19 archivo(s)
- `firebase-admin/storage` — usado en 2 archivo(s)
- `firebase-functions/params` — usado en 1 archivo(s)
- `firebase-functions/v2/core` — usado en 1 archivo(s)
- `firebase-functions/v2/firestore` — usado en 1 archivo(s)
- `firebase-functions/v2/https` — usado en 11 archivo(s)
- `fs` — usado en 2 archivo(s)
- `https` — usado en 2 archivo(s)
- `https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js` — usado en 2 archivo(s)
- `https://contecsfisc.github.io/contecsApp/logocontecs.png` — usado en 4 archivo(s)
- `https://esm.sh/docx@9` — usado en 3 archivo(s)
- `https://esm.sh/qrcode@1.5.4` — usado en 1 archivo(s)
- `https://fonts.googleapis.com` — usado en 43 archivo(s)
- `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap` — usado en 43 archivo(s)
- `https://fonts.gstatic.com` — usado en 43 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js` — usado en 1 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js` — usado en 5 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js` — usado en 37 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js` — usado en 11 archivo(s)
- `https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js` — usado en 3 archivo(s)
- `node:assert/strict` — usado en 20 archivo(s)
- `node:module` — usado en 3 archivo(s)
- `path` — usado en 2 archivo(s)
- `readline` — usado en 1 archivo(s)
- `three` — usado en 1 archivo(s)
- `three/addons/controls/OrbitControls.js` — usado en 1 archivo(s)
- `three/addons/renderers/CSS2DRenderer.js` — usado en 1 archivo(s)
- `vm` — usado en 1 archivo(s)

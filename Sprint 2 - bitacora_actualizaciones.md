# CONTECS — Bitácora de Actualizaciones del Proyecto

**Repositorio:** MLGoodsg/PRUEBA  
**Proyecto original:** CONTECS-APP (por Alpha Vilchez)  
**Proyecto actualizado:** CONTECS-APP (por Maria Goods)  
**Fecha de desarrollo:** 8 de mayo de 2026  
**Desarrolladora:** Maria Goods (maria.goods@utp.ac.pa)  


---

## 1. Resumen

Este documento registra todas las modificaciones realizadas al proyecto CONTECS desde el commit inicial hasta el estado actual del repositorio. La segunda parte del trabajo se concentró en una sola jornada de desarrollo (8 de mayo de 2026), con **11 commits** que incluyen la creación del módulo 'Ajuste Inventario', 'Registro Ventas', 'Compras', 'Fondos', 'Detalle fondo'  y múltiples iteraciones de mejora sobre los módulos de compras, venta y inventario en las operaciones financieras.

### Cifras clave

| Concepto | Valor |
|----------|-------|
| Archivos en el proyecto recibido | 19 |
| Archivos en el proyecto actual | 27 |
| **Archivos nuevos creados** | **9** |
| **Archivos modificados** | **12** |
| Archivos renombrados por Maria | 1 |
| Total de líneas de código actuales | 5,341 |
| Commits realizados | 11 |

---

## 2. Proyecto (Línea Base)

### 2.1 Archivos del proyecto (Fase 1 y 2) (19 archivos)

| Archivo | Descripción |
|---------|-------------|
| `js/firebase-config.js` | Configuración Firebase (proyecto `contecs-utp`) |
| `js/auth.js` | Autenticación con Google OAuth |
| `js/permisos.js` | Motor de permisos por roles |
| `js/catalogo.js` | Catálogo con iconos anidados por categoría (~60 líneas de iconos) |
| `auth.js` (raíz) | Versión simplificada de autenticación |
| `index.html` | Página de login |
| `dashboard.html` | Panel principal |
| `catologo.html` | Catálogo de productos (con typo en el nombre) |
| `ventas.html` | **Placeholder**: "Módulo en construcción — Fase 3" |
| `compras.html` | **Placeholder**: "Módulo en construcción" |
| `fondos.html` | **Placeholder**: "Módulo en construcción" |
| `inventario.html` | Inventario (sin animaciones, ~320 líneas) |
| `bitacora.html` | Historial de cierres (estructura base) |
| `usuarios.html` | Gestión de usuarios |
| `exportar.html` | Exportación (estructura mínima) |
| `reportes.html` | Reportes (estructura base) |
| `css/styles.css` | Estilos básicos (sin animaciones) |
| `icons/bebida-lata.svg` | Icono SVG de ejemplo |
| `README.md` | Documentación del proyecto |

### 2.2 Configuración Firebase

```
Proyecto: contecs-utp
Cuenta: alphamrv@gmail.com (personal de Alpha Vilchez)
Servicios: Firestore + Authentication
apiKey: AIzaSyDDx1wnAkSFz_KD390zGBZ6MCVTg2AUBqQ
```

### 2.3 Estado de las fases al recibir el proyecto

| Fase | Estado recibido |
|------|----------------|
| Fase 0 — Configuración | ✅ Completada por Alpha |
| Fase 1 — Autenticación y roles | ✅ Completada por Alpha |
| Fase 2 — Catálogo | Estructura base existente |
| Fase 3 — Ventas | ❌ Placeholder "en construcción" |
| Fase 4 — Inventario | Estructura existente (sin animaciones) |
| Fase 5 — Compras | ❌ Placeholder "en construcción" |
| Fase 6 — Fondos | ❌ Placeholder "en construcción" |
| Fase 7 — Bitácora | Estructura mínima |
| Fase 8 — Dashboard y pulido | Pendiente |

---

## 3. Archivos Nuevos Creados (9 archivos)


### 3.1 Hoja de estilos global — `css/styles.css`

Se creó una hoja de estilos compartida completamente nueva con:
- Variables CSS de animación: `--ease-spring`, `--ease-out`, `--ease-in-out`
- 6 keyframes de animación: `pageSlideUp`, `fadeScaleIn`, `slideInLeft`, `cardCascade`, `modalBounceUp`, `pulseSoft`
- Animación de entrada en cascada para cards (`.card:nth-child(n)` con delays progresivos)
- Animación del container (`.container` con `pageSlideUp`)
- Animación del topbar (con `slideInLeft`)
- Clases reutilizables: `.anim-cascade`, `.anim-page-in`
- Mejoras en transiciones: botones con `translateY(-1px)` en hover, inputs con elevación en focus
- Alertas con animación `fadeScaleIn`
- Clases utilitarias: `.is-hidden`, `.fondo-estado`, `.topbar-link`

### 3.2 Página de ajustes de inventario — `ajustesInventario.html`

Página HTML completa (94 líneas) para que usuarios con permiso `ajustar_inventario` puedan modificar manualmente el stock de productos.

### 3.3 Página de detalle de fondo — `detalleFondo.html`

Página HTML (211 líneas) que muestra el historial detallado de movimientos del fondo con filtros.

### 3.4 Lógica de ajustes — `js/ajustes.js`

Módulo JavaScript (163 líneas) con:
- Búsqueda y filtrado de productos por categoría
- Selección visual de producto con estado de stock
- Formulario de ajuste (cantidad, tipo, motivo)
- Integración con `ajustarStock()` de operaciones.js

### 3.5 Lógica de compras — `js/compras.js`

Módulo JavaScript (482 líneas) — el más extenso del proyecto. Incluye:
- Carrito de compras con agregar/quitar/modificar cantidades
- Búsqueda de productos por nombre
- Sistema de carga de facturas con preview (imagen o PDF)
- Validación completa de formularios (frontend)
- Cálculo de subtotales por paquete/caja/artículo
- Integración con `registrarCompra()` de operaciones.js

### 3.6 Lógica de detalle de fondo — `js/detalleFondo.js`

Módulo JavaScript (216 líneas) con visualización de movimientos del fondo en tiempo real.

### 3.7 Lógica de fondos — `js/fondo.js`

Módulo JavaScript (172 líneas) con:
- Visualización de balance y movimientos
- Formulario de ingreso/egreso
- Integración con `registrarMovimientoFondo()` de operaciones.js

### 3.8 Motor de operaciones — `js/operaciones.js`

Módulo JavaScript (482 líneas) — el corazón transaccional del sistema. Incluye:
- **Transacciones atómicas de Firestore** para ventas, compras, ajustes y fondos
- `registrarVenta()`: Transacción con descuento de stock, registro de movimiento de inventario, movimiento de fondo
- `registrarCompra()`: Transacción con incremento de stock, upload de factura a Firebase Storage, registro de movimiento de fondo
- `ajustarStock()`: Transacción para ajustes manuales de inventario
- `registrarMovimientoFondo()`: Transacción para ingresos/egresos del fondo
- `subirFacturaAStorage()`: Upload de facturas a Firebase Storage con validación y metadata
- Funciones auxiliares: `formatearMoneda()`, `aNumero()`, validaciones, manejo de errores

### 3.9 Lógica de ventas — `js/ventas.js`

Módulo JavaScript (347 líneas) con:
- Carrito de ventas con selección de productos
- Registro de mermas con motivo
- Método de pago (efectivo/transferencia)
- Integración con `registrarVenta()` de operaciones.js

---

## 4. Archivos Renombrados (1 archivos)

| Nombre original | Nombre nuevo | Motivo |
|-----------------|-------------|--------|
| `catologo.html` | `catalogo.html` | Corrección de typo |

---

## 5. Archivos Modificados (12 archivos)

### 5.1 `js/firebase-config.js` — Migración de proyecto Firebase a modo de pruebas

Se migró temporalmente de la cuenta personal de Alpha Vilchez a un nuevo proyecto Firebase de pruebas:

| Campo | Valor original (contecs-utp) | Valor nuevo (contects-54be8) |
|-------|------------------------------|------------------------------|
| apiKey | `AIzaSyDDx1wnAkSFz_KD390z...` | `AIzaSyAXKnBgFf9XhtJol7wv...` |
| authDomain | `contecs-utp.firebaseapp.com` | `contects-54be8.firebaseapp.com` |
| projectId | `contecs-utp` | `contects-54be8` |
| storageBucket | `contecs-utp.firebasestorage.app` | `contects-54be8.firebasestorage.app` |

Se añadió también la integración con **Firebase Storage** (no existía en el proyecto original):
```javascript
+ import { getStorage } from "firebase-storage.js";
+ export const storage = getStorage(app);
```

### 5.2 `js/permisos.js` — Nuevos permisos

Se añadieron dos permisos al motor de roles:
```javascript
+ ajustar_inventario: ["junta", "finanzas", "logistica"],
+ gestionar_usuarios: ["ceo", "junta", "coordinador", "finanzas"],
```

### 5.3 `js/auth.js` — Reescritura mayor

El archivo original tenía autenticación básica. Sin embargo se decidió reescribir completamente (108 → 153 líneas):

**Nuevas funciones añadidas:**

| Función | Descripción |
|---------|-------------|
| `esErrorDePermisosFirestore(error)` | Detecta errores de permisos de Firestore |
| `manejarErrorAuth(error, contexto)` | Manejo centralizado de errores con logging contextual |
| `escucharCambiosDeRol(uid)` | Listener en tiempo real (`onSnapshot`) que recarga la página automáticamente cuando un admin cambia el rol del usuario |

**Mejoras en funciones existentes:**
- `guardRoute()`: Añadido `try/catch`, escucha de cambios de rol en tiempo real
- `cargarUsuario(user)`: Añadido **auto-registro** con `setDoc` — cuando un usuario inicia sesión por primera vez, se crea automáticamente su documento en Firestore con `rol: "sin_rol"`. Incluye fallback graceful si Firestore bloquea la operación
- `loginConGoogle()`: Envuelto en `try/catch` con manejo de errores centralizado

**Nuevas dependencias de Firestore:**
```javascript
// Antes:
import { doc, getDoc } from "firebase-firestore.js";

// Después:
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase-firestore.js";
```

### 5.4 `js/catalogo.js` — Simplificación de iconos

Se reemplazó el sistema de iconos anidado por categoría (~60 líneas de estructura compleja) por un sistema plano y simplificado:

```javascript
// Antes: estructura anidada por categoría
bebidas: [
  { id: "lata", emoji: "🥤", label: "Lata / Refresco" },
  { id: "botella", emoji: "🍶", label: "Botellas" },
  // ... ~60 líneas organizadas por categoría
]

// Después: 6 iconos genéricos de categoría + lista plana de ~50 emojis de producto
export const ICONOS_CATEGORIA = [
  { id: "cat_comida",  emoji: "🍔", label: "Comida" },
  { id: "cat_bebidas", emoji: "🥤", label: "Bebidas" },
  { id: "cat_dulces",  emoji: "🍬", label: "Dulces" },
  { id: "cat_snacks",  emoji: "🍿", label: "Snacks" },
  { id: "cat_postres", emoji: "🍰", label: "Postres" },
  { id: "cat_otros",   emoji: "📦", label: "Otros" },
];
export const ICONOS_PRODUCTO = [ /* ~50 emojis en lista plana */ ];
```

### 5.5 `compras.html` — De placeholder a módulo completo

Se reemplazó el placeholder "Módulo en construcción" por un módulo funcional completo:

**Eliminado:**
```html
<div class="card-title">Módulo en construcción</div>
<p>Próximamente disponible.</p>
```

**Añadido:**
- Panel de resumen del día con grid de tarjetas
- Listado dinámico de compras registradas
- Modal/formulario de registro de compra con:
  - Buscador de productos
  - Carrito con cantidades y subtotales
  - Campo de proveedor (obligatorio)
  - Método de pago (efectivo/transferencia)
  - Carga de factura (PDF/imagen con preview)
  - Notas de la compra
- `<script type="module" src="js/compras.js"></script>`

### 5.6 `ventas.html` — De placeholder a módulo completo

Se reemplazó el placeholder "Módulo en construcción — Fase 3" por un módulo funcional:

**Eliminado:**
```html
<div class="card-title">🧾 Cierre del día</div>
<p>Módulo en construcción — Fase 3</p>
```

**Añadido:**
- Toolbar de acciones
- Panel de resumen de ventas del día
- Grid de productos con emojis para selección
- Carrito de venta con total acumulado
- `<script type="module" src="js/ventas.js"></script>`

### 5.7 `fondos.html` — De placeholder a módulo completo

Se reemplazó el placeholder "Módulo en construcción" por un módulo funcional:

**Añadido:**
- Tarjetas de saldo por fondo
- Historial de movimientos en tiempo real
- Formulario de ingreso/egreso
- `<script type="module" src="js/fondo.js"></script>`

### 5.8 `exportar.html` — Añadida UI completa

Se añadió la interfaz completa de exportación:
- Selector de rango de fechas y módulo
- Vista previa de datos a exportar
- Botón de exportar a CSV
- Enlace a `css/styles.css` compartido

### 5.9 `dashboard.html` — Animaciones y manejo de errores

**Mejoras de diseño:**
- Animación `fadeScaleIn` en la bienvenida
- Animaciones en cascada para stat-cards (`.stat-card:nth-child(n)`)
- Sombra mejorada: `0 6px 20px` → `0 8px 28px`

**Mejoras funcionales:**
- Nueva función `manejarErrorSnapshot()`: manejo centralizado de errores Firestore
- Mecanismo de refresh de rol cambiado: `onSnapshot` dinámico → `getDoc` con `setInterval` cada 30 segundos
- Callbacks de error en todos los `onSnapshot` (fondos, alertas de stock, cierres)
- Manejo graceful de `permission-denied`

### 5.10 `inventario.html` — Animaciones y expansión mayor

El archivo creció significativamente (~320 → ~1050+ líneas según el Comparativo):
- Añadidas animaciones con `cardCascade` y `opacity: 0` inicial
- Nuevos filtros de búsqueda
- Vista de edición de productos
- Estilos y estructura completamente renovados

### 5.11 `catalogo.html` — Filtros y selectores de iconos

- Añadidos chips de filtro por categoría (`#filtro-categorias`)
- Selector de icono de categoría (`#select-icono-categoria` con `ICONOS_CATEGORIA`)
- Selector de icono de producto (`#select-icono-producto` con `ICONOS_PRODUCTO`)

### 5.12 `auth.js` (raíz) — Corrección de indentación

Se corrigió la indentación del archivo: se eliminaron 2 espacios extra al inicio de cada línea (45 líneas afectadas). Sin cambios funcionales.

---

## 6. Historial de Commits

Todos los commits fueron realizados por Maria Goods el 8 de mayo de 2026:

| # | Hash | Hora | Mensaje | Archivos | Descripción |
|---|------|------|---------|----------|-------------|
| 1 | `950ef74` | 12:09 | first commit | 27 | Commit inicial con todas las transformaciones del proyecto recibido |
| 2 | `a7167a9` | 13:04 | costo por paquete | 1 | Etiqueta "Costo unitario" → "Costo por paquete" en compras |
| 3 | `9f83bc2` | 14:39 | cambios generales | 3 | Reescritura de auth.js, manejo de errores en dashboard, ajustes en compras |
| 4 | `a432876` | 14:43 | algunos cambios | 2 | Ajustes menores en dashboard y compras |
| 5 | `da2b9c3` | 15:17 | ajuste en compras | 4 | **Integración de Firebase Storage**: upload de facturas, preview, validaciones |
| 6 | `e4a0137` | 15:20 | campos requeridos | 3 | Validaciones obligatorias: proveedor, método de pago, factura |
| 7 | `753f8c9` | 15:33 | cambio en lógica de compra | 3 | Lógica de "precio unitario" → "subtotal por paquete/caja" |
| 8 | `26ad829` | 15:56 | ajuste compra | 3 | Refinamientos en compras |
| 9 | `b034571` | 16:10 | usuarios | 4 | **Mejora de seguridad**: `sessionStorage` → `auth.currentUser` en todos los módulos |
| 10 | `0abe76d` | 16:12 | Create CNAME | 1 | Intento de dominio personalizado (revertido) |
| 11 | `ff197a3` | 16:14 | Delete CNAME | 1 | Reversión del CNAME |

### 6.1 Detalle de commits post-iniciales (commits #2-#11)

Estos commits representan refinamientos adicionales que Maria realizó **después** del commit inicial. Los cambios más significativos son:

#### Commit #5 — Integración de Firebase Storage (`da2b9c3`)

Implementa el sistema completo de carga de facturas:
- `js/firebase-config.js`: Añadido `getStorage` y export de `storage`
- `compras.html`: UI de upload con estilos (`.factura-box`, `.factura-preview`, `.factura-ayuda`)
- `js/compras.js`: Estado de factura, validación de archivo (tipo/tamaño), preview con `createObjectURL`
- `js/operaciones.js`: `subirFacturaAStorage()`, `validarFacturaArchivo()`, `limpiarNombreArchivo()`, `esperarAuthListo()`. Ruta de almacenamiento: `compras/{compraId}/facturas/{timestamp}_{nombre}`

#### Commit #7 — Cambio en lógica de compra (`753f8c9`)

Cambio conceptual: de "precio unitario por producto" a "subtotal por paquete/caja/artículo":
- Nueva función `subtotalItem()` en operaciones.js
- El precio unitario ahora se calcula inversamente: `unitario = subtotal / cantidad`
- Etiqueta cambiada a "Costo de paquete, caja o artículo"

#### Commit #9 — Mejora de seguridad en autenticación (`b034571`)

Cambio transversal en 4 archivos (`js/ajustes.js`, `js/compras.js`, `js/fondo.js`, `js/ventas.js`):

```javascript
// Antes (inseguro — lee de sessionStorage, manipulable por el usuario):
const usuario = getUsuarioActual();
await registrarCompra({ usuarioId: usuario.uid, ... });

// Después (seguro — estado real de Firebase Auth):
const usuarioActual = auth.currentUser;
if (!usuarioActual) {
  mostrarAlerta("error", "No se pudo identificar al usuario.");
  return;
}
await registrarCompra({ usuarioId: usuarioActual.uid, ... });
```

---

## 7. Cambios en la Base de Datos

### 7.1 Migración de proyecto Firebase para realización de pruebas de los nuevos módulos

| Aspecto | Proyecto recibido | Proyecto actual |
|---------|-------------------|-----------------|
| Nombre del proyecto | `contecs-utp` | `contects-54be8` |
| Cuenta asociada | alphamrv@gmail.com | — (nueva cuenta de prueba) |
| Región Firestore | nam5 (us-central1) | us-central1 |

### 7.2 Firestore — Colecciones existentes (sin cambios)

Estas colecciones ya existían en el proyecto recibido y se mantienen:

| Colección | Campos principales |
|-----------|-------------------|
| `usuarios/{uid}` | nombre, email, foto, rol, creadoEn |
| `productos/{productoId}` | nombre, categoriaId, icono, stock, precioVenta, alertaMinima, activo |
| `categorias/{categoriaId}` | nombre, icono, orden |

### 7.3 Firestore — Colecciones nuevas creadas

Se crearon las siguientes **4 colecciones nuevas** en Firestore:

#### Colección: `compras/{compraId}`

Registra cada compra realizada con todos sus detalles, incluyendo la factura adjunta.

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `creadoEn` | timestamp | Fecha y hora del registro | 8 de mayo de 2026, 4:00:01 p.m. UTC-5 |
| `usuarioId` | string | UID del usuario que registró la compra | `"chTEUpx0ZJaFOKs8HjW4t73Yq5f2"` |
| `usuarioNombre` | string | Nombre del usuario | `"Lourdes Goods"` |
| `proveedor` | string | Nombre del proveedor (obligatorio) | `"PriceSmart"` |
| `metodoPago` | string | Método de pago utilizado (obligatorio) | `"efectivo"` |
| `total` | double | Monto total de la compra | `6.4` |
| `nota` | string | Observaciones opcionales | `""` |
| `items` | array | Lista de productos comprados (ver detalle abajo) | — |
| `factura` | map | Metadata de la factura adjunta (ver detalle abajo) | — |

**Estructura de cada elemento en `items[]`:**

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `productoId` | string | ID del producto en Firestore | `"slyujyJFoeM7qvhrpydY"` |
| `nombre` | string | Nombre del producto | `"Coca-Cola 600ml"` |
| `cantidad` | int64 | Unidades compradas | `24` |
| `subtotal` | double | Costo total del paquete/caja | `6.4` |
| `precioUnitario` | double | Precio por unidad (calculado: subtotal/cantidad) | `0.2667` |

**Estructura del campo `factura` (map):**

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `name` | string | Nombre original del archivo | `"plan 2024.pdf"` |
| `contentType` | string | Tipo MIME del archivo | `"application/pdf"` |
| `size` | int64 | Tamaño en bytes | `396086` |
| `url` | string | URL de descarga en Firebase Storage | `"https://firebasestorage.googleapis.com/..."` |
| `uploadedAt` | timestamp | Fecha de subida | 8 de mayo de 2026, 4:00:01 p.m. UTC-5 |
| `uploadedBy` | string | UID del usuario que subió el archivo | `"chTEUpx0ZJaFOKs8HjW4t73Yq5f2"` |

#### Colección: `ventas/{ventaId}`

Registra cada venta realizada con los productos vendidos.

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `creadoEn` | timestamp | Fecha y hora del registro | 7 de mayo de 2026, 3:34:52 p.m. UTC-5 |
| `usuarioId` | string | UID del usuario que registró la venta | `"dx1cLFLyDVfmRwU4eKnETzwvHuj1"` |
| `metodoPago` | string | Método de pago | `"efectivo"` |
| `total` | double | Monto total de la venta | `7.5` |
| `nota` | string | Observaciones opcionales | `""` |
| `items` | array | Lista de productos vendidos | — |

**Estructura de cada elemento en `items[]`:**

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `productoId` | string | ID del producto | `"slyujyJFoeM7qvhrpydY"` |
| `nombre` | string | Nombre del producto | `"Coca-Cola 600ml"` |
| `cantidad` | int64 | Unidades vendidas | `10` |
| `precioUnitario` | double | Precio de venta unitario | `0.75` |
| `subtotal` | double | Subtotal (cantidad × precioUnitario) | `7.5` |

#### Colección: `fondos_entrada/{id}`

Registra cada movimiento financiero (entrada o salida) del fondo de la organización.

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `creadoEn` | timestamp | Fecha y hora del movimiento | 7 de mayo de 2026, 2:24:52 p.m. UTC-5 |
| `tipo` | string | Tipo de movimiento | `"salida"` |
| `monto` | int64 | Monto del movimiento | `50` |
| `descripcion` | string | Descripción del movimiento | `"Compra mnlsdbgLnFQiYe5NRm6Y"` |
| `origen` | string | Módulo que generó el movimiento | `"compra"` |
| `referenciaId` | string | ID del documento que originó el movimiento | `"mnlsdbgLnFQiYe5NRm6Y"` |
| `usuarioId` | string | UID del usuario responsable | `"dx1cLFLyDVfmRwU4eKnETzwvHuj1"` |

#### Colección: `movimiento_inventario/{id}`

Registra cada cambio de stock en el inventario (entradas por compra, salidas por venta, ajustes manuales).

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `creadoEn` | timestamp | Fecha y hora del movimiento | 8 de mayo de 2026, 12:47:08 p.m. UTC-5 |
| `productoId` | string | ID del producto afectado | `"SOmIGXsjkxKYgG15X2jJ"` |
| `nombre` | string | Nombre del producto | `"Hamburguesa Vaquera"` |
| `cantidad` | int64 | Unidades del movimiento | `101` |
| `antes` | int64 | Stock antes del movimiento | `0` |
| `despues` | int64 | Stock después del movimiento | `101` |
| `tipo` | string | Tipo de movimiento | `"entrada"` |
| `motivo` | string | Razón del movimiento | `"Compra registrada"` |
| `origen` | string | Módulo que generó el movimiento | `"compra"` |
| `referenciaId` | string | ID del documento que originó el movimiento | `"iDWJf80kcUIMtvLaU73j"` |
| `usuarioId` | string | UID del usuario responsable | `"chTEUpx0ZJaFOKs8HjW4t73Yq5f2"` |

### 7.4 Firestore — Documento de fondo actualizado

El documento `fondos/principal` fue actualizado con los siguientes campos:

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `balance` | int64 | Balance actual del fondo | `0` |
| `creadoEn` | timestamp | Fecha de creación | 7 de mayo de 2026, 1:58:12 p.m. UTC-5 |
| `actualizadoEn` | timestamp | Última actualización | 7 de mayo de 2026, 1:58:17 p.m. UTC-5 |

### 7.5 Firebase Storage — Nueva estructura

Se añadió el uso de **Firebase Storage** para almacenar las facturas de compras de forma segura. La estructura es:

```
Firebase Storage (contects-54be8.firebasestorage.app)
└── compras/
    └── {compraId}/
        └── facturas/
            └── {timestamp}_{nombreArchivo}
```

**Tipos de archivo aceptados:** PDF, JPEG, PNG, GIF, WebP  
**Tamaño máximo:** 10 MB por archivo  
**Ejemplo de ruta real:** `compras/2NKK7KWCpWqzxiojg5js/facturas/1778273996678_plan_2024.pdf`

### 7.6 Servicios Firebase activos

| Servicio | Proyecto recibido | Proyecto actual | Uso |
|----------|:-----------------:|:---------------:|-----|
| Firebase Authentication | ✅ | ✅ | Login con Google OAuth |
| Cloud Firestore | ✅ | ✅ | Base de datos principal (ubicación: us-central1) |
| Firebase Storage | ❌ No existía | ✅ **Nuevo** | Almacenamiento seguro de facturas de compras |

---

## 8. Estado Actual del Proyecto — Fases

| Fase | Descripción | Estado recibido | Estado actual | Trabajo de Maria |
|------|-------------|:---------------:|:-------------:|-----------------|
| **Fase 0** | Configuración y estructura | ✅ Alpha | ✅ | Migración a nuevo proyecto Firebase de prueba |
| **Fase 1** | Autenticación y roles | ✅ Alpha | ✅ | Auto-registro, escucha de rol en tiempo real, manejo de errores, seguridad `auth.currentUser` |
| **Fase 2** | Catálogo de productos | 🔶 Estructura | 🔶 Mejorado | Simplificación de iconos, filtros por categoría, selectores |
| **Fase 3** | Ventas y mermas | ❌ Placeholder | ✅ **Implementado** | Módulo completo: carrito, mermas, método de pago, transacciones atómicas |
| **Fase 4** | Inventario en tiempo real | 🔶 Básico | ✅ **Mejorado** | Animaciones, filtros, ajustes manuales (`ajustesInventario.html` + `js/ajustes.js`) |
| **Fase 5** | Compras | ❌ Placeholder | ✅ **Implementado** | Módulo completo: carrito, facturas, validaciones, Firebase Storage, subtotales |
| **Fase 6** | Fondos | ❌ Placeholder | ✅ **Implementado** | Módulo completo: balance, movimientos, ingreso/egreso (`fondos.html`, `detalleFondo.html`, `js/fondo.js`, `js/detalleFondo.js`) |
| **Fase 7** | Bitácora | 📝 Mínimo | 📝 Mínimo | Sin cambios significativos en esta fase |
| **Fase 8** | Dashboard y pulido | 🔶 Básico | 🔶 En progreso | Animaciones CSS, manejo de errores Firestore, estadísticas en tiempo real |

### 8.1 Resumen de donde quedó el desarrollo

**Módulos completados por Maria:**
1. **Compras (Fase 5)** — Módulo más desarrollado: carrito, facturas con upload a Storage, validaciones frontend/backend, subtotal por paquete
2. **Ventas (Fase 3)** — Carrito de ventas, mermas, transacciones atómicas
3. **Fondos (Fase 6)** — Balance, movimientos, ingreso/egreso con 2 páginas nuevas
4. **Inventario (Fase 4)** — Ajustes manuales con nueva página, animaciones

**Módulos mejorados:**
5. **Autenticación (Fase 1)** — Auto-registro, seguridad mejorada, manejo de errores
6. **Catálogo (Fase 2)** — Iconos simplificados, filtros
7. **Dashboard (Fase 8)** — Animaciones, manejo de errores Firestore

**Pendientes:**
- Fase 7 (Bitácora de cierres) — Solo estructura HTML mínima, sin lógica JS
- Reglas de seguridad de Firestore para producción
- Reglas de Firebase Storage para la carpeta `compras/`
- Migración del proyecto Firebase a cuenta oficial de CONTECS
- Pruebas completas de integración entre módulos

### 8.2 Archivos que Maria NO modificó

Los siguientes archivos se mantienen tal como fueron recibidos:
- `index.html` — Página de login
- `usuarios.html` — Gestión de usuarios
- `reportes.html` — Módulo de reportes
- `icons/bebida-lata.svg` — Icono SVG

---

## 9. Resumen de Archivos — Estado Final

| Archivo | Líneas | Estado | Trabajo de Maria |
|---------|:------:|:------:|-----------------|
| `css/styles.css` | 359 | 🆕 Nuevo | Estilos globales con animaciones |
| `ajustesInventario.html` | 94 | 🆕 Nuevo | Página de ajustes de inventario |
| `detalleFondo.html` | 211 | 🆕 Nuevo | Detalle de movimientos del fondo |
| `js/ajustes.js` | 163 | 🆕 Nuevo | Lógica de ajustes de inventario |
| `js/compras.js` | 482 | 🆕 Nuevo | Lógica de compras con carrito y facturas |
| `js/detalleFondo.js` | 216 | 🆕 Nuevo | Lógica de detalle de fondos |
| `js/fondo.js` | 172 | 🆕 Nuevo | Lógica del módulo de fondos |
| `js/operaciones.js` | 482 | 🆕 Nuevo | Motor de transacciones atómicas |
| `js/ventas.js` | 347 | 🆕 Nuevo | Lógica de ventas con carrito |
| `js/firebase-config.js` | 19 | ✏️ Modificado | Migración Firebase + Storage |
| `js/permisos.js` | 61 | ✏️ Modificado | Nuevos permisos |
| `js/auth.js` | 153 | ✏️ Modificado | Reescritura: auto-registro, errores, seguridad |
| `js/catalogo.js` | 141 | ✏️ Modificado | Iconos simplificados |
| `compras.html` | 167 | ✏️ Modificado | De placeholder a módulo completo |
| `ventas.html` | 144 | ✏️ Modificado | De placeholder a módulo completo |
| `fondos.html` | 97 | ✏️ Modificado | De placeholder a módulo completo |
| `exportar.html` | 29 | ✏️ Modificado | UI completa de exportación |
| `dashboard.html` | 302 | ✏️ Modificado | Animaciones, manejo de errores |
| `inventario.html` | 366 | ✏️ Modificado | Animaciones, filtros, expansión mayor |
| `catalogo.html` | 765 | ✏️ Modificado | Filtros, selectores de iconos (renombrado de `catologo.html`) |
| `bitacora.html` | 24 | 📝 Renombrado | De `bitacora.html` a `bitácora.html` |
| `auth.js` (raíz) | 75 | ✏️ Modificado | Corrección de indentación |
| `index.html` | 191 | — Sin cambios | — |
| `usuarios.html` | 202 | — Sin cambios | — |
| `reportes.html` | 29 | — Sin cambios | — |
| `icons/bebida-lata.svg` | 2 | — Sin cambios | — |
| `README.md` | 49 | — Sin cambios | — |
| **Total** | **5,341** | | |

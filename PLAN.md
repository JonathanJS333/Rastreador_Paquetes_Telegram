# Plan completo — Bot de rastreo de paquetes en Telegram (México / Oaxaca)

> Documento de trabajo del equipo. Objetivo: que el equipo pueda construir **la mayor parte del proyecto por su cuenta**, con pasos concretos, comandos y contratos ya definidos.
>
> **Región base:** México. **Destino foco:** paquetes con entrega en **Oaxaca**.
>
> Estado actual del repo: estructura de carpetas creada (`bot/`, `carriers/`, `config/`, `repositories/`, `services/`) con archivos `.ts` **vacíos**. `package.json` sin scripts. `.env.example` vacío.

---

## 0. Resumen y alcance

**Qué es:** un bot de Telegram donde cada usuario añade números de guía (tracking numbers) de paqueterías mexicanas e internacionales que entregan en Oaxaca, y recibe una notificación automática cuando el estado del paquete cambia.

**MVP (v1):**
1. `/add <guia> [paqueteria] [alias]` — registrar un paquete (con CP de destino).
2. `/list` — ver mis paquetes y su estado actual.
3. `/status <guia>` — detalle + historial de eventos.
4. `/remove <guia>` — borrar un paquete.
5. Un **job programado** que consulta las paqueterías cada X minutos y notifica solo cuando hay cambio.

**Fuera del MVP (v2+):** dashboard web, login web, estadísticas, mapa de sucursales.

---

## 1. Contexto México / Oaxaca (leer antes de programar)

### 1.1 Por qué Oaxaca es un caso especial

- Oaxaca tiene **570 municipios**, muchos rurales y con nomenclatura de calles irregular. La última milla es **irregular**: hay municipios sin cobertura a domicilio.
- Muchos envíos **no llegan directo**: entran por un hub en CDMX o Puebla y de ahí bajan a la sucursal de Oaxaca de Juárez.
- Por eso es muy común el **"ocurre"**: en lugar de entrega a domicilio, el paquete queda **disponible para recoger en sucursal**. En el tracking esto aparece como "En sucursal", "Disponible para recoger" o "Intento de entrega".
- **Códigos postales de Oaxaca: 68000–71999** (prefijos `68`, `69`, `70`, `71`). Oaxaca de Juárez = `68000`.
  → El bot debe **validar el CP** y avisar si está fuera de ese rango.

### 1.2 Estados que aparecen en México (y que el bot debe traducir)

| Lo que dice la paquetería | Estado normalizado |
|---|---|
| Guía generada / Información recibida | `created` |
| En tránsito / En camino / Salida de origen | `in_transit` |
| **Retenido en aduana / En revisión aduanal** | `customs` |
| Llegó a sucursal de destino | `at_branch` |
| **Disponible para ocurre / Listo para recoger** | `at_branch` |
| En reparto / Con el repartidor | `out_for_delivery` |
| Entregado | `delivered` |
| **Intento de entrega fallido / Domicilio cerrado** | `exception` |
| Devuelto al remitente | `returned` |

> ⚠️ **`customs` (aduana) es clave**: los paquetes de Shein, Temu y AliExpress pasan días retenidos sin que cambie el estado. Sin este estado el bot daría información confusa. Es normal, no es una incidencia.

### 1.3 Paqueterías prioritarias para Oaxaca

| Prioridad | Paquetería | Cómo se rastrea | Formato de guía |
|---|---|---|---|
| 1 | **Estafeta** | API oficial (WS) o agregador | 10 dígitos, o alfanumérica de 22 |
| 1 | **Mercado Envíos (Mercado Libre)** | **API pública y gratis** de Mercado Libre | ID numérico de envío |
| 2 | **Correos de México (Sepomex)** | Web de rastreo (sin API pública) → agregador o scraping | Formato S10: `RR123456789MX` |
| 2 | **DHL Express / DHL eCommerce** | API oficial (developer.dhl.com) | 10 dígitos |
| 2 | **FedEx México** | API oficial (developer.fedex.com) | 12 o 15 dígitos |
| 3 | **Paquetexpress** | API para clientes / agregador | Alfanumérica |
| 3 | **Redpack** | API para clientes / agregador | Alfanumérica |
| 3 | **J&T Express México** | Web/agregador (creció mucho con Temu/Shein) | Alfanumérica |
| 3 | **99minutos** | API / agregador (última milla e-commerce) | Alfanumérica |
| 4 | **UPS México** | API oficial | `1Z` + 16 caracteres |
| 4 | **Amazon México (AMZL)** | Sin API pública de rastreo | `TBA` + dígitos |

**Internacionales que terminan en Oaxaca:** China Post / Cainiao (AliExpress), YunExpress, 4PX, Yanwen. Suelen entrar por Correos de México o J&T.

### 1.4 ⚠️ La decisión más importante: de dónde sacamos los datos

Ninguna de las paqueterías mexicanas ofrece una API de rastreo **abierta y gratuita**, salvo Mercado Libre. Las opciones:

1. **Agregador (recomendado para el MVP)** — AfterShip, TrackingMore o 17TRACK ya soportan Estafeta, DHL, FedEx, UPS, Correos de México, J&T, Paquetexpress y Redpack con **una sola API**. Plan gratuito limitado. Es la vía con menos trabajo y más cobertura.
2. **API oficial** — solo cuando el agregador falle o necesitéis datos exactos. Requiere registro y a veces contrato comercial.
3. **Scraping de la web** — frágil y con dudas de ToS. Último recurso, aislado en su adaptador.

**Propuesta:** agregador para todo + **API pública de Mercado Libre** para envíos de Mercado Envíos. Las APIs oficiales se añaden después, sin tocar el resto del código.

### 1.5 ⚠️ La detección automática de paquetería NO es fiable

DHL México usa **10 dígitos** y Estafeta también usa **10 dígitos**. FedEx usa 12. Es imposible distinguirlas por el número.

👉 **Diseño:** `/add` acepta la paquetería como parámetro opcional. Si el usuario no la indica, se delega en el agregador (que la autodetecta) y se guarda la que devuelva. **Nunca** confiéis en `supports()` para casos ambiguos.

---

## 2. Arquitectura: Modular por Capas Pragmática

### 2.1 Qué significa aquí

No es un patrón canónico de libro, así que lo definimos explícitamente para este proyecto:

- **Por capas** → capas horizontales con una única dirección de dependencia: de fuera hacia dentro.
- **Modular** → dentro de cada capa, el código se agrupa por módulo funcional (`carriers`, `shipments`, `tracking`, `bot`, `config`), no en archivos sueltos por tipo.
- **Pragmática** → aplicamos solo las reglas que nos protegen del caos. Sin contenedores de inyección de dependencias, sin una interfaz por clase, sin DDD completo. Si una regla no nos está salvando de un problema real, no se aplica.

### 2.2 Diagrama de componentes

```
                         ┌──────────────────────────┐
        Telegram  ──────▶│  Bot (grammy)  bot.ts     │
        (usuario)        │  /add /list /status ...   │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │ TrackingService           │  ← lógica de negocio
                         │ services/tracking.service │
                         └────┬──────────────────┬───┘
                              │                  │
              ┌───────────────▼──┐        ┌──────▼─────────────────┐
              │ CarrierFactory   │        │ ShipmentRepository     │
              │ (elige adaptador)│        │ repositories/...       │
              └───────┬──────────┘        └──────┬─────────────────┘
                      │                          │
        ┌─────────────▼──────────┐       ┌───────▼────────┐
        │ EstafetaAdapter        │       │  Base de datos │
        │ MercadoLibreAdapter    │       │ (SQLite/Postgres)│
        │ DhlAdapter ...         │       └────────────────┘
        └─────────────┬──────────┘
                      │ HTTP
              ┌───────▼────────────────────────┐
              │ Agregador / API oficial        │
              └────────────────────────────────┘

   Scheduler (node-cron) ──▶ TrackingService.syncAll() ──▶ notifica cambios
```

### 2.3 Las capas

| # | Capa | Carpeta | Responsabilidad | Puede importar de |
|---|---|---|---|---|
| 1 | **Presentación** | `src/bot/` | Hablar con Telegram: comandos, teclados, formateo de mensajes. | 2, 3, T |
| 2 | **Aplicación** | `src/services/` | Casos de uso: añadir, sincronizar, decidir si notificar. Orquesta; no implementa detalles. | 3, 4, T |
| 3 | **Dominio** | `src/carriers/carrier.interface.ts` | Contratos y reglas puras: estados normalizados, tipos. **Cero dependencias externas.** | nada |
| 4 | **Infraestructura** | `src/carriers/*.carrier.ts`, `src/repositories/` | Detalles: HTTP (axios), BD (SQLite), resolución de adaptadores. | 3, T |
| T | *Transversal* | `src/config/` | `env` validado + validación de CP de Oaxaca. | nada |

### 2.4 La regla de dependencia (la única que no se negocia)

Las dependencias apuntan siempre **hacia dentro**. El dominio no conoce a nadie.

```
   Presentación           Aplicación            Dominio
    src/bot       ──────▶ src/services ──────▶ contratos y tipos
       ▲                                           ▲
       │                                           │
       └────────────  Infraestructura  ────────────┘
                adaptadores · repositorios

   Transversal (src/config) es accesible desde cualquier capa.
```

Consecuencias prácticas:
- `TrackingService` depende de la **interfaz** `CarrierAdapter`, nunca de `EstafetaAdapter`.
- `carrier.interface.ts` **no importa** axios, grammy ni better-sqlite3. Si lo hace, está mal.
- El bot **nunca** importa `repositories/` ni `carriers/` directamente: todo pasa por `services/`.

### 2.5 Matriz de imports

| Desde ↓ / Hacia → | bot | services | dominio | carriers | repositories | config |
|---|---|---|---|---|---|---|
| **bot** | ✔ | ✔ | ✔ | ✘ | ✘ | ✔ |
| **services** | ✘ | ✔ | ✔ | ✔ (interfaz + factory) | ✔ (interfaz) | ✔ |
| **dominio** | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ |
| **carriers** | ✘ | ✘ | ✔ | ✔ | ✘ | ✔ |
| **repositories** | ✘ | ✘ | ✔ | ✘ | ✔ | ✔ |
| **config** | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ |

En una frase: **nadie importa hacia arriba.**

> **Aclaración importante:** la columna «carriers» se refiere a los **adaptadores concretos** (`*.carrier.ts`). El archivo `carrier.interface.ts` es **dominio** (sección 2.3), así que **cualquier capa puede importarlo** sin romper la regla.

### 2.6 Módulos y dueño

| Módulo | Contenido | Rol |
|---|---|---|
| `carriers` | Contrato + un adaptador por paquetería + factory | A |
| `shipments` | Repositorio, modelo, esquema SQL | C |
| `tracking` | `TrackingService`, normalización de estados | D |
| `bot` | Comandos, textos, teclados, notificaciones | B |
| `config` | `env` validado, validación de CP de Oaxaca | D |

### 2.7 Qué significa "pragmática": lo que NO hacemos

Deliberadamente fuera, porque en un MVP de 3 semanas no compensa:

- ❌ Contenedor de inyección de dependencias → el repositorio se pasa por constructor, punto.
- ❌ Una interfaz por cada clase → solo hay interfaces donde existe **más de una implementación real** (adaptadores de paquetería, repositorio).
- ❌ Entidades DDD, value objects, agregados → sobre-ingeniería para este tamaño.
- ❌ CQRS, bus de eventos, eventos de dominio → no.
- ❌ Separar la interfaz del repositorio de su implementación en archivos distintos → **al principio van juntas** en `shipment.repository.ts`. Cuando el archivo pase de ~250 líneas, se separan.

Y SÍ hacemos:

- ✅ Una única dirección de dependencia, respetada.
- ✅ Un adaptador por paquetería, todos con el mismo contrato.
- ✅ Errores de infraestructura que no tumban la aplicación (`status: 'unknown'`).
- ✅ Un `TrackingService` testeable sin red y sin Telegram (con el adaptador `fake`).

### 2.8 Cómo se hace cumplir (esto es lo que evita que se degrade)

Una arquitectura sin verificación se convierte en un desastre en dos semanas. Dos mecanismos:

1. **Revisión en PR** — el checklist incluye: "¿respeta la dirección de dependencias?"
2. **Script automático** (recomendado, ~30 líneas) — `scripts/check-architecture.mjs`, que lee los imports de `src/` y falla si alguien importa hacia arriba. Se expone como `npm run check:arch` y se ejecuta en CI.

```js
// scripts/check-architecture.mjs  (esqueleto)
// Regla: el dominio no importa nada externo; el bot no importa carriers/ ni repositories/.
const FORBIDDEN = {
  'src/carriers/carrier.interface.ts': ['axios', 'grammy', 'better-sqlite3', 'node-cron'],
  'src/bot/': ['carriers/', 'repositories/', 'axios', 'better-sqlite3'],
  'src/services/': ['grammy', 'better-sqlite3'],
};
// 1. recorrer src/**/*.ts y extraer los imports con regex
// 2. comparar cada import contra las reglas de su carpeta
// 3. process.exit(1) listando las violaciones
```

> 💡 Este script es el pegamento del modelo. Sin él, "pragmática" acaba significando "cada quien hace lo que quiere".

**Principios de diseño:**
- **El bot no sabe de paqueterías.** Solo habla con `TrackingService`.
- **El servicio no sabe de HTTP ni de Telegram.** Solo orquesta.
- **Cada paquetería es un adaptador** que cumple el mismo contrato → añadir una nueva es crear un archivo.
- **La persistencia está aislada** → cambiar de SQLite a Postgres sin tocar el resto.

---

## 3. Stack y decisiones técnicas

| Pieza | Elección | Por qué |
|---|---|---|
| Runtime | Node.js 22+ | Ya instalado (probado en 22.22.2), soporte de TS |
| Lenguaje | TypeScript | Tipado, seguridad al refactorizar en equipo |
| Bot | `grammy` | Ya en `package.json`, moderno, inline keyboards |
| HTTP | `axios` | Ya en `package.json` |
| Validación | `zod` | Validar `.env`, CP y datos externos |
| Config | `dotenv` | Ya en `package.json` |
| Dev runner | `tsx` | Ejecutar TS sin compilar |
| Pruebas | `node:test` + `tsx` | Node 22 ya trae corredor de pruebas: cero dependencias nuevas. Se lanza con `npm test` |
| Scheduler | Temporizadores de Node (`setTimeout`) | Vienen incluidos. `node-cron` sería una dependencia más para una línea (ver §11) |
| BD (MVP) | `better-sqlite3` | Un archivo, cero servidores |
| BD (v2) | PostgreSQL / Supabase | Cuando haya más de un servidor |
| Zona horaria | `America/Mexico_City` | Oaxaca es hora del centro (UTC−6) |

---

## 4. Modelo de datos

```sql
users (
  telegram_id   INTEGER PRIMARY KEY,
  chat_id       INTEGER NOT NULL,
  language      TEXT DEFAULT 'es-MX',
  default_cp    TEXT,                  -- CP habitual del usuario (Oaxaca)
  notify        INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL
)

shipments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  tracking_number TEXT NOT NULL,
  carrier         TEXT NOT NULL,        -- 'estafeta' | 'mercadolibre' | 'dhl' ...
  alias           TEXT,                 -- "Tenis", "Regalo mamá"
  dest_cp         TEXT,                 -- CP de entrega (validar Oaxaca)
  dest_state      TEXT,                 -- 'Oaxaca'
  status          TEXT NOT NULL DEFAULT 'unknown',
  last_event_at   TEXT,
  last_checked_at TEXT,
  active          INTEGER DEFAULT 1,
  UNIQUE(telegram_id, tracking_number, carrier)
)

tracking_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id   INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status        TEXT NOT NULL,
  description   TEXT,
  location      TEXT,
  occurred_at   TEXT,
  raw           TEXT,                   -- JSON original por si hay que depurar
  created_at    TEXT NOT NULL
)
```

**Estados normalizados:**
`unknown` · `created` · `in_transit` · `customs` · `at_branch` · `out_for_delivery` · `delivered` · `exception` · `returned`

---

## 5. Reparto de roles y flujo de trabajo

| Rol | Responsabilidad | Carpetas |
|---|---|---|
| **A — Paqueterías** | Adaptadores y normalización de estados | `src/carriers/` |
| **B — Bot/UX** | Comandos, teclados, textos, notificaciones | `src/bot/` |
| **C — Datos** | Esquema, migraciones, repositorio | `src/repositories/` |
| **D — Core/DevOps** | Servicio, scheduler, despliegue, CI | `src/services/`, `src/index.ts`, `src/config/` |

> Si sois menos de 4, agrupad: A+C y B+D. Lo importante es **no tocar la carpeta del otro a la vez**.

**Reglas de Git:**
- `main` siempre funciona. Nadie hace push directo.
- Una rama por tarea: `feat/carrier-estafeta`, `fix/list-vacio`.
- Commits con formato: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- PR obligatorio + 1 revisión de otro compañero antes de mergear.
- **Antes de empezar:** congelad los contratos de la sección 6.1. Son la frontera entre compañeros.

---

## 6. Fases y paso a paso

### 6.1 — Contratos primero (bloqueante, 1 sesión de equipo)

**Acción:** escribir las **interfaces** antes de programar, para trabajar en paralelo sin bloquearse.

**Paso 1.** `src/carriers/carrier.interface.ts`:

```ts
export type NormalizedStatus =
  | 'unknown' | 'created' | 'in_transit' | 'customs' | 'at_branch'
  | 'out_for_delivery' | 'delivered' | 'exception' | 'returned';

export interface TrackingEvent {
  status: NormalizedStatus;
  description: string;
  location?: string;
  occurredAt?: string; // ISO 8601
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  status: NormalizedStatus;
  events: TrackingEvent[];
  estimatedDelivery?: string;
}

export interface CarrierAdapter {
  readonly name: string;                       // 'estafeta'
  /** Solo para números inequívocos (S10 de Correos, 1Z de UPS). Nunca para 10 dígitos. */
  supports(trackingNumber: string): boolean;
  track(trackingNumber: string): Promise<TrackingResult>;
}
```

**Paso 2.** Definir los tipos de dominio (`User`, `Shipment`) y la interfaz del repositorio en `src/repositories/shipment.repository.ts`.

**Paso 3.** Commit: `docs: definir contratos de adaptadores y repositorio`.

---

### Fase 1 — Base del proyecto (Rol D)

**Paso 1.** Añadir scripts a `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "check:arch": "node scripts/check-architecture.mjs"
  }
}
```

> El script `check:arch` se explica en la sección 2.8. Si aún no lo habéis escrito, dejad la línea comentada o cread el archivo vacío con un `console.log` para que no falle.

**Paso 2.** Corregir `tsconfig.json`: la línea `"types": []` **excluye** los tipos de Node, así que `process` dará error. Cambiar a:

```json
"types": ["node"],
"rootDir": "./src",
"outDir": "./dist",
"lib": ["esnext"],
"noUnusedLocals": true,
"noUnusedParameters": true
```

> ⚠️ Con `"module": "nodenext"` + `"type": "module"`, **los imports relativos necesitan extensión `.js`** aunque el archivo sea `.ts`:
> `import { bot } from './bot/bot.js'` ✔️  ·  `import { bot } from './bot/bot'` ✘
> Y los tipos se importan con `import type { ... }`.

**Paso 3.** `.gitignore` completo:

```
node_modules/
dist/
.env
data/
*.sqlite
*.sqlite-journal
.DS_Store
```

**Paso 4.** Crear el bot en Telegram:
1. Abrir Telegram → buscar **@BotFather**.
2. `/newbot` → elegir nombre → usuario terminado en `bot`.
3. Copiar el **token** (`123456:ABC-DEF...`). **Nunca** commitearlo.
4. Buscar **@userinfobot** → `/start` → copiar tu **user id** (para pruebas).

**Paso 5.** Rellenar `.env.example` (sí se commitea) y crear `.env` (no se commitea):

```
BOT_TOKEN=
DATABASE_PATH=./data/bot.sqlite
COUNTRY=MX
DEFAULT_STATE=Oaxaca
TZ=America/Mexico_City
TRACKING_PROVIDER=aftership
TRACKING_API_KEY=
MERCADOLIBRE_ACCESS_TOKEN=
POLL_INTERVAL_MINUTES=30
LOG_LEVEL=info
```

**Paso 6.** Instalar dependencias:

```bash
npm install grammy axios zod dotenv node-cron better-sqlite3
npm install -D typescript tsx @types/node @types/node-cron
```

**Paso 7.** Commit: `chore: configurar scripts, tsconfig y variables de entorno`.

---

### Fase 2 — Configuración validada (Rol D)

**Paso 1.** `src/config/env.ts` — fallar rápido y claro si falta una variable:

```ts
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(10, 'Falta BOT_TOKEN'),
  DATABASE_PATH: z.string().default('./data/bot.sqlite'),
  COUNTRY: z.string().default('MX'),
  DEFAULT_STATE: z.string().default('Oaxaca'),
  TZ: z.string().default('America/Mexico_City'),
  TRACKING_PROVIDER: z.string().default('aftership'),
  TRACKING_API_KEY: z.string().optional(),
  MERCADOLIBRE_ACCESS_TOKEN: z.string().optional(),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Config inválida:\n', parsed.error.issues);
  process.exit(1);
}
export const env = parsed.data;
```

**Paso 2.** `src/config/oaxaca.ts` — validación de CP (¡esto es específico del proyecto!):

```ts
/** CPs de Oaxaca: 68000–71999 (prefijos 68, 69, 70, 71). */
export function isOaxacaCp(cp: string): boolean {
  if (!/^\d{5}$/.test(cp)) return false;
  const n = Number(cp);
  return n >= 68000 && n <= 71999;
}

export function validateCp(cp: string): { ok: boolean; message?: string } {
  if (!/^\d{5}$/.test(cp)) return { ok: false, message: 'El CP debe tener 5 dígitos.' };
  if (!isOaxacaCp(cp)) {
    return { ok: false, message: 'Ese CP no es de Oaxaca. ¿Seguro que el paquete viene a Oaxaca?' };
  }
  return { ok: true };
}
```

**Paso 3.** Verificar: `npm run dev` arranca sin errores.

---

### Fase 3 — Capa de paqueterías (Rol A) — *la más independiente*

**Paso 1.** `src/carriers/carrier.factory.ts`:

```ts
import type { CarrierAdapter } from './carrier.interface.js';

const adapters: CarrierAdapter[] = [
  // new FakeAdapter(),
  // new MercadoLibreAdapter(),
];

export function getAdapter(carrierName: string): CarrierAdapter {
  const found = adapters.find(a => a.name === carrierName);
  if (!found) throw new Error(`Paquetería no soportada: ${carrierName}`);
  return found;
}
```

> 💡 **No incluimos `detectCarrier()`**: con 10 dígitos compartidos entre DHL y Estafeta es engañoso. Si queréis autodetección, usad la del agregador.

**Paso 2.** Empezar con un adaptador *fake* para no bloquear al resto del equipo:

```ts
// src/carriers/fake.carrier.ts
import type { CarrierAdapter, TrackingResult } from './carrier.interface.js';

export class FakeAdapter implements CarrierAdapter {
  readonly name = 'fake';
  supports(n: string) { return /^FAKE\d{6}$/i.test(n); }
  async track(trackingNumber: string): Promise<TrackingResult> {
    return {
      trackingNumber, carrier: this.name, status: 'in_transit',
      events: [{ status: 'in_transit', description: 'En tránsito hacia Oaxaca (prueba)',
                 location: 'CDMX', occurredAt: new Date().toISOString() }],
    };
  }
}
```

**Paso 3.** Adaptador de **Mercado Envíos** (API pública y gratis, la más fácil):

```ts
// src/carriers/mercadolibre.carrier.ts
import axios from 'axios';
import { env } from '../config/env.js';
import type { CarrierAdapter, TrackingResult, NormalizedStatus } from './carrier.interface.js';

const STATUS_MAP: Record<string, NormalizedStatus> = {
  pending: 'created', handling: 'created', ready_to_ship: 'created',
  shipped: 'in_transit', in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery', delivered: 'delivered',
  not_delivered: 'exception', cancelled: 'returned',
};

export class MercadoLibreAdapter implements CarrierAdapter {
  readonly name = 'mercadolibre';
  supports(n: string) { return /^\d{8,12}$/.test(n); }  // id de envío
  async track(trackingNumber: string): Promise<TrackingResult> {
    const { data } = await axios.get(
      `https://api.mercadolibre.com/shipments/${trackingNumber}`,
      { headers: { Authorization: `Bearer ${env.MERCADOLIBRE_ACCESS_TOKEN}` }, timeout: 10_000 },
    );
    const events = (data.shipping_items ?? []).map((e: any) => ({
      status: STATUS_MAP[data.status] ?? 'unknown',
      description: e.description ?? '',
      location: e.address?.city?.name,
      occurredAt: e.date,
    }));
    return { trackingNumber, carrier: this.name,
      status: STATUS_MAP[data.status] ?? 'unknown', events };
  }
}
```

**Paso 4.** Adaptador del **agregador** (cubre Estafeta, DHL, FedEx, UPS, Correos de México, J&T, Paquetexpress, Redpack):

```ts
// src/carriers/aftership.carrier.ts  (esqueleto)
import axios from 'axios';
import { env } from '../config/env.js';
import type { CarrierAdapter, TrackingResult, NormalizedStatus } from './carrier.interface.js';

const STATUS_MAP: Record<string, NormalizedStatus> = {
  Pending: 'created', InfoReceived: 'created',
  InTransit: 'in_transit', OutForDelivery: 'out_for_delivery',
  Delivered: 'delivered', Exception: 'exception',
  AttemptFail: 'exception', AvailableForPickup: 'at_branch',
  ReturnedToSender: 'returned', Expired: 'exception',
};

/** Los estados de aduana llegan como texto libre: hay que buscarlos. */
function detectCustoms(text: string): boolean {
  return /aduan|customs|retenido|revisi[oó]n aduanal/i.test(text);
}

export class AfterShipAdapter implements CarrierAdapter {
  readonly name = 'aftership';
  supports() { return true; }
  async track(trackingNumber: string): Promise<TrackingResult> {
    const { data } = await axios.get('https://api.aftership.com/v4/trackings', {
      params: { tracking_numbers: trackingNumber },
      headers: { 'aftership-api-key': env.TRACKING_API_KEY! },
      timeout: 10_000,
    });
    const item = data.data?.trackings?.[0] ?? {};
    const checkpoints = item.checkpoints ?? [];
    const events = checkpoints.map((e: any) => {
      let status = STATUS_MAP[e.tag] ?? 'unknown';
      if (detectCustoms(e.message ?? '')) status = 'customs';
      return { status, description: e.message ?? '', location: e.location,
               occurredAt: e.checkpoint_time };
    });
    return { trackingNumber, carrier: this.name,
      status: events.at(-1)?.status ?? STATUS_MAP[item.tag] ?? 'unknown', events };
  }
}
```

**Paso 5.** Registrar los adaptadores en el array de la factory.

**Paso 6.** **Prueba aislada** con `tsx` (sin arrancar el bot) usando guías reales de Estafeta, DHL y Mercado Libre. Commit: `feat(carriers): adaptadores fake, mercadolibre y aftership`.

> 💡 Reglas del adaptador: siempre `timeout` en axios; capturar errores y devolver `status: 'unknown'` en vez de lanzar excepción (el bot no debe caerse porque una API externa falle).

---

### Fase 4 — Persistencia (Rol C)

**Paso 1.** Capa de conexión + esquema con `better-sqlite3` en `src/repositories/db.ts`. Ejecutar el SQL de la sección 4 con `CREATE TABLE IF NOT EXISTS`.

**Paso 2.** Implementar `ShipmentRepository`:

```ts
interface ShipmentRepository {
  upsertUser(telegramId: number, chatId: number): void;
  setDefaultCp(telegramId: number, cp: string): void;
  addShipment(telegramId: number, carrier: string, trackingNumber: string,
              alias?: string, destCp?: string): Shipment;
  listByUser(telegramId: number): Shipment[];
  findByTracking(trackingNumber: string): Shipment | null;
  removeShipment(telegramId: number, id: number): boolean;
  listActiveForSync(): Shipment[];
  updateStatus(shipmentId: number, status: string, lastEventAt?: string): void;
  addEvent(shipmentId: number, event: TrackingEvent): void;
  getEvents(shipmentId: number): TrackingEvent[];
  setNotify(telegramId: number, enabled: boolean): void;
  userWantsNotifications(telegramId: number): boolean;
}
```

**Paso 3.** Probar insertando y leyendo un paquete. Commit: `feat(repo): repositorio SQLite con esquema de paquetes y eventos`.

> 🔒 **Seguridad:** todas las consultas con **parámetros preparados** (`?`), nunca concatenando strings → evita inyección SQL.

---

### Fase 5 — Servicio de tracking (Rol D)

**Paso 1.** `src/services/tracking.service.ts` — el corazón de la lógica:

```ts
export class TrackingService {
  constructor(private repo: ShipmentRepository) {}

  async add(telegramId: number, chatId: number, carrier: string,
            number: string, alias?: string, destCp?: string) {
    this.repo.upsertUser(telegramId, chatId);
    const adapter = getAdapter(carrier);
    const result = await adapter.track(number);        // primera consulta ya
    const shipment = this.repo.addShipment(telegramId, carrier, number, alias, destCp);
    this.repo.updateStatus(shipment.id, result.status, result.events.at(-1)?.occurredAt);
    result.events.forEach(e => this.repo.addEvent(shipment.id, e));
    return { shipment, result };
  }

  /** La usa el scheduler: recorre los paquetes activos y devuelve los que cambiaron */
  async syncAll(): Promise<Array<{ shipment: Shipment; newStatus: string }>> {
    const changed = [];
    for (const s of this.repo.listActiveForSync()) {
      try {
        const result = await getAdapter(s.carrier).track(s.trackingNumber);
        if (result.status !== s.status) {
          this.repo.updateStatus(s.id, result.status, result.events.at(-1)?.occurredAt);
          this.repo.addEvent(s.id, result.events.at(-1)!);
          changed.push({ shipment: s, newStatus: result.status });
        }
      } catch (err) {
        console.error(`Error consultando ${s.trackingNumber}`, err); // no romper el bucle
      }
    }
    return changed;
  }
}
```

**Paso 2.** Verificar con el adaptador `fake` que un cambio de estado se detecta y se registra.

---

### Fase 6 — Bot de Telegram (Rol B)

**Paso 1.** `src/bot/bot.ts`:

```ts
import { Bot, InlineKeyboard } from 'grammy';
import { env } from '../config/env.js';

export const bot = new Bot(env.BOT_TOKEN);
```

**Paso 2.** Comandos del MVP:

| Comando | Qué hace | Ejemplo |
|---|---|---|
| `/start` | Registra al usuario | Bienvenida + ayuda |
| `/help` | Lista de comandos | Texto |
| `/add <guia> [paqueteria] [alias]` | Añade paquete | `/add 1234567890 estafeta Tenis` |
| `/list` | Lista paquetes con estado y emoji | Con botones 🔄 / 🗑 |
| `/status <guia>` | Detalle + timeline | Historial ordenado |
| `/remove <guia>` | Borra (con confirmación) | Teclado Sí/No |
| `/cp <codigo>` | Guarda tu CP habitual (valida Oaxaca) | `/cp 68000` |
| `/notify on\|off` | Activa/desactiva avisos | Confirmación |

**Paso 3.** Plantillas de texto con emojis por estado:
`created 🆕 · in_transit 🚚 · customs 🛃 · at_branch 🏤 · out_for_delivery 🛵 · delivered ✅ · exception ⚠️ · returned ↩️`

Mensajes clave en español de México:
- Aduana: *"🛃 Tu paquete está en revisión aduanal. Es normal en pedidos de Shein/Temu/AliExpress; puede tardar varios días."*
- Sucursal: *"🏤 Ya está en sucursal en Oaxaca. Puedes pasar a recogerlo (ocurre) o esperar el reparto."*

**Paso 4.** Manejar errores con mensajes claros, nunca un stack trace.

**Paso 5.** Probar en Telegram con `npm run dev` y el token real.

---

### Fase 7 — Notificaciones automáticas (Rol B + D)

**Paso 1.** `src/index.ts` — arrancar bot + scheduler:

```ts
import cron from 'node-cron';
import { env } from './config/env.js';
import { bot } from './bot/bot.js';
import { TrackingService } from './services/tracking.service.js';
import { ShipmentRepository } from './repositories/shipment.repository.js';

const repo = new ShipmentRepository(env.DATABASE_PATH);
const service = new TrackingService(repo);

cron.schedule(`*/${env.POLL_INTERVAL_MINUTES} * * * *`, async () => {
  const changed = await service.syncAll();
  for (const { shipment, newStatus } of changed) {
    if (!repo.userWantsNotifications(shipment.telegramId)) continue;
    await bot.api.sendMessage(shipment.chatId,
      `${EMOJI[newStatus]} Tu paquete ${shipment.alias ?? shipment.trackingNumber} ahora está: ${LABEL[newStatus]}`);
  }
});

bot.start();  // long polling (simple; en producción se puede pasar a webhook)
console.log('🤖 Bot arrancado');
```

**Paso 2.** **Anti-spam:** no notificar si el estado no cambió (ya lo garantiza `syncAll`) ni dos veces el mismo evento.
**Paso 3.** **Respeto de límites:** procesar secuencialmente (como en el ejemplo) o con un delay entre consultas. Nunca 500 peticiones a la vez.

---

### Fase 8 — Pruebas y calidad

**Paso 1.** `npm run typecheck` debe pasar en cada PR.
**Paso 2.** Probar el camino feliz y los casos raros: guía inválida, CP que no es de Oaxaca, paquete duplicado, API caída, usuario sin paquetes, paquete retenido en aduana.
**Paso 3.** (Opcional) `vitest` para testear `TrackingService` con el adaptador `fake` — sin red.
**Paso 4.** Revisión cruzada: cada compañero prueba el trabajo de otro.

---

### Fase 9 — Despliegue

**Paso 1.** Elegir destino:
- **Rápido/free tier:** Railway, Render o Fly.io → conectan el repo y despliegan solos.
- **VPS propio (más control, ~4-6 USD/mes):** Ubuntu + Docker.

**Paso 2.** Dockerizar:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

**Paso 3.** Configurar las variables de entorno en el panel del proveedor (nunca en el repo).
**Paso 4.** Montar un **volumen** para el SQLite, o migrar a Postgres si el despliegue es efímero.
**Paso 5.** Alternativa con PM2 en VPS:

```bash
npm run build
npm install -g pm2
pm2 start dist/index.js --name tracking-bot
pm2 save && pm2 startup
```

**Paso 6.** (Producción seria) Pasar de long polling a **webhook** con HTTPS y dominio: `bot.api.setWebhook(...)` + servidor Express/Fastify.

---

### Fase 10 — Mantenimiento y v2

- **Logs** con niveles (`LOG_LEVEL`) y alerta si el bot lleva caído X minutos.
- **Añadir paqueterías** = crear un archivo en `carriers/` y registrarlo en la factory.
- **v2:** dashboard web, Postgres, notificaciones por email, mapa de sucursales en Oaxaca, detección de "ocurre" disponible.

---

## 7. Cronograma sugerido (equipo de 3-4, ~2-3 semanas a tiempo parcial)

| Semana | Objetivo | Entregable |
|---|---|---|
| 1 | Contratos + Fases 1-4 | Bot arranca, guarda paquetes en SQLite, valida CP de Oaxaca |
| 2 | Fases 5-6 | Bot funcional en Telegram con /add /list /status |
| 3 | Fases 7-9 | Notificaciones automáticas + desplegado |

---

## 8. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Paqueterías mexicanas sin API pública | Alto | Agregador (AfterShip/TrackingMore/17TRACK) tras el adaptador |
| Guías de 10 dígitos ambiguas (DHL vs Estafeta) | Medio | Pedir la paquetería en `/add`; no autodetectar |
| Paquetes de Shein/Temu retenidos en aduana | Medio | Estado `customs` + mensaje explicativo para no alarmar |
| Cobertura irregular en municipios de Oaxaca | Medio | Avisar del "ocurre" (recoger en sucursal) |
| Límite de peticiones del agregador | Medio | Intervalo configurable + procesado secuencial |
| HTML/API cambia (scraping) | Medio | Aislado en un solo adaptador |
| Token del bot filtrado | Alto | `.env` en `.gitignore`; rotar token con BotFather |
| SQLite se corrompe en despliegue efímero | Medio | Volumen persistente o migrar a Postgres |
| Datos personales (CP, dirección) | Medio | No guardar dirección completa; solo CP. Ley LFPDPPP |
| La arquitectura se degrada a "bola de barro" | Alto | `npm run check:arch` en CI + revisión de PR contra la matriz de la sección 2.5 |
| Conflictos de Git | Bajo | Una rama por tarea + PRs + contratos congelados |

---

## 9. Checklist de "hecho" (por fase)

- [ ] Contratos escritos y commiteados
- [ ] `npm run check:arch` pasa (dirección de dependencias respetada, ver sección 2.5)
- [ ] `npm run dev` arranca sin errores con `.env` válido
- [ ] `npm run typecheck` pasa
- [ ] Validación de CP de Oaxaca (68000–71999) funcionando
- [ ] Adaptador probado de forma aislada (sin bot), con guía real de Estafeta y de Mercado Libre
- [ ] Repositorio guarda y lee paquetes correctamente
- [ ] `/add`, `/list`, `/status`, `/remove`, `/cp` funcionan en Telegram
- [ ] El scheduler notifica **solo** cuando cambia el estado
- [ ] Estado `customs` (aduana) se muestra con mensaje explicativo
- [ ] Desplegado y funcionando 24 h seguidas sin caídas

---

## 10. Cómo vamos a trabajar (modo acompañado)

> Acuerdo de trabajo del equipo. **Hay miembros que son principiantes**, así que este documento manda sobre la prisa.

### 10.1 El ritmo: micro-pasos verificables

Un **paso** es algo que se puede ejecutar y ver que funciona antes de seguir. Nunca hacemos dos pasos a la vez.

Ciclo de cada paso:

1. **Se explica** qué vamos a hacer y **por qué** (no solo el qué).
2. **Se escribe** el código o se da el comando exacto.
3. **El equipo ejecuta** y pega el resultado — funcione o falle.
4. **Se verifica** y, si falla, se arregla antes de continuar.
5. Se marca como hecho y se pasa al siguiente.

### 10.2 Reglas para el equipo

- **Nadie escribe código que no entienda.** Si algo no se entiende, se pregunta *antes* de copiarlo.
- **Un paso a la vez.** Si algo se bloquea, se para. No se avanza "a ver si funciona".
- **Los errores son información, no fracaso.** Pegar el error **completo**, no un resumen.
- **Los comandos no se memorizan**, se ejecutan. Aquí siempre estarán escritos.
- **Nada de copiar y pegar sin leer.** El objetivo es que al final podáis mantenerlo vosotros solos.

### 10.3 Reparto de trabajo

| El asistente hace | El equipo hace |
|---|---|
| Explica cada concepto nuevo la primera vez | Ejecuta los comandos y pega la salida |
| Escribe el código y los archivos de configuración | Prueba el bot en Telegram |
| Traduce los errores y propone la corrección | Decide lo que afecta al producto |
| Mantiene el plan y el orden de los pasos | Añade sus propios adaptadores de paquetería |
| Vigila que se respete la arquitectura (sección 2) | Revisa los PR de sus compañeros |

### 10.4 Al empezar cada sesión

Preguntad **"¿en qué vamos?"**. La respuesta será siempre:

1. El estado actual real (qué funciona y qué no).
2. El siguiente paso concreto.
3. Nada más. Un paso.

### 10.5 Estado actual

| Fecha | Estado | Siguiente paso |
|---|---|---|
| 2026-09-25 | Fase 6 (comandos): `/add` (guarda y consulta el estado por primera vez) y `/list` (con estado real). El repositorio tipa `status` como `NormalizedStatus` y añade `actualizarEstado()`. **Verificado:** guardado con estado real, duplicado con mensaje legible, paquetería inválida rechazada, aislamiento entre usuarios. | Probar `/add` y `/list` en Telegram y hacer commit |
| 2026-09-25 | **Paso 10 / Fase 7 — sincronizador automático.** `SyncService.syncAll()` recorre todos los paquetes y avisa **solo cuando el estado cambió**. La capa de aplicación emite datos (`CambioDeEstado`), no frases: el bot las convierte en mensaje. El reloj es un `setTimeout` autorreagendado. Adaptador de desarrollo `secuencia` para poder verlo funcionar. **Verificado con 4 pruebas** (`npm test`) y con el flujo completo de punta a punta. | Probar en Telegram (`/add secuencia SECU000123` con `POLL_INTERVAL_MINUTES=1`) y hacer commit |
| 2026-09-25 | **Paso 11 — validación de CP de Oaxaca.** `src/config/oaxaca.ts` con la función pura `validarCp()`. Distingue los **dos** motivos de rechazo (no tiene 5 dígitos / no es de Oaxaca) porque al usuario hay que decirle *cuál* de los dos es. **Verificado con 7 pruebas nuevas (11 en total, todas en verde)**, `typecheck` limpio y **chequeo de mutación** (bajar el límite a 71998 pone roja justo la prueba del límite superior). | Conectar la validación al bot: comando `/cp <codigo>` y validar el CP en `/add` |

**Método de trabajo adoptado** (ver §11): TDD (prueba que falla primero), revisión de 5 ejes y criterio "Ponytail" (la solución más simple que funcione).

**Pendiente de este paso:**

- El sincronizador **no tiene prueba propia** (su lógica sí: `SyncService` está cubierto). Probar el reloj exigiría inyectar temporizadores; no compensa todavía.
- `npm run build` compila los `.test.ts` dentro de `dist/`. Inofensivo (nada los importa), pero se puede limpiar con un `tsconfig.build.json`.
- El adaptador `secuencia` es una herramienta de desarrollo: hay que decidir si se queda en el catálogo de producción o se saca antes de desplegar.
- `syncAll()` consulta los paquetes **de uno en uno**. Con pocos paquetes sobra; si algún día son cientos, toca paralelizar con un límite.
- Sigue sin existir `scripts/check-architecture.mjs` (sección 2.8): las reglas de dependencia están escritas pero no se comprueban solas.
- `src/config/oaxaca.ts` **ya existe** con `validarCp()`, pero **todavía no lo usa nadie**: falta el comando `/cp <codigo>` y validar el CP en `/add`. Siguen pendientes `/remove` y `/notify on|off`.
- Los adaptadores reales (Estafeta, MercadoLibre, DHL, agregador) siguen pendientes.

---

## 11. Registro de decisiones

Cada decisión importante, con su motivo. Así, dentro de dos meses nadie tiene que preguntar "¿por qué está esto así?".

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-09-25 | **Arquitectura Modular por Capas Pragmática** (sección 2) | Da orden sin exigir contenedores de inyección ni DDD completo |
| 2026-09-25 | **Agregador de rastreo** (AfterShip/TrackingMore) en vez de APIs oficiales | Ninguna paquetería mexicana ofrece API de rastreo abierta y gratuita, salvo Mercado Libre |
| 2026-09-25 | **No autodetectar la paquetería**; se indica en el comando | DHL y Estafeta usan ambos 10 dígitos: es imposible distinguirlas |
| 2026-09-25 | **`better-sqlite3`** en vez de `node:sqlite` | `node:sqlite` es experimental y avisa en cada arranque; `better-sqlite3` es estable y usa binarios precompilados (sin compilar en Windows) |
| 2026-09-25 | **SQLite** como base de datos | Un solo archivo, cero infraestructura. Le sobra capacidad para este proyecto |
| 2026-09-25 | **Despliegue en VPS propio** | Disco persistente: SQLite funciona sin problema. Los free tiers (Render/Railway) borran el disco en cada despliegue y obligarían a migrar a PostgreSQL |
| 2026-09-25 | **Los estados viven como texto** en la base de datos | SQLite no tiene tipos enumerados; la conversión se hace en un único punto (`aShipment` en el repositorio) |
| 2026-09-25 | **`node:test` + `tsx`** como corredor de pruebas | Node 22 ya trae corredor de pruebas incluido: cero dependencias nuevas. Comando: `npm test` |
| 2026-09-25 | **Pruebas contra base de datos en memoria** (`:memory:`) | Cada prueba arranca limpia y no deja archivos. En Windows no se puede borrar un SQLite que sigue abierto (`EBUSY`), así que un archivo temporal no sirve |
| 2026-09-25 | **`setTimeout` autorreagendado, no `setInterval`**, para el sincronizador | Con `setInterval`, una revisión lenta se solapa con la siguiente y el usuario recibe el mismo aviso dos veces |
| 2026-09-25 | **Temporizadores de Node, no `node-cron`** | `setTimeout` viene incluido; `node-cron` sería una dependencia más para una línea |
| 2026-09-25 | **El servicio emite DATOS (`CambioDeEstado`), no texto** | La capa de aplicación no debe saber español ni Telegram. Así el mismo aviso podría salir por correo o WhatsApp sin tocar el servicio |
| 2026-09-25 | **El estado se guarda ANTES de enviar el aviso** | El sincronizador siempre avanza y nunca repite un mensaje ya enviado. A cambio, si Telegram falla, ese único aviso se pierde (el usuario puede ver el estado con `/list`) |
| 2026-09-25 | **`chat_id` se lee de la tabla `users`, no se asume igual a `telegram_id`** | En un chat privado coinciden, en un grupo no. El dato ya estaba guardado: usarlo es más correcto que suponer |
| 2026-09-25 | **Adaptador `secuencia`** (avanza un estado por consulta) | Sin él no había forma de *ver* el sincronizador funcionando: los adaptadores existentes devuelven siempre el mismo estado |
| 2026-09-25 | **Método de trabajo: TDD + revisión de 5 ejes + Ponytail** | Prueba que falla primero; revisión con severidades; la solución más simple que funcione. Reduce bugs silenciosos, que es justo el riesgo de un bot que corre solo |
| 2026-09-25 | **Una sola función `validarCp()`**, en vez de `isOaxacaCp()` + `validateCp()` (como esbozaba §6.2) | Dos funciones donde una hace el trabajo es código de más que mantener, y la que sobra no aporta nada que la otra no haga ya |
| 2026-09-25 | **Validar un CP devuelve una unión discriminada** `{ ok: true } \| { ok: false; motivo: string }`, no `{ ok, message? }` | Con el mensaje opcional, nada impide leerlo sin comprobar `ok` y quedarse con `undefined`. Con la unión, el compilador obliga a tratar el caso de error. Un CP inválido tiene SIEMPRE motivo |
| 2026-09-25 | **`validarCp()` hace `trim()` ella misma** | En Telegram es habitual teclear " 68000 " sin querer. No tiene sentido castigar al usuario por un espacio de más, y resolverlo en un sitio evita que cada llamador tenga que acordarse |

> **Nota sobre la base de datos:** si algún día se migra a PostgreSQL, el trabajo está acotado a
> `db.ts` y `shipment.repository.ts` (métodos `async` y marcadores `$1, $2` en vez de `?`). El bot,
> el servicio y los adaptadores no se tocan.

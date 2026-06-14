# Runbook — App Finanzas

Operational procedures. Keep this up to date as infrastructure changes.

---

## Acciones manuales en Vercel — referencia histórica

> **Estado actual (2026-06-04)**: todas las variables críticas ya están configuradas. Esta sección documenta qué se configuró y cómo, para referencia futura o si hay que recrear el entorno desde cero.

Esta sección está escrita para el propietario del proyecto, no para un desarrollador.

---

### Paso 1 — Configurar las variables de entorno en Vercel

**Cómo llegar:**
1. Abre [https://vercel.com/dashboard](https://vercel.com/dashboard) en el navegador
2. Haz clic en el proyecto **App-Finanzas**
3. Haz clic en **Settings** (pestaña superior)
4. Haz clic en **Environment Variables** (menú lateral izquierdo)
5. Para cada variable de la lista de abajo: haz clic en **Add**, escribe el nombre exacto, pega el valor, marca al menos **Production**, y haz clic en **Save**
6. Una vez añadidas todas, ve a la pestaña **Deployments**, haz clic en los tres puntos del último deployment, y selecciona **Redeploy** para que el servidor use las nuevas variables

---

### Variables obligatorias

#### `CRON_SECRET`
- **Obligatoria.** Sin esto, el cron devuelve 503 y no ejecuta nada.
- Genera un valor seguro con este comando en tu terminal:
  ```bash
  openssl rand -hex 32
  ```
  O usa cualquier generador de contraseñas seguras (mínimo 32 caracteres aleatorios).
- Copia el resultado y pégalo como valor de la variable.

#### `PRICE_PROVIDER`
- **Obligatoria.** Sin esto la app usa precios ficticios (mock).
- Valor en producción actual: `twelvedata` (configurada desde Mayo 2026).
- **No cambiar a `yahoo`**: Yahoo Finance rate-limita desde IPs de cloud de Vercel. Twelve Data es el provider de producción. Requiere `TWELVE_DATA_API_KEY`.
- Ver `docs/DECISIONS.md` sección "Twelve Data as production pricing provider".

#### `KV_REST_API_URL`
- **Obligatoria para persistencia real.** Sin esto, los datos del motor se pierden en cada invocación de Vercel.
- El valor sale de Vercel KV / Upstash (ver Paso 2 más abajo).

#### `KV_REST_API_TOKEN`
- **Obligatoria para persistencia real.** Va junto con `KV_REST_API_URL`.
- El valor sale de Vercel KV / Upstash (ver Paso 2 más abajo).

#### `TELEGRAM_BOT_TOKEN`
- **Necesaria para recibir alertas.** Sin esto, las alertas sólo se escriben en los logs de Vercel.
- Obtén el token creando un bot con [@BotFather](https://t.me/BotFather) en Telegram (comando `/newbot`).

#### `TELEGRAM_CHAT_ID`
- **Necesaria para recibir alertas.** Va junto con `TELEGRAM_BOT_TOKEN`.
- Para obtener tu chat ID: envía un mensaje a tu bot, luego abre en el navegador:
  ```
  https://api.telegram.org/bot<TU_TOKEN>/getUpdates
  ```
  Busca el campo `"id"` dentro de `"chat"`. Ese número es tu `TELEGRAM_CHAT_ID`.

---

### Variable que NO debes configurar todavía

#### `ENGINE_API_SECRET` — NO configurar por ahora
- **No la añadas todavía.**
- Motivo: el botón "Analizar" del dashboard hace una llamada POST a `/api/engine/run` sin cabecera de autorización. Si configuras esta variable antes de que el dashboard esté actualizado para enviar el header correcto, el botón dejará de funcionar (recibirás 401).
- Cerrar ese endpoint requiere una actualización posterior del dashboard. No es urgente para un uso personal.
- Si en el futuro decides activarla: primero actualiza `page.tsx` para enviar `Authorization: Bearer $ENGINE_API_SECRET` en el POST, luego añade la variable.

---

### Paso 2 — Crear y conectar el almacén Vercel KV (Upstash)

El almacén KV permite que el motor guarde y recupere datos entre ejecuciones. Sin él, cada vez que Vercel arranca un contenedor nuevo los datos del análisis anterior desaparecen.

**Cómo crear el KV:**
1. En el proyecto **App-Finanzas** en Vercel, haz clic en la pestaña **Storage**
2. Haz clic en **Create Database** (o **Connect Store** si ya tienes uno)
3. Selecciona **KV** (Upstash) y haz clic en **Continue**
4. Ponle un nombre (ej. `app-finanzas-kv`) y selecciona la región más cercana
5. Haz clic en **Create** y confirma
6. Vercel conecta el store automáticamente y añade `KV_REST_API_URL` y `KV_REST_API_TOKEN` como variables de entorno del proyecto
7. Verifica que ambas variables aparecen en **Settings → Environment Variables** con scope **Production**

---

### Paso 3 — Configurar Telegram (si quieres alertas)

1. En Telegram, abre la app y busca [@BotFather](https://t.me/BotFather)
2. Envíale el comando `/newbot` y sigue las instrucciones (elige nombre y username)
3. BotFather te dará un token con el formato `123456789:ABCdef...` — ese es tu `TELEGRAM_BOT_TOKEN`
4. Envía cualquier mensaje a tu bot para iniciar el chat
5. Abre en el navegador:
   ```
   https://api.telegram.org/bot<TU_TOKEN>/getUpdates
   ```
6. Busca `"chat": { "id": <número> }` — ese número es tu `TELEGRAM_CHAT_ID`
7. Añade ambas variables en Vercel (ver Paso 1)

---

### Paso 4 — Verificar que todo funciona

Después de añadir las variables y redeployar, ejecuta estos comandos para confirmar que Vercel las ha cargado. Sustituye `<URL>` por la URL de tu proyecto en Vercel y `<SECRET>` por el valor de `CRON_SECRET`.

```bash
BASE="https://<URL>"
SECRET="<tu-CRON_SECRET>"
```

**Verificar que el endpoint de estado reconoce la configuración:**
```bash
curl -s "$BASE/api/config/status" | jq .
```
Respuesta esperada tras configurar todo:
```json
{
  "priceProvider": "twelvedata",
  "cronSecretSet": true,
  "telegramConfigured": true,
  "isVercel": true,
  "kvConfigured": true
}
```
- `priceProvider` debe ser `"twelvedata"`, no `"mock"` ni `"yahoo"`
- `cronSecretSet` debe ser `true`
- `telegramConfigured` será `true` sólo si has añadido ambas variables de Telegram
- `kvConfigured` debe ser `true` — si es `false`, las env vars de KV no son visibles en runtime y la persistencia entre invocaciones no funcionará

**Verificar protección del cron:**
```bash
# Sin header → debe devolver 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily"

# Header incorrecto → debe devolver 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily" \
  -H "Authorization: Bearer valorincorrecto"

# Header correcto → debe devolver 200 (el motor se ejecuta)
curl -s "$BASE/api/cron/daily" \
  -H "Authorization: Bearer $SECRET"
```

**Verificar que el motor produce datos reales:**
```bash
# Ejecutar el motor manualmente (POST sin auth, porque ENGINE_API_SECRET no está configurado).
# sendDigest/sendAlertMessages en false para no disparar Telegram durante pruebas.
curl -s -X POST "$BASE/api/engine/run" \
  -H "Content-Type: application/json" \
  -d '{"sendDigest": false, "sendAlertMessages": false}' \
  | jq '{success, alertsCount, errors, eurUsdRate, samplePrice: .portfolioAnalyses[1].currentPrice}'
```
- `success` debe ser `true`, `errors` debe ser `[]`
- `eurUsdRate` debe ser un número (~1.0–1.3), no `null`
- Nota: no hay `pricingMethod` a nivel raíz — vive dentro de cada opportunity. `proxy_drawdown_only` en ETFs europeos (CNDX, IWVL) es esperado, no un fallo.

**Verificar persistencia (si KV está configurado):**
```bash
# Después de ejecutar el motor, recuperar el último resultado guardado
curl -s "$BASE/api/engine/run" | jq '{runAt, noData}'
# Y verificar que las rutas de lectura ven el mismo run:
curl -s "$BASE/api/opportunities" | jq '{lastRunAt, stocks: (.stocks|length)}'
curl -s "$BASE/api/portfolio" | jq '{lastRunAt, analyses: (.analyses|length)}'
```
- `runAt`/`lastRunAt` deben mostrar la fecha del último run en las TRES rutas
- Si `/api/engine/run` GET tiene datos pero `/api/opportunities` devuelve `lastRunAt: null`, revisar la sección "Lección Fase 1" (caching/env inlining)

**Verificar Telegram:**
- Después de ejecutar el motor con `POST /api/engine/run`, deberías recibir un mensaje en Telegram en menos de 30 segundos.

---

### Resumen rápido — qué debe estar hecho antes del primer cron real

| Variable | Estado actual | Nota |
|---|---|---|
| `CRON_SECRET` | ✓ Configurada (Apr 30) | Cron activo |
| `PRICE_PROVIDER=twelvedata` | ✓ Configurada (May 5) | NO cambiar a `yahoo` |
| `TWELVE_DATA_API_KEY` | ✓ Configurada (May 5) | Requerida para twelvedata |
| `KV_REST_API_URL` | ✓ Configurada (May 6) | KV conectado |
| `KV_REST_API_TOKEN` | ✓ Configurada (May 6) | KV conectado |
| `TELEGRAM_BOT_TOKEN` | ✓ Configurada (Apr 30) | Bot activo |
| `TELEGRAM_CHAT_ID` | ✓ Configurada (Apr 30) | Destino activo |
| `ENGINE_API_SECRET` | **NO configurar** | Si se configura, el botón Analizar se rompe |

---

## Running tests locally

```bash
npm test
# or
npx tsx scripts/run-tests.ts
```

Runs all 23 suites. Exits 0 if all pass.

To run a single suite:
```bash
npx tsx src/lib/discovery/__tests__/provider-capability.test.ts
npx tsx src/app/api/cron/__tests__/cron-auth.test.ts
```

---

## Running the smoke script locally

```bash
npx tsx scripts/smoke-discovery-providers.ts
```

Without API keys: all providers report `missing_key`. Report written to `src/data/provider-capability-smoke.json`. Normal.

With keys:
```bash
EODHD_API_KEY=xxx FMP_API_KEY=yyy npx tsx scripts/smoke-discovery-providers.ts
```

---

## Running the provider capability smoke via GitHub Actions

1. Go to **GitHub → Actions → Multi-source capability smoke (P3-3f-0)**
2. Click **Run workflow**
3. Download artifact `provider-capability-smoke` when complete
4. Open `provider-capability-smoke.json` and check:
   - `summary.recommendedNextProvider`
   - Which providers have `"usableFor": "candidate_discovery"`
   - Any warnings

### Prerequisites (first run)
Add as **Repository Secrets** (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `EODHD_API_KEY` | eodhd.com → My Account → API tokens |
| `FMP_API_KEY` | financialmodelingprep.com → Dashboard |
| `FINNHUB_API_KEY` | finnhub.io → Dashboard → API key |
| `ALPHA_VANTAGE_API_KEY` | alphavantage.co → Get Free API Key |
| `TWELVE_DATA_API_KEY` | twelvedata.com → Dashboard |

---

## Vercel environment variables — estado actual (reconciliado PR #19)

> Las siguientes variables ya están configuradas en Vercel. Esta sección es de referencia, no de acción pendiente.

| Variable | Estado | Nota |
|---|---|---|
| `CRON_SECRET` | ✓ Configurada (Apr 30) | `cronSecretSet: true` en config/status |
| `PRICE_PROVIDER` | ✓ `twelvedata` (May 5) | NO cambiar a `yahoo`. Ver DECISIONS.md. |
| `TWELVE_DATA_API_KEY` | ✓ Configurada (May 5) | Requerida para `PRICE_PROVIDER=twelvedata` |
| `KV_REST_API_URL` | ✓ Configurada (May 6) | Auto-generada por Vercel KV |
| `KV_REST_API_TOKEN` | ✓ Configurada (May 6) | Auto-generada por Vercel KV |
| `TELEGRAM_BOT_TOKEN` | ✓ Configurada (Apr 30) | `telegramConfigured: true` en config/status |
| `TELEGRAM_CHAT_ID` | ✓ Configurada (Apr 30) | Junto con BOT_TOKEN |
| `EODHD_ENABLED` | Configurada, **inactiva** | No tiene efecto con `PRICE_PROVIDER=twelvedata` |
| `ENGINE_API_SECRET` | **NO configurar** | Dashboard llama POST sin auth; configurar esto rompe el botón Analizar |

**Nota sobre `PRICE_PROVIDER`**: los docs anteriores decían que había que configurar `PRICE_PROVIDER=yahoo`. Eso fue un error — Yahoo rate-limita desde IPs de cloud de Vercel. Twelve Data funciona correctamente. No cambiar.

### Optional

```
ENGINE_API_SECRET               = <random hex>     # closes POST /api/engine/run if set
PRICE_PROVIDER_CHAIN            = yahoo            # if using PRICE_PROVIDER=chain
TWELVE_DATA_API_KEY             = <key>            # only if adding Twelve Data to chain
EODHD_API_KEY                   = <key>            # only if activating EODHD pricing
EODHD_ENABLED                   = true             # required if using EODHD_API_KEY
DISCOVERY_INCLUDE_EXTENDED_ON_VERCEL = true        # default true; set false to disable batches
DISCOVERY_EXTENDED_BATCH_SIZE        = 8           # default 8; max 20
MOCK_MODE                       = false            # set true to force mock provider
```

---

## Verifying cron protection — manual test

Once `CRON_SECRET` is set in Vercel (and after deploying), verify:

```bash
BASE="https://<your-vercel-url>"
SECRET="<your-CRON_SECRET>"

# Case 1: missing CRON_SECRET in env → 503 (cannot test without undeploying, but code verified by unit tests)

# Case 2: no Authorization header → 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily"
# Expected: 401

# Case 3: wrong Authorization → 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily" \
  -H "Authorization: Bearer wrongvalue"
# Expected: 401

# Case 4: correct Authorization → 200 (engine runs)
curl -s "$BASE/api/cron/daily" \
  -H "Authorization: Bearer $SECRET"
# Expected: {"success":true,"runAt":"...","alerts":...}
```

The auth logic is covered by 7 unit tests in `src/app/api/cron/__tests__/cron-auth.test.ts`.

---

## Deploying

Push to `main` — Vercel auto-deploys. No manual steps.

---

## Triggering the engine manually

**Important**: `/api/engine/run` uses `ENGINE_API_SECRET`, not `CRON_SECRET`. These are separate secrets.

```bash
# POST — triggers a full engine run (stores output to KV + file-store)
# If ENGINE_API_SECRET is not set in Vercel, this endpoint is open (no auth required):
curl -s -X POST "https://<your-vercel-url>/api/engine/run"

# If ENGINE_API_SECRET is set:
curl -s -X POST "https://<your-vercel-url>/api/engine/run" \
  -H "Authorization: Bearer $ENGINE_API_SECRET"

# GET — returns the latest persisted output (KV-aware, no auth required)
curl -s "https://<your-vercel-url>/api/engine/run"
```

Response includes `success`, `runAt`, `alertsCount`, `errors` array, plus full `portfolioAnalyses`, `stockOpportunities`, `etfOpportunities`.

---

## Verificación end-to-end (Fase 1) — checklist con comandos

Usar después de confirmar que todos los env vars están configurados en Vercel. Sustituir placeholders antes de ejecutar.

```bash
BASE="https://<tu-url-de-vercel>"
CRON_SECRET="<tu-CRON_SECRET>"
```

### 1. Config status
```bash
curl -s "$BASE/api/config/status" | jq .
```
Esperado:
```json
{
  "priceProvider": "twelvedata",
  "cronSecretSet": true,
  "telegramConfigured": true,
  "isVercel": true,
  "kvConfigured": true
}
```
Si `priceProvider` es `"mock"`: redeploy pendiente o `PRICE_PROVIDER` no configurada.
Si `kvConfigured` es `false`: las env vars de KV no llegan al runtime — la persistencia entre invocaciones no funcionará (ver sección "Lección Fase 1" más abajo).

### 2. Cron auth

> **URL importante**: usar siempre la URL canónica de producción (`https://www.beaihub.com`), **no** el alias de rama (`app-finanzas-git-main-...vercel.app`).
> Los aliases de rama tienen Vercel Deployment Protection activada y devuelven 401 a nivel de proxy antes de llegar al código — no es un fallo de auth de la app.

```bash
BASE="https://www.beaihub.com"

# Sin header → debe devolver 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily"

# Header incorrecto → 401
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron/daily" \
  -H "Authorization: Bearer VALOR_INCORRECTO"

# Header correcto → 200 (motor ejecuta)
curl -s "$BASE/api/cron/daily" \
  -H "Authorization: Bearer $CRON_SECRET" | jq '{success, runAt}'
```

Verificado 2026-06-11 en `https://www.beaihub.com`: sin header → 401, header incorrecto → 401, header correcto → 200 ✅

### 3. Engine run manual
```bash
# ENGINE_API_SECRET no está configurado → no requiere auth.
# sendDigest/sendAlertMessages en false para no disparar Telegram durante pruebas.
curl -s -X POST "$BASE/api/engine/run" \
  -H "Content-Type: application/json" \
  -d '{"sendDigest": false, "sendAlertMessages": false}' \
  | jq '{success, alertsCount, errors, eurUsdRate, samplePrice: .portfolioAnalyses[1].currentPrice}'
```
- `success: true`, `errors: []` y `eurUsdRate` numérico: precios reales confirmados.
- `samplePrice` debe ser un número (no-null). Nota: `pricingMethod` no existe a nivel raíz — vive dentro de cada opportunity.
- Si `success: false` o errores: revisar campo `errors` en la respuesta.

### 4. KV persistence (write → read)
```bash
# Leer el output del run anterior (confirma KV read)
curl -s "$BASE/api/engine/run" | jq '{runAt, noData}'
```
El `runAt` debe coincidir con el run del paso 3 y `noData` debe estar ausente/null. Si `noData: true`: KV write no funcionó.

### 5. Opportunities y Portfolio
```bash
curl -s "$BASE/api/opportunities" | jq '{lastRunAt, stockCount: (.stocks | length)}'
curl -s "$BASE/api/portfolio" | jq '{holdingsCount: (.config.holdings | length), lastRunAt}'
```

### 6. CSV import

> **Campo correcto**: el formulario multipart debe llamarse `csv`, **no** `file`. `-F "file=@..."` devuelve `{"error": "No CSV file provided"}`.

```bash
curl -s -X POST "$BASE/api/portfolio/import" \
  -F "csv=@tu-trades.csv" | jq '{saved, saveSource, holdingsUpdated, unknownIsins, warnings}'
```
Esperado con KV: `{"saved": true, "saveSource": "kv", "holdingsUpdated": N, "unknownIsins": [], "warnings": []}`

Verificado 2026-06-11: `saved: true`, `saveSource: "kv"`, `holdingsUpdated: 16` ✅

> **ISINs sin ticker conocido — el import FALLA y NO actualiza la cartera (intencionado)**:
> si el CSV contiene un ISIN que no está en `ISIN_TO_TICKER`
> (`src/app/api/portfolio/import/route.ts`), el endpoint responde **HTTP 422** con
> `{"success": false, "saved": false, "unknownIsins": [...], "warnings": [...], "error": "..."}`
> y **no escribe nada en KV**. La cartera guardada se queda como estaba.
>
> Esto es deliberado: un holding sin ticker llegaría a KV, el motor pediría precio por
> el ISIN y cada engine run mostraría `No data for <ISIN>`. Preferimos no actualizar la
> cartera antes que dejarla en un estado que el motor no puede analizar por completo.
>
> **Qué hacer si ves `unknownIsins` en la respuesta**:
> 1. La cartera **no** se ha actualizado — no hay que revertir nada.
> 2. Añadir el mapping ISIN → ticker en `ISIN_TO_TICKER` (con test) y desplegar.
> 3. **Repetir el import** del mismo CSV. Esta vez `unknownIsins: []` y `saved: true`.
>
> Caso real: `US46120E6023` = Intuitive Surgical (ISRG) — mapeado el 2026-06-11.

> **Fondos privados (ELTIF) — se importan pero NO se les pide precio diario**:
> Un **ELTIF** (European Long-Term Investment Fund) es un fondo de inversión a largo
> plazo. En la práctica, en Trade Republic son **fondos de private equity** (capital
> riesgo): metes dinero en empresas que no cotizan en bolsa. Por eso **no tienen un
> precio que cambie cada día** como una acción o un ETF normal — no hay cotización
> pública que consultar.
>
> Estos activos se marcan con `type: 'private_fund'` en `ISIN_TO_TICKER`. El motor
> diario (`daily-engine.ts`) los **excluye** de la lista de símbolos a los que pide
> precio (Twelve Data). Si no lo hiciéramos, cada engine run mostraría
> `No data for <ISIN>` para siempre, porque ese precio no existe en el proveedor.
>
> Consecuencia esperada: estos fondos **aparecen en la cartera** (units y coste medio
> en EUR del CSV) pero **no tienen P&L diario ni señales de compra/venta automáticas**.
> Es correcto: su valor lo publica el gestor del fondo, no el mercado.
>
> Casos reales (mapeados el 2026-06-11):
> - `LU3176111881` = EQT Nexus Fund ELTIF (ticker interno `ENXF`)
> - `LU3170240538` = Apollo Global Private Markets ELTIF (ticker interno `APGM`)
>
> En la UI se muestran con la etiqueta **ELTIF** (badge ámbar).

### 7. Telegram
Después del paso 3, espera hasta 30 segundos. El bot debería enviar un digest con señales del portfolio.

---

## Regla anti-pérdida de contexto — qué hacer si docs y producción no coinciden

Si `/api/config/status` o los env vars de Vercel contradicen lo que dicen los docs:

1. **No tocar Vercel** inmediatamente.
2. **Verificar producción**: `curl "$BASE/api/config/status"` + revisar Vercel → Settings → Env Vars.
3. **Abrir PR docs-only** para reconciliar los docs con la realidad.
4. **Solo después** decidir si hay cambios funcionales que hacer.

Razón: los docs pueden estar desactualizados. Un agente que actúa sobre docs erróneos puede romper un sistema que ya funciona. Por ejemplo: cambiar `PRICE_PROVIDER=twelvedata` a `yahoo` cuando twelvedata ya estaba en producción y yahoo falla desde cloud IPs.

---

## Verifying production is working

1. Env vars ya configuradas (ver tabla arriba) — `kvConfigured: true` en `/api/config/status`
2. Trigger engine: `POST /api/engine/run` (o esperar cron)
3. Check `GET /api/engine/run` — debe devolver engine output con precios reales
4. Check `GET /api/opportunities` y `GET /api/portfolio` — `lastRunAt` debe coincidir con el run
5. Confirmar `currentPrice` es no-null y no-zero para AAPL, MSFT, NVDA (los ETFs proxy como CNDX tienen `currentPrice: null` por diseño — `proxy_drawdown_only`)
6. Check Telegram — digest debe llegar en menos de 30 segundos

**Todos los endpoints de lectura** (`/api/engine/run` GET, `/api/opportunities`, `/api/portfolio`) son KV-aware via `loadEngineOutput()`. Con KV configurado, devuelven datos consistentes tras un cold start de Vercel.

---

## Lección Fase 1 — rutas GET-only y env vars de KV (PRs #20, #21)

Lo aprendido durante la verificación end-to-end de Fase 1 (2026-06-09/10). Registrado aquí para que ningún agente futuro tenga que redescubrirlo.

**Síntoma observado:**
- `POST /api/engine/run` escribía a KV correctamente — logs mostraban `[EngineStore] Output saved to Vercel KV` y la llamada a `upstash.io` aparecía en External APIs de Vercel.
- `GET /api/engine/run` leía el output correctamente.
- Pero `GET /api/opportunities` y `GET /api/portfolio` devolvían siempre `"No engine output yet"` con `lastRunAt: null`, incluso segundos después de un run exitoso. En Vercel: "No outgoing requests" y sin logs de función.

**Diagnóstico en dos capas:**
1. **Caching de rutas GET-only (PR #20)**: las rutas que solo exportan `GET` son elegibles para caching estático en Next.js/Vercel — la primera respuesta del deployment (cuando aún no había output) se servía cacheada. `/api/engine/run` no sufría esto porque exporta `GET` y `POST` en el mismo archivo, lo que fuerza modo dinámico. Fix: `export const dynamic = 'force-dynamic'` en ambas rutas + imports estáticos de los stores.
2. **Inlining de env vars en build (PR #21)**: tras PR #20 el handler ya corría fresco pero seguía sin ver KV. Hipótesis confirmada por el patrón: Turbopack puede inlinear `process.env.VAR` (notación de punto) como `undefined` en build time para bundles pequeños e independientes. El bundle del POST (con todo `daily-engine.ts`) no resultaba afectado; los bundles GET pequeños sí. Fix: notación de corchete `process.env['KV_REST_API_URL']` en `engine-store.ts` y `portfolio-store.ts`, que fuerza evaluación en runtime.

**Reglas resultantes:**
- Toda ruta API GET-only que lea estado mutable (KV, file-store) debe llevar `export const dynamic = 'force-dynamic'`.
- Los stores server-side (`engine-store.ts`, `portfolio-store.ts`) deben acceder a las env vars de KV con notación de corchete. No volver a notación de punto.
- `GET /api/config/status` expone `kvConfigured` — primer check de diagnóstico si la persistencia falla.

---

## Incidente 2026-06-12 — custom domain atascado en deploy anterior

### Síntoma
`www.beaihub.com` devolvía `success: false, unknownIsins: [LU3176111881, LU3170240538]` después de mergear y desplegar PR #30 (fix ELTIF). El import fallaba con el fail-closed guard aunque el código correcto ya estaba en `main`.

### Causa raíz
El PR #30 se construyó con `target: production` y `state: READY` en Vercel. Vercel asignó el alias `app-finanzas-beatriztts-projects.vercel.app` a ese deployment (confirmado vía API). Sin embargo, el check post-deploy marcó `failure`, y como resultado Vercel **no transfirió el custom domain `www.beaihub.com`** al nuevo deployment. `beaihub.com` siguió sirviendo el código de PR #29 (que tiene el fail-closed de #28 pero no los mappings ELTIF de #30).

En paralelo, al intentar importar usando las URLs `.vercel.app` alternativas, se obtenía `jq: parse error` porque esas URLs tienen Vercel Deployment Protection activa (devuelven HTML de login, no JSON).

### Resolución
Promover manualmente el deployment `dpl_AMKZkeenYGon7F6Kn237cdMvMmPm` (f0af3e1, PR #30) a producción vía Vercel dashboard o API. Esto transfiere `beaihub.com` al deployment correcto.

**Cómo promover manualmente** (si ocurre de nuevo):
1. Ir a Vercel Dashboard → proyecto `app-finanzas` → pestaña **Deployments**
2. Localizar el deployment del commit correcto (en este caso f0af3e15)
3. Hacer clic en los tres puntos `...` → **Promote to Production**
4. Confirmar. El custom domain ahora apunta al deployment correcto.

### Acción futura
**Cuando un deploy quede atascado**: antes de depurar código, verificar qué deployment está sirviendo el custom domain:
```bash
# Comprobar qué commit sirve el custom domain
curl -sI https://www.beaihub.com/api/config/status | grep -i x-vercel-id
# Si el commit no coincide con el último de main → custom domain no fue promovido
```

### Procedimiento de verificación tras un fix de mapping/import (re-import + engine)

Después de desplegar (y promover, si aplica) un fix que cambia `ISIN_TO_TICKER` o el import:

```bash
BASE="https://www.beaihub.com"
f="$HOME/Desktop/<tu-export>.csv"   # ver L8 si el nombre tiene paréntesis/espacios

# 1. Re-import — debe persistir en KV sin ISINs desconocidos
curl -s -X POST "$BASE/api/portfolio/import" -F "csv=@$f" \
  | jq '{success, saved, saveSource, holdingsUpdated, unknownIsins}'
# Esperado: success:true, saved:true, saveSource:"kv", unknownIsins:[]

# 2. Verificar que KV tiene los tickers/tipos correctos para los ISINs problemáticos
curl -s "$BASE/api/portfolio" \
  | jq '[.config.holdings[] | select(.isin=="US46120E6023" or (.isin|startswith("LU"))) | {isin, ticker, type}]'
# Esperado: ISRG/stock, ENXF/private_fund, APGM/private_fund

# 3. Re-correr el engine — sin errores "No data for..."
curl -s -X POST "$BASE/api/engine/run" \
  -H "Content-Type: application/json" \
  -d '{"sendDigest": false, "sendAlertMessages": false}' \
  | jq '{success, errors}'
# Esperado: success:true, errors:[]
```

Verificado 2026-06-12 tras PR #30: los 3 pasos OK ✅ (ver CTO_BACKLOG P1-3c).

---

## Alert history y dedupe (PR-1, Fase 2)

### Qué se guarda y dónde

| Clave KV | Contenido | Tamaño máximo |
|---|---|---|
| `alerts:history` | Ring buffer de alertas enviadas/descartadas (`Alert[]`) | 500 entradas |
| `alerts:previous_states` | Mapa `assetId → { state, lastAlertAt }` — para detectar cambios de estado y evitar spam | Sin límite (un entry por activo) |

Fallback: si KV no está disponible, se usa file-store (`src/data/` en local, `/tmp/app-finanzas` en Vercel). En Vercel sin KV, el file-store es efímero entre invocaciones — la deduplicación pierde memoria pero el sistema no falla.

### Semántica del cooldown y la deduplicación

- `previous_states.state` = **"último estado notificado con éxito"** (refinado por P1-4d — ver abajo). No es "último generado" ni "último observado": el dedupe solo avanza para una transición alertable cuando Telegram confirmó la entrega.
- Cooldown (`ALERT_COOLDOWN_HOURS`, default 24h) **solo se aplica a repeticiones del mismo estado**.
- **Cualquier transición a un estado alertable** (p.ej. `BUY_MORE → REDUCE`) **bypasa el cooldown**. Una alerta de protección de capital no se puede suprimir por un cooldown activo.
- `REVIEW → REVIEW`: no se re-alerta nunca (el generador bloquea repeticiones del mismo estado). Recordatorios para REVIEW persistente quedan como mejora futura si se ve necesario.

### Si Telegram falla, el dedupe NO avanza (P1-4d)

**Garantía central de las alertas defensivas**: si la app detecta una señal de venta/reducción, Beatriz la recibe. Para que esto se cumpla, el avance del dedupe está condicionado a la entrega real, no a la generación.

- `generateAlerts()` **no** persiste `previous_states`. Devuelve `{ alerts, context }`.
- El engine envía por Telegram y luego llama `commitPreviousStates(context, deliveredAlerts)`, donde `deliveredAlerts = sentAlerts.filter(a => a.telegramSent)`.
- Reglas:
  - **Alertable + entregado** → avanza `state` + `lastAlertAt` (la ventana de recordatorio cuenta desde la entrega).
  - **Alertable + NO entregado** (Telegram falló / `sendAlertMessages:false` / envío parcial) → **no avanza**; se mantiene el último estado notificado → se vuelve a alertar en el siguiente run.
  - **No alertable** (`DO_NOTHING`, `WAIT`, …) → actualiza baseline observado sin `lastAlertAt`, para detectar futuras transiciones.
- Consecuencia operativa: si ves en logs `telegram_alerts: <error>`, las alertas defensivas de ese run **no** quedaron marcadas como enviadas y reaparecerán en el próximo run. No hace falta intervención manual para recuperarlas.
- `alerts:history` (ring buffer) sí guarda todas las alertas generadas con su flag `telegramSent` — es el registro de auditoría, independiente del dedupe.

### Recordatorio REDUCE sin resolver (P1-4b)

Decisión del propietario (2026-06-12): una posición que sigue en `REDUCE` sin que se haya actuado **se recuerda cada N días** — una señal defensiva no puede quedar enterrada para siempre porque la primera alerta pasó desapercibida.

- `REDUCE` nuevo (transición desde otro estado) → alerta inmediata, bypasa cooldown.
- `REDUCE → REDUCE` dentro de la ventana de recordatorio → suprimido.
- `REDUCE → REDUCE` pasada la ventana → re-alerta con prefijo `🔁 Recordatorio` (distinguible de una señal nueva). Cada recordatorio reinicia la ventana.

**Variable**: `ALERT_REDUCE_REMINDER_DAYS`
- Default: `3` (no hace falta configurarla en Vercel si se quiere el default).
- `0` = recordatorios desactivados (`REDUCE → REDUCE` no se repite nunca, comportamiento PR-1).
- Valor inválido → se usa el default 3.
- El código la lee con bracket notation (`process.env['ALERT_REDUCE_REMINDER_DAYS']`) — regla anti-inlining de Turbopack.

**No es tiempo real**: la alerta se evalúa en cada ejecución del engine (cron 07:00/16:00 UTC L-V o run manual). Más frecuencia de ejecución sería una fase posterior.

### Copy defensivo de Telegram (P1-4b)

`REDUCE` y `REVIEW` de cartera tienen templates propios (en `generator.ts`), distintos del template genérico de compra:

- `REDUCE` (🟡): explica la causa (beneficio/concentración/target, vía `reasons` del engine), sugiere en tono no imperativo ("podrías vender un 20-25%"), y aclara que **no significa vender todo**. Nunca contiene copy de compra ("Plantéate añadir").
- `REDUCE` con `currentPrice: null` (precio EUR no confirmado en ese run): se alerta igualmente (p.ej. por concentración) pero **sin cifras** — nunca se muestran importes que podrían ser incorrectos.
- `REVIEW` (⚠️): si la causa es caída >35%, copy urgente ("Caída fuerte: revisa antes de actuar"); si es riesgo de tesis, copy preventivo ("No es urgente, pero conviene revisarla"). Siempre cierra con: no compres más todavía, revisa la tesis, no significa vender automáticamente.
- `priceError` → no se genera alerta (sin datos no hay señal).
- Oportunidades (`EXIT` / `REVIEW_FOR_TRIM`) **no** están cubiertas — siguen con template genérico hasta P1-4c.
- **Escape de Markdown** (Codex Review fix): los valores dinámicos (`prevState`, `ticker`, nombre, `reasons`) pasan por `escapeMd()` antes de interpolarse. Telegram usa `parse_mode: Markdown` y los nombres de estado llevan underscores (`BUY_MORE`), que romperían el formato (`_Antes era: BUY_MORE_`) y podrían hacer que Telegram rechace el mensaje entero. `escapeMd()` convierte `_` → `-` (`BUY-MORE`) y elimina `*`, `` ` ``, `[`, `]`. Solo se escapan valores dinámicos; el markup estático del template se mantiene.

### Verificar alert history en producción

```bash
BASE="https://www.beaihub.com"

# Ver las últimas 5 alertas
curl -s "$BASE/api/alerts?limit=5" | jq '{count: .count, alerts: [.alerts[] | {id, type, asset, newState, telegramSent, timestamp}]}'

# Ver previous_states en KV (requiere curl directo a Upstash — no expuesto por API)
# Si previous_states está vacío: las alertas se reenviarán todas en el próximo run (comportamiento correcto)
```

### Qué hacer si KV no está disponible

1. `GET /api/config/status` → `kvConfigured: false` → las env vars de KV no llegan al runtime.
2. Sin KV: alert history no persiste entre invocaciones. El motor no falla; simplemente pierde memoria del ciclo anterior.
3. Corrección: verificar `KV_REST_API_URL` y `KV_REST_API_TOKEN` en Vercel Dashboard → Settings → Environment Variables.

---

## Vercel "Error" en PR con build READY (post-deploy check)

### Síntoma
El bot de Vercel comenta "Error" en el PR pero el build se completó correctamente (`✓ Compiled successfully`). El deployment list muestra `state: READY`.

### Causa
Vercel tiene dos capas: (1) build y (2) post-deploy check. El build puede pasar (`READY`) pero el post-deploy check puede fallar. Cuando esto ocurre, Vercel marca el commit como `nextCommitStatus: FAILED` en el comentario del PR aunque el deployment esté `READY` y sirva correctamente.

**Este patrón no indica un error de código.** El mismo patrón ocurrió en PR #30 y PR #31.

### Impacto
- El deployment preview en `*.vercel.app` funciona correctamente.
- El custom domain `beaihub.com` **no se promueve automáticamente** — sigue sirviendo el deployment anterior.
- Merge del PR: seguro si tests locales, TSC y build están verdes.
- Después del merge: si `beaihub.com` no se actualiza, promover manualmente (ver "Incidente 2026-06-12").

### Diagnóstico
```bash
# ¿Qué commit sirve el custom domain actualmente?
curl -sI https://www.beaihub.com/api/config/status | grep -i x-vercel-id
# Si no coincide con el HEAD de main → promover manualmente
```

### L8: Nombre de archivo con paréntesis en zsh

`Exportación de transacción (2).csv` contiene paréntesis que zsh interpreta como expansión de historial (`event not found: )`). Para evitarlo:

```bash
# Asignar a variable primero — zsh no expande dentro de cadenas ya asignadas
f="$HOME/Desktop/Exportación de transacción (2).csv"
curl -s -X POST "$BASE/api/portfolio/import" -F "csv=@$f" | jq ...
```

Alternativa: escapar con backslash `\(2\)`.

---

## Lecciones adicionales Fase 1 (2026-06-11)

Tres lecciones adicionales descubiertas al completar la verificación el 2026-06-11, complementarias a las de PRs #20/#21.

### L3: Vercel Deployment Protection bloquea aliases de rama

Los aliases con formato `app-finanzas-git-main-...vercel.app` tienen Vercel Deployment Protection activada por defecto. Cualquier request a esas URLs devuelve 401 a nivel de proxy — el código Next.js nunca se ejecuta, y el log de la función no aparece en Vercel Logs.

**Regla**: para cualquier test manual de la API en producción, usar siempre `https://www.beaihub.com` (dominio canónico de producción), nunca el alias de rama.

**Diagnóstico**: si un test manual devuelve 401 y no aparece ninguna entrada en Vercel Logs ni en "Invocations" de la ruta, el 401 viene del proxy — no del código.

### L4: Campo del formulario CSV es `csv`, no `file`

`POST /api/portfolio/import` lee `formData.get('csv')`. Si el campo se envía como `file` (e.g., `-F "file=@trades.csv"`), el endpoint devuelve `{"error": "No CSV file provided"}`.

**Regla**: siempre usar `-F "csv=@ruta/al/archivo.csv"` en tests de importación.

### L5: CRON_SECRET — bracket notation en la ruta del cron

`process.env.CRON_SECRET` (dot notation) puede ser inlinado por Turbopack como `undefined` en build time para bundles pequeños. La ruta `/api/cron/daily` usa `process.env['CRON_SECRET']` (bracket notation) — esta es la forma correcta y debe mantenerse así.

**Regla**: cualquier env var leída en rutas de cron o stores server-side debe usar bracket notation `process.env['VAR']`.

### L6: Nunca loguear secretos ni fragmentos de secretos

Durante el debug del 401 del cron (PR #23) se añadió temporalmente un `console.log` que imprimía la longitud y los primeros caracteres de `CRON_SECRET` y del header `Authorization`. Eso quedó en los logs de Vercel. Se revirtió en PR #24.

**Regla permanente** (no negociable):
- **Nunca** loguear el valor de un secreto, ni siquiera parcialmente: nada de `.substring(0, N)`, `.length`, prefijos, sufijos ni hashes de `CRON_SECRET`, `KV_REST_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TWELVE_DATA_API_KEY`, `ENGINE_API_SECRET` ni ningún token.
- Para depurar auth, loguear únicamente el **resultado** de la comparación (`ok: true/false`, código de estado), nunca el material de entrada.
- Los fragmentos de secretos en logs son tan sensibles como el secreto completo: reducen el espacio de búsqueda y quedan persistidos en el proveedor de logs.
- Si un secreto (o fragmento) llega a aparecer en un log o en un chat, **rotarlo** inmediatamente.

---

## Known risks and open questions

### R2: `ENGINE_API_SECRET` is optional — POST engine trigger is fail-open
If `ENGINE_API_SECRET` is not set in Vercel, `POST /api/engine/run` is publicly triggerable. Any caller can run a full engine run. See CTO_BACKLOG P0-7 for options.

### R3: `../../config/portfolio.json` path risk ✓ RESOLVED (PR #17)
All portfolio config consumers (`GET /api/engine/run`, `POST /api/engine/run`, `GET /api/portfolio`, `POST /api/portfolio/import`, `runDailyEngine`) now use `loadPortfolioConfig()` from `portfolio-store.ts`. This reads KV first (`portfolio:config`) and falls back to `config/portfolio.json` directly (not via a relative file-store path). The fragile `readJsonFile('../../config/portfolio.json', {})` path has been eliminated.

---

## What to do if Twelve Data fails

Symptoms: `currentPrice: null` for multiple tickers, `pricingMethod` unexpectedly mock, or widespread `errors` in engine run response.

Steps:
1. Check Twelve Data status and free tier quota (800 req/day — could be exhausted if cron ran many times)
2. If rate limit: wait for next cron run (quota resets daily)
3. If persistent: options in order of preference:
   - Upgrade Twelve Data plan
   - Do NOT fall back to Yahoo as primary — Yahoo is unreliable from Vercel cloud IPs
   - Evaluate EODHD for validated symbols (requires `EODHD_ENABLED=true` already configured; only for symbols in `eodhd-symbol-validation.json`)
   - Evaluate a chain provider once `batchGetRecentHighs` is implemented for ChainedPriceProvider

Never set `currentPrice` to a fake value. Leave null; safety gates suppress BUY recommendations.

---

## What to do if Telegram is not sending

Steps:
1. Check Vercel function logs for `[Telegram] Not configured`
2. Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
3. Test bot: `curl "https://api.telegram.org/bot$TOKEN/getMe"`
4. Verify chat ID: `curl "https://api.telegram.org/bot$TOKEN/getUpdates"` (send a message to bot first)
5. 403 error: may have blocked the bot — unblock or create new chat

---

## What to do if Vercel KV does not respond

Steps:
1. Check `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set in Vercel
2. Test: `curl -H "Authorization: Bearer $KV_REST_API_TOKEN" "$KV_REST_API_URL/get/engine:latest_output"`
3. Check Upstash dashboard for quota
4. If KV down: engine falls back to `/tmp` automatically; data not persisted but engine still runs
5. For prolonged outage: create new Upstash KV, update env vars

---

## Reading the capability smoke artifact

After running the GitHub Actions workflow:

```json
{
  "summary": {
    "recommendedNextProvider": "eodhd_screener" | null,
    "candidateDiscoveryProviders": [],
    "warnings": []
  }
}
```

Decision tree:
- `usableFor === "candidate_discovery"` → proceed to P3-3f-b (ExternalCandidate schema)
- `warnings: ["plan_upgrade_required"]` → plan doesn't include screener; evaluate upgrade
- All `not_usable` → continue rotating batches; re-evaluate in 30 days

---

## CSV portfolio import

CSV parsing works end-to-end. With KV configured in Vercel, import now persists and returns `saved: true`.

**How it works after PR #17**:
- `POST /api/portfolio/import` saves the updated portfolio config to KV key `portfolio:config`
- All consumers (`GET /api/portfolio`, `runDailyEngine`, `/api/engine/run`) load portfolio config KV-first via `loadPortfolioConfig()`
- Without KV, the response includes `saved: false` and the engine continues using `config/portfolio.json` from the repo

**Requirements for `saved: true` in production**:
- `KV_REST_API_URL` and `KV_REST_API_TOKEN` must be set in Vercel (see section "Acciones manuales obligatorias en Vercel")
- These variables were already required for engine output persistence — no new Vercel action needed for this feature

**Verifying import persistence after deploy**:
```bash
BASE="https://<your-vercel-url>"

# 1. Upload a CSV — expect saved:true with KV configured
curl -s -X POST "$BASE/api/portfolio/import" \
  -F "csv=@your-trades.csv" | jq '{saved, saveSource, holdingsUpdated}'
# Expected: {"saved": true, "saveSource": "kv", "holdingsUpdated": N}

# 2. Verify the loaded config reflects the import
curl -s "$BASE/api/portfolio" | jq '{holdingsCount: (.config.holdings | length), lastRunAt}'
```

**Local dev (without KV)**: import still works — falls back to writing `config/portfolio.json`. Returns `saved: true, saveSource: "file"` if the write succeeds, or `saved: false, saveSource: "none"` if restricted.

**Fallback**: if KV is down or not configured, engine uses committed `config/portfolio.json` automatically.

---

## Common npm commands

```bash
npm ci                  # Clean install from lock file
npm test                # 24 suites, 1527 asserts
npm run build           # Production build
npx tsc --noEmit        # Type-check
npm run dev             # Local dev server :3000
npm run lint            # ESLint
```

---

## Cómo mantener la documentación viva

La documentación de este proyecto vive en cuatro archivos. Cada uno tiene un propósito distinto.
Todo PR funcional debe revisar si estos documentos siguen siendo correctos.
Si no se actualizan, el PR debe explicar explícitamente por qué no aplica.

### Cuándo tocar cada documento

| Documento | Qué contiene | Cuándo actualizar |
|---|---|---|
| `docs/PROJECT_STATE.md` | Estado actual verificado: qué está hecho, qué está bloqueado, qué persiste y dónde | En todo PR que cambie endpoints, persistencia, env vars, estado de producción o PRs mergeados |
| `docs/CTO_BACKLOG.md` | Prioridades, próximos PRs, bloqueos técnicos, orden de trabajo | Cuando se cierra un ítem, se añade uno nuevo, o cambia el orden de prioridad |
| `docs/RUNBOOK.md` | Operación manual: Vercel, env vars, Telegram, comandos de verificación | Cuando cambia cualquier operación manual, env var, endpoint, o se añade un riesgo conocido |
| `docs/DECISIONS.md` | Decisiones arquitectónicas con razonamiento y tradeoffs | Cuando se toma una decisión técnica relevante o se revierte una anterior |
| `AGENTS.md` | Instrucciones para agentes/IA: qué leer, qué no tocar, acciones manuales | Cuando cambia el estado de producción, las restricciones o el orden de los próximos PRs |

### Regla

> **Todo PR funcional debe revisar si estos documentos siguen siendo correctos.**
> Si no se actualizan, el PR debe explicar en el body por qué no aplica.
> No es aceptable cerrar un PR funcional dejando los docs desactualizados.

### Acciones manuales para el propietario

Si un PR requiere que el propietario haga algo en Vercel, Telegram, GitHub Actions u otro servicio externo, debe aparecer en el PR y en los docs con el formato `ACCIÓN MANUAL PARA EL PROPIETARIO` descrito en `AGENTS.md`.

Las instrucciones deben estar en español y escritas para una persona no técnica.

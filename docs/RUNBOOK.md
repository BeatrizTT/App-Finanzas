# Runbook — App Finanzas

Operational procedures. Keep this up to date as infrastructure changes.

---

## Acciones manuales obligatorias en Vercel antes de producción real

Esta sección está escrita para el propietario del proyecto, no para un desarrollador.
Sigue los pasos en orden. Sin estas variables, la app usa precios falsos y el cron no funciona.

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
- Valor: `yahoo`
- No requiere ninguna API key adicional.

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
  "priceProvider": "yahoo",
  "cronSecretSet": true,
  "telegramConfigured": true,
  "isVercel": true
}
```
- `priceProvider` debe ser `"yahoo"`, no `"mock"`
- `cronSecretSet` debe ser `true`
- `telegramConfigured` será `true` sólo si has añadido ambas variables de Telegram

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
# Ejecutar el motor manualmente (POST sin auth, porque ENGINE_API_SECRET no está configurado)
curl -s -X POST "$BASE/api/engine/run" | jq '{success, pricingMethod: .pricingMethod, alertsCount}'
```
- `success` debe ser `true`
- `pricingMethod` debe ser `"yahoo"`, no `"mock"`

**Verificar persistencia (si KV está configurado):**
```bash
# Después de ejecutar el motor, recuperar el último resultado guardado
curl -s "$BASE/api/engine/run" | jq '{runAt, pricingMethod: .pricingMethod}'
```
- `runAt` debe mostrar una fecha reciente (la del último run)

**Verificar Telegram:**
- Después de ejecutar el motor con `POST /api/engine/run`, deberías recibir un mensaje en Telegram en menos de 30 segundos.

---

### Resumen rápido — qué debe estar hecho antes del primer cron real

| Variable | Estado necesario | Consecuencia si falta |
|---|---|---|
| `CRON_SECRET` | ✓ Configurada | Cron devuelve 503 y no ejecuta |
| `PRICE_PROVIDER=yahoo` | ✓ Configurada | App usa precios mock |
| `KV_REST_API_URL` | ✓ Configurada | Datos del motor se pierden entre runs |
| `KV_REST_API_TOKEN` | ✓ Configurada | Datos del motor se pierden entre runs |
| `TELEGRAM_BOT_TOKEN` | Opcional pero recomendada | Alertas van sólo a logs de Vercel |
| `TELEGRAM_CHAT_ID` | Opcional pero recomendada | Alertas van sólo a logs de Vercel |
| `ENGINE_API_SECRET` | **NO configurar todavía** | Si se configura, el botón Analizar se rompe |

---

## Running tests locally

```bash
npm test
# or
npx tsx scripts/run-tests.ts
```

Runs all 19 suites. Exits 0 if all pass.

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

## Vercel environment variables — go-live checklist

Go to: **Vercel → Project → Settings → Environment Variables**

### Required before go-live (in this order)

```
CRON_SECRET        = <openssl rand -hex 32>
PRICE_PROVIDER     = yahoo
KV_REST_API_URL    = <from Vercel KV → Upstash dashboard>
KV_REST_API_TOKEN  = <from Vercel KV → Upstash dashboard>
TELEGRAM_BOT_TOKEN = <from @BotFather>
TELEGRAM_CHAT_ID   = <personal chat ID>
```

**Why `PRICE_PROVIDER=yahoo`**: simplest path to real prices. No Twelve Data key needed. Can add `chain` later when a second provider is needed.

**Why `CRON_SECRET` first**: the cron route returns 503 if this is missing — it cannot execute. Set this before any scheduled run.

**Note on `ENGINE_API_SECRET`**: the manual trigger endpoint (`POST /api/engine/run`) is fail-open when this is not set. The dashboard calls POST without an Authorization header, so this is intentional for personal use. If you want to close the endpoint, set `ENGINE_API_SECRET` and add the header to the dashboard fetch in `page.tsx`. See CTO_BACKLOG P0-7.

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

## Verifying production is working

1. Set `PRICE_PROVIDER=yahoo` + `KV_REST_API_URL/TOKEN` in Vercel
2. Trigger engine: `POST /api/engine/run` (or wait for cron)
3. Check `GET /api/engine/run` — should return engine output with real prices
4. Confirm `pricingMethod` in output is `yahoo`, not `mock`
5. Confirm `currentPrice` is non-null and non-zero for AAPL, MSFT, NVDA
6. Check Telegram — digest should arrive within 30 seconds of engine run

**Note**: `GET /api/opportunities` and `GET /api/portfolio` read from file-store directly (not KV-aware as of PR #13). On Vercel, they may return empty data between invocations even if KV is configured. Use `GET /api/engine/run` as the authoritative source until `p0-read-endpoints-kv-consistency` is implemented.

---

## Known risks and open questions

### R1: `/api/opportunities` and `/api/portfolio` are not KV-aware
Both endpoints call `readJsonFile('engine-output.json', null)` directly, bypassing `loadEngineOutput()`. On Vercel, the file-store is in `/tmp` and is wiped between invocations. Even with KV configured, these endpoints return empty data after a cold start.

**Impact**: Low for now — the dashboard does not call these endpoints (it uses `/api/engine/run` GET). Impact grows if any future UI or external consumer calls these endpoints.

**Fix**: Next code PR `p0-read-endpoints-kv-consistency` — replace `readJsonFile` with `loadEngineOutput()` in both routes.

### R2: `ENGINE_API_SECRET` is optional — POST engine trigger is fail-open
If `ENGINE_API_SECRET` is not set in Vercel, `POST /api/engine/run` is publicly triggerable. Any caller can run a full engine run. See CTO_BACKLOG P0-7 for options.

### R3: `../../config/portfolio.json` path risk
Both `GET /api/engine/run` and `POST /api/engine/run` call `readJsonFile('../../config/portfolio.json', {})` to read `closedPositions` and `totalRealizedPnl`. This path is relative to `src/data/` (the file-store DATA_DIR). If DATA_DIR changes (e.g., a future migration), this path will break silently.

`GET /api/portfolio` uses `getEffectivePortfolioConfig()` for portfolio config (reads committed `config/` files — stable) and `readJsonFile('engine-output.json')` for analyses. The `../../config/portfolio.json` path issue applies to `engine/run/route.ts` and `portfolio/import/route.ts`.

---

## What to do if Yahoo Finance fails

Symptoms: `currentPrice: null` for multiple tickers, `pricingMethod: mock`.

Steps:
1. Check `yahoo-finance2` npm for known issues
2. If transient (rate limit, outage): wait for next cron run
3. If persistent: add `TWELVE_DATA_API_KEY` and set `PRICE_PROVIDER=chain` + `PRICE_PROVIDER_CHAIN=twelvedata,yahoo`
4. If Twelve Data also unavailable: activate EODHD (`EODHD_ENABLED=true`) for validated symbols only

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

## CSV portfolio import — current state

CSV parsing works end-to-end. On Vercel, writing back to `config/portfolio.json` **silently fails** — response includes `"saved": false`.

**Workaround until persistence is fixed**: import locally (`npm run dev`), the write succeeds, commit the updated `config/portfolio.json`.

**Permanent fix needed (P0-6)**: store portfolio CSV data in KV using the same pattern as `engine-store.ts`.

---

## Common npm commands

```bash
npm ci                  # Clean install from lock file
npm test                # 19 suites, 1481 asserts
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

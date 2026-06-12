# CTO Backlog — App Finanzas

Last updated: 2026-06-12 (P1-3c verificado en producción ✅ — producción limpia)

Ordered by priority. P0 = production is broken or silent without these. Do not advance to P1 until P0 is solid.

---

## P0 — Production basics (app is broken without these)

### P0-0: Close open cron route ✓ DONE (PR #13, `021e89f`)
**Status**: Implemented and active. `checkCronAuth()` returns 503 if `CRON_SECRET` is not set, 401 if header is missing or wrong.
`CRON_SECRET` configured in Vercel since April 30, 2026. `/api/config/status` → `cronSecretSet: true`.

---

### P0-1: Set real pricing provider in Vercel ✓ DONE
**Status**: `PRICE_PROVIDER=twelvedata` configured since May 5, 2026. `TWELVE_DATA_API_KEY` also configured.
**Important correction**: Earlier docs said to use `yahoo`. That was wrong — Yahoo Finance aggressively rate-limits from Vercel cloud IPs. Twelve Data works reliably from cloud and supports batch. Do NOT change to `yahoo`. See `docs/DECISIONS.md`.
`/api/config/status` → `priceProvider: "twelvedata"`.

---

### P0-2: Connect Vercel KV ✓ DONE (env configured)
**Status**: `KV_REST_API_URL` and `KV_REST_API_TOKEN` (plus `KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`) configured in Vercel since May 6, 2026.
All KV-aware code is deployed (PRs #16 + #17):
- `engine-store.ts`: engine output — KV-first, file-store fallback
- `portfolio-store.ts`: portfolio config — KV-first, `config/portfolio.json` fallback
- All three read endpoints use `loadEngineOutput()`, import uses `savePortfolioConfig()`

**Verificado 2026-06-11**: KV write + read cross-instance confirmados. `kvConfigured: true`, `/api/opportunities` `stockCount: 4`, `/api/portfolio` `analysesCount: 13` ✅

---

### P0-3: Set CRON_SECRET (env var) ✓ DONE
**Status**: Configured since April 30, 2026. `/api/config/status` → `cronSecretSet: true`.
**Verificado 2026-06-11**: cron auth confirmado en `https://www.beaihub.com` — sin header → 401, header incorrecto → 401, header correcto → 200 ✅

---

### P0-4: Connect Telegram ✓ DONE (env configured)
**Status**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` configured since April 30, 2026. `/api/config/status` → `telegramConfigured: true`.
**Verificado 2026-06-11**: bot envió digest tras engine run con `sendDigest: true`. `success: true` ✅

---

### P0-5: Read-endpoint KV consistency ✓ DONE (PR #16)
**Status**: Implemented. Both `/api/opportunities` and `/api/portfolio` now use `loadEngineOutput()` from `engine-store.ts` — KV-first, file-store fallback. Pure response builders (`buildOpportunitiesResponse`, `buildPortfolioResponse`) exported and covered by 12 new unit tests including wiring tests with mocked KV fetch.

**Verification at merge**: 21 suites · 1493 asserts · 0 failed. (Current suite: 23 suites · 1509 asserts — includes PR #17 additions.)

---

### P0-6: CSV import persistence on Vercel ✓ DONE (PR #17)
**Status**: Implemented. New module `src/lib/utils/portfolio-store.ts` provides `loadPortfolioConfig()` (KV-first, `config/portfolio.json` fallback) and `savePortfolioConfig()` (KV write, local file fallback).

- `POST /api/portfolio/import` now reads existing config via `loadPortfolioConfig()` and saves via `savePortfolioConfig()` → `saved: true` in Vercel when KV configured.
- `GET /api/portfolio`, `runDailyEngine()`, and both `GET`/`POST /api/engine/run` all read portfolio config via `loadPortfolioConfig()`.
- Response contract unchanged. Added `saveSource` field to import response.
- 16 new unit tests (8 portfolio-store + 8 import).

**Verification**: 23 suites · 1509 asserts · 0 failed.

---

### P0-7: ENGINE_API_SECRET design risk (document, not fix)
**Current behavior**: `POST /api/engine/run` is fail-open when `ENGINE_API_SECRET` is not set — any caller can trigger a full engine run. This is intentional: the dashboard (`page.tsx` line 140) calls POST without an Authorization header.

**Risk**: Without `ENGINE_API_SECRET`, the engine endpoint is publicly triggerable and will consume API rate limits / KV writes from any source.

**Options**:
- A: Accept current design — dashboard works, risk is low for a personal app on Vercel Hobby
- B: Set `ENGINE_API_SECRET` in Vercel and add the header to the dashboard fetch — closes the endpoint
- C: Move dashboard trigger to use the cron route instead (uses `CRON_SECRET`)

**Recommended**: Option A for now (personal app, Vercel Hobby rate limiting provides natural protection). If exposed publicly, implement B.

**Not a code blocker**: engine still runs correctly. Document and decide before go-live.

---

## P1 — Automation and reliability

### P1-1: Verify end-to-end cron → alert → Telegram ✓ DONE (2026-06-11)
Verificación completa — ver Fase 1 en el roadmap de arriba y `docs/RUNBOOK.md` § "Lección Fase 1".

---

### P1-2: Discovery state persistence (watchlist / snapshots)
**Problem**: `watchlist.ts` and `snapshots.ts` use `file-store` → `/tmp` on Vercel. Watchlist entries survive zero runs.

**Fix options**:
- A: Extend KV to cover watchlist and snapshots (prefixed keys like `discovery:watchlist`)
- B: Accept stateless discovery per run (re-evaluate all each run) — simpler but loses trend tracking

Recommended: option A, using the same KV pattern as `engine-store.ts`.

---

### P1-3: Alert history persistence (dedupe ring buffer)
Same problem as P1-2: `history.ts` uses file-store. Dedupe doesn't work across Vercel invocations.

Fix: extend KV or accept alert repetition (worse UX).

---

### P1-3b: Hotfix `No data for US46120E6023` ✓ DONE (2026-06-11, PR #28)
**Diagnóstico**: el CSV import guardó en KV un holding con ISIN `US46120E6023` sin mapping en `ISIN_TO_TICKER` → `ticker: undefined` → el engine usó `h.ticker ?? h.id.toUpperCase()` y pidió precio para el ISIN.
**Identidad confirmada** (onvista, ad-hoc-news): `US46120E6023` = Intuitive Surgical, Inc. (ISRG, Nasdaq, USD).
**Fix**:
- Mapping `US46120E6023 → ISRG` añadido.
- `findUnknownIsins()` detecta cualquier ISIN sin ticker.
- **Fail-closed**: si hay ISINs desconocidos, el endpoint responde **HTTP 422** con `success: false`, `saved: false`, `unknownIsins` y `warnings`, y **no escribe en KV**. La cartera no se actualiza con datos que el motor no puede analizar. 6 tests nuevos (incluye verificación de que NO se hace SET a KV).
**ACCIÓN MANUAL pendiente**: re-importar el CSV tras el deploy para que el holding en KV reciba `ticker: ISRG`.

---

### P1-3c: Hotfix `No data for LU3176111881` / `No data for LU3170240538` — ELTIF (private funds) ✓ DONE (2026-06-12)
**Estado**: fix mergeado PR #30 (`f0af3e1`), promovido a producción manualmente (ver RUNBOOK § Incidente 2026-06-12), verificado en `https://www.beaihub.com`.

**Verificado 2026-06-12**:
- Import: `success: true, saved: true, saveSource: "kv", holdingsUpdated: 16, unknownIsins: []` ✅
- KV: `US46120E6023 → ISRG/stock`, `LU3176111881 → ENXF/private_fund`, `LU3170240538 → APGM/private_fund` ✅
- Engine: `success: true, errors: []` — sin ningún `No data for...` ✅

**Sobre `US46120E6023` (ISRG)**: confirmado que el error original fue stale KV (import corrió antes de que PR #28 fuera desplegado). El KV ahora tiene `ticker: ISRG, type: stock` tras el re-import con código de #30. Hipótesis cerrada.

**Qué se observó (verificado, no hipótesis)**: tras re-importar el CSV (paso del P1-3b) y correr el engine, la respuesta mostró:
```
"errors": ["No data for US46120E6023", "No data for LU3176111881", "No data for LU3170240538"]
```
Los dos ISINs `LU...` no estaban en `ISIN_TO_TICKER` ni en ninguna parte del repo.

**Identidad confirmada** (extraetf, eltif.info, parqet):
- `LU3176111881` = **EQT Nexus Fund ELTIF** (private equity).
- `LU3170240538` = **Apollo Global Private Markets ELTIF** (private equity).

Ambos son **ELTIF** (European Long-Term Investment Fund): fondos de private equity vendidos por Trade Republic. **No cotizan en bolsa**, así que Twelve Data nunca tendrá precio para ellos. Pedirles precio produce `No data` de forma permanente, no transitoria.

**Fix (mínimo)**:
- `AssetType` añade `'private_fund'`.
- Mapping `LU3176111881 → ENXF` y `LU3170240538 → APGM`, ambos `type: 'private_fund'`, `currency: EUR`.
- `daily-engine.ts` excluye `private_fund` de `portfolioTickers` y `usdTickers` → no se les pide precio.
- `TypeBadge` muestra `ELTIF` (badge ámbar) con tooltip "sin precio diario automático".
- 3 tests nuevos del importador (mapping de ambos ISINs + `findUnknownIsins` no los marca). 24 suites · 1530 asserts · 0 failed.

**Sobre `US46120E6023` (ISRG)**: NO está confirmado que su error fuera solo una carrera "stale KV". Hipótesis abierta — pudo ser (a) que el engine leyó KV antes de que el re-import propagara, o (b) que ese ISIN siga llegando sin ticker correcto. **No se da por cerrado.** Verificación pendiente: tras desplegar este fix, comprobar en KV que el holding tiene `ticker: ISRG` (`/api/portfolio | jq '[.config.holdings[] | select(.isin=="US46120E6023") | {id, ticker}]'`) y re-correr el engine.

**ACCIÓN MANUAL pendiente (verificación en producción)**:
1. Mergear el PR y desplegar.
2. Re-importar el CSV (el import ahora reconoce los LU ISINs → no falla con 422).
3. Re-correr el engine: `errors` debe quedar `[]` (o sin ninguna línea `No data for LU...`).
4. Confirmar que los ELTIF aparecen en la cartera sin P&L diario y con badge ELTIF.

---

### P1-4b: Alertas de venta / reducción por Telegram (siguiente prioridad recomendada tras merge de PR-1 #31)

**Descripción**: recibir un mensaje de Telegram cada vez que la app considera que es buen momento para vender, reducir o revisar seriamente una posición que ya se tiene.

**Triggers definidos**:
- `REDUCIR` (estado `REDUCE`): alerta inmediata.
- Equivalente a venta fuerte / thesis broken / riesgo alto: alerta inmediata.
- `REVISAR` (estado `REVIEW`): **no** alerta urgente salvo que el motivo sea riesgo alto o deterioro claro del activo (distinguir por `manualThesisRisk`).

**Formato del mensaje** (lenguaje simple, no jerga):
- Qué posición es (nombre + ticker).
- Qué ha cambiado (precio, distancia desde máximo, señal anterior vs nueva).
- Por qué la app recomienda vender / reducir / revisar.
- Qué acción prudente sugiere: vender todo, reducir parte (20-30%), no comprar más, o revisar tesis.

**Anti-spam**: no repetir la misma alerta todos los días si el estado no ha cambiado. Cubierto por PR-1 (#31): alert history + previous-states en KV, cooldown solo para mismo estado, bypass en cambios de estado.

**Dependencias**:
1. P1-3 (alert history en KV) — **PR #31 listo para merge** ✅.
2. P1-3c verificado en producción (ELTIF + ISRG limpios) — **DONE 2026-06-12** ✅.

**Qué NO hacer**:
- No disparar alerta `REDUCE` si `currentPrice: null` o datos stale.
- No repetir sin dedupe en KV.
- No cambiar los umbrales globales de scoring para generar más / menos señales.

**DECISIÓN PENDIENTE (registrada 2026-06-12, a resolver en P1-4b): recordatorios de alertas defensivas no resueltas.**

Comportamiento actual tras PR-1 (#31): `REDUCE → REDUCE` no re-alerta nunca, ni siquiera después del cooldown, porque el generador bloquea repeticiones del mismo estado (`stateChanged = false`). Para PR-1 esto es aceptable como anti-spam, pero para protección de capital tiene un riesgo: una señal de salida crítica puede quedar enterrada si la primera alerta pasa desapercibida.

Propuesta a evaluar en P1-4b:
- `REDUCE` nuevo (transición) → alerta inmediata (ya implementado en PR-1: bypass del cooldown).
- `REDUCE` persistente sin cambio → sin spam diario (ya implementado).
- `REDUCE` persistente durante 3/7 días sin resolverse → **recordatorio** (pendiente de decidir: intervalo, si aplica también a `REVIEW` con riesgo alto, y cómo se marca como "resuelto" — venta, cambio de estado, o ack manual).

Implementación candidata: añadir `firstAlertedAt` a `PreviousStateEntry` y comparar contra un `ALERT_REMINDER_DAYS` configurable. No implementar sin decisión explícita de Beatriz sobre el intervalo y el criterio de resolución.

---

### P1-5: UI — explicar la etiqueta REVISAR en lenguaje para dummies

**Copy aprobado por Beatriz (usar literalmente cuando se implemente)**.

**Qué significa REVISAR** (badge `REVIEW`):
- **"No compres más todavía."**
- **No significa vender.**
- Significa: *"Puede parecer barata, pero hay una señal de riesgo. Antes de meter más dinero, comprueba si todavía confías en esta empresa."*

**Texto específico para SMCI**:
> "SMCI tiene riesgo medio marcado y convicción 6/10. La app no dice vender; dice pausa antes de añadir más."

**Por qué aparece en SMCI**: tiene `manualThesisRisk: "medium"` y `convictionScore: 6` en config. La etiqueta es correcta — es exactamente el caso para el que existe.

**Mejora pendiente**: tooltip/texto contextual en el dashboard con el copy de arriba, generando la línea por activo a partir del motivo concreto (`manualThesisRisk` + `convictionScore`) en vez del texto genérico. El texto actual en `src/components/ui/badge.tsx` (`REVIEW`) dice solo "Algo ha cambiado en esta posición. Revisa la tesis de inversión antes de tomar decisiones." — correcto pero demasiado abstracto para alguien no técnico.

---

### P1-4: Daily digest quality
Review digest format (`digest.ts`). Ensure:
- Every BUY/REDUCE signal includes: ticker, current price, distance from 52W high/low, conviction, reason, suggested amount, data age, source
- Digest shows portfolio summary: NAV, daily change, biggest moves
- No "current price = null" or "0" visible to user

---

### P1-6: UI específica para fondos privados / ELTIF (mejora futura, NO en el hotfix)

**Contexto**: el hotfix P1-3c sólo evita que los ELTIF rompan el engine (no se les pide precio) y los marca con badge `ELTIF`. **No** resuelve la valoración ni la experiencia de usuario para activos privados. Eso es un bloque aparte, no parte de este hotfix.

**Pendiente (cuando se priorice)**:
- Vista/sección separada para `private_fund` en el dashboard, distinta de acciones/ETF.
- Copy claro para usuarios no financieros: explicar que un ELTIF es un fondo privado, que su valor lo publica el gestor (NAV periódico), no el mercado, y que por eso no hay P&L diario ni señal de compra/venta automática.
- Mostrar coste invertido (del CSV) y, si en el futuro hay una fuente fiable de NAV, valor estimado — **nunca** inventar precio ni usar 0.
- Decidir cómo (o si) se incluyen en concentración/allocation, dado que no tienen precio de mercado diario.

**Qué NO hacer**: no forzar estos activos al pipeline de scoring/pricing normal. No hardcodear NAV. No tratar `private_fund` como `stock`/`etf`.

---

## Roadmap — fases post-P0

El código P0 está completo (PRs #13–#17). Las env vars de producción están configuradas (reconciliado en PR #19). Las siguientes fases en orden:

### Fase 0 — Reconciliar producción real ✓ DONE (PR #19)
- Docs alineados con producción real.
- Pricing: Twelve Data en producción, no Yahoo.
- Env vars de Vercel: CRON_SECRET, KV, Telegram, PRICE_PROVIDER=twelvedata — todos configurados.
- DECISIONS.md actualizado. AGENTS.md actualizado.

### Fase 1 — Verificación end-to-end real ✓ DONE (2026-06-11)

Verificación completa en `https://www.beaihub.com`:

| Paso | Resultado |
|---|---|
| `/api/config/status` → `kvConfigured: true`, `priceProvider: "twelvedata"`, `cronSecretSet: true`, `telegramConfigured: true` | ✅ |
| `POST /api/engine/run` → `success: true`, precios reales, `eurUsdRate` numérico | ✅ |
| `GET /api/engine/run` → `runAt` coincide con run anterior (KV write → read confirmado) | ✅ |
| `GET /api/opportunities` → `stockCount: 4`, `lastRunAt` no-null (KV cross-instance) | ✅ |
| `GET /api/portfolio` → `analysesCount: 13`, `lastRunAt` no-null (KV cross-instance) | ✅ |
| Cron auth: sin header → 401, header incorrecto → 401, header correcto → 200 | ✅ |
| CSV import: `saved: true`, `saveSource: "kv"`, `holdingsUpdated: 16` | ✅ |
| Telegram: `success: true`, bot envió digest | ✅ |

**Lecciones registradas en `docs/RUNBOOK.md` § "Lección Fase 1" y § "Lecciones adicionales Fase 1".**

### Fase 2 — Fiabilidad y persistencia completa (código) — EN CURSO

0. **PR-0 (#27): shared KV client refactor — Merged.**
   `src/lib/utils/kv-client.ts` como cliente KV compartido. `engine-store.ts` y `portfolio-store.ts` migrados. 12 tests nuevos (24 suites · 1521 asserts). Sin cambio de comportamiento.

1. **`p1-alert-history-kv`** (PR-1, P1-3): mover `history.ts` (alert history + previous-states / dedupe ring buffer) a KV → alertas no se repiten entre invocaciones de Vercel. **LISTO PARA MERGE — PR #31 (2026-06-12)**. Incluye fix crítico de Codex Review: cambio de estado bypasa cooldown (`BUY_MORE → REDUCE` dentro de 24h ya no se suprime); `previous_states.state` = último estado alertado, no último observado. 26 suites · 1549 asserts · TSC OK · build OK. Vercel muestra "Error" pero el build es READY (patrón post-deploy check, documentado en RUNBOOK).
2. **P1-4b `telegram-sell-reduce-alerts`**: alertas Telegram de venta/reducción — **SIGUIENTE PRIORIDAD RECOMENDADA tras merge de PR-1** (ver sección P1-4b arriba, incluye decisión pendiente sobre recordatorios). Protección de capital antes que discovery state.
3. **`p1-discovery-state-kv`** (PR-2, P1-2): mover watchlist y snapshots a KV con prefijo `discovery:` → trend tracking funciona entre runs. Desbloqueado (PR-0 merged); **queda después de P1-4b salvo decisión explícita de Beatriz**.

### Fase 3 — Radar amplio de oportunidades

Objetivo: detectar empresas fuertes **fuera de la cartera actual** que hayan caído mucho y sean buenas entradas potenciales.

Componentes necesarios:
- External screener provider (EODHD screener, FMP, u otro) — requiere smoke evidence con keys reales antes de PR
- ExternalCandidate schema (P2-2 del backlog): status machine `candidate → confirmed → watchlisted → graduated | rejected`
- Filtros de calidad + liquidez + fit de cartera antes de cualquier BUY signal
- No BUY hasta: pricing validado, data quality aprobada, drawdown clasificado

**No iniciar sin smoke evidence real** del proveedor elegido.

### Fase 4 — Single-asset live check

Botón "Verificar ahora" por oportunidad/señal. Ver P2-5 en backlog.

### Fase 5 — News/thesis explainer

Noticias recientes, explicación de caída, riesgos, tesis de entrada. Ver P3-5 en backlog. Solo después de decidir proveedor de noticias con smoke evidence y reglas de seguridad.

---

## P2 — Discovery motor

### P2-1: Resolve multi-source provider after smoke
After merging PR #12 and running the GitHub Actions workflow with real API keys:
- If EODHD screener accessible: implement P3-3f-b (ExternalCandidate schema) → P3-3f-c (EODHD screener connector)
- If FMP free tier works: P3-3f-b → P3-3f-c-alt (FMP connector)
- If nothing works on free tier: continue with rotating batches only; evaluate paid plan cost/benefit

Do not add any external screener connector without real smoke evidence.

---

### P2-2: ExternalCandidate schema (P3-3f-b)
Schema for candidates arriving from external screeners (not in universe config):
- `ticker`, `exchange`, `source`, `screenerScore`, `marketCap`, `discoveredAt`, `confirmedAt`, `status`
- Status machine: `candidate` → `confirmed` → `watchlisted` → `graduated` | `rejected`
- Must not score as BUY until: pricing validated, data quality above threshold, not duplicate with universe

---

### P2-3: Scoring calibration
Current scoring weights are placeholders. After real data is flowing:
- Review `RADAR_SCORE_WEIGHTS` in `drawdown-radar.ts` against real drawdown distributions
- Review scanner scoring in `scoring.ts` — ensure no signal inflated by mock data history
- Add `dataQualityScore` gate: no BUY if data quality is low (already blocked by policy, needs code enforcement)

---

### P2-4: BUY/REDUCE signal quality
Each BUY or REDUCE output must include all of:
- [ ] Current price (not null, not 0, not mock)
- [ ] Average cost (from portfolio, may be null if not in portfolio)
- [ ] Distance from 52W high and 52W low
- [ ] Drawdown phase (`classifyDrawdownZone`)
- [ ] Conviction (HIGH/MEDIUM/LOW)
- [ ] Risk summary (one sentence)
- [ ] Reason (one sentence, non-generic)
- [ ] Suggested amount (EUR, sized by portfolio and conviction)
- [ ] Data age (timestamp of last price)
- [ ] Data source (`yahoo`, `eodhd`, etc.)
- [ ] Confidence level
- [ ] What would flip this recommendation

---

### P2-5: Single-asset live check (`p2-single-asset-live-check`)

**Objetivo**: Cuando el motor produce una recomendación (BUY, ALMOST_READY, WATCH, REDUCE), el usuario puede pulsar un botón "Verificar ahora" para obtener un análisis actualizado de ese activo concreto en ese momento.

**Motivación**: El motor corre cada día (07:00 + 16:00 UTC). Si el precio de un activo cambia significativamente entre runs, la señal guardada puede estar obsoleta. Este endpoint permite verificar si la señal sigue siendo válida con precio fresco.

#### Funcionalidad

**Nuevo endpoint propuesto**: `GET /api/engine/asset?ticker=NVDA` (o `POST` con body `{ ticker }`)
- Recarga precio real de ese ticker vía pricing chain (bypass de caché en memoria, o `forceRefresh: true`)
- Recalcula la señal con el motor existente (`computeScore()`, `classifyDrawdownZone()`)
- Aplica todos los safety gates: no BUY si `suitableForBuyRecommendation: false`, no BUY si `dataQualityScore` bajo, no precio USD como EUR
- Devuelve:
  - `previousSignal` (del último output del motor en KV)
  - `currentSignal` (recalculado ahora)
  - `priceNow` (precio actual obtenido)
  - `priceAtLastRun` (precio en el último run del motor)
  - `priceChange` (diferencia y porcentaje)
  - `signalChanged` (boolean: ¿cambió la señal?)
  - `explanation` (qué recomendaba antes, qué dice ahora, por qué)
  - `dataAge` (timestamp del precio obtenido)
  - `dataSource` (`yahoo`, `eodhd`, etc.)
  - `safetyGates` (qué gates se comprobaron y su resultado)

**UI**: botón "Verificar ahora" en cada tarjeta de oportunidad/señal en el dashboard. Muestra resultado inline sin navegar.

#### Dependencias
- Pricing chain existente (`chain-provider.ts`) — no cambia
- Scoring existente (`computeScore()`, `scoring.ts`) — no cambia
- `loadEngineOutput()` para leer `previousSignal` del KV — ya disponible
- `loadPortfolioConfig()` para contexto de portfolio — ya disponible
- Safety gates existentes (`suitableForExactPnl`, `suitableForBuyRecommendation`) — no cambian

#### Qué NO toca
- No modifica el motor global ni su output en KV
- No cambia `runDailyEngine()` ni el cron
- No añade proveedores externos
- No toca scoring weights ni BUY thresholds globales
- No accede a fundamentals, noticias, ni datos externos (eso es P3-5)

#### Riesgos
- Rate limiting de Yahoo si se llama muchas veces seguidas — mitigar con TTL corto de caché por ticker (ej. 60 segundos)
- Sin `ENGINE_API_SECRET` configurado, este endpoint también sería público — acepta el mismo riesgo que `POST /api/engine/run` (Vercel Hobby rate limiting como protección natural)
- El ticker debe existir en el universo del motor o en la cartera; no debe aceptar tickers arbitrarios externos sin validación

#### Preguntas del CTO — respondidas

**¿Está de acuerdo con que vaya después de P1?** Sí. P1 es prerequisito real: sin alert history KV funcional y sin verificación end-to-end, no tiene sentido añadir un live check. El valor de este botón depende de que el motor global ya funcione correctamente en producción con precios reales.

**¿Qué datos podemos explicar con el motor actual sin añadir proveedores externos?**
- Precio actual y variación respecto al último run del motor
- Distancia desde máximo 52W y mínimo 52W
- Fase de drawdown (`classifyDrawdownZone`)
- Convicción y señal recalculadas
- Comparación con promedio de coste del portfolio
- Antigüedad del dato y fuente de pricing
- Safety gates aplicados y resultado
- Por qué el motor recomienda o no recomienda (texto generado desde scoring interno)

**¿Qué datos requieren proveedor externo y decisión arquitectónica?** Todo lo de P3-5: noticias recientes, calidad de empresa, explicación de caída por fundamentals, catalizadores externos. Estos requieren un proveedor de noticias/fundamentals (NewsAPI, Financial Modeling Prep, Finnhub noticias) — decisión de arquitectura separada.

**¿Cómo evitar recomendaciones BUY inseguras?** Mismos safety gates del motor global:
- `suitableForBuyRecommendation: false` → no BUY (precio no validado, FX no disponible, dato stale)
- `dataQualityScore` bajo → no BUY
- `currentPrice: null` o `0` → no BUY, devolver error claro al usuario
- No USD como EUR en ningún caso

---

## P3 — Observability and validation

### P3-1: Structured engine logging
Current logging is ad-hoc console logs. Add:
- Run ID per engine invocation
- Start/end timestamps, duration
- Prices fetched count, cache hits, errors
- Alerts generated count, Telegram success/fail
- KV write success/fail

Write structured JSON to `POST /api/engine/run` response for debugging.

---

### P3-2: Extend `/api/config/status` health check
**Note**: `/api/config/status` already exists at `src/app/api/config/status/route.ts`. It currently returns:
```json
{
  "priceProvider": "mock" | "yahoo" | ...,
  "telegramConfigured": true | false,
  "cronSecretSet": true | false,
  "isVercel": true | false
}
```

**Extend** (do not recreate) to also return:
- KV connected (yes/no) — attempt a lightweight KV ping
- Last engine run (timestamp, from KV if available)
- Universe size (seed + extended count)
- Test suite status (cached from CI, optional)

---

### P3-3: Backtesting / signal validation
Run historical data through scoring to verify signals were actionable:
- Identify dates where `BUY` was signaled
- Check 30/60/90 day forward returns
- Identify false positives (BUY → continued drawdown)
- Adjust scoring weights if false positive rate is high

Only implement after P0 + P1 are solid and real prices are flowing for 30+ days.

---

### P3-4: Runbook automation
Automate the most common ops tasks:
- Auto-retry Telegram on rate limit
- Alert on KV write failure (fallback to Telegram "KV is down" message)
- Alert on engine crash (catch unhandled, send to Telegram)
- Health check on cron start (before scoring, verify KV + pricing respond)

---

### P3-5: Single-asset news and thesis explainer (`p3-single-asset-news-and-thesis-explainer`)

**Objetivo**: Fase posterior a P2-5. Cuando el usuario verifica una señal, la app también explica el contexto externo: por qué la empresa es fuerte, qué ha hecho caer la acción, noticias recientes relevantes, riesgos actuales, qué invalidaría la tesis.

**Estado**: Diseñado, NO implementar todavía.

**Prerequisitos antes de implementar**:
1. P2-5 funcionando (live check de precio y señal)
2. Decisión sobre proveedor de noticias/fundamentals (NewsAPI, FMP noticias, Finnhub)
3. Smoke evidence de que el proveedor elegido devuelve datos útiles para los tickers del universo
4. Reglas de seguridad claras: qué narrativa se puede generar, cómo evitar que noticias stale o incorrectas generen recomendaciones BUY erróneas

**Riesgos que deben resolverse antes de implementar**:
- Noticias de baja calidad o desactualizadas pueden generar narrativas que parezcan sólidas pero sean engañosas
- Ninguna noticia externa debe modificar `computeScore()`, scoring weights ni BUY thresholds — la explicación es informativa, no operativa
- Si el dato de noticias no está disponible, la respuesta debe decirlo claramente en lugar de generar texto vacío o inventado
- Proveedor de noticias requiere API key nueva → nueva env var → nueva acción manual del propietario → nueva decisión arquitectónica en `DECISIONS.md`

**Lo que puede incluir (sujeto a decisión de proveedor)**:
- Noticias recientes (últimas 48h) relevantes al ticker
- Resumen de por qué el precio ha caído (basado en titulares, no en análisis propio)
- Factores de riesgo conocidos (sin inventar fundamentals)
- Qué eventos próximos podrían mover el precio (earnings, macro)
- Qué invalidaría la tesis de entrada (precio rebasa umbral, cambio de contexto macro)

**Lo que NO puede hacer** (restricciones de seguridad permanentes):
- No usar fundamentals (P/E, EPS, revenue) para modificar señales BUY
- No añadir nuevos símbolos al universo basándose en noticias
- No emitir BUY si pricing/FX no es apto — las noticias no cambian este gate
- No hardcodear narrativas ni inventar datos

---

## Not doing (explicit non-goals)

- Fundamentals (P/E, EPS, revenue) — too noisy for this use case; not scheduled
- Dynamic position sizing beyond current allocator — current model is sufficient
- New universe symbols — requires EODHD smoke evidence first
- GBX/GBP new symbols — explicitly deferred
- CNDX, IWVL, EMIM — explicitly deferred
- EODHD as default pricing provider — explicitly deferred pending evaluation
- Public-facing UI / multi-user — not in scope

---

## Rule: update this file

**Before closing any PR**, update `PROJECT_STATE.md` with what changed. Before opening any PR, check this backlog for conflicts. This is the source of truth for the project's direction.

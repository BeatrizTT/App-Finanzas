# AGENTS.md — App Finanzas

Instrucciones obligatorias para cualquier agente, IA o colaborador nuevo que trabaje en este repositorio.
Leer este archivo completo antes de tocar cualquier código o documentación.

---

## Antes de empezar cualquier tarea

Lee estos cuatro documentos en este orden:

1. **`docs/PROJECT_STATE.md`** — estado actual verificado del proyecto: qué está hecho, qué está bloqueado, qué endpoints existen, qué persiste y qué no.
2. **`docs/CTO_BACKLOG.md`** — prioridades, próximos PRs recomendados, bloqueos técnicos y orden de trabajo. Consultar antes de proponer cualquier cambio.
3. **`docs/RUNBOOK.md`** — operación manual, variables de entorno en Vercel, comandos de verificación, Telegram, KV. Contiene instrucciones paso a paso para el propietario.
4. **`docs/DECISIONS.md`** — decisiones arquitectónicas registradas con su razonamiento. No revertir decisiones sin leer su justificación.

No asumas que el estado del código refleja la última conversación. Verifica en los docs.

---

## Reglas de trabajo

### Alcance
- No tocar código fuera del scope del PR. Si ves algo que mejorar fuera del scope, anótalo en `docs/CTO_BACKLOG.md` o menciona al propietario — no lo implementes.
- No mezclar fases: P0 es P0, P1 es P1. No adelantar P1 mientras P0 esté sin cerrar.
- **Todo store nuevo que use KV debe importar de `src/lib/utils/kv-client.ts`**. No copiar los helpers (`getKvConfig`, `sanitizeKvError`, `upstashCommand`, `kvSet`, `kvGet`) en ningún otro archivo.

### Seguridad — restricciones permanentes
Estas restricciones no se negocian y no cambian salvo instrucción explícita del propietario:

- **No añadir símbolos a `config/eodhd-symbol-validation.json` como `validated_usd_needs_fx` sin evidencia real de smoke con EODHD.**
- **No usar precio USD como EUR. No hardcodear FX. No poner `currentPrice: 0`. No introducir `Infinity`.**
- **No emitir recomendación BUY si `dataQualityScore` es bajo.**
- **No emitir BUY si pricing o FX no es apto** (`suitableForExactPnl: false` / `suitableForBuyRecommendation: false`).
- **Nunca loguear secretos ni fragmentos de secretos** (longitud, prefijo, sufijo, hash incluidos) de `CRON_SECRET`, `KV_REST_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TWELVE_DATA_API_KEY`, `ENGINE_API_SECRET` ni ningún token. Para depurar auth, loguear solo el resultado de la comparación, nunca el material de entrada. Si un secreto aparece en un log o chat, rotarlo. Ver `docs/RUNBOOK.md` § "L6". (Origen: PR #23 logueó fragmentos de `CRON_SECRET`; revertido en PR #24.)
- **No tocar todavía**: fundamentals, valuation, earnings, market cap, volumen, dynamic sizing, nuevos símbolos del universo, CNDX, IWVL, EMIM, GBP/GBX, scoring weights, BUY thresholds globales, EODHD como provider por defecto.

### Documentación
Todo PR que cambie cualquiera de los siguientes debe actualizar los docs correspondientes:

| Si cambia… | Actualizar… |
|---|---|
| Comportamiento de la app o endpoints | `PROJECT_STATE.md`, `RUNBOOK.md` |
| Persistencia (KV, file-store, DB) | `PROJECT_STATE.md` tabla de persistencia |
| Variables de entorno o su comportamiento | `RUNBOOK.md` sección de Vercel, `PROJECT_STATE.md` |
| Cron o scheduling | `RUNBOOK.md`, `PROJECT_STATE.md` |
| Pricing, FX, scoring, universe | `PROJECT_STATE.md`, `DECISIONS.md` si hay decisión |
| Telegram o alertas | `RUNBOOK.md`, `PROJECT_STATE.md` |
| Discovery engine | `PROJECT_STATE.md`, `CTO_BACKLOG.md` |
| Backlog, prioridades, próximos PRs | `CTO_BACKLOG.md` |
| Workflows de GitHub Actions | `RUNBOOK.md` |

Si un PR funcional **no** actualiza los docs, el PR debe incluir una justificación explícita de por qué no aplica. No es aceptable cerrar un PR funcional dejando los docs desactualizados.

---

## Acciones manuales para el propietario

Si un cambio requiere que el propietario haga algo fuera del código (Vercel, Telegram, GitHub Actions, Upstash/KV u otro servicio externo), debe aparecer en el PR y en los docs con este formato exacto:

---

### ACCIÓN MANUAL PARA EL PROPIETARIO

**Qué:** [descripción concisa de lo que hay que hacer]

**Dónde:** [servicio y URL o ruta de navegación exacta]

**Cuándo:** [antes del deploy / después del merge / antes del siguiente cron / etc.]

**Qué pasa si no se hace:** [consecuencia concreta]

**Qué NO tocar:** [variables, opciones o pasos que no deben activarse todavía]

---

Las instrucciones deben estar en español, escritas para una persona no técnica, paso a paso.

### Variable que NO debe configurarse todavía — ENGINE_API_SECRET

`ENGINE_API_SECRET` **no debe configurarse en Vercel** hasta que el dashboard (`page.tsx`) esté actualizado para enviar `Authorization: Bearer $ENGINE_API_SECRET` en el POST a `/api/engine/run`.

Motivo: el dashboard llama a `POST /api/engine/run` sin cabecera de autorización. Si se configura esta variable antes del cambio en el dashboard, el botón "Analizar" devolverá 401 y dejará de funcionar.

Esto cambiará cuando se implemente autenticación del dashboard (pendiente en `docs/CTO_BACKLOG.md` P0-7). Hasta entonces, mantener esta variable sin configurar.

---

## Estado de producción al leer este archivo

El estado real y actualizado está en `docs/PROJECT_STATE.md`. No asumir el estado a partir de este archivo.

Resumen a fecha de última actualización de este archivo (2026-06-12, Fase 2 — PR-1 listo para merge):
- **Hotfix ELTIF (PR #30) verificado en producción 2026-06-12**: import `success:true`, KV con `US46120E6023→ISRG/stock`, `LU3176111881→ENXF/private_fund`, `LU3170240538→APGM/private_fund`, engine `errors:[]`. Los `private_fund` (ELTIF) NO se piden a Twelve Data (excluidos en `daily-engine.ts`).
- **Precios**: `PRICE_PROVIDER=twelvedata` en Vercel desde Mayo 2026. `priceProvider: "twelvedata"` en `/api/config/status`. **NO** en mock. **NO** cambiar a yahoo (yahoo rate-limita desde Vercel cloud IPs).
- **Cron**: `CRON_SECRET` configurado. `cronSecretSet: true`. Fail-closed activo. Cron auth verificado 2026-06-11: sin header → 401, header incorrecto → 401, header correcto → 200 ✅.
- **KV**: end-to-end verificado 2026-06-11. `kvConfigured: true`. Write + read cross-instance confirmados. `/api/opportunities` `stockCount: 4`, `/api/portfolio` `analysesCount: 13` ✅.
- **Telegram**: bot envió digest el 2026-06-11. `success: true` ✅.
- **CSV import**: verificado 2026-06-11. `saved: true`, `saveSource: "kv"`, `holdingsUpdated: 16` ✅. Campo del formulario: `csv` (no `file`).
- **Portfolio config**: todos los consumidores usan `loadPortfolioConfig()` — KV-first, `config/portfolio.json` fallback (PR #17).
- **EODHD**: env vars configuradas en Vercel pero **inactivas** — `PRICE_PROVIDER=twelvedata` no las instancia.
- **`ENGINE_API_SECRET`**: NO configurar. Dashboard llama POST sin Authorization header.
- **URL canónica para tests**: usar `https://www.beaihub.com`. Los aliases de rama de Vercel tienen Deployment Protection y devuelven 401 a nivel de proxy.

---

## Próximos PRs recomendados (según backlog)

Ver `docs/CTO_BACKLOG.md` sección "Roadmap" para detalle completo. Orden actual:

**Fase 0 (docs, DONE PR #19)**: producción reconciliada. Env vars ya configuradas. NO tocar Vercel.

**Fase 1 (verificación, DONE 2026-06-11)**: end-to-end completo ✅
- `kvConfigured: true` ✅ — `POST` engine + `GET` engine/opportunities/portfolio todos KV-aware
- Cron auth: 401/401/200 ✅ — usar `https://www.beaihub.com`, no alias de rama
- CSV import: `saved: true`, `saveSource: "kv"` ✅ — campo `csv` no `file`
- Telegram: `success: true`, mensaje recibido ✅

**Fase 2 (código — EN CURSO, autorizada 2026-06-12)**:
0. PR-0 (#27): shared KV client refactor — Merged. `kv-client.ts` creado, `engine-store.ts` + `portfolio-store.ts` migrados, 12 tests nuevos.
1. `p1-alert-history-kv` (PR-1) — historial/dedupe de alertas a KV. **LISTO PARA MERGE** (PR #31). Incluye fix crítico: `shouldSendAlert` bypasa cooldown en cambios de estado (`BUY_MORE → REDUCE` no puede suprimirse). `previous_states.state` = último estado alertado (no último observado). 26 suites, 1549 asserts, TSC OK, build OK. Nota: Vercel muestra "Error" en el PR pero el build es `READY` — es el patrón post-deploy check, no un error de código (documentado en RUNBOOK).
2. `p1-discovery-state-kv` (PR-2) — mover watchlist y snapshots a KV (prefijo `discovery:`). Desbloqueado; siguiente tras PR-1.

**Branch workflow (regla del propietario)**: cada PR funcional sale de una rama limpia desde `main` (p.ej. `p1-alert-history-kv`). **NO** usar `claude/personal-investing-app-BG2r1` como base — historia divergente, conflictos masivos.

**Fase 3 (código)**: radar amplio — external screener, ExternalCandidate schema, smoke evidence primero.

**Fase 4 (código)**: `p2-single-asset-live-check` — precio fresco, recalcular señal, explicación interna.

**Fase 5 (código + decisión de proveedor)**: `p3-single-asset-news-and-thesis-explainer` — noticias, fundamentals, tesis.

No iniciar ninguna fase sin confirmación del propietario.

---

## Regla anti-pérdida de contexto — cuando producción contradice docs

Si `/api/config/status` o los env vars de Vercel muestran algo distinto a lo que dicen estos docs:

1. **No tocar Vercel** inmediatamente basándose en los docs.
2. **Verificar producción** primero: `curl "$BASE/api/config/status"` + revisar env vars reales.
3. **Abrir PR docs-only** para reconciliar.
4. **Solo después** decidir cambios funcionales.

Ejemplo real: los docs decían "producción usa mock, configurar PRICE_PROVIDER=yahoo". La realidad era `PRICE_PROVIDER=twelvedata` ya configurado y funcionando. Cambiar a yahoo habría roto producción (yahoo rate-limita desde cloud IPs de Vercel).

---

## Cómo actualizar este archivo

Actualizar `AGENTS.md` cuando cambie:
- el estado de producción (variables configuradas, PRs mergeados)
- las restricciones de seguridad
- las reglas de trabajo
- el orden de los próximos PRs

Mantenerlo sincronizado con `docs/PROJECT_STATE.md`.

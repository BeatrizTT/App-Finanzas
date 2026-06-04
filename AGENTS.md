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

### Seguridad — restricciones permanentes
Estas restricciones no se negocian y no cambian salvo instrucción explícita del propietario:

- **No añadir símbolos a `config/eodhd-symbol-validation.json` como `validated_usd_needs_fx` sin evidencia real de smoke con EODHD.**
- **No usar precio USD como EUR. No hardcodear FX. No poner `currentPrice: 0`. No introducir `Infinity`.**
- **No emitir recomendación BUY si `dataQualityScore` es bajo.**
- **No emitir BUY si pricing o FX no es apto** (`suitableForExactPnl: false` / `suitableForBuyRecommendation: false`).
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

Resumen a fecha de última actualización de este archivo (2026-06-04, PR #17):
- Cron fail-closed: implementado en código (PR #13). Falta configurar `CRON_SECRET` en Vercel.
- Precios: producción usa mock. Falta configurar `PRICE_PROVIDER=yahoo` en Vercel.
- Persistencia KV: código listo. Falta configurar `KV_REST_API_URL` + `KV_REST_API_TOKEN` en Vercel.
- Telegram: código listo. Falta configurar `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` en Vercel.
- `/api/engine/run` GET, `/api/opportunities`, `/api/portfolio`: todos KV-aware via `loadEngineOutput()` (PR #16).
- CSV import: KV-aware (PR #17). `POST /api/portfolio/import` guarda via `savePortfolioConfig()` → `saved: true` en Vercel con KV.
- Portfolio config: todos los consumidores (`/api/portfolio`, `/api/engine/run`, `runDailyEngine`) leen via `loadPortfolioConfig()` — KV-first, `config/portfolio.json` fallback (PR #17).
- `/api/config/status`: ya existe (devuelve `priceProvider`, `cronSecretSet`, `telegramConfigured`, `isVercel`).

---

## Próximos PRs recomendados (según backlog)

Ver `docs/CTO_BACKLOG.md` para detalle completo. Orden actual (P1):

1. `p1-alert-history-kv` — mover `history.ts` (alert history/deduplication) a KV para que funcione entre invocaciones de Vercel
2. `p1-discovery-state-kv` — mover watchlist y snapshots a KV (prefijo `discovery:`)

No iniciar ninguno sin confirmación del propietario.

---

## Cómo actualizar este archivo

Actualizar `AGENTS.md` cuando cambie:
- el estado de producción (variables configuradas, PRs mergeados)
- las restricciones de seguridad
- las reglas de trabajo
- el orden de los próximos PRs

Mantenerlo sincronizado con `docs/PROJECT_STATE.md`.

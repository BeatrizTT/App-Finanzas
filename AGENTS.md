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

Resumen a fecha de última actualización de este archivo (2026-06-04, PR #19 — producción reconciliada):
- **Precios**: `PRICE_PROVIDER=twelvedata` en Vercel desde Mayo 2026. `priceProvider: "twelvedata"` en `/api/config/status`. **NO** en mock. **NO** cambiar a yahoo (yahoo rate-limita desde Vercel cloud IPs).
- **Cron**: `CRON_SECRET` configurado desde Abril 2026. `cronSecretSet: true`. Fail-closed activo.
- **KV**: `KV_REST_API_URL` + `KV_REST_API_TOKEN` configurados desde Mayo 2026. Verificación end-to-end pendiente (Fase 1).
- **Telegram**: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` configurados desde Abril 2026. `telegramConfigured: true`. Recepción de mensajes pendiente de verificar (Fase 1).
- **CSV import**: KV-aware (PR #17). `saved: true` cuando KV responde correctamente.
- **Portfolio config**: todos los consumidores usan `loadPortfolioConfig()` — KV-first, `config/portfolio.json` fallback (PR #17).
- **EODHD**: env vars configuradas en Vercel pero **inactivas** — `PRICE_PROVIDER=twelvedata` no las instancia.
- **`ENGINE_API_SECRET`**: NO configurar. Dashboard llama POST sin Authorization header.

---

## Próximos PRs recomendados (según backlog)

Ver `docs/CTO_BACKLOG.md` sección "Roadmap" para detalle completo. Orden actual:

**Fase 0 (docs, DONE PR #19)**: producción reconciliada. Env vars ya configuradas. NO tocar Vercel.

**Fase 1 (verificación, sin código)**: end-to-end live:
- `/api/config/status` → `priceProvider: "twelvedata"`, `cronSecretSet: true`, `telegramConfigured: true`
- `POST /api/engine/run` → precios reales
- `GET /api/engine/run` → confirma KV write/read
- CSV import → `saved: true`
- Telegram → confirmar mensaje

**Fase 2 (código, después de Fase 1)**:
1. `p1-alert-history-kv` — mover `history.ts` (alert history/deduplication) a KV
2. `p1-discovery-state-kv` — mover watchlist y snapshots a KV (prefijo `discovery:`)

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

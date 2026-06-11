## Descripción

<!-- Qué cambia y por qué. Una o dos frases. -->

## Tipo de cambio

- [ ] Docs / proceso (sin código funcional)
- [ ] Bug fix
- [ ] Nueva feature
- [ ] Refactor
- [ ] Infraestructura / configuración

---

## Checklist de documentación

Marcar como completado o justificar "no aplica" — no dejar sin responder.

- [ ] `docs/PROJECT_STATE.md` actualizado, o **no aplica porque**: ___
- [ ] `docs/CTO_BACKLOG.md` actualizado, o **no aplica porque**: ___
- [ ] `docs/RUNBOOK.md` actualizado (si cambia operación, env vars o endpoints), o **no aplica porque**: ___
- [ ] `docs/DECISIONS.md` actualizado (si hay decisión arquitectónica), o **no aplica porque**: ___
- [ ] `AGENTS.md` actualizado si cambia estado de producción o próximos PRs, o **no aplica porque**: ___

---

## Acciones manuales para el propietario

- [ ] Este PR **no requiere** acciones manuales en Vercel, Telegram, GitHub Actions ni ningún servicio externo

Si sí requiere acciones manuales, describirlas aquí en español, paso a paso, para una persona no técnica:

<!-- Usar este formato:

### ACCIÓN MANUAL PARA EL PROPIETARIO

**Qué:** ...
**Dónde:** ...
**Cuándo:** ...
**Qué pasa si no se hace:** ...
**Qué NO tocar:** ...

-->

---

## Tests y verificación

- [ ] `npm test` ejecutado — resultado: ___ suites, ___ asserts, ___ failed
- [ ] `npx tsc --noEmit` ejecutado sin errores
- [ ] Comportamiento verificado (indicar cómo): ___

---

## Scope

- [ ] No se tocaron áreas fuera del scope declarado
- [ ] No se mezclan fases P0/P1/P2/P3
- [ ] Las restricciones de seguridad de `AGENTS.md` siguen en vigor

---

## Referencia al backlog

<!-- PR relacionado con qué ítem de CTO_BACKLOG.md: -->
Cierra / avanza: `P0-X` / `P1-X` / ninguno

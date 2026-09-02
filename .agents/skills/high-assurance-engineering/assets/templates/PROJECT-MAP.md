# Project Map

> Optional navigation and ownership template. It describes what exists, not whether it is
> healthy or why historical decisions were made.

## System boundary

`[WHAT THE SYSTEM OWNS, WHAT IT INTEGRATES WITH, AND WHAT IS OUTSIDE ITS BOUNDARY]`

## Current and target state

| Responsibility | Current owner | Approved target owner | Migration status | Verify with |
|---|---|---|---|---|
| `[RESPONSIBILITY]` | `[CURRENT]` | `[TARGET OR SAME]` | `[NOT STARTED / COEXISTING / CUT OVER / RETIRED]` | `[CODE/CONFIG/TEST]` |

An approved target is not current truth until verification shows the cutover and retirement
gates passed.

## Repository structure and ownership

| Surface | Purpose | Owner | Main entry points | Verification |
|---|---|---|---|---|
| `[PATH / MODULE / SERVICE]` | `[PURPOSE]` | `[TEAM/ROLE]` | `[ENTRY]` | `[TEST/CONFIG]` |

## Data and external systems

| System/data class | Source of truth | Read/write boundary | Environment | Contract/runbook |
|---|---|---|---|---|
| `[SYSTEM]` | `[OWNER]` | `[BOUNDARY]` | `[ENVIRONMENTS]` | `[LINK]` |

## Delivery map

| Concern | Canonical owner | Location | Notes |
|---|---|---|---|
| Source control | `[HOST/REPO]` | `[LINK]` | `[MIRROR DIRECTION IF ANY]` |
| CI | `[SYSTEM]` | `[CONFIG PATH]` | `[REQUIRED CHECKS]` |
| Artifacts | `[SYSTEM]` | `[LOCATION]` | `[IDENTITY/RETENTION]` |
| Environments | `[SYSTEM]` | `[RUNBOOK]` | `[PROMOTION FLOW]` |
| Observability | `[SYSTEM]` | `[DASHBOARD/RUNBOOK]` | `[OWNER]` |
| Recovery | `[SYSTEM]` | `[RUNBOOK]` | `[OWNER]` |

## Jump table

| Need | Start here | Read next | Verify with |
|---|---|---|---|
| Change identity/access | `[PATH]` | `[DECISION/RUNBOOK]` | `[TEST]` |
| Change persistent data | `[PATH]` | `[SCHEMA/MIGRATION RULE]` | `[TEST/ENV]` |
| Change public interface | `[PATH]` | `[CONTRACT]` | `[CONTRACT TEST]` |
| Change UI/user flow | `[PATH]` | `[DESIGN/ACCESSIBILITY]` | `[E2E/AUDIT]` |
| Change analytics/observability | `[PATH]` | `[EVENT/SIGNAL CONTRACT]` | `[VALIDATION]` |
| Change deployment | `[PATH]` | `[RUNBOOK]` | `[CI/SMOKE]` |


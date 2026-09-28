# Accepted advisories

Advisories that `npm audit` reports and we have decided to accept, with the reason.
An advisory nobody addresses trains everyone to skim the list, so each one here has a
decision, and anything not here is to be fixed.

| Advisory | Path | Severity | Decision | Why | Review |
|---|---|---|---|---|---|
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — `uuid` v3/v5/v6 missing buffer bounds check when `buf` is given | `@capacitor/cli` → `xcode` → `uuid` | moderate | **Accepted** (2026-09-28) | Build-time only: `@capacitor/cli` is a devDependency that edits the Xcode project on the developer's machine. It never ships in the game, the site or the service (`npm audit --omit=dev` is clean, and CI checks exactly that), and it never passes a caller-supplied buffer. | When `@capacitor/cli` updates `xcode`, or on the next Capacitor major |

**Dependabot:** alerts are currently disabled for this repository, so there is no alert
to dismiss yet. When they are enabled (docs/LAUNCH.md, "Accounts and security"), dismiss
this one as *"Vulnerable code is not actually used"* with a link to this file:

```
gh api -X PATCH repos/chezgoulet/efflorescent/dependabot/alerts/<number> \
  -f state=dismissed -f dismissed_reason=not_used -f dismissed_comment="Build-time only (@capacitor/cli); see docs/ADVISORIES.md"
```

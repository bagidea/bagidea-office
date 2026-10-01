# Testing the research tools

Run the offline regression suite from the Office root:

```powershell
node --test daemon/tests/research-gate.test.js daemon/tests/research-catalog.test.js daemon/tests/install-research-harness.test.js daemon/tests/skills.test.js
```

Tests use temporary directories, injected HTTP responses and synthetic office registries. They do not call a live office, install models or contact catalog projects.

Coverage includes packet scope/freshness, malformed evidence, draft refusal, source-fetch limits, redirect restrictions, preserving a failed-refresh cache, catalog changes, installer idempotence, profile preservation, content limits, selected backups, uncertain writes and native skill synchronization. Portability checks cover arbitrary lead IDs, different office roots/rosters, explicit target selection, optional existing files/skills and loopback URL configuration.

The checker validates recorded evidence structure and review attestation. It does not fetch or authenticate citations, prove license compatibility, authorize tool execution or certify production readiness. Installation reports describe only the office against which the installer was explicitly run; no live installation receipt is included in this package.

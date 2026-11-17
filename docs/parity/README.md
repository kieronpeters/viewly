# Parity reports

One report per flow, generated after the implementation gate.

```
docs/parity/<flow>-report.md
```

Each report states:

- spec version and commit under test
- contract assertions passed / failed
- performance measurements against budget
- accessibility checks
- deviations and their reasons
- reviewer sign-off

Reports are append-only per release so regressions are visible over time.

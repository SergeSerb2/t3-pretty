# Performance motion plans

| Number | Title                             | Severity | Status      |
| ------ | --------------------------------- | -------- | ----------- |
| 001    | Bound thinking-orb rendering work | HIGH     | IMPLEMENTED |
| 002    | Filter scenery motion mutations   | HIGH     | IMPLEMENTED |

Recommended order: execute 001 first because it removes the sustained idle GPU
load, then 002 because it removes streaming-time main-thread layout churn. The
plans are independent but touch `SceneryMotion.tsx`, so applying them in this
order minimizes merge overlap.

Both plans are mechanically verified in the implementation PR. The patched
client A/B described in each feel check remains a separate integrated
verification step.

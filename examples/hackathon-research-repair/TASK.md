# Demo task

Use this prompt from the repository root:

> The sample under `examples/hackathon-research-repair` contains a stale Tavily client. Verify Tavily's **current official Search API** with the available web research tools before editing; do not rely only on the local test expectations. Update the sample to the current API contract while preserving the `searchWeb(query, options)` interface. Run the sample's tests, diagnose any failure, repair it, and finish only after verification passes.

Expected workflow:

1. Inspect the fixture.
2. Detect the current-API knowledge gap.
3. Use Tavily research and collect source evidence.
4. Edit the stale client.
5. Run `cd examples/hackathon-research-repair && npm test`.
6. If verification fails, repair and rerun it.
7. Finish with the structured completion report.

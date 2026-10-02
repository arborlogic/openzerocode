# Research → Repair demo

This small fixture is intentionally broken so OpenZeroCode can demonstrate the full public hackathon path on a deterministic repository task:

```text
inspect → identify knowledge gap → research → edit → verify → repair if needed → report
```

The fixture contains no credentials and makes no real Tavily request during tests. Its test double records the outgoing request shape, so verification is deterministic and free. Runtime research still requires the developer's own `TAVILY_API_KEY`.

## Setup

From the OpenZeroCode repository root:

```bash
export TAVILY_API_KEY=your_own_key_here
export NEBIUS_API_KEY=your_own_key_here
npm run dev
```

Open `TASK.md`, paste its task into OpenZeroCode, and keep the Web research (Tavily) tool group enabled.
For the hackathon path, switch the provider to `nebius`; the default model is NVIDIA Nemotron 3.5 Lightning.

## Baseline

The committed fixture is expected to fail before the agent repairs it:

```bash
cd examples/hackathon-research-repair
npm test
```

## Reset for another demo

From the repository root:

```bash
git restore examples/hackathon-research-repair/src/tavily-client.mjs
```

Only synthetic code and a placeholder credential name are used. Do not add real API keys, private endpoints, local absolute paths, customer code, or personal data to this fixture.

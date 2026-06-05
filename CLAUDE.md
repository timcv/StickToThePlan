# StickToThePlan

Vätternrundan race-plan calculator. Monorepo:

- `packages/core` — pure pacing model and output builders (FIT, GPX, plan JSON, Connect IQ source)
- `packages/cli` — CLI that runs the pipeline and writes `output/`
- `apps/web` — React web app
- `api` — serverless weather endpoints
- `ciq` — Garmin Connect IQ data field (Monkey C)

## Roadmap / future work

When you spot a future improvement, enhancement, or deferred idea that is out of scope
for the current task, append it to [docs/roadmap.md](docs/roadmap.md) rather than
expanding the current change. Keep entries short and actionable.

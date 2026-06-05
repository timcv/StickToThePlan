# StickToThePlan

Computes per-control split times and downloadable bike-computer / watch files for a long road cycling event (Vätternrundan 315 km is the bundled route) from a route GPX, a stop schedule, and a target finish time. The plan holds an even rider effort (constant normalized power) and lets speed vary with gradient and wind, capped so front pulls stay sustainable.

The same pure calculation core (`@stp/core`) runs in the browser app and the Node CLI, so the web result and the local result are identical.

- Live app: https://sticktotheplan.vercel.app
- Model and validation numbers: [MODELL.md](MODELL.md)

This README is for developers who want to run the code locally, reuse the core, or open a pull request. If you just want to plan a ride, use the live app.

## Repo layout

This is an npm-workspaces monorepo. ESM throughout, TypeScript, no build step for the libraries (source is imported directly).

| Path            | What it is                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | The pure calculation core and output builders: physics, chaingang model, planner, segmentation, GPX/FIT ingest, and the FIT/GPX/JSON builders (incl. the `course.fit` course export). Browser-safe, no Node-only IO. **This is the reusable part.** |
| `packages/cli`  | Node CLI that does file IO, weather fetch + cache, and the `monkeyc` compile, calling `@stp/core` for all math.                                                                                                                                     |
| `apps/web`      | Vite + React single-page app. Runs `@stp/core` in a Web Worker; serves the form, split table, tempokort, and downloads.                                                                                                                             |
| `api/`          | Vercel serverless function for the server-side weather fetch.                                                                                                                                                                                       |
| `ciq/`          | Garmin Connect IQ data field (Next Control Pace): a static, generic field compiled once with `npm run build:ciq`.                                                                                                                                   |

## Getting started

Requires Node 18+ (Vite 6 / React 19).

```bash
git clone git@github.com:timcv/StickToThePlan.git
cd StickToThePlan
npm install            # installs all workspaces
```

Run the web app:

```bash
npm run dev -w apps/web   # Vite dev server, default http://localhost:5173
```

Run the CLI planner:

```bash
npm start -w @stp/cli          # uses config.json at the repo root
npm start -w @stp/cli -- --offline   # no network: cached forecast, else calm wind
```

The CLI reads `config.json` at the repo root (GPX path, optional FIT path, FTP, rider count, target time, stops). The `data/` directory is gitignored, so point `config.json` at your own files, or pass `--config path/to/other.json`.

## Checks

All three must pass before a PR is merged. CI and reviewers run them.

```bash
npm test            # Vitest across all workspaces
npm run typecheck   # tsc --noEmit (root, api, web)
npm run build:web   # production build of apps/web
```

## Reusing the core

`@stp/core` is the calculation engine with no UI and no Node-only IO, so it runs anywhere an ES module bundler does (browser, worker, Node, Bun). It is published only inside this repo and ships TypeScript source, so consume it through a bundler/runtime that handles `.ts` (Vite, tsx, Bun), or compile it first.

```ts
import {
  applyDefaults,
  ingestGpxString,
  solveThreeScenarios,
  segment,
  buildSplitTable,
} from '@stp/core';

const cfg = applyDefaults({
  gpx_path: 'route.gpx',
  ftp: 272,
  n_riders: 12,
  target_total_hm: '11:45',
  start_time: '04:22',
  stops: [{ control: 'Gränna', km: 77, minutes: 10 }],
});

const micro = ingestGpxString(gpxText, cfg); // string in, no fs
const scenarios = solveThreeScenarios(micro, field, cfg); // field = EnsembleField, or calm
const splits = buildSplitTable(scenarios.expected, cfg);
const display = segment(scenarios.expected, cfg);
```

`field` is the weather (an `EnsembleField`); for no wind, pass a calm field. The full wiring, including how the web app builds the calm and fetched fields, is in the two worked examples: the web worker pipeline ([`apps/web/src/lib/pipeline.ts`](apps/web/src/lib/pipeline.ts)) and the CLI. The public surface is the re-exports in [`packages/core/src/index.ts`](packages/core/src/index.ts).

## How the planner works

1. An NP anchor (`np_target`) is read from an optional representative FIT ride (its rolling normalized power), or falls back to `0.60 × FTP`.
2. Each microsegment gets a physics estimate (gravity, rolling resistance, yaw-adjusted aero, drivetrain efficiency, air density) wrapped in a chaingang model (front pull vs draft, duty cycle `1/n_riders`).
3. The route is time-marched at fixed rider NP, with a neutral start block and hard/soft pull caps. An outer bisection adjusts the NP until total time hits the target.
4. Control ETAs and the split table fall out of the time march.

Full detail and validation in [MODELL.md](MODELL.md).

## Contributing

1. Branch off `main`.
2. Keep `packages/core` browser-safe: no `fs`, `path`, or other Node-only APIs. IO belongs in `packages/cli` or `api/`.
3. Add or update tests next to what you change. The core has good coverage; keep it that way.
4. Make `npm test`, `npm run typecheck`, and `npm run build:web` pass.
5. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
6. Open a PR against `main` with a short description of the change and why.

The math is intentionally pure and deterministic. If you change a number that affects output, say which validation case in MODELL.md still holds.

## Privacy

Uploaded GPX and FIT files are processed entirely in the browser, never sent to a server. In server weather mode only the route's rounded sample coordinates and the date are sent to the weather function (SMHI, MET Norway, Open-Meteo). Calm and manual modes send nothing.

## License

MIT. See [LICENSE](LICENSE).

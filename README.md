# StickToThePlan

StickToThePlan computes per-depot split times (mellantider) and downloadable watch files for a long road cycling event (the Vätternrundan 315 km is the bundled example) from a route GPX, a stop schedule, and a target finish time. The plan holds an even rider effort (constant normalized power) and lets speed vary with gradient and wind, with caps so front pulls never become unsustainable. The same pure calculation core runs in the browser app and the Node CLI, so the web result and the local result are identical.

## Hosted app

Live app: TBD (filled after the first Vercel deploy)

## How it works

In short:

1. An NP anchor (`np_target`) is read from an optional representative FIT ride (its rolling normalized power), or falls back to `0.60 x FTP` when no FIT is given.
2. Each microsegment gets a per-segment physics estimate (gravity, rolling resistance, yaw-adjusted aero, drivetrain efficiency, air density) wrapped in a chaingang model (front pull vs draft, duty cycle `1/n_riders`).
3. The route is time-marched at that fixed rider NP, with a neutral start block and hard and soft pull caps, and an outer bisection adjusts the NP until the total time hits the target.
4. From the time march, the tool derives depot ETAs and the per-depot split table.

See [MODELL.md](MODELL.md) for the full model and the validation numbers.

## Web quick start

1. Open the app URL.
2. Upload a route GPX (and optionally a representative FIT ride for the NP anchor).
3. Set your stops, target finish time, and parameters (FTP, number of riders, start time).
4. Read the depot split table.
5. Download `workout.fit` (distance-based structured workout), `course.gpx` (route plus ETA waypoints), `plan.json` (full machine-readable plan), and `PlanDelta.mc` (Connect IQ data-field source).

The Connect IQ `.prg` watch app cannot be produced in the browser. The web download gives you the `.mc` source. The compiled `.prg` must be built locally with the CLI and the Garmin SDK (see below).

## Local CLI quick start

```bash
npm install            # at the repo root, installs all workspaces
npm start -w @stp/cli  # run the planner (equivalently: npm start)
```

By default the CLI fetches a live weather forecast. Pass `--offline` to use the cached forecast or, if there is no cache, calm wind, with no network access:

```bash
npm start -w @stp/cli -- --offline
```

You bring your own inputs. The CLI reads `config.json` at the repo root for the GPX path, the optional FIT path, FTP, rider count, target time, and stops. The repo's `data/` directory (course GPX and FIT rides) is gitignored, so point `config.json` at your own files. You can also pass `--config path/to/other.json`.

The Connect IQ `.prg` is compiled locally by the CLI via the Garmin Connect IQ SDK (`monkeyc`). If the SDK and a device package are installed, the CLI compiles the generated `.mc` source to a `.prg`. If not, it writes the `.mc` source and skips compilation gracefully.

## Monorepo layout

- `packages/core`: the pure calculation core and output builders (physics, chaingang, planner, segmentation, GPX/FIT ingest, FIT/GPX/JSON/Connect IQ builders), browser-safe and with no Node-only IO.
- `packages/cli`: the Node command-line tool that does file IO, weather fetching and caching, and the `monkeyc` compile, calling `@stp/core` for all of the math.
- `apps/web`: the Vite + React single-page app that runs the same `@stp/core` in the browser (in a Web Worker) and serves the upload, form, split table, and downloads.

## Development

```bash
npm test          # Vitest across all workspaces
npm run typecheck # tsc --noEmit
npm run build:web # production build of apps/web
```

## Deployment

The web app deploys to Vercel as a static SPA built from the monorepo: install at the repo root, build `apps/web`, and serve the static output from `apps/web/dist`. The exact `vercel.json` lives in the repo (added by a separate task).

## Privacy

Uploaded GPX and FIT files are processed entirely in the browser and are never sent to a server. In Open-Meteo weather mode the only data sent to the network is the route coordinates and the date, which go to the Open-Meteo API to fetch the forecast.

## License

MIT. See [LICENSE](LICENSE).

# DrumKlone

Be a dead ringer for any drum. Drop in drum sample A to detect its pitch, drop in sample B, and retune B to match A.

- `src/detect.js`: pitch detection (spectral peaks + YIN, multi-candidate for inharmonic drums)
- `web/`: browser app, time-preserving shift via Signalsmith Stretch (MIT) or varispeed
- `npm test` runs detector tests on synthetic drums; `node test/e2e.cjs` runs a headless-browser check
- `npm run serve` then open http://localhost:8080

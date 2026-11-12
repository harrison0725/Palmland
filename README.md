# Palmlands

A tiny living world that grows on the palm of your hand. Built for the Meta VR
Start Developer Competition 2026 (Gaming track, New Experience).

Hold your hand out palm up in mixed reality and an island grows out of it. Poke
the grass with your other index finger to plant trees, tilt your hand to pour
the pond over the fields, close your hand to bring the night and open it for
sunrise, and pinch villagers to carry them around. No controllers needed.

## Run locally

```bash
npm install
npm run dev        # IWSDK-managed dev server + emulator (IWER)
```

Open the network URL it prints on a Quest on the same Wi-Fi to test on device.
Add `?debug` to the URL to log hand and game state to the console once a second.

## Build and deploy

`npm run build` writes a static site to `dist/`. Pushing to `main` runs
`.github/workflows/pages.yml`, which builds and publishes to GitHub Pages
(enable Pages with "GitHub Actions" as the source in the repo settings).

## Code map

- `src/hands.ts` reads WebXR hand joints: palm centre and normal, openness, pinch.
- `src/palm-system.ts` is the game: placement on the palm, day/night, water,
  villagers, planting, onboarding steps, save/resume.
- `src/island.ts` builds all low-poly geometry procedurally.
- `src/sfx.ts` is a tiny WebAudio synth, so there are no audio assets.

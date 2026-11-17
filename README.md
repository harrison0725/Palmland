# Palmlands

A tiny living world that grows on the palm of your hand. Built for the Meta VR
Start Developer Competition 2026 (Gaming track, New Experience).

Play it in the Meta Quest browser: https://harrison0725.github.io/Palmland/

Hold your hand out palm up in mixed reality and an island grows out of it.
Everything is done with bare hands, seated, with no controllers and no menus.

| Gesture | What happens |
| --- | --- |
| Palm up | The island grows out of your hand |
| Poke the grass | Plant a tree |
| Tilt your hand | The pond pours a stream over the fields, and leaves a rainbow |
| Close your hand | Night falls, lanterns glow, crops grow |
| Pinch a villager | Pick them up and carry them |
| Flip your palm over | The island settles into your room at table size |
| Cover it with a flat hand | Night on the resting island |
| Open palm underneath | Scoop the island back up |

After the first few minutes the villagers start making wishes (play with me,
plant me some shade, bring the night, take me to a friend, water my field).
Granting them unlocks wildflowers and a windmill, then lanterns, then a festival
night with fireworks, sky lanterns and dancing. A new villager moves in each day
you come back, and the island is saved between visits.

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
- `src/wishes.ts` holds the villager wishes and what they unlock.
- `src/water.ts`, `src/fx.ts` and `src/life.ts` are the stream, pooled particles,
  butterflies, fireworks, sky lanterns, rainbow, night sky and leaping fish.
- `src/sfx.ts` is a tiny WebAudio synth, so there are no audio assets.
- `tools/` holds emulator scripts that play the game with emulated hands. They are
  how every gesture was tested and how the demo video was filmed.

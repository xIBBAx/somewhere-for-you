# Architecture

A single-page web app: React renders the interface and a React Three Fiber
canvas, and almost everything that moves is plain TypeScript running in the
render loop. There is no server. This page is a map: the header comment of
each module explains the details (and often the physics) behind it.

```
index.html ─ boot/letter.js (letter, before the bundle) ─ boot/progress.js (loader)
   └─ src/main.tsx ── initPersonalization() ──▶ App.tsx
                                                ├─ GameCanvas (React Three Fiber)
                                                │    └─ World.tsx: sky, terrain, life, people, animals, effects
                                                ├─ ui/*: HUD, cards, map, journal, Personalize
                                                └─ state/*: zustand stores + localStorage
   Web Workers: world/chunk, world/farTerrain, world/horizonLands, game/navigation/mapTiles
```

## Start-up

1. `index.html` shows the letter immediately: `public/boot/letter.js` fills
   it from this browser's saved personalization or the build's
   `customize/gift.json` (embedded as inert JSON by
   `tools/vite/giftLetterPlugin.ts`). The world starts loading behind it.
2. `src/main.tsx` awaits `initPersonalization()` (reads localStorage and the
   IndexedDB files the gift refers to), **then** imports the game, so every
   module sees the final names, memories and photos.
3. `App.tsx` mounts the canvas; `GameCanvas` reports loading progress until
   the spawn area has streamed, both characters have loaded and shaders are
   warm. **Enter** on the letter starts the world.

## Where things are

| Area | Directory | Key modules |
|---|---|---|
| Personalization | `src/personalization/` | `types.ts` (the schema), `defaults.ts` (demo world), `normalize.ts` (validation), `resolve.ts` (start-up, `names`, photo/model/music lookup), `localData.ts` (localStorage + IndexedDB), `media.ts` (checking added files), `bundle.ts` + `zip.ts` (export/import), `modelCheck.ts` |
| Story content | `src/content/` | `memories.ts` (nine places), `secrets.ts`, `story.ts` (title, ending, occasion), `together.ts` (dialogue), `adventures.ts` (journal pages), `discoveries.ts`, `groundLife.ts` |
| Runtime state | `src/game/runtime.ts`, `src/state/` | mutable per-frame state for the bodies, camera, input and world flags; zustand stores for UI and saved progress (`gameStore`, `persistence.ts`, `adventureStore`, `navigationStore`, `qualityStore`…) |
| Terrain and streaming | `src/world/` | `terrain.ts`, `baseTerrain.ts`, `chunkGen.ts` + `chunk.worker.ts`, `streamer.ts`, `farTerrain*`, `horizonLands*`, `origin.ts` (floating origin), `climate.ts`, `erosion.ts` |
| Water, plants, scatter | `src/world/render/`, `src/game/environment/` | `StreamedTerrain`, `GrassField`, `WorldScatter`, `vegetation*`, `Water`, `Clouds`, `Lighting`, `trees/` |
| The mountain valley | `src/world/highvale/` | baked height maps, river, village, its own sky and ground |
| Authored places | `src/world/sites/` | flat sites for hand-made models (empty by default) and building footprints |
| Small creatures | `src/world/life/`, `src/world/aquatic/` | birds, insects, ground creatures, fish, frogs, dragonflies (GPU-instanced, simulated near you) |
| Wildlife | `src/world/wildlife/`, `src/game/animals/`, `src/game/deer/` | rigged animals with `QuadrupedAnimator`/`PrimateAnimator`; deer herds with territories, trust and riding |
| People | `src/game/characters/` | `human/HumanAnimator.ts` (procedural posing, IK, swimming, riding poses), `human/humanAsset.ts` (loading presets or custom GLBs), `realHuman.ts` (materials, rig contract), `faceRig.ts` (ARKit expressions, gaze), `controller/` (locomotion), `characterSwitch.tsx` |
| The cat | `src/game/characters/CompanionCat.tsx`, `catBrain.ts`, `catLife.ts`, `catRigPose.ts` | following, playing, riding along, finding the secrets |
| Two together | `src/game/together/` | the companion's behaviour and shared actions |
| Horses and flight | `src/game/horses/`, `src/game/pegasus/`, `src/game/dragon/`, `src/game/mounts/` | gaits (`HorseAnimator`), riding (`riding.ts`), Pegasus flight model, wings, landing, aerobatics, the dragon's spine-follows-the-head flight |
| Space | `src/game/celestial/` | the solar system at 1:63.71 scale (`scale.ts`, `universe.ts`, `bodies.ts`), star-sail flight, journeys between worlds (`cosmicTravel.ts`), the Moon realm and landing sites (`realm/`), rings, space cats, sky rendering |
| Camera and maps | `src/game/camera/`, `src/game/navigation/`, `src/ui/WorldMap.tsx` | follow camera with collision, map tiles rendered in a worker, marks, fast travel |
| Effects | `src/game/vfx/`, `src/game/particles/`, `src/game/render/` | the shared GPU particle system (`lumenCore`), the post-processing chain (`PostFX.tsx`: AO, bloom, grade), quality presets |
| Activities | `src/game/activities/` | photo mode, races, stones, lanterns, fireflies, flowers, the valley bench |
| Weather and time | `src/game/weather/`, `src/game/timeOfDay.ts` | the world's own clock-driven weather, optional live weather |
| Audio | `src/game/audio/` | one music track through Howler; sound effects are switched off (`SOUND_EFFECTS = false`) |
| Interface | `src/ui/` | HUD, cards, journal, controls guide, Explore menu, map, `personalize/` |
| QA tools | `src/dev/` | `?debug` helpers (`window.__worldDev`), only in development builds or a build made with `VITE_DEV_TOOLS=1` |

Tests live in `tests/` (Vitest, no GPU needed: they load the real GLBs and
run the animators, physics, streaming and personalization) and `tests/e2e/`
(Playwright in a real browser).

## How a frame runs

React renders the scene graph once; per-frame work happens in `useFrame`
callbacks with explicit priorities. Input → the active body's locomotion
(`controller/`) and riding/flight → the companion's and cat's decisions →
animators pose skeletons → the follow camera → world streaming and the
floating origin (the world is shifted back toward 0,0,0 so 32-bit floats stay
precise over tens of kilometres) → effects → post-processing. Hot paths
reuse their vectors and quaternions; the tests check that the animator
allocates nothing per frame.

## Streaming and performance

Terrain is generated in 64 m chunks by a pool of workers around the player
(high detail within ~128 m, lower to ~300 m), with a far-terrain mesh and
"horizon lands" beyond. Vegetation and creatures are instanced and culled by
distance; animals switch to LOD models far away. The quality store picks
High, Balanced or Light (shadow resolution, grass density, animal counts,
post-processing) and Auto steps down when the frame rate drops. The canvas
renders at most one pixel per CSS pixel.

## The Indian layer

`src/game/environment/india/` holds the diyas, rangoli, torans, kites and
peacocks: all procedural, all placed by `indiaLayout.ts`. Gulmohar trees use the
tree system in `environment/trees/`, and across the wider world the same flame
colour comes from a tint in `world/render/WorldScatter.tsx`. Names and words are
in `personalization/defaults.ts` and `content/`, and can be replaced by a gift.

## Personalization boundaries

Everything personal flows through `src/personalization`. Code that shows a
name reads it from `names` (`names.cat`, `names.starborn`,
`characterName(id)`); content modules build their lists from `gift()`; photos,
music and models are referenced as `placeholder:`, `media:` or `local:` and
resolved there. Nothing else reads localStorage's personal key or IndexedDB,
and nothing in the game uses text as HTML.

## Adding things

- **A memory scene:** the nine places are in `content/memories.ts`
  (positions, scene types); their props are in `game/environment/`.
- **A place with your own model:** see "Swapping places" in
  [CUSTOMIZATION.md](CUSTOMIZATION.md).
- **An animal:** a builder script in `asset-pipeline/blender/`, its entry in
  `world/wildlife/animalAssets.ts` and a behaviour in `world/wildlife/`.
- **A control:** add it to `game/controls/bindings.ts` (the guide, legend and
  a test all read from there) and handle it in `game/input.ts`.

## Known limitations

- **Hand and foot IK on the realistic rigs** is looser than the animator's
  tests were tuned for: when kneeling to stroke the cat the palm can land
  about 10–15 cm from the target, and on steep slopes a planted foot can
  slide by a similar amount. Those checks are kept in the tests, marked as
  skipped with the measured values, as targets for improvement.
- **Desktop only.** Touch controls were removed; phones and tablets are not
  supported.
- **Live weather** needs the browser's location permission and an internet
  connection; without them the world's own weather is used.
- The production bundle is one large script (about 3.5 MB, 1.2 MB gzipped)
  plus the worker scripts; code-splitting the space and valley systems is an
  open improvement.

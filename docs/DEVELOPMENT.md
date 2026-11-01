# Development

## Requirements

- Node.js 20.19+ or 22.12+ (what Vite 8 needs) and npm.
- A desktop browser with WebGL 2 and, ideally, a dedicated GPU.
- Optional: Chromium for Playwright (`npx playwright install chromium`).
- Optional, only to rebuild models: Blender 5.x and the tools in
  `asset-pipeline/setup/` (see [CHARACTER_ASSETS.md](CHARACTER_ASSETS.md)).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server with hot reload at http://localhost:5173 |
| `npm run build` | typecheck, then a production build in `dist/` |
| `npm run preview` | serve `dist/` at http://localhost:4173 with the production security headers |
| `npm run typecheck` | TypeScript, no output |
| `npm run lint` | ESLint |
| `npm test` | unit tests (Vitest, about 1,200, no GPU needed, ~30 s) |
| `npm run test:e2e` | browser tests (Playwright; starts its own dev server on port 5199) |
| `npm run check` | typecheck + lint + tests + build: run this before a pull request |
| `npm run characters` | rebuild the built-in characters with Blender |

`npm run dev -- --host` serves on your network as well (for testing on another
computer); by default it only listens on this machine.

## Browser tests on a real GPU

`npm run test:e2e` uses software rendering by default, which is slow. To use the
graphics card, set `GAME_NATIVE_GPU=1` and, on Linux or WSL,
`GAME_BROWSER_ARGS="--use-gl=angle --use-angle=gl --ignore-gpu-blocklist"`. Run
with `--workers=1`: the world is heavy, and parallel runs starve each other.

## Debug tools

Add `?debug` to the address in a development build (`npm run dev`):

- a panel with the frame rate, renderer, position, time of day, weather and
  buttons to jump to each memory place, unlock everything or reset progress;
- `window.__worldDev` helpers in the console, for example
  `__worldDev.ridePegasus("starborn")`, `__worldDev.journey("moon")`,
  `__worldDev.lookAvatar(30, 3, 1.6)`, `__worldDev.horse("Chetak")`;
- `?skipIntro` skips the letter and the opening journey; `?cinematic` replays
  the journey; `?personalize` opens the Personalize screen.

A production build ignores `?debug`. To test a production build with the
tools, build with `VITE_DEV_TOOLS=1 npm run build`. Never deploy that build.

`tools/qa/browser-driver.mjs` scripts a Playwright session (steps, waits,
key presses, screenshots) for repeatable captures; its header documents the
format.

## Working on WSL or a network drive

On WSL with the project on a Windows drive (`/mnt/c`, `/mnt/d`…), file
changes don't reach the dev server. Use `WATCH_POLLING=1 npm run dev`, or
better, keep the project inside the Linux file system (`~/…`), which is also
much faster for `npm ci` and builds.

On Windows, a running dev server can lock files in `node_modules`; stop it
before `npm install`.

## Performance and troubleshooting

**The frame rate is low.** Open the quality menu in the HUD (High, Balanced,
Light; Auto follows the frame rate). High adds ambient occlusion, bloom and
colour grading and the most grass and animals. Close other GPU-heavy tabs. On
laptops with two GPUs, make sure the browser uses the dedicated one (Windows:
Settings → Display → Graphics → your browser → High performance).

**"Rendering without a graphics card".** The browser fell back to software
rendering (SwiftShader or llvmpipe): hardware acceleration is off, the driver
is blocked, or there is no GPU (common in virtual machines and some remote
desktops). Turn on *Use graphics acceleration when available* in the
browser's settings, update the GPU driver, and check `chrome://gpu`.

**Black or flickering screen.** Usually a GPU driver problem. Try the Light
preset, update the driver, or another Chromium-based browser.

**Stuck in the world or caught in a pose.** F5 (*Refresh the universe*) rebuilds
the scene and puts you back where you stood. Explore → *Take me somewhere
safe* moves you to safe ground.

**No music.** Browsers block sound until you interact: click once or press a
key. The track can also be off in the HUD or set to *no music* in
Personalize.

**My photo doesn't show.** In `gift.json`, check the `media:` path matches the
file in `customize/media/` exactly (case matters) and that it is JPEG, PNG or
WebP. The dev server console lists every value it had to replace.

**The Personalize screen won't save.** Some browsers block storage in private
windows or for files opened from disk. Serve the game (`npm run dev` or
`npm run preview`) and use a normal window.

## Layout of the repository

```
src/            the game (see docs/ARCHITECTURE.md)
public/         static files served as-is: models, textures, fonts, music, the letter's scripts
customize/      your personalization (gift.json and media/ are git-ignored)
asset-pipeline/ scripts that build the models and data in public/assets
tests/          unit tests; tests/e2e/ browser tests
tools/          Vite plugins and the QA browser driver
docs/           guides
```

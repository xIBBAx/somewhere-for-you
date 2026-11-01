<h1 align="center">Somewhere, For You</h1>

<p align="center">
An explorable 3D world in the browser, rooted in Indian traditions, that you can make for someone:<br/>
their name on the letter that opens it, your memories at nine places around home,<br/>
and a sky full of stars to ride out into.
</p>

<p align="center"><strong>Created by Ibrahim Sultan</strong></p>

<p align="center">
<a href="docs/media/somewhere-for-you-trailer-720p.mp4"><img src="docs/media/poster.jpg" alt="Somewhere, For You: the trailer. The explorer at home at night, a rangoli ringed with lit diyas under a starry sky." width="880" /></a><br/>
<a href="docs/media/somewhere-for-you-trailer-720p.mp4"><strong>▶ Download the trailer</strong></a> (MP4, 27 MB: real gameplay, captured from the running game)
</p>

It is two things at once:

- **A game you can play right now.** Walk, ride, fly and sail through an endless landscape, from meadows and lakes to a mountain valley, the Moon and the planets. It works out of the box with a complete demo world.
- **A starting point for a gift.** Give it to a partner, a friend, a parent or a sibling: change the names, write the letter, put your photos at the memory places, pick or import the characters and choose the music. You can do it in the browser without code, or in a config file if you build it yourself.

> **Status:** playable from start to finish on a desktop browser, and still a work in progress. It is
> tested in Chromium. Phones and tablets are not supported. See [Project status](#project-status)
> for what works, what is experimental and what is next.

## Contents

- [What's in the world](#whats-in-the-world)
- [Play it](#play-it)
- [Make it for someone](#make-it-for-someone)
- [Controls](#controls)
- [Built with](#built-with)
- [Project status](#project-status)
- [Browser support](#browser-support)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [How this was made](#how-this-was-made)
- [License](#license)

## What's in the world

| | |
|---|---|
| <img src="docs/media/scenes/takeoff.webp" alt="A winged horse leaping into the sky past a golden dragon, kites and sky whales" width="420" /><br/><sub>Taking off on the star-born Pegasus</sub> | <img src="docs/media/scenes/peacock.webp" alt="A peacock with its train fanned out in a meadow under gulmohar trees" width="420" /><br/><sub>Peacocks fan their trains when you come close</sub> |
| <img src="docs/media/scenes/mela-dragon.webp" alt="A golden dragon flying over a ferris wheel at dusk" width="420" /><br/><sub>The mela at dusk, with the dragon passing over</sub> | <img src="docs/media/scenes/fireworks.webp" alt="Fireworks over a marigold gate at night, the Moon and sky whales above" width="420" /><br/><sub>Fireworks over the garden gate</sub> |
| <img src="docs/media/scenes/valley-flight.webp" alt="A winged horse flying through a Himalayan valley above a forest and a river" width="420" /><br/><sub>Flying through the mountain valley</sub> | <img src="docs/media/scenes/golden-rush.webp" alt="A golden dragon surging through clouds with a burst of light" width="420" /><br/><sub>The dragon's golden rush</sub> |
| <img src="docs/media/scenes/gallop.webp" alt="A rider galloping a chestnut horse across open meadow" width="420" /><br/><sub>Seven horse breeds to ride</sub> | <img src="docs/media/scenes/rainbow-kites.webp" alt="Patang kites and a rainbow over the home meadow after rain" width="420" /><br/><sub>Kites and a rainbow after the rain</sub> |
| <img src="docs/media/scenes/snow.webp" alt="Snow on the home meadow with flame-red gulmohar trees" width="420" /><br/><sub>Weather changes: here, snow on the meadow</sub> | <img src="docs/media/scenes/warp.webp" alt="A winged horse in a star corridor bursting out beside the Moon" width="420" /><br/><sub>The star corridor opening onto the Moon</sub> |
| <img src="docs/media/scenes/earth.webp" alt="Earth seen from orbit with swirling clouds" width="420" /><br/><sub>Earth from orbit</sub> | <img src="docs/media/scenes/saturn.webp" alt="Saturn and its rings against the Milky Way" width="420" /><br/><sub>Saturn's rings</sub> |

- **Rooted in India.** Flame-red gulmohar trees, clay diyas that light up along the path at dusk and go out in the rain, rangoli at the thresholds, marigold torans on the gateways, patang kites on dry days, peacocks that fan their trains when you come close, a chai stall, a mela, and the first rain of the monsoon. The demo's people, animals and memory places have Indian names, home on the globe is the centre of India, a Himalayan valley waits to the north, and the Moon has the Chandrayaan landing sites. The occasion can be Diwali, Holi, Eid, Christmas, Navratri, Onam, Pongal, Baisakhi, Raksha Bandhan or Gurpurab as well as a birthday or anniversary. All of it can be changed. Two things are not Indian yet: the default music is a CC0 lo-fi track (bring your own raga or bansuri piece in the Personalize screen), and the default characters wear modern clothes rather than traditional dress, because no suitably licensed rigged outfits were available.
- **An endless landscape** streamed around you as you go: forests, meadows, lakes and rivers, and a high Himalayan-style valley with a village. Weather changes from sun to showers, storms, mist and snow, and a real star catalogue fills the night sky.
- **Two people and a cat.** You play as the explorer, with a cat who follows, plays and finds things. After the last memory the companion joins you: hold hands, hug, high-five, dance, or switch and play as them (Q).
- **Animals** that live their own lives: 15 kinds of deer with fawns, foxes, rabbits, monkeys, big cats, ducks, birds, insects, frogs and fish.
- **Horses and flight.** Seven horse breeds you can ride at walk, trot, canter and gallop. Three winged horses that take off, dash, stoop, land and do aerobatics. A golden dragon you can call down and ride.
- **Space.** The star-born Pegasus carries you past the sky to the Moon (with its real landing sites), the planets and Saturn's rings, and brings you home again.
- **Nine memory places, two hidden finds and a closing scene** that hold the personal part: words, places, dates and photos.
- **A journal, a photo mode, a world map with marks** and fast travel.

## Play it

You need [Node.js](https://nodejs.org/) 20.19+ or 22.12+ and Git.

```bash
git clone https://github.com/xIBBAx/somewhere-for-you.git
cd somewhere-for-you
npm ci
npm run dev
```

Open the address it prints (http://localhost:5173), read the letter and press **Chalo, enter the world**.

To make a copy you can host or send (a folder of static files in `dist/`):

```bash
npm run build
npm run preview   # check the built copy at http://localhost:4173
```

The people you give it to only need a desktop browser. They don't need Node.js or anything else installed. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for putting `dist/` online.

## Make it for someone

<p align="center"><img src="docs/images/personalize.jpg" alt="The Personalize screen with a live letter preview" width="760" /></p>

**Without code:** open the game and choose **Explore → Personalize this world** (or visit `/?personalize`). Set the names, write the letter and the memory texts, add photos, choose the characters, the creature names, the music and the date the sky celebrates. Then press **Save and restart the world**. Everything stays in that browser: nothing is uploaded. **Export** saves the whole world as one `.zip` that you can import on another computer.

**With code:** copy `customize/gift.example.json` to `customize/gift.json`, put your files in `customize/media/` and run `npm run build`. Your `gift.json` and media are ignored by Git, so they can't be committed by accident.

What you can change: names, the relationship and occasion, the letter, the title card, nine memory places (title, words, place, date, up to six photos each), two hidden finds, the closing card, both characters (built-in looks or your own rigged `.glb`), what they say, the animals' names, the café sign, the valley's name, music, an accent colour, home on the globe, and optional live weather.

**Photos are never turned into 3D models.** A photo appears as a photo; a 3D character must be a rigged model you provide ([docs/CHARACTER_ASSETS.md](docs/CHARACTER_ASSETS.md)).

Full guide: [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md). What is stored where: [PRIVACY.md](PRIVACY.md).

## Controls

Press **/** in the game for the full list. The essentials:

| On foot | | Riding and flying | |
|---|---|---|---|
| W A S D / arrows | walk or swim | E | get on or off a horse or Pegasus |
| Shift | run | W S · A D | speed · steer |
| Space | jump | Space (on a Pegasus) | take off, climb |
| E | interact, look closer | C | descend |
| Mouse drag · wheel | look · zoom | Shift | dash; hold for the dragon's rush |
| Tab | camera distance | R | land into a gallop |
| C | call the cat | Y · U · I | whistle for your Pegasus · call your horse · call the star-born Pegasus |
| P | photo mode | 1 | call the golden dragon |
| L | journal | M · N · K | world map (in space, the star chart) · travel · go home |
| Q | switch character | 2 | change the weather |
| F2 | hide the extras | F5 | refresh the universe |

With the companion: **H** hold hands, **G** hug, **F** high five, **V** dance, **T** follow or wait.

## Built with

**To play:** a desktop browser with WebGL 2. Nothing to install.

**Runtime** (shipped in the game): [three.js](https://threejs.org/) (WebGL rendering), [React](https://react.dev/) with [React Three Fiber](https://r3f.docs.pmnd.rs/) and [drei](https://github.com/pmndrs/drei), [postprocessing](https://github.com/pmndrs/postprocessing) with [N8AO](https://github.com/N8python/n8ao) (bloom, ambient occlusion, colour grading), [zustand](https://zustand.docs.pmnd.rs/) (state), [Howler.js](https://howlerjs.com/) (music) and [Lucide](https://lucide.dev/) (icons). Terrain, far terrain, the horizon and map tiles are generated in Web Workers.

**Development:** TypeScript, [Vite](https://vite.dev/), [Vitest](https://vitest.dev/) (about 1,200 unit tests), [Playwright](https://playwright.dev/) (browser tests) and ESLint.

**Asset authoring** (optional, only to rebuild models): [Blender](https://www.blender.org/) with [MPFB](https://static.makehumancommunity.org/mpfb.html) for the characters, Python scripts for the horses, deer, terrain textures and sky data, and [glTF Transform](https://gltf-transform.dev/). See [asset-pipeline/](asset-pipeline/).

All models are glTF binary (`.glb`). There is no backend, no account, no analytics and no tracking.

## Browser support

| | Status |
|---|---|
| Chromium (desktop) | **Tested**: Chromium on Linux under WSLg on Windows, with an NVIDIA GTX 1660 Ti through D3D12 |
| Chrome / Edge (desktop) | Same engine as the tested build; not separately tested for this release |
| Firefox (desktop) | Not tested for this release |
| Safari (macOS) | Not tested for this release |
| Phones and tablets | **Not supported** (no touch controls) |

It is a demanding 3D scene: a dedicated graphics card is recommended. Measured on the production build with a GTX 1660 Ti, Chromium under WSLg and auto quality, standing at home: about 32 fps at 1280×800 and about 27 fps at 1920×1080. If it runs slowly, choose **Balanced** or **Light** in the HUD's quality menu. A computer without a working graphics card falls back to software rendering, which is very slow; the game tells you when that happens. More in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#performance-and-troubleshooting).

## Project status

It isn't perfect and it isn't finished. Here is where it honestly stands.

| | |
|---|---|
| **Working, played and tested** | Walking, running and jumping · horses · the three winged horses and the dragon · the home region, the wider world and the mountain valley · weather, day and night · the journey to the Moon, the planets and back · the companion and shared moments · photo mode, journal, world map and fast travel · the Personalize screen, including photos, export, import and deleting everything |
| **Experimental** | Your own rigged 3D character: the upload check is tested, but playing through the whole game with one has not been · live weather (optional, off by default) |
| **Not tested yet** | Firefox, Safari, and native Windows Chrome or Edge (the same engine as the tested Chromium build) |
| **Known rough edges** | Hand and foot placement on slopes and on saddles can be about 14 cm off · frame rate is demanding on mid-range graphics cards · water contact and animal behaviour have automated tests but deserve more real play · memory use over very long sessions has not been measured |
| **Next** | Traditional clothing and a soundtrack rooted in Indian classical music, both of which need properly licensed assets · better foot placement · a lighter first load |

See the [open issues](https://github.com/xIBBAx/somewhere-for-you/issues). Contributions from developers, designers, 3D artists and animators are welcome, and so is simply cloning it and making it your own.

## Documentation

| | |
|---|---|
| [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | every personal setting, in the browser or in `gift.json` |
| [docs/CHARACTER_ASSETS.md](docs/CHARACTER_ASSETS.md) | the character rig, importing your own model, rebuilding the built-in ones |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the code is organised and how the systems fit together |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | local setup, scripts, tests, debugging, performance and troubleshooting |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | hosting your built copy, with the recommended security headers |
| [PRIVACY.md](PRIVACY.md) · [SECURITY.md](SECURITY.md) | what stays on your device · reporting a vulnerability |
| [ASSET_LICENSES.md](ASSET_LICENSES.md) | where every model, texture, font and track comes from |

## Contributing

Bug reports, fixes and new ideas are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## How this was made

**Somewhere, For You was created by Ibrahim Sultan.** I came up with the idea and built it over many long iterations, directing, playing, testing and revising every part of it, using LLMs, coding agents, agent skills, plugins, MCP servers, browser automation and Blender tooling.

The models and agents involved include OpenAI Codex, Anthropic's Claude Sonnet and Claude Opus (Claude Opus 5.5 handled much of the later refinement and integration), Google's Gemini through Antigravity, GLM and DeepSeek. They wrote a great deal of the code. The decisions, the taste and the testing were mine, and the tests in this repository are the evidence that it works, not the tools that wrote it.

## License

The code and the project's own models, textures and artwork are released under the [MIT License](LICENSE). Some bundled third-party assets have their own licences (most are CC0 or public domain; the planet textures are CC BY 4.0 and the star catalogue is CC BY-SA 4.0). They are listed with their required credits in [ASSET_LICENSES.md](ASSET_LICENSES.md).

---

<sub>Somewhere, For You was created by <a href="https://github.com/xIBBAx">Ibrahim Sultan</a>.</sub>

# Changelog

<p align="center"><img src="docs/media/scenes/lantern.webp" alt="Sky lanterns rising from a dark meadow at night" width="560" /></p>

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] — first public release

### The world
- Indian traditions by default: gulmohar trees, diyas, rangoli, marigold
  torans, patang kites, peacocks, a chai stall and a mela; Indian names for
  the demo's people, animals and memory places; festivals as occasions.
- An endless, streamed landscape of forests, meadows, lakes and rivers, a
  mountain valley with a village, changing weather and a day–night cycle
  with a real star catalogue.
- The explorer, a companion and a cat; shared moments (hold hands, hug, high
  five, dance, follow) and switching between the two people.
- Wildlife: 15 kinds of deer with young, foxes, rabbits, monkeys, big cats,
  ducks, birds, insects, frogs and fish.
- Seven horse breeds to ride, three winged horses with flight and
  aerobatics, and a golden dragon.
- Space travel to the Moon (with its real landing sites), the planets and
  Saturn's rings.
- Nine memory places, two hidden finds, a closing scene, a journal, a photo
  mode, a world map with marks, and fast travel.

### Making it personal
- A typed gift configuration with complete, fictional defaults.
- The Personalize screen: names, occasion, letter, memories and photos,
  ending, characters (presets or your own rigged `.glb`), what they say,
  animals' and places' names, music, colour, home on the globe, optional live
  weather; export and import as one `.zip`; local-only storage with one-click
  deletion.
- Build-time personalization through `customize/gift.json` and
  `customize/media/`, ignored by Git.

### Safety
- No backend, analytics or tracking. Live weather is off unless turned on.
- Uploaded photos are re-encoded (EXIF and GPS removed); archives and models
  are size-limited and checked before use.
- Debug tools exist only in development builds; the production build works
  under a strict Content Security Policy.

---

<sub>Somewhere, For You was created by <a href="https://github.com/xIBBAx">Ibrahim Sultan</a>.</sub>

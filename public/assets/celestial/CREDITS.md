# The sky beyond the air: sources and licences

The game is not endorsed by NASA, ESA, USGS or any of the sources below.

| File | Source | Licence |
| --- | --- | --- |
| `milkyway_8k.jpg`, `milkyway_4k.jpg` | Deep Star Maps 2020, starless Milky Way background (`milkyway_2020_8k.exr`, `_4k.exr`), celestial coordinates — NASA Scientific Visualization Studio, svs.gsfc.nasa.gov/4851. Tone-mapped to sRGB JPEG. | NASA media, not copyrighted in the US; credit NASA SVS |
| `stars.bin`, `star-names.json` | HYG Database v4.1 (astronexus/HYG-Database), every star to magnitude 7.0 and every catalogued star within 50 pc, packed by `scripts/celestial/build_stars.py`. | CC BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0/). These two derived files are shared under the same licence. |
| `mercury_2k.jpg`, `venus_atmosphere_2k.jpg`, `mars_2k.jpg`, `jupiter_4k.jpg`, `saturn_4k.jpg`, `uranus_2k.jpg`, `neptune_2k.jpg`, `saturn_ring.png` | Solar System Scope textures (solarsystemscope.com/textures), via their Wikimedia Commons copies. Venus downscaled from 4K; Jupiter and Saturn re-encoded. | CC BY 4.0 (creativecommons.org/licenses/by/4.0/) |
| `io_2k.jpg`, `callisto_2k.jpg`, `enceladus_2k.jpg` | USGS Astrogeology Science Center global mosaics (Galileo SSI / Voyager; Cassini ISS for Enceladus). Downscaled to 2048×1024; no-data gaps filled by `scripts/celestial/fill_nodata.py`. | Public domain (USGS product pages) |
| `europa_2k.jpg`, `titan_2k.jpg` | USGS Astrogeology Voyager/Galileo SSI Europa mosaic (500 m) and Cassini ISS Titan mosaic (4 km). Downscaled, gaps filled. | USGS-produced data; the product pages state no use constraint ("please cite authors"). Credited here. |
| `moon_elevation.bin` | LRO LOLA elevation (`ldem_4.tif`, 4 px/degree), CGI Moon Kit — NASA SVS, svs.gsfc.nasa.gov/4720. Packed by `scripts/celestial/build_elevation.py`. | NASA media; credit NASA SVS |
| `mars_elevation.bin` | Mars Global Surveyor MOLA MEGDR topography (`megt90n000cb.img`, 4 px/degree) — NASA PDS Geosciences Node. | NASA mission data |

The Moon's colour map is the intro's LRO map (`../cinematic/earth/moon_2k.jpg`), and
Earth uses the intro's NASA Blue Marble / Black Marble set (see `../cinematic/earth/CREDITS.md`).

Planet positions: JPL "Keplerian Elements for Approximate Positions of the Major
Planets" (E. M. Standish). Body sizes, rotation and orbits: NASA/JPL fact sheets.
Pole directions: IAU WGCCRE.

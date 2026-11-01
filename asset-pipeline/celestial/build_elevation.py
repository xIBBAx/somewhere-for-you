"""Pack real elevation grids for landable worlds into uint16 files.

Moon: LRO LOLA ldem_4.tif (NASA SVS 4720, float km, 1440x720).
Mars: MGS MOLA MEGDR megt90n000cb.img (PDS Geosciences, int16 m big-endian, 1440x720).
Output: little-endian uint16, row 0 = 90° N, column 0 = 180° W (the SVS Moon
kit is already centred on 0°; MOLA starts at 0° E and is rolled by half a
width), value = (metres + 10000) / 0.5.
Usage: python build_elevation.py ldem_4.tif megt90n000cb.img out_dir
"""
import sys
import numpy as np
import tifffile

moon_src, mars_src, out = sys.argv[1:4]
moon = tifffile.imread(moon_src).astype(np.float64) * 1000.0
mars = np.fromfile(mars_src, dtype=">i2").reshape(720, 1440).astype(np.float64)
mars = np.roll(mars, mars.shape[1] // 2, axis=1)
for name, grid in (("moon", moon), ("mars", mars)):
    q = np.clip(np.round((grid + 10000.0) / 0.5), 0, 65535).astype("<u2")
    q.tofile(f"{out}/{name}_elevation.bin")
    print(name, grid.shape, round(grid.min()), round(grid.max()))

"""Pack the HYG v4.1 star catalogue (CC BY-SA 4.0, astronexus/HYG-Database)
into the game's star file.

Kept: every star to visual magnitude 7.0 (the naked-eye sky and a little
more) and every catalogued star within 50 pc, where travelling between stars
visibly shifts them. Per star, little-endian float32: x, y, z (parsecs,
equatorial J2000; stars without a parallax sit on a 100 kpc shell), absolute
magnitude, B-V colour index. The Sun (HYG id 0) is left out.

Usage: python3 build_stars.py hygdata_v41.csv out_dir
"""
import csv, json, math, struct, sys

src, out = sys.argv[1], sys.argv[2]
stars, names = [], []
with open(src, newline="") as f:
    for row in csv.DictReader(f):
        if row["id"] == "0":
            continue
        mag, dist = float(row["mag"]), float(row["dist"])
        if not (mag <= 7.0 or dist <= 50):
            continue
        x, y, z = float(row["x"]), float(row["y"]), float(row["z"])
        absmag = float(row["absmag"])
        if dist >= 99999:
            # no parallax: keep the direction, place it far away, and give it
            # the absolute magnitude that reproduces its apparent one there
            r = math.sqrt(x * x + y * y + z * z) or 1.0
            x, y, z = x / r * 1e5, y / r * 1e5, z / r * 1e5
            absmag = mag - 5 * (math.log10(1e5) - 1)
        ci = float(row["ci"]) if row["ci"] else 0.65
        i = len(stars)
        stars.append((x, y, z, absmag, ci))
        if row["proper"]:
            names.append({"i": i, "name": row["proper"], "spect": row["spect"], "dist": round(dist * 3.26156, 2) if dist < 99999 else None,
                          "con": row["con"], "mag": round(mag, 2)})
with open(f"{out}/stars.bin", "wb") as f:
    for s in stars:
        f.write(struct.pack("<5f", *s))
with open(f"{out}/star-names.json", "w") as f:
    json.dump(names, f, separators=(",", ":"))
print(len(stars), "stars,", len(names), "named")

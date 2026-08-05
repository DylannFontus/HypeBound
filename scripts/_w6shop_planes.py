"""How many resolvable depth planes does the Merch Drops hero actually have?

AAA-BAR section 2 asks for four, and the criticism this pass answers was that
the shop had two: a panel, and an object floating in a near-black field. That is
a claim about *value structure*, so it can be measured rather than argued.

The instrument samples a vertical strip of the hero panel that misses the pack
entirely — the left third, where there is nothing but background — and reports
the mean luminance every few rows. A field with two planes produces one smooth
ramp; a room produces steps, and the steps are the planes.

    python scripts/_w6shop_planes.py before.png after.png
"""

import sys

import numpy as np
from PIL import Image

# A strip of the hero panel that contains no type at all, which is the whole
# discipline here: a grain reading taken across button text once read 18.5% when
# the real figure was 2.36%, and a luminance profile taken across a headline
# reads as a plane boundary that is really a letterform. The pack occupies
# x 723..911 and every string on the panel is either above y 210 or inside
# x 600..1030, so this column is background and nothing else.
HERO = (420, 210, 590, 690)
STRIP = (420, 590)


def profile(path: str) -> None:
    img = np.asarray(Image.open(path).convert("RGB"), dtype=float)
    x0, y0, x1, y1 = HERO
    lum = 0.2126 * img[:, :, 0] + 0.7152 * img[:, :, 1] + 0.0722 * img[:, :, 2]
    del x0, x1
    strip = lum[y0:y1, STRIP[0] : STRIP[1]]
    rows = strip.mean(axis=1)

    # Bucket into 24 bands so the print is readable, then report the biggest
    # step between adjacent bands: a step is an edge, and an edge is a plane
    # boundary.
    width = max(1, len(rows) // 24)
    bands = rows[: width * 24].reshape(24, width).mean(axis=1)
    steps = np.abs(np.diff(bands))
    print(f"\n{path}")
    print("  band luminance:", " ".join(f"{v:5.1f}" for v in bands))
    print(f"  range {bands.min():.1f}-{bands.max():.1f}  spread {bands.max() - bands.min():.1f}")
    print(f"  largest step between adjacent bands: {steps.max():.2f}")
    print(f"  steps over 2.0 (plane boundaries): {(steps > 2.0).sum()}")


for arg in sys.argv[1:]:
    profile(arg)

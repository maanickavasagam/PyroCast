"""Synthetic vegetation / fuel grid.

There is no free global fuel-model raster we can hit per-request, so we generate
a plausible patchy landscape: a few random seed points per vegetation type, each
grown into a patch by a randomized flood-fill. Deterministic for a given seed so
repeated /simulate calls at the same location are stable.
"""

import logging

import numpy as np

logger = logging.getLogger("pyrocast.terrain")

# Vegetation type labels stored in the grid as small ints.
VEG_CHAPARRAL = 0
VEG_FOREST = 1
VEG_GRASSLAND = 2
VEG_URBAN_WATER = 3

VEG_NAMES = {
    VEG_CHAPARRAL: "chaparral",
    VEG_FOREST: "forest",
    VEG_GRASSLAND: "grassland",
    VEG_URBAN_WATER: "urban/water",
}

# Fuel-load multiplier per vegetation type (0 = non-burnable).
FUEL_MULTIPLIER = {
    VEG_CHAPARRAL: 1.4,
    VEG_FOREST: 1.0,
    VEG_GRASSLAND: 0.8,
    VEG_URBAN_WATER: 0.0,
}

# Map a user-supplied fuel_type string to a dominant vegetation label.
FUEL_TYPE_TO_VEG = {
    "chaparral": VEG_CHAPARRAL,
    "brush": VEG_CHAPARRAL,
    "forest": VEG_FOREST,
    "coniferous": VEG_FOREST,
    "grassland": VEG_GRASSLAND,
    "grass": VEG_GRASSLAND,
    "urban": VEG_URBAN_WATER,
    "water": VEG_URBAN_WATER,
}


def generate_vegetation_grid(rows: int, cols: int, seed: int = 42, dominant=None):
    """Return (veg_grid, fuel_grid) as numpy arrays of shape (rows, cols).

    veg_grid holds VEG_* labels; fuel_grid holds the fuel-load multiplier.
    `dominant` (a VEG_* label) biases the landscape toward one fuel type so the
    /simulate `fuel_type` parameter is reflected in the terrain."""
    rng = np.random.default_rng(seed)

    # -1 = unassigned. Grow patches via randomized flood-fill from seed points.
    veg = np.full((rows, cols), -1, dtype=int)

    # Seed counts per type; the dominant type gets extra seeds so it wins area.
    seeds_per_type = {
        VEG_CHAPARRAL: 3,
        VEG_FOREST: 3,
        VEG_GRASSLAND: 3,
        VEG_URBAN_WATER: 2,
    }
    if dominant in seeds_per_type:
        seeds_per_type[dominant] += 4

    # Randomized flood-fill: BFS-ish growth with random frontier ordering.
    for veg_type, n_seeds in seeds_per_type.items():
        for _ in range(n_seeds):
            r0 = int(rng.integers(0, rows))
            c0 = int(rng.integers(0, cols))
            if veg[r0, c0] != -1:
                continue
            # Patch size scaled to grid area; dominant patches are larger.
            base = (rows * cols) // 12
            target = int(base * (2.0 if veg_type == dominant else 1.0) * rng.uniform(0.6, 1.4))
            frontier = [(r0, c0)]
            veg[r0, c0] = veg_type
            grown = 1
            while frontier and grown < target:
                idx = int(rng.integers(0, len(frontier)))
                r, c = frontier.pop(idx)
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols and veg[nr, nc] == -1:
                        if rng.random() < 0.75:  # randomized growth
                            veg[nr, nc] = veg_type
                            frontier.append((nr, nc))
                            grown += 1

    # Fill any unassigned cells with the nearest-ish default (grassland).
    veg[veg == -1] = VEG_GRASSLAND if dominant is None else dominant

    # Build fuel-load grid from the vegetation labels.
    fuel = np.zeros((rows, cols), dtype=float)
    for veg_type, mult in FUEL_MULTIPLIER.items():
        fuel[veg == veg_type] = mult

    logger.info(
        "Vegetation grid %dx%d generated (dominant=%s).",
        rows,
        cols,
        VEG_NAMES.get(dominant, "mixed"),
    )
    return veg, fuel

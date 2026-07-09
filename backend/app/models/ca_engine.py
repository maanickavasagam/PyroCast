"""Cellular-automaton wildfire spread engine.

Grid cell states: 0 = unburned, 1 = burning, 2 = burned.

Each timestep runs a few CA sub-iterations. In every sub-iteration each burning
cell tries to ignite its 8 neighbors with a probability driven by:
  * wind alignment  — dot(wind-travel vector, direction-to-neighbor)
  * slope           — uphill neighbors ignite more readily
  * fuel load       — the neighbor's fuel multiplier (0 = non-burnable)
  * humidity        — dampens every probability

After a cell has spread it becomes `burned`, so the fire advances as a moving
front. Snapshots and cumulative burned-area are captured after each timestep.
"""

import logging
import math

import numpy as np

logger = logging.getLogger("pyrocast.ca")

SQM_PER_ACRE = 4046.86

# 8-neighborhood offsets (drow, dcol) with their unit vectors precomputed.
_NEIGHBORS = []
for _dr in (-1, 0, 1):
    for _dc in (-1, 0, 1):
        if _dr == 0 and _dc == 0:
            continue
        _len = math.hypot(_dr, _dc)
        _NEIGHBORS.append((_dr, _dc, _dr / _len, _dc / _len, _len))

SUBITERS_PER_STEP = 3  # CA passes per reported timestep (lets the front advance)
BASE_IGNITION_P = 0.58


def simulate_spread(
    elevation_grid,
    vegetation_grid,  # kept for signature completeness / future use
    fuel_grid,
    ignition_point,
    wind_speed,
    wind_direction,
    humidity,
    timesteps: int = 4,
    hours_per_step: int = 3,
    cell_size_m: float = 100.0,
    seed: int = 7,
):
    """Run the CA and return snapshots + per-timestep burned area.

    ignition_point is (row, col) into the grids.
    Returns dict:
      snapshots       list[np.ndarray]  grid state after each timestep
      burned_counts   list[int]         cumulative burned+burning cells per step
      burned_acres    list[float]       same, converted to acres
      cell_size_m     float
    """
    rows, cols = fuel_grid.shape
    rng = np.random.default_rng(seed)

    state = np.zeros((rows, cols), dtype=int)
    r0, c0 = ignition_point
    r0 = int(np.clip(r0, 0, rows - 1))
    c0 = int(np.clip(c0, 0, cols - 1))

    # If the ignition cell is non-burnable, nudge to the nearest burnable cell.
    if fuel_grid[r0, c0] <= 0:
        burnable = np.argwhere(fuel_grid > 0)
        if len(burnable):
            d = np.abs(burnable[:, 0] - r0) + np.abs(burnable[:, 1] - c0)
            r0, c0 = burnable[int(np.argmin(d))]
    state[r0, c0] = 1

    # Wind *travel* vector: wind_direction is the direction wind comes FROM, so
    # the fire is pushed toward (wind_direction + 180). Bearing is clockwise
    # from north; grid rows increase northward, cols increase eastward.
    travel_bearing = math.radians((wind_direction + 180.0) % 360.0)
    wind_row = math.cos(travel_bearing)  # north component (+row)
    wind_col = math.sin(travel_bearing)  # east component  (+col)
    wind_norm = min(1.5, wind_speed / 25.0)  # 0..~1.5 influence

    # Humidity dampening: drier air → higher spread. Floor keeps fire alive.
    dryness = max(0.15, 1.0 - (humidity / 100.0) * 0.9)

    snapshots = []
    burned_counts = []
    cell_area_acres = (cell_size_m * cell_size_m) / SQM_PER_ACRE

    for _t in range(timesteps):
        for _sub in range(SUBITERS_PER_STEP):
            burning = np.argwhere(state == 1)
            if burning.size == 0:
                break
            new_ignitions = []
            for br, bc in burning:
                elev_here = elevation_grid[br, bc]
                for dr, dc, ur, uc, dist in _NEIGHBORS:
                    nr, nc = br + dr, bc + dc
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        continue
                    if state[nr, nc] != 0:
                        continue
                    fuel = fuel_grid[nr, nc]
                    if fuel <= 0:
                        continue

                    # Wind alignment in [-1, 1].
                    align = wind_row * ur + wind_col * uc
                    wind_factor = max(0.05, 1.0 + align * wind_norm * 1.4)

                    # Slope: uphill (positive rise) boosts spread.
                    rise = elevation_grid[nr, nc] - elev_here
                    run = dist * cell_size_m
                    slope_factor = 1.0 + np.clip(rise / run, -0.6, 1.2)

                    p = BASE_IGNITION_P * fuel * wind_factor * slope_factor * dryness
                    p = float(np.clip(p, 0.0, 0.98))

                    if rng.random() < p:
                        new_ignitions.append((nr, nc))

            # Advance: current front burns out, newly ignited cells become front.
            state[state == 1] = 2
            for nr, nc in new_ignitions:
                state[nr, nc] = 1

        snapshots.append(state.copy())
        burned = int(np.count_nonzero(state >= 1))  # burning + burned
        burned_counts.append(burned)

    burned_acres = [round(c * cell_area_acres, 2) for c in burned_counts]
    logger.info("CA spread complete: burned_acres=%s", burned_acres)

    return {
        "snapshots": snapshots,
        "burned_counts": burned_counts,
        "burned_acres": burned_acres,
        "cell_size_m": cell_size_m,
    }

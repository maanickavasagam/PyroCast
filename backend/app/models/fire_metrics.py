"""Derived fire-behavior metrics.

Deliberately simple, well-commented approximations — directionally correct, not
research-grade.
"""

import math

CHAIN_M = 20.1168  # 1 chain = 20.1168 metres
M_TO_FT = 3.28084
SQM_PER_ACRE = 4046.86


def calculate_flame_length(fuel_load: float, wind_speed: float, humidity: float) -> float:
    """Byram's flame length: FL = 0.45 * I^0.46  (FL in feet, I in Btu/ft/s).

    We don't have a true fireline intensity, so we APPROXIMATE I from the three
    available drivers:
        I ~= K * fuel_load * wind_factor * dryness
    where K=300 Btu/ft/s is a nominal reference intensity for a moderate fire,
    wind_factor scales with wind speed, and dryness rises as humidity falls.
    This is a rough proxy chosen to yield believable flame lengths (a few feet
    for light fuels, tens of feet for heavy fuel + strong wind + low humidity).
    """
    wind_factor = 1.0 + wind_speed / 20.0          # ~1.6x at 12 mph
    dryness = max(0.2, 1.0 - humidity / 100.0)     # drier -> larger
    fireline_intensity = 300.0 * max(fuel_load, 0.05) * wind_factor * dryness  # Btu/ft/s
    flame_length_ft = 0.45 * (fireline_intensity ** 0.46)
    return round(flame_length_ft, 1)


def calculate_rate_of_spread(burned_cells_per_timestep, cell_size_m: float, hours_per_step: float) -> float:
    """Rate of spread in chains/hour.

    `burned_cells_per_timestep` is the list of CUMULATIVE burned-cell counts per
    timestep. We convert each count to an equivalent circular front radius
    (r = sqrt(area / pi)), take the average radial growth per timestep, and
    express it as chains/hour.
    """
    if not burned_cells_per_timestep:
        return 0.0

    cell_area = cell_size_m * cell_size_m
    radii = [math.sqrt(max(c, 0) * cell_area / math.pi) for c in burned_cells_per_timestep]

    prev = 0.0
    deltas = []
    for r in radii:
        deltas.append(max(0.0, r - prev))
        prev = r
    avg_delta_m = sum(deltas) / len(deltas)          # metres advanced per timestep
    ros_m_per_h = avg_delta_m / max(hours_per_step, 1e-6)
    ros_chains_per_h = ros_m_per_h / CHAIN_M
    return round(ros_chains_per_h, 2)


def calculate_threat_index(wind_speed: float, humidity: float, fuel_load: float) -> dict:
    """Composite 0-100 threat index + label from a simple weighted formula."""
    wind_pts = min(40.0, (wind_speed / 60.0) * 40.0)
    dry_pts = min(35.0, ((100.0 - humidity) / 100.0) * 35.0)
    fuel_pts = min(25.0, (fuel_load / 1.4) * 25.0)
    score = round(wind_pts + dry_pts + fuel_pts, 1)

    if score < 30:
        label = "Low"
    elif score < 55:
        label = "Moderate"
    elif score < 78:
        label = "High"
    else:
        label = "Extreme"
    return {"label": label, "score": score}

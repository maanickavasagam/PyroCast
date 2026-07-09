import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { FuelType, Terrain, Weather, WatchLocation } from '../../types';
import { fetchWeather } from '../../lib/weather';
import { fetchTerrain } from '../../lib/elevation';
import { computeSpread } from '../../lib/spread';
import { useDebounce } from '../../hooks/useDebounce';
import { Brand } from '../ui/Brand';
import { Badge, SimulatedTag } from '../ui/primitives';
import { LeftControls } from './LeftControls';
import { RightStats } from './RightStats';
import { RegionMap } from './RegionMap';
import { TimelineScrubber } from './TimelineScrubber';

interface Props {
  location: WatchLocation;
  onBack: () => void;
}

/** Region View: three-zone layout with two independently collapsible panels. */
export function RegionView({ location, onBack }: Props) {
  // Panel collapse state.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [resizeSignal, setResizeSignal] = useState(0);

  // Scenario controls.
  const [windSpeed, setWindSpeed] = useState(12);
  const [windDirection, setWindDirection] = useState(0);
  const [fuel, setFuel] = useState<FuelType>(location.fuel);

  // Live data.
  const [live, setLive] = useState<Weather | null>(null);
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [loading, setLoading] = useState(true);
  const [weatherSim, setWeatherSim] = useState(false);

  // Timeline scrubber.
  const [step, setStep] = useState(6);

  // Load live weather + terrain when the selected location changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFuel(location.fuel);
    Promise.all([
      fetchWeather(location.lat, location.lon),
      fetchTerrain(location.lat, location.lon),
    ]).then(([w, t]) => {
      if (cancelled) return;
      setLive(w.weather);
      setWeatherSim(w.simulated);
      setWindSpeed(w.weather.windSpeed);
      setWindDirection(w.weather.windDirection);
      setTerrain(t.terrain);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [location.id, location.lat, location.lon, location.fuel]);

  // Debounce the scenario inputs so dragging a slider never blocks on recompute.
  const dWind = useDebounce(windSpeed, 170);
  const dDir = useDebounce(windDirection, 170);
  const dFuel = useDebounce(fuel, 170);

  // Recompute the spread projection only when debounced inputs settle.
  const spread = useMemo(() => {
    if (!live || !terrain) return null;
    return computeSpread({
      lat: location.lat,
      lng: location.lon,
      weather: { ...live, windSpeed: dWind, windDirection: dDir },
      terrain,
      fuel: dFuel,
      region: location.region,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dWind, dDir, dFuel, terrain, live, location.id]);

  const stats = spread ? spread.statsByStep[step === 0 ? 3 : step] ?? null : null;

  // After a panel width transition ends, tell the map to resize.
  const toggleLeft = () => {
    setLeftCollapsed((c) => !c);
    scheduleResize();
  };
  const toggleRight = () => {
    setRightCollapsed((c) => !c);
    scheduleResize();
  };
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>();
  const scheduleResize = () => {
    clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => setResizeSignal((s) => s + 1), 220);
  };

  const resetToObserved = () => {
    if (!live) return;
    setWindSpeed(live.windSpeed);
    setWindDirection(live.windDirection);
    setFuel(location.fuel);
  };

  return (
    <div className="absolute inset-0 flex animate-fade-in">
      {/* LEFT — controls */}
      <LeftControls
        regionName={location.name}
        regionSub={location.region}
        collapsed={leftCollapsed}
        onToggle={toggleLeft}
        windSpeed={windSpeed}
        windDirection={windDirection}
        fuel={fuel}
        onWindSpeed={setWindSpeed}
        onWindDirection={setWindDirection}
        onFuel={setFuel}
        onReset={resetToObserved}
        live={live}
        loading={loading}
        simulated={weatherSim}
      />

      {/* CENTER — map + scrubber */}
      <div className="relative min-w-0 flex-1">
        <RegionMap
          location={location}
          points={spread?.points ?? []}
          step={step}
          windDirection={dDir}
          resizeSignal={resizeSignal}
        />

        {/* Top bar overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 p-4">
          <button
            type="button"
            onClick={onBack}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/5 bg-base-900/85 px-3.5 py-2 text-[12px] font-medium text-slate-300 backdrop-blur-xl transition-colors hover:border-white/15 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            World View
          </button>
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/5 bg-base-900/85 px-3 py-1.5 backdrop-blur-xl">
            <Brand compact />
            {location.status === 'active' ? (
              <Badge tone="fire">Active front</Badge>
            ) : (
              <Badge tone="amber">High-risk</Badge>
            )}
            {weatherSim && <SimulatedTag />}
          </div>
        </div>

        <TimelineScrubber step={step} onChange={setStep} />
      </div>

      {/* RIGHT — stats */}
      <RightStats
        collapsed={rightCollapsed}
        onToggle={toggleRight}
        stats={stats}
        step={step}
        loading={loading}
      />
    </div>
  );
}

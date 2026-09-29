import React, { useState } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Zap, 
  CheckCircle2, 
  Clock, 
  Truck, 
  Wrench, 
  Flame, 
  ListOrdered, 
  ChevronDown, 
  ChevronUp,
  Activity,
  Sparkles
} from 'lucide-react';
import { SimulationEvent } from '../services/simulationService';

interface FleetSimulationBarProps {
  isRunning: boolean;
  isPaused: boolean;
  speedMultiplier: number;
  onSetSpeed: (speed: number) => void;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  fleetProgressPercent: number;
  completedTicketsCount: number;
  inProgressTicketsCount: number;
  enRouteTicketsCount: number;
  totalAssignedTickets: number;
  events: SimulationEvent[];
  activeMessage: string | null;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
}

export const FleetSimulationBar: React.FC<FleetSimulationBarProps> = ({
  isRunning,
  isPaused,
  speedMultiplier,
  onSetSpeed,
  onStart,
  onPause,
  onReset,
  fleetProgressPercent,
  completedTicketsCount,
  inProgressTicketsCount,
  enRouteTicketsCount,
  totalAssignedTickets,
  events,
  activeMessage,
  isMinimized = false,
  onToggleMinimize,
}) => {
  const [showEventLog, setShowEventLog] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  // When minimized, render a sleek compact floating/inline HUD
  if (isMinimized) {
    return (
      <div
        id="fleet-simulation-controller-min"
        role="region"
        aria-label="Fleet Route Simulation Mini Bar"
        className="bg-slate-900/95 backdrop-blur-md text-white border-b border-slate-800 px-3 sm:px-4 py-1.5 shadow-md flex items-center justify-between transition-all shrink-0 z-10"
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {!isRunning || isPaused ? (
            <button
              onClick={onStart}
              className="min-h-[34px] px-2.5 sm:px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
              aria-label={isPaused ? 'Resume fleet route simulation' : 'Run 15-vehicle fleet route simulation'}
            >
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>{isPaused ? 'Resume' : 'Simulate'}</span>
            </button>
          ) : (
            <button
              onClick={onPause}
              className="min-h-[34px] px-2.5 sm:px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
              aria-label="Pause fleet route simulation"
            >
              <Pause className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Pause</span>
            </button>
          )}

          <div className="flex items-center gap-2 font-mono text-xs text-slate-200 shrink-0">
            <span className="text-emerald-400 font-bold">
              {completedTicketsCount}/{totalAssignedTickets}
            </span>
            <span className="text-blue-400 font-bold">({fleetProgressPercent}%)</span>
          </div>

          {activeMessage && (
            <span className="hidden md:inline text-xs text-slate-300 truncate max-w-sm">
              • {activeMessage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onReset}
            className="min-h-[34px] p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Reset simulation"
            aria-label="Reset simulation to initial fleet positions"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          {onToggleMinimize && (
            <button
              onClick={onToggleMinimize}
              className="min-h-[34px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              title="Expand simulation controls"
              aria-label="Expand full simulation controls"
            >
              <span>Controls</span>
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      id="fleet-simulation-controller"
      role="region"
      aria-label="Fleet Route Simulation Controls"
      className="bg-slate-900 text-white border-b border-slate-800 px-3 sm:px-4 py-2 shadow-lg transition-all shrink-0 z-10"
    >
      {/* Mobile Streamlined Layout (< md) */}
      <div className="md:hidden flex flex-col gap-2">
        {/* Sleek Compact Primary Row */}
        <div className="flex items-center justify-between gap-2">
          {/* Play / Pause / Resume Button */}
          {!isRunning || isPaused ? (
            <button
              id="sim-mobile-start-btn"
              onClick={onStart}
              className="min-h-[40px] px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
              aria-label={isPaused ? 'Resume fleet route simulation' : 'Run 15-vehicle fleet route simulation'}
            >
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>{isPaused ? 'Resume' : 'Simulate'}</span>
            </button>
          ) : (
            <button
              id="sim-mobile-pause-btn"
              onClick={onPause}
              className="min-h-[40px] px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
              aria-label="Pause fleet route simulation"
            >
              <Pause className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Pause</span>
            </button>
          )}

          {/* Center Progress & Status */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 px-1">
            <div className="flex items-center justify-between text-[11px] font-semibold leading-none">
              <span className="text-slate-200 truncate flex items-center gap-1">
                <Activity className={`w-3 h-3 flex-shrink-0 ${isRunning && !isPaused ? 'text-emerald-400 animate-spin' : 'text-slate-400'}`} aria-hidden="true" />
                <span className="truncate">
                  {isRunning ? (isPaused ? 'Paused' : 'Simulating') : 'Simulation Ready'}
                </span>
              </span>
              <span className="font-mono text-emerald-400 font-bold ml-1 shrink-0 text-[10px]">
                {completedTicketsCount}/{totalAssignedTickets} ({fleetProgressPercent}%)
              </span>
            </div>

            <div
              className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden border border-slate-700"
              role="progressbar"
              aria-valuenow={fleetProgressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Fleet route progress: ${fleetProgressPercent}%`}
            >
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-300 rounded-full"
                style={{ width: `${fleetProgressPercent}%` }}
              />
            </div>
          </div>

          {/* Right Controls: Reset & Speed/Log Drawer Toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              id="sim-mobile-reset-btn"
              onClick={onReset}
              className="min-h-[40px] min-w-[40px] p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              aria-label="Reset simulation to initial fleet positions"
              title="Reset simulation"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            <button
              id="sim-mobile-options-toggle"
              onClick={() => setIsMobileExpanded(!isMobileExpanded)}
              className={`min-h-[40px] px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                isMobileExpanded
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              aria-expanded={isMobileExpanded}
              aria-label="Toggle simulation speed and log options"
            >
              <span>{speedMultiplier}x</span>
              {isMobileExpanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>

            {onToggleMinimize && (
              <button
                onClick={onToggleMinimize}
                className="min-h-[40px] min-w-[36px] p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 flex items-center justify-center cursor-pointer transition-colors"
                title="Minimize simulation bar"
                aria-label="Minimize simulation bar"
              >
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile Expanded Drawer: Speed Controls & Event Log Button */}
        {isMobileExpanded && (
          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
            {/* Speed Options */}
            <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
              <span className="text-[10px] text-slate-300 font-mono font-bold px-1.5">Speed:</span>
              {[1, 2, 5, 10].map((s) => (
                <button
                  key={s}
                  onClick={() => onSetSpeed(s)}
                  className={`min-h-[34px] min-w-[34px] px-2 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    speedMultiplier === s
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                  }`}
                  aria-label={`Set speed to ${s}x`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Log Button */}
            <button
              onClick={() => setShowEventLog(!showEventLog)}
              className={`min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                showEventLog
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              aria-expanded={showEventLog}
              aria-label={`View simulation event log, ${events.length} events`}
            >
              <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Log ({events.length})</span>
              {showEventLog ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>

            {/* Active message ticker on mobile */}
            {activeMessage && (
              <div className="w-full text-[11px] text-slate-300 truncate flex items-center gap-1.5 pt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-ping" aria-hidden="true" />
                <span className="truncate">{activeMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Comprehensive Layout (md+) */}
      <div className="hidden md:flex max-w-7xl mx-auto flex-row items-center justify-between gap-3">
        {/* Left: Simulation Primary Controls */}
        <div className="flex items-center gap-2 sm:gap-3 w-full md:w-auto justify-between md:justify-start flex-wrap">
          <div className="flex items-center gap-2">
            {!isRunning || isPaused ? (
              <button
                id="sim-start-play-btn"
                onClick={onStart}
                className="min-h-[44px] px-4 py-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all transform hover:scale-[1.02] cursor-pointer"
                aria-label={isPaused ? 'Resume fleet route simulation' : 'Run 15-vehicle fleet route simulation'}
                title={isPaused ? 'Resume Fleet Simulation' : 'Start Multi-Vehicle Route Simulation'}
              >
                <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>{isPaused ? 'Resume Simulation' : 'Run Fleet Simulation'}</span>
              </button>
            ) : (
              <button
                id="sim-pause-btn"
                onClick={onPause}
                className="min-h-[44px] px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all transform hover:scale-[1.02] cursor-pointer"
                aria-label="Pause fleet route simulation"
                title="Pause Simulation"
              >
                <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>Pause Simulation</span>
              </button>
            )}

            <button
              id="sim-reset-btn"
              onClick={onReset}
              className="min-h-[44px] px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-xl border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
              aria-label="Reset simulation to initial fleet positions"
              title="Reset simulation to initial fleet positions"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>

          {/* Speed Multiplier Pills */}
          <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            <span className="text-[11px] text-slate-300 font-mono font-bold px-2 hidden sm:inline" id="speed-label">Speed:</span>
            {[1, 2, 5, 10].map((s) => (
              <button
                key={s}
                onClick={() => onSetSpeed(s)}
                className={`min-h-[36px] min-w-[36px] sm:min-w-[40px] px-2 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  speedMultiplier === s
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
                }`}
                aria-label={`Set simulation speed to ${s} times real-time`}
                title={`Run at ${s}x real-time speed`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Center: Live Status & Progress Bar */}
        <div className="flex-1 w-full max-w-xl flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-slate-200">
                <Activity className={`w-4 h-4 ${isRunning && !isPaused ? 'text-emerald-400 animate-spin' : 'text-slate-400'}`} aria-hidden="true" />
                <span>
                  {isRunning
                    ? isPaused
                      ? 'Simulation Paused'
                      : 'Simulating Dynamic Routes'
                    : 'Route Simulation Ready'}
                </span>
              </span>

              {isRunning && !isPaused && (
                <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse font-bold">
                  LIVE GPS FEED
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-emerald-400 font-bold">
                {completedTicketsCount} / {totalAssignedTickets} Done
              </span>
              <span className="text-slate-400">•</span>
              <span className="text-blue-400 font-bold">{fleetProgressPercent}%</span>
            </div>
          </div>

          {/* Accessible Progress Bar with Gradient */}
          <div
            className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden relative border border-slate-700"
            role="progressbar"
            aria-valuenow={fleetProgressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Fleet route execution progress: ${fleetProgressPercent} percent completed`}
          >
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-300 rounded-full"
              style={{ width: `${fleetProgressPercent}%` }}
            />
          </div>

          {/* Active Live Event Ticker (screen reader polite announcement) */}
          {activeMessage && (
            <div
              className="text-xs text-slate-200 truncate flex items-center gap-1.5"
              role="status"
              aria-live="polite"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 animate-ping" aria-hidden="true" />
              <span className="truncate">{activeMessage}</span>
            </div>
          )}
        </div>

        {/* Right: Live Fleet Counters & Event Log Drawer Toggle */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <div className="hidden lg:flex items-center gap-2 bg-slate-800/80 px-2.5 py-1.5 rounded-xl border border-slate-700 text-xs">
            <div className="flex items-center gap-1 text-blue-400" title="Technicians actively driving">
              <Truck className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-mono font-bold">{enRouteTicketsCount}</span>
              <span className="text-[10px] text-slate-300">En Route</span>
            </div>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <div className="flex items-center gap-1 text-amber-400" title="Crews on-site performing cleaning services">
              <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-mono font-bold">{inProgressTicketsCount}</span>
              <span className="text-[10px] text-slate-300">On Site</span>
            </div>

            <span className="text-slate-600" aria-hidden="true">|</span>

            <div className="flex items-center gap-1 text-emerald-400" title="Tickets successfully completed">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="font-mono font-bold">{completedTicketsCount}</span>
              <span className="text-[10px] text-slate-300">Done</span>
            </div>
          </div>

          {/* Toggle Live Activity Log Popover */}
          <button
            id="toggle-sim-event-log"
            onClick={() => setShowEventLog(!showEventLog)}
            className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              showEventLog
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
            aria-expanded={showEventLog}
            aria-controls="sim-event-log-drawer"
            aria-label={`Toggle simulation event log, ${events.length} events logged`}
            title="View simulation dispatch history"
          >
            <ListOrdered className="w-4 h-4" aria-hidden="true" />
            <span className="text-xs">Log ({events.length})</span>
            {showEventLog ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
          </button>

          {/* Minimize Simulation Bar to give map maximum screen space */}
          {onToggleMinimize && (
            <button
              onClick={onToggleMinimize}
              className="min-h-[44px] px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              title="Minimize simulation controls to expand territory map"
              aria-label="Minimize simulation controls"
            >
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
              <span className="hidden xl:inline">Minimize</span>
            </button>
          )}
        </div>
      </div>

      {/* Expandable Live Simulation Event Stream */}
      {showEventLog && (
        <div
          id="sim-event-log-drawer"
          className="max-w-7xl mx-auto mt-2 pt-2 border-t border-slate-800 max-h-48 overflow-y-auto space-y-1.5 animate-fadeIn"
          role="log"
          aria-live="polite"
        >
          {events.length === 0 ? (
            <div className="text-center py-3 text-xs text-slate-500">
              No simulation events logged yet. Press <strong>Run Fleet Simulation</strong> to start.
            </div>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between p-1.5 rounded-lg bg-slate-800/60 border border-slate-750 text-xs font-sans hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                  <span className="font-mono text-[10px] text-slate-400">{ev.timestamp}</span>
                  <span
                    className="px-1.5 py-0.2 rounded text-[9px] font-extrabold text-white flex-shrink-0"
                    style={{ backgroundColor: ev.techColor || '#3B82F6' }}
                  >
                    {ev.techVan}
                  </span>
                  <span className="text-slate-200 truncate text-[11px]">{ev.message}</span>
                </div>

                <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 flex-shrink-0">
                  {ev.type.replace('_', ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

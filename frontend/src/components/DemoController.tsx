import React, { useState } from "react";
import type { DemoScenario, VitalsPacket } from "../types";
import { DEMO_SCENARIOS } from "../utils/mockData";
import { PauseIcon, PlayIcon, SlidersIcon, SparklesIcon, XIcon, ZapIcon } from "./Icons";

interface DemoControllerProps {
  isOpen: boolean;
  onClose: () => void;
  onInjectScenario: (scenario: DemoScenario) => void;
  onInjectCustomVitals: (vitals: Omit<VitalsPacket, "patient_id" | "timestamp">) => void;
  isSimulating: boolean;
  onToggleSimulating: () => void;
}

export function DemoController({
  isOpen,
  onClose,
  onInjectScenario,
  onInjectCustomVitals,
  isSimulating,
  onToggleSimulating,
}: DemoControllerProps) {
  const [customHr, setCustomHr] = useState(75);
  const [customSpo2, setCustomSpo2] = useState(98);
  const [customSys, setCustomSys] = useState(120);
  const [customDia, setCustomDia] = useState(78);
  const [showSliders, setShowSliders] = useState(false);

  if (!isOpen) return null;

  const handleApplySliders = () => {
    onInjectCustomVitals({
      heart_rate: customHr,
      spo2: customSpo2,
      systolic_bp: customSys,
      diastolic_bp: customDia,
    });
  };

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-cyan-500/40 bg-gradient-to-b from-slate-900/95 to-slate-950/95 p-4 sm:p-5 shadow-2xl backdrop-blur-xl">
      {/* Background ambient gradient */}
      <div className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-2xl" />

      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40">
            <SparklesIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">Hackathon Presentation Studio</h3>
              <span className="rounded bg-cyan-500/20 px-1.5 py-0.2 text-[9px] font-bold text-cyan-300">
                JUDGE CONTROLS
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Instantly trigger real clinical states and demonstrate reactive risk alerts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto Simulator Toggle */}
          <button
            type="button"
            onClick={onToggleSimulating}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
              isSimulating
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200"
                : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            {isSimulating ? <PauseIcon className="h-3 w-3 text-emerald-400" /> : <PlayIcon className="h-3 w-3 text-slate-400" />}
            <span>{isSimulating ? "Streaming Loop ON" : "Start Auto Loop"}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scenario Cards */}
      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {DEMO_SCENARIOS.map((scen) => {
          const isComp = scen.id === "compound";
          const borderStyle = isComp
            ? "border-purple-500/40 hover:border-purple-400 bg-purple-950/20"
            : scen.severity === "RED"
              ? "border-rose-500/40 hover:border-rose-400 bg-rose-950/20"
              : scen.severity === "YELLOW"
                ? "border-amber-500/40 hover:border-amber-400 bg-amber-950/20"
                : "border-emerald-500/40 hover:border-emerald-400 bg-emerald-950/20";

          const badgeColor = isComp
            ? "bg-purple-500/20 text-purple-300"
            : scen.severity === "RED"
              ? "bg-rose-500/20 text-rose-300"
              : scen.severity === "YELLOW"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-emerald-500/20 text-emerald-300";

          return (
            <button
              key={scen.id}
              type="button"
              onClick={() => onInjectScenario(scen)}
              className={`group flex flex-col justify-between rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${borderStyle}`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badgeColor}`}>
                    {isComp ? "COMPOUND" : scen.severity}
                  </span>
                  {isComp && <ZapIcon className="h-3.5 w-3.5 text-purple-400" />}
                </div>

                <div className="mt-2 text-xs font-bold text-white group-hover:text-cyan-300">
                  {scen.title}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400 leading-tight">
                  {scen.subtitle}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-2 text-[10px] font-mono text-slate-300">
                <span>HR: {scen.vitals.heart_rate}</span>
                <span>SpO2: {scen.vitals.spo2}%</span>
                <span>BP: {scen.vitals.systolic_bp}/{scen.vitals.diastolic_bp}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Fine-Tuning Slider Expander */}
      <div className="mt-3.5 border-t border-slate-800/70 pt-2.5">
        <button
          type="button"
          onClick={() => setShowSliders(!showSliders)}
          className="flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300"
        >
          <SlidersIcon className="h-3.5 w-3.5" />
          <span>{showSliders ? "Hide Manual Sliders" : "Custom Sliders (Fine-Tune Vitals Packet)"}</span>
        </button>

        {showSliders && (
          <div className="mt-3 grid gap-4 rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 sm:grid-cols-4">
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span>Heart Rate</span>
                <span className="font-mono text-cyan-300 font-bold">{customHr} bpm</span>
              </div>
              <input
                type="range"
                min="40"
                max="160"
                value={customHr}
                onChange={(e) => setCustomHr(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span>SpO2 Oxygen</span>
                <span className="font-mono text-cyan-300 font-bold">{customSpo2}%</span>
              </div>
              <input
                type="range"
                min="80"
                max="100"
                value={customSpo2}
                onChange={(e) => setCustomSpo2(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span>Systolic BP</span>
                <span className="font-mono text-cyan-300 font-bold">{customSys} mmHg</span>
              </div>
              <input
                type="range"
                min="70"
                max="200"
                value={customSys}
                onChange={(e) => setCustomSys(Number(e.target.value))}
                className="mt-2 w-full accent-cyan-400"
              />
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300">
                  <span>Diastolic BP</span>
                  <span className="font-mono text-cyan-300 font-bold">{customDia} mmHg</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="120"
                  value={customDia}
                  onChange={(e) => setCustomDia(Number(e.target.value))}
                  className="mt-2 w-full accent-cyan-400"
                />
              </div>

              <button
                type="button"
                onClick={handleApplySliders}
                className="mt-2 w-full rounded-lg border border-cyan-500/40 bg-cyan-500/20 py-1 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30"
              >
                Inject Packet
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

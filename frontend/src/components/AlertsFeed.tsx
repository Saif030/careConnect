import React, { useState, useMemo, useEffect, useRef } from "react";
import type { Alert, AlertSeverity } from "../types";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Check,
  Zap,
  Pill,
  Send,
  Search,
  ChevronDown,
  ChevronUp,
  Clock,
  UserCheck,
  Stethoscope,
  Activity,
  HeartPulse,
  Info,
  RotateCcw,
} from "lucide-react";

interface AlertsFeedProps {
  alerts: Alert[];
  onAcknowledgeAlert?: (eventId: string) => void;
  onAlertFeedback?: (eventId: string, feedback: "false_alarm" | "real_problem") => void;
  onEscalateAlert?: (alert: Alert) => void;
  onResolveAlert?: (
    eventId: string,
    resolution: { action: string; note: string; clinician: string }
  ) => void;
}

const RESOLUTION_OUTCOMES = [
  "Medication Held / Adjusted",
  "Vitals Stabilized",
  "Oxygen Titrated",
  "Physician Consulted",
  "Protocol Completed",
  "False Alarm / Sensor Artifact",
];

export function AlertsFeed({
  alerts,
  onAcknowledgeAlert,
  onAlertFeedback,
  onEscalateAlert,
  onResolveAlert,
}: AlertsFeedProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"ACTIVE" | "RESOLVED" | "ALL">("ACTIVE");
  const [selectedPriority, setSelectedPriority] = useState<"ALL" | "P1" | "P2" | "P3">("ALL");
  const [selectedCategory, setSelectedCategory] = useState<
    "ALL" | "VITALS" | "COMPOUND" | "DDI" | "CONTRAINDICATION"
  >("ALL");

  // State to pause queue updates manually or automatically when resolving
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  // State for interactive checklist steps
  const [completedSteps, setCompletedSteps] = useState<Record<string, Record<number, boolean>>>({});
  // Expanded diagnostic rationale sections
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  // Resolution form open states
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionAction, setResolutionAction] = useState(RESOLUTION_OUTCOMES[0]);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionClinician, setResolutionClinician] = useState("Dr. Vance, MD");

  // Snapshot ref to freeze alerts during resolution or manual pause
  const frozenAlertsRef = useRef<Alert[] | null>(null);
  const isHeld = isQueuePaused || resolvingId !== null;

  useEffect(() => {
    if (!isHeld) {
      frozenAlertsRef.current = null;
    } else if (frozenAlertsRef.current === null) {
      frozenAlertsRef.current = alerts;
    }
  }, [isHeld, alerts]);

  // displayAlerts uses frozen list when held, keeping resolution updates live
  const displayAlerts = useMemo(() => {
    if (!isHeld || !frozenAlertsRef.current) return alerts;
    return frozenAlertsRef.current.map((frozen) => {
      const live = alerts.find((a) => a.event_id === frozen.event_id);
      return live ? { ...frozen, ...live } : frozen;
    });
  }, [isHeld, alerts]);

  // Helper to determine triage level if not present
  const getTriageLevel = (alert: Alert): "P1" | "P2" | "P3" | "P4" => {
    if (alert.triage_level) return alert.triage_level;
    if (alert.severity === "RED") return "P1";
    if (alert.severity === "YELLOW") return "P2";
    return "P4";
  };

  // Helper to determine triage category
  const getTriageCategory = (
    alert: Alert
  ): "VITALS" | "COMPOUND" | "DDI" | "CONTRAINDICATION" | "ANOMALY" => {
    if (alert.triage_category) return alert.triage_category;
    if (alert.type === "COMPOUND") return "COMPOUND";
    if (alert.interaction) return "DDI";
    return "VITALS";
  };

  // Compute stats
  const stats = useMemo(() => {
    const total = displayAlerts.length;
    const active = displayAlerts.filter((a) => !a.resolved).length;
    const resolved = displayAlerts.filter((a) => a.resolved).length;
    const p1 = displayAlerts.filter((a) => !a.resolved && getTriageLevel(a) === "P1").length;
    const p2 = displayAlerts.filter((a) => !a.resolved && getTriageLevel(a) === "P2").length;
    const p3 = displayAlerts.filter((a) => !a.resolved && getTriageLevel(a) === "P3").length;
    return { total, active, resolved, p1, p2, p3 };
  }, [displayAlerts]);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    return displayAlerts.filter((alert) => {
      // Tab filter
      if (activeTab === "ACTIVE" && alert.resolved) return false;
      if (activeTab === "RESOLVED" && !alert.resolved) return false;

      // Priority filter
      const level = getTriageLevel(alert);
      if (selectedPriority !== "ALL" && level !== selectedPriority) return false;

      // Category filter
      const cat = getTriageCategory(alert);
      if (selectedCategory !== "ALL" && cat !== selectedCategory) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesMessage = alert.message.toLowerCase().includes(query);
        const matchesPatient = alert.patient_id.toLowerCase().includes(query);
        const matchesSignals = alert.contributing_signals?.some((s) =>
          s.toLowerCase().includes(query)
        );
        const matchesDrugs = alert.interaction?.drugs?.some((d) => d.toLowerCase().includes(query));
        return matchesMessage || matchesPatient || matchesSignals || matchesDrugs;
      }

      return true;
    });
  }, [displayAlerts, activeTab, selectedPriority, selectedCategory, searchQuery]);

  const toggleStep = (eventId: string, idx: number) => {
    setCompletedSteps((prev) => ({
      ...prev,
      [eventId]: {
        ...(prev[eventId] || {}),
        [idx]: !prev[eventId]?.[idx],
      },
    }));
  };

  const toggleDetails = (eventId: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  };

  const handleOpenResolve = (alert: Alert) => {
    setResolvingId(alert.event_id);
    setResolutionAction(RESOLUTION_OUTCOMES[0]);
    setResolutionNote("");
  };

  const handleConfirmResolve = (eventId: string) => {
    onResolveAlert?.(eventId, {
      action: resolutionAction,
      note: resolutionNote,
      clinician: resolutionClinician,
    });
    setResolvingId(null);
  };

  const formatTime = (iso: string) => {
    try {
      const date = new Date(iso);
      return date.toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 sm:p-6 backdrop-blur-xl shadow-xl">
      {/* Minimalist Header */}
      <div className="flex flex-col gap-4 border-b border-slate-800/80 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <HeartPulse className="h-4 w-4" />
            </div>
            <h2 className="text-base font-semibold text-white tracking-tight">
              Clinical Triage & Alert Center
            </h2>
            <button
              type="button"
              onClick={() => setIsQueuePaused(!isQueuePaused)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono transition-colors ${
                isHeld
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
              title={
                resolvingId !== null
                  ? "Queue held in place while resolving alert"
                  : isQueuePaused
                  ? "Click to resume live incoming queue"
                  : "Click to pause incoming queue stream"
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isHeld ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
                }`}
              />
              <span>
                {resolvingId !== null
                  ? "Queue Held (Resolving)"
                  : isQueuePaused
                  ? "Queue Paused"
                  : "Live Telemetry"}
              </span>
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Real-time physiologic deviation, multi-factor fusion risk, and clinical resolution audit.
          </p>
        </div>

        {/* Quick Triage Counters Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("ACTIVE");
              setSelectedPriority("P1");
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
              selectedPriority === "P1" && activeTab === "ACTIVE"
                ? "border-rose-500/60 bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30"
                : "border-slate-800 bg-slate-900/80 text-rose-400/90 hover:border-slate-700"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
            <span>P1 Critical</span>
            <span className="rounded bg-rose-500/20 px-1 text-[10px] text-rose-300">
              {stats.p1}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("ACTIVE");
              setSelectedPriority("P2");
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
              selectedPriority === "P2" && activeTab === "ACTIVE"
                ? "border-amber-500/60 bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                : "border-slate-800 bg-slate-900/80 text-amber-400/90 hover:border-slate-700"
            }`}
          >
            <span>P2 Emergent</span>
            <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">
              {stats.p2}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("ACTIVE");
              setSelectedPriority("P3");
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
              selectedPriority === "P3" && activeTab === "ACTIVE"
                ? "border-cyan-500/60 bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/30"
                : "border-slate-800 bg-slate-900/80 text-cyan-400/90 hover:border-slate-700"
            }`}
          >
            <span>P3 Urgent</span>
            <span className="rounded bg-cyan-500/20 px-1 text-[10px] text-cyan-300">
              {stats.p3}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("RESOLVED");
              setSelectedPriority("ALL");
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
              activeTab === "RESOLVED"
                ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                : "border-slate-800 bg-slate-900/80 text-emerald-400/90 hover:border-slate-700"
            }`}
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span>Resolved</span>
            <span className="rounded bg-emerald-500/20 px-1 text-[10px] text-emerald-300">
              {stats.resolved}
            </span>
          </button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Active vs Resolved vs All Segment */}
        <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900/80 p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setActiveTab("ACTIVE");
              setSelectedPriority("ALL");
            }}
            className={`rounded-lg px-3 py-1 transition-colors ${
              activeTab === "ACTIVE"
                ? "bg-slate-800 text-white font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Active Queue ({stats.active})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("RESOLVED")}
            className={`rounded-lg px-3 py-1 transition-colors ${
              activeTab === "RESOLVED"
                ? "bg-slate-800 text-emerald-300 font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Resolved ({stats.resolved})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className={`rounded-lg px-3 py-1 transition-colors ${
              activeTab === "ALL"
                ? "bg-slate-800 text-white font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All History ({stats.total})
          </button>
        </div>

        {/* Category Pills & Search */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Category Dropdown/Pills */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs">
            {(
              [
                ["ALL", "All Types"],
                ["VITALS", "Vitals Crisis"],
                ["COMPOUND", "Compound Fusion"],
                ["CONTRAINDICATION", "Contraindications"],
                ["DDI", "Drug Interactions"],
              ] as const
            ).map(([cat, label]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  selectedCategory === cat
                    ? "border border-cyan-500/40 bg-cyan-500/15 text-cyan-300 font-semibold"
                    : "border border-slate-800/80 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[160px] sm:w-48">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter alerts..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/90 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 font-sans"
            />
          </div>
        </div>
      </div>

      {/* Alerts Feed List */}
      <div className="mt-4 space-y-3">
        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800/80 py-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400/80" />
            <h4 className="mt-2 text-sm font-semibold text-slate-300">
              No Alerts Matching Current Filter
            </h4>
            <p className="mt-0.5 text-xs text-slate-500">
              All monitored physiological and pharmacology parameters are within accepted boundaries.
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const level = getTriageLevel(alert);
            const category = getTriageCategory(alert);
            const isResolved = Boolean(alert.resolved);
            const isExpanded = Boolean(expandedDetails[alert.event_id]);
            const isResolving = resolvingId === alert.event_id;

            // Priority left border & subtle accent styling
            const borderAccent = isResolved
              ? "border-l-4 border-l-emerald-500/70 border-slate-800/70 bg-slate-900/40 opacity-90"
              : level === "P1"
              ? "border-l-4 border-l-rose-500 border-slate-800/90 bg-gradient-to-r from-rose-950/20 via-slate-900/80 to-slate-900/60"
              : level === "P2"
              ? "border-l-4 border-l-amber-500 border-slate-800/90 bg-gradient-to-r from-amber-950/15 via-slate-900/80 to-slate-900/60"
              : level === "P3"
              ? "border-l-4 border-l-cyan-500/60 border-slate-800/80 bg-slate-900/50"
              : "border-l-4 border-l-slate-600/60 border-slate-800/80 bg-slate-900/40";

            return (
              <div
                key={alert.event_id}
                className={`relative overflow-hidden rounded-xl border transition-all duration-150 ${borderAccent} p-4 sm:p-4.5`}
              >
                {/* Meta Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Triage Priority Pill */}
                    {isResolved ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300 uppercase tracking-wide">
                        <Check className="h-3 w-3" />
                        Resolved
                      </span>
                    ) : level === "P1" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-extrabold text-rose-300 uppercase tracking-wide">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                        P1 Resuscitation
                      </span>
                    ) : level === "P2" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300 uppercase tracking-wide">
                        P2 Emergent
                      </span>
                    ) : level === "P3" ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300 uppercase tracking-wide">
                        P3 Urgent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 border border-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
                        P4 Monitored
                      </span>
                    )}

                    {/* Category Pill */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border uppercase tracking-wider ${
                        category === "COMPOUND"
                          ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                          : category === "CONTRAINDICATION"
                          ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                          : category === "DDI"
                          ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                          : "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                      }`}
                    >
                      {category === "COMPOUND" ? (
                        <Zap className="h-2.5 w-2.5" />
                      ) : category === "DDI" ? (
                        <Pill className="h-2.5 w-2.5" />
                      ) : (
                        <Activity className="h-2.5 w-2.5" />
                      )}
                      {category}
                    </span>

                    {/* Patient room */}
                    <span className="rounded bg-slate-800/80 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                      {alert.patient_id}
                    </span>

                    {/* Timestamp */}
                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-500" />
                      {formatTime(alert.timestamp)}
                    </span>
                  </div>

                  {/* Right Status Indicator */}
                  <div className="flex items-center gap-2">
                    {alert.acknowledged && !isResolved && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-cyan-400/90 font-medium bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                        <Check className="h-3 w-3" />
                        Acknowledged
                      </span>
                    )}
                    {isResolved && alert.resolved_at && (
                      <span className="text-[10px] text-emerald-400/80 font-mono">
                        Resolved {formatTime(alert.resolved_at)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Main Clinical Deviation Title */}
                <h3 className="mt-2 text-sm font-semibold text-white tracking-tight leading-snug">
                  {alert.message}
                </h3>

                {/* Telemetry / Trigger Signals Strip */}
                {alert.contributing_signals && alert.contributing_signals.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400">
                      Telemetry Signals:
                    </span>
                    {alert.contributing_signals.map((sig) => (
                      <span
                        key={sig}
                        className="rounded bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 text-[10px] font-mono text-cyan-300 font-medium"
                      >
                        {sig.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                )}

                {/* Minimalist Compound / Interaction Pill Box */}
                {alert.interaction && (
                  <div className="mt-2.5 rounded-lg border border-purple-500/30 bg-purple-950/25 p-2.5 text-xs text-purple-200">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 font-bold text-purple-300 text-[11px] uppercase tracking-wide">
                        <Pill className="h-3 w-3 text-purple-400" />
                        Agents:
                      </span>
                      {alert.interaction.drugs?.map((drug) => (
                        <span
                          key={drug}
                          className="rounded bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.2 text-[10px] font-mono text-purple-200"
                        >
                          {drug}
                        </span>
                      ))}
                    </div>
                    {alert.interaction.mechanism && (
                      <p className="mt-1 text-[11px] text-slate-300">
                        <strong className="text-slate-400">Mechanism:</strong>{" "}
                        {alert.interaction.mechanism}
                      </p>
                    )}
                  </div>
                )}

                {/* Resolution Audit Banner (If already resolved) */}
                {isResolved && (
                  <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-xs text-emerald-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Resolution Action: {alert.resolution_action}</span>
                      </div>
                      <span className="text-[10px] text-emerald-400/80 font-mono">
                        By {alert.resolved_by || "Clinician"}
                      </span>
                    </div>
                    {alert.resolution_note && (
                      <p className="mt-1 text-[11px] text-slate-300 italic">
                        "{alert.resolution_note}"
                      </p>
                    )}
                  </div>
                )}

                {/* Caregiver Checklist (Actionable Steps) */}
                {alert.instructions && alert.instructions.length > 0 && !isResolved && (
                  <div className="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/50 p-2.5">
                    <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      <span>Clinical Action Checklist</span>
                      <span className="font-mono text-slate-400">
                        {
                          Object.values(completedSteps[alert.event_id] || {}).filter(Boolean).length
                        }
                        /{alert.instructions.length} Done
                      </span>
                    </div>

                    <div className="mt-1.5 space-y-1">
                      {alert.instructions.map((step, idx) => {
                        const isDone = completedSteps[alert.event_id]?.[idx];
                        return (
                          <div
                            key={step}
                            onClick={() => toggleStep(alert.event_id, idx)}
                            className="flex cursor-pointer items-start gap-2 text-xs text-slate-300 hover:text-white group"
                          >
                            <span
                              className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                                isDone
                                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                                  : "border-slate-700 bg-slate-900 group-hover:border-slate-600"
                              }`}
                            >
                              {isDone && <Check className="h-2.5 w-2.5" />}
                            </span>
                            <span className={isDone ? "line-through text-slate-500" : ""}>
                              {step}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expandable Diagnostic Rationale */}
                {alert.explanation && (
                  <div className="mt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggleDetails(alert.event_id)}
                      className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-cyan-300 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      <span>{isExpanded ? "Hide Diagnostic Rule" : "Diagnostic Evidence & Limits"}</span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-2 text-[11px] animate-in fade-in">
                        {alert.explanation.matched_rule && (
                          <div>
                            <span className="font-bold text-slate-400 uppercase">Rule: </span>
                            <span className="text-slate-300 font-mono">
                              {alert.explanation.matched_rule}
                            </span>
                          </div>
                        )}
                        {alert.explanation.clinical_rationale && (
                          <div>
                            <span className="font-bold text-slate-400 uppercase">Rationale: </span>
                            <span className="text-slate-300">
                              {alert.explanation.clinical_rationale}
                            </span>
                          </div>
                        )}
                        {alert.explanation.recommendation && (
                          <div>
                            <span className="font-bold text-cyan-400 uppercase">Recommendation: </span>
                            <span className="text-cyan-200">
                              {alert.explanation.recommendation}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Inline Resolution Drawer */}
                {isResolving && (
                  <div className="mt-3 rounded-xl border border-emerald-500/40 bg-slate-950 p-3.5 space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          Resolve Triage Event
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setResolvingId(null)}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">
                        Resolution Action
                      </label>
                      <select
                        value={resolutionAction}
                        onChange={(e) => setResolutionAction(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        {RESOLUTION_OUTCOMES.map((out) => (
                          <option key={out} value={out}>
                            {out}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1">
                        Clinical Note & Summary
                      </label>
                      <input
                        type="text"
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        placeholder="e.g. Rate stabilized after 4L O2, physician notified and updated order."
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          value={resolutionClinician}
                          onChange={(e) => setResolutionClinician(e.target.value)}
                          placeholder="Clinician Name / Title"
                          className="w-40 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-300"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConfirmResolve(alert.event_id)}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition-all shadow-md"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Confirm & Archive
                      </button>
                    </div>
                  </div>
                )}

                {/* Minimalist Footer Controls */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 pt-2.5 text-xs">
                  {/* Left Actions: Resolve & Acknowledge & Escalate */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isResolved && !isResolving && (
                      <button
                        type="button"
                        onClick={() => handleOpenResolve(alert)}
                        className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Resolve Alert
                      </button>
                    )}

                    {!alert.acknowledged && !isResolved && (
                      <button
                        type="button"
                        onClick={() => onAcknowledgeAlert?.(alert.event_id)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                      >
                        <Check className="h-3 w-3" />
                        Acknowledge
                      </button>
                    )}

                    {onEscalateAlert && level === "P1" && !isResolved && (
                      <button
                        type="button"
                        onClick={() => onEscalateAlert(alert)}
                        className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors"
                      >
                        <Send className="h-3 w-3" />
                        Escalate
                      </button>
                    )}
                  </div>

                  {/* Right Actions: Feedback Triage Log */}
                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                    <span className="text-slate-500">Triage Validity:</span>
                    <button
                      type="button"
                      onClick={() => onAlertFeedback?.(alert.event_id, "real_problem")}
                      className={`rounded px-2 py-0.5 font-medium transition-colors ${
                        alert.feedback === "real_problem"
                          ? "bg-rose-500/30 text-rose-300 font-bold border border-rose-500/40"
                          : "hover:bg-slate-800 text-slate-300"
                      }`}
                    >
                      Confirmed Incident
                    </button>
                    <span className="text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={() => onAlertFeedback?.(alert.event_id, "false_alarm")}
                      className={`rounded px-2 py-0.5 font-medium transition-colors ${
                        alert.feedback === "false_alarm"
                          ? "bg-amber-500/30 text-amber-300 font-bold border border-amber-500/40"
                          : "hover:bg-slate-800 text-slate-300"
                      }`}
                    >
                      False Alarm
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
export default AlertsFeed;

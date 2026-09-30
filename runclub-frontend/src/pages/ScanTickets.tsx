import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Page, PageHeader } from "../components/layout";
import { PageScene } from "../components/scene3d";
import { PartyPanel, partyFromScan, type ScannedParty } from "../components/partyPanel";
import { QrScanner, insecureContext, scannerSupported } from "../components/qrScanner";
import { Badge, Button, buttonClass, Card, Input, Select } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { eventDate, eventTime, relativeTime } from "../lib/format";
import type { CheckInResult } from "../lib/types";
import { useFetch } from "../lib/useFetch";

type Feedback = { kind: "ok" | "repeat" | "err"; title: string; body?: string };

const FEEDBACK_TINT: Record<Feedback["kind"], string> = {
  ok: "var(--color-paid)",
  repeat: "var(--color-pending)",
  err: "var(--color-failed)",
};

interface AdmittedLogItem {
  id: string;
  name: string;
  eventTitle: string;
  timestamp: Date;
  status: "admitted" | "already";
}

function playScanSound(type: "ok" | "repeat" | "err") {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "ok") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "repeat") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch {
    // Ignore audio restrictions
  }
}

export function ScanTickets() {
  const loadEvents = useCallback(() => api.events(), []);
  const { data: events } = useFetch(loadEvents);

  const [selectedEventId, setSelectedEventId] = useState<string>("ALL");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [party, setParty] = useState<ScannedParty | null>(null);
  const [count, setCount] = useState(0);
  const [admittedLog, setAdmittedLog] = useState<AdmittedLogItem[]>([]);

  const supported = scannerSupported();
  const insecure = insecureContext();

  // Set default event to the soonest upcoming event if available
  useEffect(() => {
    if (events && events.length > 0 && selectedEventId === "ALL") {
      // Pick first published event
      const published = events.filter((e) => e.status === "PUBLISHED");
      if (published.length > 0) {
        setSelectedEventId(published[0].id);
      }
    }
  }, [events, selectedEventId]);

  const activeEvent = useMemo(() => {
    if (!events || selectedEventId === "ALL") return null;
    return events.find((e) => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  const flash = useCallback((f: Feedback) => {
    setFeedback(f);
    playScanSound(f.kind);
    window.setTimeout(() => setFeedback((cur) => (cur === f ? null : cur)), 4000);
  }, []);

  const submit = useCallback(
    async (input: { registration_id?: string; qr_payload?: string }) => {
      setBusy(true);
      try {
        const payload: { registration_id?: string; qr_payload?: string; event_id?: string } = {
          ...input,
        };
        if (selectedEventId && selectedEventId !== "ALL") {
          payload.event_id = selectedEventId;
        }

        const res: CheckInResult = await api.checkIn(payload);

        // Group / multi-person booking: show party panel for 1-tap admit
        const scanned = partyFromScan(res, input.registration_id);
        if (scanned) {
          setParty(scanned);
          setFeedback(null);
          playScanSound("ok");
          return;
        }

        if (res.already_checked_in) {
          flash({
            kind: "repeat",
            title: `${res.name} was already checked in`,
            body: res.attended_at ? `Scanned ${relativeTime(res.attended_at)}.` : "Already admitted.",
          });
          setAdmittedLog((prev) => [
            {
              id: `${Date.now()}-${res.name}`,
              name: res.name,
              eventTitle: res.event_title || activeEvent?.title || "Club Event",
              timestamp: new Date(),
              status: "already",
            },
            ...prev.slice(0, 19),
          ]);
        } else {
          flash({
            kind: "ok",
            title: `✓ ${res.name} checked in!`,
            body: "Attendance recorded. Send them through.",
          });
          setCount((c) => c + 1);
          setAdmittedLog((prev) => [
            {
              id: `${Date.now()}-${res.name}`,
              name: res.name,
              eventTitle: res.event_title || activeEvent?.title || "Club Event",
              timestamp: new Date(),
              status: "admitted",
            },
            ...prev.slice(0, 19),
          ]);
        }
      } catch (err) {
        flash({
          kind: "err",
          title: err instanceof ApiError ? err.message : "Check-in failed",
          body: "Please verify ticket validity or check registration ID.",
        });
      } finally {
        setBusy(false);
      }
    },
    [activeEvent, flash, selectedEventId],
  );

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = manual.trim();
    if (!id) return;
    await submit({ registration_id: id });
    setManual("");
  };

  return (
    <Page>
      <PageScene variant="lattice" opacity={0.25} />
      <PageHeader
        eyebrow="Race Day Operations"
        title="Scan tickets & Attendance"
        description="Scan participant QR codes with your phone or device camera to record attendance and admit runners."
        action={
          activeEvent ? (
            <Link
              to={`/raceday/${activeEvent.id}`}
              className={buttonClass("outline", "md")}
            >
              Open event-day console
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* ── Left Column: Camera Scanner & Party Admit ── */}
        <div className="space-y-6">
          {/* Event Filter Selector */}
          <Card className="p-4 border-gold/25 bg-gold/[0.04]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label htmlFor="event-select" className="text-[12px] font-bold uppercase tracking-wider text-ink-3">
                  Scanning for Event
                </label>
                <div className="mt-1">
                  <Select
                    id="event-select"
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    className="min-w-[260px] font-medium text-ink bg-surface-2"
                  >
                    <option value="ALL">All events (Auto-match from ticket)</option>
                    {(events ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title} ({eventDate(e.date_time)})
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {activeEvent && (
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <Badge color="var(--color-gold)">
                    {count > 0 ? `${count} admitted today` : "Live session"}
                  </Badge>
                  <Link
                    to={`/events/${activeEvent.id}`}
                    className="text-[12px] text-gold underline underline-offset-4 hover:text-gold-2"
                  >
                    Event page →
                  </Link>
                </div>
              )}
            </div>
          </Card>

          {/* Result Feedback Banner */}
          {feedback && (
            <div
              className="rounded-xl border p-4 shadow-lg transition-all"
              style={{
                borderColor: `color-mix(in oklab, ${FEEDBACK_TINT[feedback.kind]} 50%, transparent)`,
                background: `color-mix(in oklab, ${FEEDBACK_TINT[feedback.kind]} 14%, transparent)`,
              }}
              role="status"
            >
              <p
                className="text-[16px] font-bold"
                style={{ color: FEEDBACK_TINT[feedback.kind] }}
              >
                {feedback.title}
              </p>
              {feedback.body && (
                <p className="mt-1 text-[13.5px] text-ink-2">{feedback.body}</p>
              )}
            </div>
          )}

          {/* Group / Party Admit Panel */}
          {party && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold uppercase tracking-wider text-gold">
                  Group Ticket Attendance
                </span>
                <span className="text-[12px] text-ink-3">
                  Tap 'Admit' for each person as they arrive
                </span>
              </div>
              <PartyPanel
                party={party}
                onChange={(members) =>
                  setParty((cur) => (cur ? { ...cur, members } : cur))
                }
                onClose={() => setParty(null)}
                onAdmittedCountChange={(d) => setCount((c) => Math.max(0, c + d))}
              />
            </div>
          )}

          {/* Camera Viewfinder */}
          <Card className="overflow-hidden border-gold/30 bg-surface-1">
            <div className="border-b border-white/8 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[13px] font-semibold text-ink">Camera Viewfinder</span>
              </div>
              {busy && (
                <span className="text-[12px] text-gold font-medium animate-pulse">
                  Verifying ticket...
                </span>
              )}
            </div>

            <div className="p-4">
              {insecure ? (
                <div className="rounded-xl border border-[color:var(--color-pending)]/30 bg-[color:var(--color-pending)]/8 p-4 text-[13.5px] leading-relaxed text-ink-2">
                  <p className="font-semibold text-ink">Camera requires HTTPS</p>
                  <p className="mt-1">
                    Please open this page over https://b2club.in to grant camera access. You can still use the manual registration ID entry below.
                  </p>
                </div>
              ) : supported ? (
                <div className="relative rounded-2xl overflow-hidden bg-black/60 aspect-[4/3] sm:aspect-[16/10] max-h-[460px]">
                  <QrScanner
                    paused={busy || feedback !== null || party !== null}
                    onScan={(text) => void submit({ qr_payload: text })}
                  />
                  {/* Subtle viewfinder guideline overlay */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="size-52 rounded-2xl border-2 border-gold/60 bg-gold/[0.03] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-surface-2 p-5 text-[13.5px] leading-relaxed text-ink-2">
                  No camera detected on this browser. You can enter the registration code manually below.
                </div>
              )}
            </div>
          </Card>

          {/* Manual Registration Entry */}
          <Card className="p-5 border-white/10">
            <h3 className="text-[14px] font-semibold text-ink">Manual Ticket Search / ID</h3>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              If the runner's screen is cracked or camera cannot read the QR, type or paste the registration ID from their ticket.
            </p>
            <form onSubmit={submitManual} className="mt-3 flex gap-2">
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Paste Registration ID (e.g. uuid or ticket ref)"
                className="flex-1"
                disabled={busy}
              />
              <Button type="submit" variant="gold" loading={busy} disabled={!manual.trim()}>
                Admit
              </Button>
            </form>
          </Card>
        </div>

        {/* ── Right Column: Session Attendance & Recent Log ── */}
        <div className="space-y-6">
          {/* Quick Stats Card */}
          <Card className="p-5 border-gold/25">
            <h3 className="text-[14px] font-semibold text-ink">Start Line Summary</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-surface-2/60 p-3.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                  Admitted (Session)
                </span>
                <p className="mt-1 text-[26px] font-bold text-gold">{count}</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-surface-2/60 p-3.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                  Selected Event
                </span>
                <p className="mt-1 truncate text-[14px] font-semibold text-ink">
                  {activeEvent ? activeEvent.title : "All Events"}
                </p>
              </div>
            </div>

            {activeEvent && (
              <div className="mt-4 pt-4 border-t border-white/8 text-[12.5px] space-y-1.5 text-ink-3">
                <p className="flex justify-between">
                  <span>Location:</span>
                  <span className="text-ink font-medium">{activeEvent.location}</span>
                </p>
                <p className="flex justify-between">
                  <span>Date & Time:</span>
                  <span className="text-ink font-medium">
                    {eventDate(activeEvent.date_time)} · {eventTime(activeEvent.date_time)}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span>Capacity:</span>
                  <span className="text-ink font-medium">
                    {activeEvent.capacity ? `${activeEvent.capacity} runners` : "Open"}
                  </span>
                </p>
              </div>
            )}
          </Card>

          {/* Recent Admitted Runners Log */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-ink">Recent Check-ins</h3>
              <Badge>{admittedLog.length}</Badge>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Runners checked in during this session.
            </p>

            {admittedLog.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-white/10 p-6 text-center text-[13px] text-ink-3">
                No runners scanned yet in this session. Present a ticket QR to begin!
              </div>
            ) : (
              <ul className="mt-4 space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {admittedLog.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-white/6 bg-surface-2/40 px-3 py-2 text-[13px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{item.name}</p>
                      <p className="truncate text-[11px] text-ink-3">
                        {item.eventTitle} · {relativeTime(item.timestamp.toISOString())}
                      </p>
                    </div>
                    <Badge
                      color={
                        item.status === "admitted"
                          ? "var(--color-paid)"
                          : "var(--color-pending)"
                      }
                      icon={item.status === "admitted" ? "✓" : "ℹ"}
                    >
                      {item.status === "admitted" ? "Admitted" : "Prior Check-in"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

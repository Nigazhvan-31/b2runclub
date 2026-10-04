import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { cn, countdown, inr } from "../lib/format";
import { useAuth } from "../lib/auth";
import type { ClubEvent } from "../lib/types";
import { EventCoverBackdrop, EventMeta } from "./eventCover";
import { DisciplineIcon } from "./icons";
import { Tilt } from "./tilt";
import { buttonClass, Card, Skeleton } from "./ui";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
      <path
        d={dir === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const arrowClass =
  "grid size-9 place-items-center rounded-full border border-white/15 bg-white/5 text-ink-2 transition-colors " +
  "hover:border-gold/50 hover:bg-gold/15 hover:text-gold active:scale-95 disabled:pointer-events-none disabled:opacity-25";

/** One session, as the spotlight panel. Unchanged from the single-card version. */
function SpotlightCard({ event, label }: { event: ClubEvent; label: string }) {
  const { isAdmin } = useAuth();
  return (
    <Tilt className="h-full">
      {/* card-glow, so the session reads as a distinct object over the hero
          video rather than a translucent panel floating in it. */}
      <Card className="speedlines card-glow group relative h-full overflow-hidden">
        {/* The event's own cover behind the spotlight, so the first thing on the
            page shows the session rather than a gradient. */}
        <EventCoverBackdrop url={event.cover_url} scrim="card" />
        <div
          className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full opacity-[0.15] blur-3xl"
          style={{ background: "var(--color-gold)" }}
          aria-hidden
        />
        <div className="relative flex h-full flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow text-gold">{label}</p>
            <Link
              to={isAdmin ? `/raceday/${event.id}` : `/events/${event.id}`}
              className="relative z-20 block transition-colors group-hover:text-gold"
            >
              <h2 className="display mt-3 text-[clamp(26px,3.6vw,40px)]">{event.title}</h2>
            </Link>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <span className="text-gold" aria-hidden>
                  <DisciplineIcon type={event.type} className="size-4" />
                </span>
                {event.type}
              </span>
            </div>
            <EventMeta event={event} className="mt-2.5" />
          </div>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-4 lg:shrink-0">
            <div>
              <p className="eyebrow whitespace-nowrap">Starts in</p>
              <p className="display tnum mt-1.5 whitespace-nowrap text-[32px] text-gold">
                {countdown(event.date_time) ?? "now"}
              </p>
            </div>
            <div>
              <p className="eyebrow">Entry</p>
              <p className="display mt-1.5 whitespace-nowrap text-[32px]">
                {event.price === 0 ? "Free" : inr(event.price)}
              </p>
            </div>
            {isAdmin ? (
              <Link
                to={`/raceday/${event.id}`}
                className={buttonClass("gold", "md", "mb-1 w-full sm:w-auto relative z-20 cursor-pointer")}
              >
                Manage event
              </Link>
            ) : (
              <Link
                to={`/events/${event.id}`}
                className={buttonClass("gold", "md", "mb-1 w-full sm:w-auto relative z-20 cursor-pointer")}
              >
                Take a spot
              </Link>
            )}
          </div>
        </div>
      </Card>
    </Tilt>
  );
}

/**
 * The "Next up" spotlight, one panel per upcoming session.
 *
 * Horizontal rather than a vertical scroll box: a nested vertical scroller in
 * the middle of a page competes with the page's own scroll, and on a phone it
 * swallows the gesture entirely. Sideways snapping steps through the sessions
 * one at a time without touching the page scroll.
 */
export function UpcomingScroller({
  events,
  loading,
}: {
  events: ClubEvent[];
  loading: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: true });

  // Mouse drag-to-swipe states for laptop / desktop users
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startScrollLeft = useRef(0);
  const hasDragged = useRef(false);
  const dragStartTime = useRef(0);

  /*
   * Which panel is on screen, worked out from the panel centre nearest the
   * scrollport centre. Dividing scrollLeft by a panel width would need the gap
   * and the padding folded in and drifts by a pixel per panel; this needs
   * neither, and it agrees exactly with what `snap-center` does.
   */
  const sync = useCallback(() => {
    const el = trackRef.current;
    const panels = el ? (Array.from(el.children) as HTMLElement[]) : [];
    if (!el || panels.length === 0) return;

    const centre = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;
    panels.forEach((panel, i) => {
      const distance = Math.abs(panel.offsetLeft + panel.offsetWidth / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });

    setActive(best);
    setEdges({
      start: el.scrollLeft <= 5,
      end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 5,
    });
  }, []);

  // Re-measure when the list arrives and whenever the track resizes — a phone
  // turning sideways changes every panel width at once.
  useEffect(() => {
    sync();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sync, events.length]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(sync);
  };

  /** Centres panel `i`, matching the snap position smoothly. */
  const go = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(events.length - 1, i));
    const panels = Array.from(el.children) as HTMLElement[];
    const panel = panels[clamped];
    if (!panel) return;
    el.scrollTo({
      left: panel.offsetLeft + panel.offsetWidth / 2 - el.clientWidth / 2,
      behavior: "smooth",
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only capture primary mouse button on laptop/desktop; mobile touch uses native momentum scrolling
    if (e.pointerType !== "mouse" || e.button !== 0 || !trackRef.current || events.length <= 1) return;

    // Never intercept or start drag on interactive controls (links, buttons, inputs)
    const target = e.target as HTMLElement | null;
    if (target?.closest("a, button, input, textarea, select, [role='button']")) {
      return;
    }

    isDragging.current = true;
    startX.current = e.pageX;
    startScrollLeft.current = trackRef.current.scrollLeft;
    hasDragged.current = false;
    dragStartTime.current = Date.now();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || !trackRef.current || e.pointerType !== "mouse") return;
    const dx = e.pageX - startX.current;
    if (Math.abs(dx) > 6) {
      if (!hasDragged.current) {
        hasDragged.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      trackRef.current.scrollLeft = startScrollLeft.current - dx;
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current || e.pointerType !== "mouse") return;
    isDragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    if (hasDragged.current && trackRef.current) {
      const dx = e.pageX - startX.current;
      const dt = Date.now() - dragStartTime.current;
      const velocity = Math.abs(dx) / (dt || 1);

      if (dx < -40 || (velocity > 0.35 && dx < -15)) {
        go(Math.min(events.length - 1, active + 1));
      } else if (dx > 40 || (velocity > 0.35 && dx > 15)) {
        go(Math.max(0, active - 1));
      } else {
        go(active);
      }
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    // Prevent accidental clicks on child elements ONLY if an actual drag gesture occurred
    if (hasDragged.current) {
      e.preventDefault();
      e.stopPropagation();
      setTimeout(() => {
        hasDragged.current = false;
      }, 50);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (events.length <= 1) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(active - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(active + 1);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-10 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/3" />
      </Card>
    );
  }

  if (events.length === 0) {
    return null;
  }

  const many = events.length >= 2;

  return (
    <div className="relative group/scroller">
      {/* Floating Left chevron button (Laptop & Mobile) */}
      {many && (
        <button
          type="button"
          onClick={() => go(active - 1)}
          disabled={edges.start}
          aria-label="Previous session"
          className={cn(
            "absolute left-1 sm:-left-5 top-1/2 -translate-y-1/2 z-30",
            "flex size-11 sm:size-13 items-center justify-center rounded-full",
            "border border-white/20 bg-stone-950/85 text-white shadow-2xl backdrop-blur-md",
            "transition-all duration-200 hover:scale-110 hover:border-gold hover:bg-gold/25 hover:text-gold active:scale-90",
            "disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-gold",
          )}
        >
          <svg viewBox="0 0 24 24" className="size-5 sm:size-6" fill="none" aria-hidden>
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* Floating Right chevron button (Laptop & Mobile) */}
      {many && (
        <button
          type="button"
          onClick={() => go(active + 1)}
          disabled={edges.end}
          aria-label="Next session"
          className={cn(
            "absolute right-1 sm:-right-5 top-1/2 -translate-y-1/2 z-30",
            "flex size-11 sm:size-13 items-center justify-center rounded-full",
            "border border-white/20 bg-stone-950/85 text-white shadow-2xl backdrop-blur-md",
            "transition-all duration-200 hover:scale-110 hover:border-gold hover:bg-gold/25 hover:text-gold active:scale-90",
            "disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-gold",
          )}
        >
          <svg viewBox="0 0 24 24" className="size-5 sm:size-6" fill="none" aria-hidden>
            <path
              d="m9 6 6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/*
       * The negative margin cancels the padding, so a panel is exactly as wide
       * as the sections above and below it and the card's left edge stays on
       * the page's own gutter. The padding itself is headroom for card-glow's
       * halo.
       *
       * Supports:
       * - Native touch swiping with momentum on mobile phones
       * - Click-and-drag mouse swiping on laptop/desktop
       * - Left/Right keyboard arrow navigation
       * - Trackpad 2-finger horizontal scroll
       */}
      <div
        ref={trackRef}
        onScroll={many ? onScroll : undefined}
        onPointerDown={many ? onPointerDown : undefined}
        onPointerMove={many ? onPointerMove : undefined}
        onPointerUp={many ? onPointerUp : undefined}
        onPointerCancel={many ? onPointerUp : undefined}
        onClickCapture={many ? onClickCapture : undefined}
        onKeyDown={many ? onKeyDown : undefined}
        role="region"
        aria-label="Upcoming sessions"
        aria-live="off"
        tabIndex={many ? 0 : -1}
        className={cn(
          "no-scrollbar -mx-4 flex gap-4 overflow-y-hidden px-4 py-6 relative",
          "rounded-[calc(var(--radius-card)+1rem)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          many
            ? "snap-x snap-mandatory overflow-x-auto overscroll-x-contain cursor-grab active:cursor-grabbing touch-pan-y select-none"
            : "overflow-x-hidden",
        )}
      >
        {events.map((event, i) => (
          <div key={event.id} className="w-full shrink-0 snap-center snap-always">
            <SpotlightCard
              event={event}
              label={
                many
                  ? i === 0
                    ? `Next up · 1 of ${events.length}`
                    : `Upcoming · ${i + 1} of ${events.length}`
                  : "Next up"
              }
            />
          </div>
        ))}
      </div>

      {many && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-3">
            {events.length <= 8 ? (
              <div className="flex items-center gap-2">
                {events.map((event, i) => (
                  <button
                    key={event.id}
                    onClick={() => go(i)}
                    aria-label={`Show ${event.title}`}
                    aria-current={i === active}
                    className={cn(
                      "h-2 rounded-full transition-all duration-300",
                      i === active
                        ? "w-8 bg-gold shadow-[0_0_12px_rgba(233,185,73,0.5)]"
                        : "w-2 bg-white/25 hover:bg-white/50",
                    )}
                  />
                ))}
              </div>
            ) : (
              <p className="eyebrow tnum text-gold">
                {active + 1} / {events.length}
              </p>
            )}

            <span className="text-[13px] font-medium text-ink-2">
              <span className="font-semibold text-gold">{active + 1}</span> of{" "}
              <span className="text-ink">{events.length}</span> upcoming sessions
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden sm:inline-block text-[12.5px] text-ink-3">
              Swipe or click to browse
            </span>
            <button
              type="button"
              onClick={() => go(active - 1)}
              disabled={edges.start}
              aria-label="Previous session"
              className={arrowClass}
            >
              <Chevron dir="left" />
            </button>
            <button
              type="button"
              onClick={() => go(active + 1)}
              disabled={edges.end}
              aria-label="Next session"
              className={arrowClass}
            >
              <Chevron dir="right" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

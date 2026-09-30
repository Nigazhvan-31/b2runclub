import { motion, useScroll, useTransform, useSpring, type MotionValue } from "framer-motion";
import { useCallback, useRef } from "react";
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { Link } from "react-router-dom";
import { ClubFeatures } from "../components/clubFeatures";
import { EventCard } from "../components/events";
import { CollaboratorScroller, FeaturedPartners } from "../components/collaborators";
import { Founders } from "../components/founders";
import { CommunityLinks } from "../components/communityLinks";
import { HeroVideo } from "../components/heroVideo";
import { RunnerScene } from "../components/scene3d";
import {
  CalendarIcon,
  DisciplineIcon,
  SparkIcon,
  TicketIcon,
} from "../components/icons";
import { AnimatedNumber, Reveal } from "../components/motion";
import { PillarCard } from "../components/PillarCard";
import { Tilt, TiltLayer } from "../components/tilt";
import { buttonClass, Card, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { countdown, eventTime, fullDate, inr, isPast } from "../lib/format";
import { useFetch } from "../lib/useFetch";

gsap.registerPlugin(SplitText);

/**
 * Magnetic hover: the element nudges toward the cursor as it moves within
 * its bounds, and eases back to rest on pointer leave. Uses `quickTo` so
 * repeated pointermove events reuse one tween per axis instead of spawning
 * a new one every frame. Not a hook — plain setup/cleanup, safe to call
 * from inside a useGSAP() callback for each button that wants the effect.
 */
function attachMagneticHover(el: HTMLElement | null, strength = 0.3) {
  if (!el) return () => {};

  const xTo = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3.out" });
  const yTo = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3.out" });

  const handlePointerMove = (event: PointerEvent) => {
    const bounds = el.getBoundingClientRect();
    const relativeX = event.clientX - (bounds.left + bounds.width / 2);
    const relativeY = event.clientY - (bounds.top + bounds.height / 2);
    xTo(relativeX * strength);
    yTo(relativeY * strength);
  };
  const handlePointerLeave = () => {
    xTo(0);
    yTo(0);
  };

  el.addEventListener("pointermove", handlePointerMove);
  el.addEventListener("pointerleave", handlePointerLeave);

  return () => {
    el.removeEventListener("pointermove", handlePointerMove);
    el.removeEventListener("pointerleave", handlePointerLeave);
  };
}

const PILLARS = [
  {
    Icon: CalendarIcon,
    title: "Run the calendar",
    body: "Weekly road runs, trail sessions, rides and the odd party. Register in two taps.",
    image: "/pillars/calendar.jpg",
  },
  {
    Icon: TicketIcon,
    title: "Carry a QR ticket",
    body: "Every confirmed spot gets a scannable ticket. Volunteers marshal for free.",
    image: "/pillars/ticket.jpg",
  },
  {
    Icon: SparkIcon,
    title: "Decide together",
    body: "Polls pick the routes. The forum carries the announcements and the banter.",
    image: "/pillars/decide.jpg",
  },
];

const HOW_STEPS = [
  {
    n: "01",
    t: "Pick a session",
    b: "Browse the calendar or the list. Every session shows route, start time and entry.",
    badge: { label: "Calendar", color: "var(--color-gold)", bg: "rgba(233,185,73,0.13)", icon: "📅" },
  },
  {
    n: "02",
    t: "Sign the waiver",
    b: "Once, with your emergency contact. We keep it for the organisers on the day.",
    badge: { label: "One time", color: "var(--color-free)", bg: "rgba(100,200,120,0.13)", icon: "✍️" },
  },
  {
    n: "03",
    t: "Pay in-app",
    b: "Card payment through Razorpay. Volunteers marshal and pay nothing.",
    badge: { label: "Secure pay", color: "var(--color-paid)", bg: "rgba(100,160,255,0.13)", icon: "💳" },
  },
  {
    n: "04",
    t: "Show your ticket",
    b: "A QR code we scan at the start line. Screenshots are fine.",
    badge: { label: "QR ticket", color: "#c084fc", bg: "rgba(192,132,252,0.13)", icon: "🎟️" },
  },
];

/**
 * Scroll-driven reveal for a single "How it works" card.
 */
function useCardReveal(
  progress: MotionValue<number>,
  range: [number, number],
  yFrom: number,
  rotateZFrom: number = -3,
) {
  const y = useTransform(progress, range, [yFrom, 0]);
  const opacity = useTransform(progress, range, [0, 1]);
  const rotateX = useTransform(progress, range, [25, 0]);
  const rotateZ = useTransform(progress, range, [rotateZFrom, 0]);
  const scale = useTransform(progress, range, [0.85, 1]);
  return { y, opacity, rotateX, rotateZ, scale };
}

export function Landing() {
  const { user, isAdmin } = useAuth();

  const load = useCallback(() => api.events(), []);
  const { data: events, loading } = useFetch(load);

  const loadGallery = useCallback(() => api.gallery(), []);
  const { data: gallery } = useFetch(loadGallery);

  const upcoming = (events ?? [])
    .filter((e) => e.status === "PUBLISHED" && !isPast(e.date_time))
    .sort((a, b) => +new Date(a.date_time) - +new Date(b.date_time));

  const next = upcoming[0];
  const rest = upcoming.slice(1, 4);

  const allEvents = events ?? [];
  const disciplines = new Set(allEvents.map((e) => e.type)).size;
  const photos = gallery ?? [];

  // ── Scroll refs for the "How it works" sticky section ──
  const stickyRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: stickyRef,
    offset: ["start end", "end end"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 130,
    damping: 26,
    mass: 0.25,
  });

  const card0 = useCardReveal(smoothProgress, [0.05, 0.6], 460);
  const card1 = useCardReveal(smoothProgress, [0.1, 0.65], 560);
  const card2 = useCardReveal(smoothProgress, [0.15, 0.7], 500);
  const card3 = useCardReveal(smoothProgress, [0.2, 0.75], 640);
  const cardMotionValues = [card0, card1, card2, card3];

  // ── Hero entrance choreography (GSAP) ──
  const heroRef = useRef<HTMLElement>(null);
  const heroPillRef = useRef<HTMLSpanElement>(null);
  const heroButtonsRef = useRef<HTMLDivElement>(null);
  const heroBtnPrimaryRef = useRef<HTMLAnchorElement>(null);
  const heroBtnSecondaryRef = useRef<HTMLAnchorElement>(null);
  const heroBtnGhostRef = useRef<HTMLAnchorElement>(null);
  const heroGraphicRef = useRef<HTMLDivElement>(null);
  const heroGraphicFloatRef = useRef<HTMLDivElement>(null);
  const heroGraphicParallaxRef = useRef<HTMLDivElement>(null);
  const heroSpotlightRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      tl.fromTo(
        heroPillRef.current,
        { opacity: 0, y: -10, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.7)" },
      ).fromTo(
        [heroBtnPrimaryRef.current, heroBtnSecondaryRef.current, heroBtnGhostRef.current].filter(Boolean),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.45, stagger: 0.08 },
        "-=0.15",
      );

      if (heroGraphicRef.current) {
        tl.fromTo(
          heroGraphicRef.current,
          { opacity: 0, scale: 0.96 },
          { opacity: 1, scale: 1, duration: 1.1, ease: "power2.out" },
          "-=0.4",
        );
      }

      if (heroSpotlightRef.current) {
        tl.fromTo(
          heroSpotlightRef.current,
          { opacity: 0, y: 22 },
          { opacity: 1, y: 0, duration: 0.55 },
          "-=0.25",
        );
      }

      if (heroGraphicFloatRef.current) {
        gsap
          .timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
          .to(heroGraphicFloatRef.current, { y: -16, rotation: 1.4, duration: 3.6 })
          .to(heroGraphicFloatRef.current, { y: 8, rotation: -1.1, duration: 4.2 });
      }

      let handlePointerMove: ((event: PointerEvent) => void) | null = null;
      let handlePointerLeave: (() => void) | null = null;
      const sectionEl = heroRef.current;

      if (sectionEl && heroGraphicParallaxRef.current) {
        const parallaxX = gsap.quickTo(heroGraphicParallaxRef.current, "x", {
          duration: 0.9,
          ease: "power3.out",
        });
        const parallaxY = gsap.quickTo(heroGraphicParallaxRef.current, "y", {
          duration: 0.9,
          ease: "power3.out",
        });

        handlePointerMove = (event: PointerEvent) => {
          const bounds = sectionEl.getBoundingClientRect();
          const relativeX = (event.clientX - bounds.left) / bounds.width - 0.5;
          const relativeY = (event.clientY - bounds.top) / bounds.height - 0.5;
          parallaxX(relativeX * 32);
          parallaxY(relativeY * 24);
        };
        handlePointerLeave = () => {
          parallaxX(0);
          parallaxY(0);
        };

        sectionEl.addEventListener("pointermove", handlePointerMove);
        sectionEl.addEventListener("pointerleave", handlePointerLeave);
      }

      const magneticCleanups: Array<() => void> = [];
      if (typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches) {
        magneticCleanups.push(attachMagneticHover(heroBtnPrimaryRef.current, 0.3));
        magneticCleanups.push(attachMagneticHover(heroBtnSecondaryRef.current, 0.3));
        magneticCleanups.push(attachMagneticHover(heroBtnGhostRef.current, 0.3));
      }

      return () => {
        if (sectionEl && handlePointerMove && handlePointerLeave) {
          sectionEl.removeEventListener("pointermove", handlePointerMove);
          sectionEl.removeEventListener("pointerleave", handlePointerLeave);
        }
        magneticCleanups.forEach((cleanup) => cleanup());
      };
    },
    { scope: heroRef },
  );

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative mx-auto max-w-7xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6 lg:px-8"
      >
        {/*
          The video area. HeroVideo sits inside it as `absolute inset-y-0`, so
          scoping it to this box ends the video cleanly above the buttons.
        */}
        <div className="relative flex min-h-[380px] sm:min-h-[460px] lg:min-h-[520px] flex-col items-center pt-2 text-center">
          <HeroVideo />

          {/* Top Centered Status Pill over the hero media */}
          <span
            ref={heroPillRef}
            className="relative z-10 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-black/80 px-4 py-1.5 shadow-lg backdrop-blur-md"
          >
            <span className="size-1.5 rounded-full bg-gold pulse-ring" aria-hidden />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-gold">
              {upcoming.length > 0
                ? `${upcoming.length} event${upcoming.length === 1 ? "" : "s"} open`
                : "Season in planning"}
            </span>
          </span>
        </div>

        {/* Centered Action Callout below the media matching client example */}
        <div
          ref={heroButtonsRef}
          className="relative z-10 flex flex-col items-center justify-center pt-8 text-center sm:pt-10"
        >
          {!user ? (
            <Link
              ref={heroBtnPrimaryRef}
              to="/signup"
              className={buttonClass(
                "gold",
                "lg",
                "sweep px-10 py-4 text-[17px] font-bold sm:px-12 sm:py-4.5 sm:text-[18px] rounded-2xl shadow-xl shadow-gold/20",
              )}
            >
              Join Us
              <svg viewBox="0 0 24 24" className="ml-1 size-4.5" fill="none" aria-hidden>
                <path
                  d="M5 12h14m-6-6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          ) : (
            <Link
              ref={heroBtnPrimaryRef}
              to="/calendar"
              className={buttonClass(
                "gold",
                "lg",
                "sweep px-10 py-4 text-[17px] font-bold sm:px-12 sm:py-4.5 sm:text-[18px] rounded-2xl shadow-xl shadow-gold/20",
              )}
            >
              See the calendar
              <svg viewBox="0 0 24 24" className="ml-1 size-4.5" fill="none" aria-hidden>
                <path
                  d="M5 12h14m-6-6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          )}

          <Link
            ref={heroBtnGhostRef}
            to="/events"
            className="mt-3.5 inline-block text-[14.5px] font-semibold text-gold transition-all hover:text-gold-2 hover:underline"
          >
            or see what's on →
          </Link>
        </div>

        {/* Next event spotlight */}
        <div ref={heroSpotlightRef} className="mt-14">
          {loading ? (
            <Card className="p-6">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-4 h-10 w-2/3" />
              <Skeleton className="mt-3 h-4 w-1/3" />
            </Card>
          ) : next ? (
            <Tilt max={4} lift={5} glare={false}>
              <Card className="speedlines relative overflow-hidden">
                <div
                  className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full opacity-[0.15] blur-3xl"
                  style={{ background: "var(--color-gold)" }}
                  aria-hidden
                />
                <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <p className="eyebrow text-gold">Next up</p>
                    <h2 className="display mt-3 text-[clamp(26px,3.6vw,40px)]">{next.title}</h2>
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-ink-2">
                      <span className="flex items-center gap-1.5">
                        <span className="text-gold" aria-hidden>
                          <DisciplineIcon type={next.type} className="size-4" />
                        </span>
                        {next.type}
                      </span>
                      <span>{fullDate(next.date_time)}</span>
                      <span>{eventTime(next.date_time)}</span>
                      <span className="text-ink-3">{next.location}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-x-6 gap-y-4 lg:shrink-0">
                    <div>
                      <p className="eyebrow whitespace-nowrap">Starts in</p>
                      <p className="display tnum mt-1.5 whitespace-nowrap text-[32px] text-gold">
                        {countdown(next.date_time) ?? "now"}
                      </p>
                    </div>
                    <div>
                      <p className="eyebrow">Entry</p>
                      <p className="display mt-1.5 whitespace-nowrap text-[32px]">
                        {next.price === 0 ? "Free" : inr(next.price)}
                      </p>
                    </div>
                    {isAdmin ? (
                      <Link
                        to={`/raceday/${next.id}`}
                        className={buttonClass("gold", "md", "mb-1 w-full sm:w-auto")}
                      >
                        Manage event
                      </Link>
                    ) : (
                      <Link
                        to={`/events/${next.id}`}
                        className={buttonClass("gold", "md", "mb-1 w-full sm:w-auto")}
                      >
                        Take a spot
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            </Tilt>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-sm text-ink-2">
                No published events right now — the organisers are drafting the next block.
              </p>
            </Card>
          )}
        </div>
      </section>

      {/* ── Pillars ──────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {PILLARS.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="h-full"
            >
              <PillarCard pillar={p} index={i} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── More events ──────────────────────────────────── */}
      {rest.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-2 text-gold">Also on the board</p>
              <h2 className="display text-[clamp(24px,3vw,32px)]">Coming up</h2>
            </div>
            <Link
              to="/events"
              className="text-[13px] font-medium text-ink-3 transition-colors hover:text-gold"
            >
              All events →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((e, i) => (
              <EventCard key={e.id} event={e} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* ── By the numbers ─────────── */}
      <Reveal>
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="datastrip mb-10" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Sessions on the board", value: allEvents.length, suffix: "" },
              { label: "Published & open", value: upcoming.length, suffix: "" },
              { label: "Disciplines", value: Math.max(disciplines, 3), suffix: "" },
              { label: "Sessions / month", value: 8, suffix: "+" },
            ].map((s) => (
              <Tilt key={s.label} max={8} lift={9}>
                <Card hover className="hud edge-gold h-full p-6">
                  <TiltLayer depth={26}>
                    <p className="display foil text-[40px] leading-none">
                      <AnimatedNumber value={s.value} format={(v) => `${Math.round(v)}${s.suffix}`} />
                    </p>
                  </TiltLayer>
                  <p className="eyebrow mt-3">{s.label}</p>
                </Card>
              </Tilt>
            ))}
          </div>
        </section>
      </Reveal>

      {/* ── Inside the club ──────────────────────────────── */}
      <ClubFeatures />

      {/* ── How it works — scroll-driven sticky section ───── */}
      {/* ── How it works — Mobile: Natural clean grid, no trapped scroll or bottom clipping ───── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 md:hidden">
        <p className="eyebrow mb-2 text-gold">How it works</p>
        <h2 className="display text-[clamp(26px,5vw,36px)] leading-tight text-ink">
          Four steps from curious to running.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {HOW_STEPS.map((step) => (
            <HowStepCard key={step.n} step={step} />
          ))}
        </div>
      </section>

      {/* ── How it works — Desktop & Laptop (md+): Smooth scroll-driven 3D parallax choreography ───── */}
      <div ref={stickyRef} style={{ height: "300vh" }} className="relative hidden md:block">
        <div className="sticky top-0 min-h-screen overflow-visible">
          <div className="flex min-h-screen flex-col justify-start px-4 pb-[clamp(160px,18vw,240px)] pt-16 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <p className="eyebrow mb-4 text-gold">How it works</p>
              <ScrollRevealText
                text="Four steps from curious to running."
                scrollProgress={smoothProgress}
              />

              <div className="mt-8 flex gap-5" style={{ perspective: "1000px" }}>
                <div className="flex flex-1 flex-col gap-5">
                  <motion.div
                    style={{
                      y: cardMotionValues[0].y,
                      opacity: cardMotionValues[0].opacity,
                      rotateX: cardMotionValues[0].rotateX,
                      rotateZ: cardMotionValues[0].rotateZ,
                      scale: cardMotionValues[0].scale,
                    }}
                  >
                    <HowStepCard step={HOW_STEPS[0]} />
                  </motion.div>
                  <motion.div
                    style={{
                      y: cardMotionValues[2].y,
                      opacity: cardMotionValues[2].opacity,
                      rotateX: cardMotionValues[2].rotateX,
                      rotateZ: cardMotionValues[2].rotateZ,
                      scale: cardMotionValues[2].scale,
                    }}
                  >
                    <HowStepCard step={HOW_STEPS[2]} />
                  </motion.div>
                </div>

                <div
                  className="flex flex-1 flex-col gap-5"
                  style={{ marginTop: "clamp(24px, 3vw, 44px)" }}
                >
                  <motion.div
                    style={{
                      y: cardMotionValues[1].y,
                      opacity: cardMotionValues[1].opacity,
                      rotateX: cardMotionValues[1].rotateX,
                      rotateZ: cardMotionValues[1].rotateZ,
                      scale: cardMotionValues[1].scale,
                    }}
                  >
                    <HowStepCard step={HOW_STEPS[1]} />
                  </motion.div>
                  <motion.div
                    style={{
                      y: cardMotionValues[3].y,
                      opacity: cardMotionValues[3].opacity,
                      rotateX: cardMotionValues[3].rotateX,
                      rotateZ: cardMotionValues[3].rotateZ,
                      scale: cardMotionValues[3].scale,
                    }}
                  >
                    <HowStepCard step={HOW_STEPS[3]} />
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── How you join ─────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <Reveal>
          <div className="datastrip mb-10" />
          <p className="eyebrow mb-2 text-gold">How you join</p>
          <h2 className="display text-[clamp(26px,3.6vw,38px)]">Two ways to join.</h2>
        </Reveal>

        <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:items-center">
          {/* Left Column — 3D running figure */}
          <div className="hidden h-full min-h-[400px] w-full items-center justify-center lg:flex">
            <RunnerScene className="h-full w-full" />
          </div>

          {/* Right Column — Cards Grid */}
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                {
                  role: "Member",
                  tint: "var(--color-paid)",
                  line: "You want to run.",
                  perks: ["Register for any published session", "Pay once, carry a QR ticket", "Post, comment and vote on routes"],
                },
                {
                  role: "Volunteer",
                  tint: "var(--color-free)",
                  line: "You want to marshal.",
                  perks: ["Entry comped on every event", "Gold bib and the junction calls", "Post photos to the club gallery"],
                },
              ].map((r, i) => (
                <Reveal key={r.role} delay={i * 0.07}>
                  <Tilt max={7} lift={9} className="h-full">
                    <Card hover className="hud edge-gold flex aspect-square flex-col justify-between p-6">
                      <div>
                        <span
                          className="inline-flex items-center gap-2 rounded-full px-2.5 py-1"
                          style={{ background: `${r.tint}1f`, color: r.tint }}
                        >
                          <span className="size-1.5 rounded-full" style={{ background: r.tint }} />
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                            {r.role}
                          </span>
                        </span>
                        <p className="display mt-4 text-[18px]">{r.line}</p>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {r.perks.map((perk) => (
                          <li key={perk} className="flex gap-2 text-[12.5px] leading-tight text-ink-2">
                            <span className="mt-1 size-1 shrink-0 rounded-full bg-gold" aria-hidden />
                            {perk}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </Tilt>
                </Reveal>
              ))}
            </div>

            <Reveal delay={0.14}>
              <Tilt max={7} lift={9}>
                <Card hover className="hud edge-gold p-6">
                  <span
                    className="inline-flex items-center gap-2 rounded-full px-2.5 py-1"
                    style={{ background: `var(--color-ink-3)1f`, color: "var(--color-ink-3)" }}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: "var(--color-ink-3)" }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                      Visitor
                    </span>
                  </span>
                  <p className="display mt-4 text-[20px]">You're just looking.</p>
                  <ul className="mt-4 grid gap-2.5 sm:grid-cols-3">
                    {[
                      "Browse the calendar and gallery",
                      "See polls and the leaderboard",
                      "No account needed to look around",
                    ].map((perk) => (
                      <li key={perk} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gold" aria-hidden />
                        {perk}
                      </li>
                    ))}
                  </ul>
                </Card>
              </Tilt>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Founders ─────────────────────────────────────── */}
      <Founders />

      {/* ── Community channels ───────────────────────────── */}
      <CommunityLinks />

      {/* ── Gallery preview ──────────────────────────────── */}
      {photos.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <Reveal>
            <div className="datastrip mb-10" />
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow mb-2 text-gold">From the club</p>
                <h2 className="display text-[clamp(26px,3.6vw,38px)]">Lately, in pictures</h2>
              </div>
              <Link to="/gallery" className="text-[13px] font-medium text-ink-3 hover:text-gold">
                Full gallery →
              </Link>
            </div>
          </Reveal>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {photos.slice(0, 4).map((ph, i) => (
              <Reveal key={ph.id} delay={i * 0.06}>
                <Tilt max={9} lift={10}>
                  <Link
                    to="/gallery"
                    className="group block overflow-hidden rounded-[var(--radius-card)] border border-white/8"
                  >
                    <img
                      src={ph.url}
                      alt={ph.caption ?? "Club photo"}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </Link>
                </Tilt>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* ── Featured Partners ────────────────────────────── */}
      <FeaturedPartners />

      {/* ── Collaborator Scroller ────────────────────────── */}
      <CollaboratorScroller />

      {/* ── Closing CTA ──────────────────────────────────── */}
      {!user && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Card className="relative overflow-hidden p-8 text-center sm:p-12">
            <div
              className="pointer-events-none absolute inset-x-0 -bottom-32 h-64 opacity-[0.16] blur-3xl"
              style={{ background: "var(--color-gold)" }}
              aria-hidden
            />
            <div className="relative">
              <h2 className="display text-[clamp(28px,4vw,44px)]">
                Next run leaves without you.
              </h2>
              <p className="mx-auto mt-4 max-w-md text-[15px] text-ink-2">
                Join as a member to register and pay, or as a volunteer to marshal for free.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link to="/signup" className={buttonClass("gold", "lg")}>
                  Create your account
                </Link>
                <Link to="/login" className={buttonClass("outline", "lg")}>
                  I have one
                </Link>
              </div>
            </div>
          </Card>
        </section>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────

function ScrollRevealText({
  text,
  scrollProgress,
}: {
  text: string;
  scrollProgress: ReturnType<typeof useSpring>;
}) {
  const chars = text.split("");
  return (
    <h2
      className="display text-[clamp(26px,3.6vw,48px)] leading-tight"
      aria-label={text}
    >
      {chars.map((char, i) => {
        const start = 0.06 + (i / chars.length) * 0.3;
        const end = start + 0.08;
        return (
          <CharSpan
            key={i}
            char={char}
            scrollProgress={scrollProgress}
            inputRange={[start, end]}
          />
        );
      })}
    </h2>
  );
}

function CharSpan({
  char,
  scrollProgress,
  inputRange,
}: {
  char: string;
  scrollProgress: ReturnType<typeof useSpring>;
  inputRange: [number, number];
}) {
  const opacity = useTransform(scrollProgress, inputRange, [0, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block whitespace-pre">
      {char}
    </motion.span>
  );
}

function HowStepCard({
  step,
}: {
  step: {
    n: string;
    t: string;
    b: string;
    badge: { label: string; color: string; bg: string; icon: string };
  };
}) {
  return (
    <Tilt max={4} lift={10}>
      <div
        className="group relative overflow-hidden rounded-3xl"
        style={{
          background: "#111214",
          padding: "clamp(24px, 3vw, 36px)",
          minHeight: "clamp(260px, 30vw, 340px)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "rgba(255,255,255,0.08)" }}
        />

        <p
          className="display leading-none tnum select-none"
          style={{
            fontSize: "clamp(56px, 8vw, 88px)",
            color: "rgba(255,255,255,0.08)",
            letterSpacing: "-0.03em",
          }}
        >
          {step.n}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
            style={{ background: step.badge.bg }}
          >
            <span className="text-[13px] leading-none" aria-hidden>
              {step.badge.icon}
            </span>
            <span
              className="text-[11px] font-bold uppercase tracking-[0.1em]"
              style={{ color: step.badge.color }}
            >
              {step.badge.label}
            </span>
          </span>

          <span
            className="ml-auto rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.3)",
            }}
          >
            STEP {step.n}
          </span>
        </div>

        <h3
          className="mt-5 font-semibold leading-tight text-white"
          style={{ fontSize: "clamp(17px, 2vw, 21px)" }}
        >
          {step.t}
        </h3>

        <p
          className="mt-2.5 text-[13px] leading-relaxed"
          style={{ color: "rgba(255,255,255,0.38)" }}
        >
          {step.b}
        </p>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `linear-gradient(to top, ${step.badge.bg}, transparent)`,
          }}
        />
      </div>
    </Tilt>
  );
}
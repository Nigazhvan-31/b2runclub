import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Card, useToast } from "./ui";
import { Confetti } from "./motion";
import { useCountdown } from "../lib/motion";
import { fullDate } from "../lib/format";

export const TARGET_DATE_ISO = "2026-12-20T00:00:00+05:30";

export function MembershipCard() {
  const { user, isMembershipActive, refreshUser } = useAuth();
  const toast = useToast();

  const [celebrate] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Live countdown to 20 December 2026
  const countdown = useCountdown(TARGET_DATE_ISO);

  // Only visible after logging in
  if (!user) return null;

  const handleResetTest = async () => {
    setResetting(true);
    try {
      await api.adminResetMyMembership();
      await refreshUser();
      toast("Membership removed for this account! You can now test the coming soon view.", "ok");
    } catch {
      toast("Could not reset test membership", "err");
    } finally {
      setResetting(false);
    }
  };

  if (isMembershipActive) {
    return (
      <section className="relative mx-auto max-w-5xl px-4 py-3 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="relative overflow-hidden border border-gold/40 bg-gradient-to-r from-surface-2/95 via-surface/90 to-surface-2/95 p-5 sm:p-6 shadow-[0_0_35px_rgba(233,185,73,0.12)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-gold">
                  ★ Active B² Member
                </div>
                <p className="text-[14px] font-medium text-ink">
                  Your monthly membership is active · 100% Free entry to all club runs
                </p>
                {user?.membership_expires_at && (
                  <p className="text-xs text-ink-3">
                    Valid until {fullDate(user.membership_expires_at)} · Renews every 30 days
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleResetTest}
                  disabled={resetting}
                  className="block text-[11px] text-ink-3 hover:text-gold transition-colors underline pt-1 text-left cursor-pointer"
                >
                  {resetting ? "Removing..." : "Remove membership for this account (test runner view)"}
                </button>
              </div>
              <Link
                to="/events"
                className="inline-flex items-center justify-center shrink-0 rounded-xl bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[color:var(--color-gold-ink)] transition-transform hover:scale-[1.02]"
              >
                Browse Free Runs →
              </Link>
            </div>
          </Card>
        </motion.div>
      </section>
    );
  }

  return (
    <>
      <Confetti show={celebrate} />
      <section className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card className="relative overflow-hidden border border-gold/40 bg-gradient-to-br from-surface-2/95 via-surface/90 to-void p-6 sm:p-10 shadow-[0_0_50px_rgba(233,185,73,0.12)]">
            {/* Ambient Background Glow */}
            <div
              className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-gold/15 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-sky-500/10 blur-3xl"
              aria-hidden
            />

            <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Left Column: Coming Soon Heading & Subtitle */}
              <div className="max-w-md">
                <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gold shadow-sm">
                  <span className="inline-block size-1.5 rounded-full bg-gold animate-pulse" />
                  Coming Soon
                </div>

                <h2 className="display mt-3 text-2xl font-bold sm:text-3xl lg:text-4xl text-ink tracking-tight">
                  Coming Soon
                </h2>

                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  Something big is dropping on 20 December 2026. Stay tuned.
                </p>
              </div>

              {/* Right Column: Live Countdown to 20 Dec 2026 */}
              <div className="shrink-0 flex flex-col items-start md:items-end">
                <p className="eyebrow text-gold font-bold mb-2 flex items-center gap-1.5">
                  <span>⏳</span> Dropping In:
                </p>

                <div className="flex items-center gap-2 sm:gap-2.5">
                  {/* Days */}
                  <div className="flex flex-col items-center justify-center rounded-xl border border-gold/40 bg-surface-3/90 px-3 py-2 sm:px-4 sm:py-2.5 min-w-[56px] shadow-sm">
                    <span className="display text-xl sm:text-2xl font-bold text-gold tnum">
                      {countdown.days}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                      Days
                    </span>
                  </div>

                  <span className="text-gold font-bold text-lg">:</span>

                  {/* Hours */}
                  <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-surface-3/90 px-3 py-2 sm:px-4 sm:py-2.5 min-w-[56px] shadow-sm">
                    <span className="display text-xl sm:text-2xl font-bold text-ink tnum">
                      {String(countdown.hours).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                      Hours
                    </span>
                  </div>

                  <span className="text-gold font-bold text-lg">:</span>

                  {/* Minutes */}
                  <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-surface-3/90 px-3 py-2 sm:px-4 sm:py-2.5 min-w-[56px] shadow-sm">
                    <span className="display text-xl sm:text-2xl font-bold text-ink tnum">
                      {String(countdown.minutes).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                      Mins
                    </span>
                  </div>

                  <span className="text-gold font-bold text-lg">:</span>

                  {/* Seconds */}
                  <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-surface-3/90 px-3 py-2 sm:px-4 sm:py-2.5 min-w-[56px] shadow-sm">
                    <span className="display text-xl sm:text-2xl font-bold text-ink-2 tnum">
                      {String(countdown.seconds).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                      Secs
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      </section>
    </>
  );
}

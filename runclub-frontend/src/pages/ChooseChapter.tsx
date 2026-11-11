import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useBranch } from "../lib/branch";
import { cn } from "../lib/format";
import { PageScene } from "../components/scene3d";

export function ChooseChapter() {
  const { branch, setBranch } = useBranch();
  const navigate = useNavigate();

  const handleSelect = (selected: "MADURAI" | "CHENNAI") => {
    setBranch(selected);
    navigate("/events", { replace: true });
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-16 sm:px-6 lg:px-8 overflow-hidden bg-void">
      <PageScene variant="lattice" opacity={0.35} />

      {/* Atmospheric Glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[600px] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--color-gold) 0%, transparent 70%)" }}
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-2xl text-center"
      >
        <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
          Location Selection
        </div>

        <h1 className="display mt-4 text-3xl font-bold sm:text-4xl lg:text-5xl text-ink tracking-tight">
          Choose Your B² Chapter
        </h1>

        <p className="mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-ink-2">
          Select your city to view scheduled start-lines, training sessions, and community events for your region.
        </p>

        {/* City Selection Cards */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 text-left">
          {/* Madurai Card */}
          <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSelect("MADURAI")}
            className={cn(
              "group relative cursor-pointer rounded-2xl border p-6 transition-all duration-300 shadow-xl",
              branch === "MADURAI"
                ? "border-gold/60 bg-gold/[0.07] ring-1 ring-gold/40 shadow-[0_0_30px_rgba(233,185,73,0.14)]"
                : "border-white/10 bg-surface-2/80 hover:border-gold/40 hover:bg-surface-3/90",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-gold">
                Temple City
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  branch === "MADURAI"
                    ? "bg-gold text-[color:var(--color-gold-ink)]"
                    : "bg-gold/15 text-gold border border-gold/30",
                )}
              >
                Active Runs
              </span>
            </div>

            <h2 className="mt-4 text-xl font-bold text-ink group-hover:text-gold transition-colors">
              Madurai Chapter
            </h2>

            <p className="mt-2 text-[13px] leading-relaxed text-ink-3 group-hover:text-ink-2 transition-colors">
              Weekly Sunday morning community runs at Race Course, Samanar Hill trail explorations, and social breakfast meetups.
            </p>

            <div className="mt-6 pt-4 border-t border-white/8 flex items-center justify-between">
              <span className="text-xs font-semibold text-gold">
                View Madurai Events
              </span>
              <span className="text-gold transition-transform group-hover:translate-x-1">→</span>
            </div>
          </motion.div>

          {/* Chennai Card */}
          <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSelect("CHENNAI")}
            className={cn(
              "group relative cursor-pointer rounded-2xl border p-6 transition-all duration-300 shadow-xl",
              branch === "CHENNAI"
                ? "border-sky-400/60 bg-sky-500/[0.08] ring-1 ring-sky-400/40 shadow-[0_0_30px_rgba(56,189,248,0.14)]"
                : "border-white/10 bg-surface-2/80 hover:border-sky-400/40 hover:bg-surface-3/90",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-sky-400">
                Coastal City
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  branch === "CHENNAI"
                    ? "bg-sky-400 text-stone-950 font-bold"
                    : "bg-sky-500/15 text-sky-300 border border-sky-500/30",
                )}
              >
                Launching Soon
              </span>
            </div>

            <h2 className="mt-4 text-xl font-bold text-ink group-hover:text-sky-300 transition-colors">
              Chennai Chapter
            </h2>

            <p className="mt-2 text-[13px] leading-relaxed text-ink-3 group-hover:text-ink-2 transition-colors">
              Weekend sunrise runs along Marina Beach promenade &amp; Besant Nagar coastal circuits are launching soon.
            </p>

            <div className="mt-6 pt-4 border-t border-white/8 flex items-center justify-between">
              <span className="text-xs font-semibold text-sky-400">
                View Chennai Events
              </span>
              <span className="text-sky-400 transition-transform group-hover:translate-x-1">→</span>
            </div>
          </motion.div>
        </div>

        <p className="mt-8 text-xs text-ink-3">
          You can switch your city anytime from your Account profile menu.
        </p>
      </motion.div>
    </div>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { useBranch } from "../lib/branch";
import { cn } from "../lib/format";

export function BranchGatewayModal() {
  const { showGateway, setShowGateway, branch, setBranch, hasChosenBranch } = useBranch();

  if (!showGateway) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (hasChosenBranch) setShowGateway(false);
          }}
          className="fixed inset-0 bg-void/85 backdrop-blur-md"
        />

        {/* Modal Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-white/12 bg-surface p-6 shadow-2xl sm:p-8"
        >
          {/* Close button if user already had a chosen branch */}
          {hasChosenBranch && (
            <button
              onClick={() => setShowGateway(false)}
              className="absolute right-4 top-4 rounded-full p-2 text-ink-3 transition-colors hover:bg-white/10 hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          )}

          {/* Header */}
          <div className="text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-gold">
              <span>📍</span> Chapter Selection
            </div>
            <h2 className="display mt-3 text-2xl font-bold sm:text-3xl text-ink">
              Choose Your B² Chapter
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-[13.5px] leading-relaxed text-ink-2">
              B² Club organizes weekly runs, Sunday community sessions, and fitness gatherings across
              two cities. Select your primary branch to explore upcoming sessions, start-lines, and tickets.
            </p>
          </div>

          {/* City Selection Cards */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {/* Madurai Card */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setBranch("MADURAI")}
              className={cn(
                "group relative cursor-pointer rounded-xl border p-5 transition-all",
                branch === "MADURAI"
                  ? "border-gold bg-gold/5 shadow-[0_0_24px_rgba(233,185,73,0.12)]"
                  : "border-white/10 bg-surface-2 hover:border-gold/50 hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-3xl">🏛️</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider",
                    branch === "MADURAI"
                      ? "bg-gold text-[color:var(--color-gold-ink)] font-bold"
                      : "bg-white/10 text-ink-3 group-hover:text-ink-2",
                  )}
                >
                  {branch === "MADURAI" ? "Active" : "Madurai"}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-bold text-ink group-hover:text-gold transition-colors">
                Madurai Chapter
              </h3>
              <p className="text-[11.5px] font-medium uppercase tracking-wider text-gold/80">
                Temple City Runners
              </p>

              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3 group-hover:text-ink-2">
                Weekly Sunday morning community runs at Race Course, Samanar Hill trail explorations,
                and social breakfast meetups.
              </p>

              <div className="mt-5 flex items-center gap-1.5 text-[13px] font-semibold text-gold">
                <span>Select Madurai</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </motion.div>

            {/* Chennai Card */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setBranch("CHENNAI")}
              className={cn(
                "group relative cursor-pointer rounded-xl border p-5 transition-all",
                branch === "CHENNAI"
                  ? "border-gold bg-gold/5 shadow-[0_0_24px_rgba(233,185,73,0.12)]"
                  : "border-white/10 bg-surface-2 hover:border-gold/50 hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-3xl">🌊</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider",
                    branch === "CHENNAI"
                      ? "bg-gold text-[color:var(--color-gold-ink)] font-bold"
                      : "bg-white/10 text-ink-3 group-hover:text-ink-2",
                  )}
                >
                  {branch === "CHENNAI" ? "Active" : "Chennai"}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-bold text-ink group-hover:text-gold transition-colors">
                Chennai Chapter
              </h3>
              <p className="text-[11.5px] font-medium uppercase tracking-wider text-gold/80">
                Coastal City Runners
              </p>

              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3 group-hover:text-ink-2">
                Weekend sunrise runs along Marina Beach promenade, Besant Nagar coastal miles,
                and post-run networking filter coffee.
              </p>

              <div className="mt-5 flex items-center gap-1.5 text-[13px] font-semibold text-gold">
                <span>Select Chennai</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </motion.div>
          </div>

          {/* Footer note */}
          <div className="mt-6 text-center text-[11.5px] text-ink-3">
            <span>You can seamlessly switch between Madurai and Chennai anytime from the top navigation bar.</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

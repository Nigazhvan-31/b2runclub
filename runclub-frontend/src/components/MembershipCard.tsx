import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { openCheckout, isMockPayment } from "../lib/razorpay";
import { Card, Button, useToast } from "./ui";
import { Confetti } from "./motion";
import { fullDate } from "../lib/format";

export function MembershipCard() {
  const { user, isMembershipActive, refreshUser } = useAuth();
  const toast = useToast();

  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  // The membership section only appears after logging in
  if (!user) return null;

  const handleJoin = async () => {
    setBusy(true);
    try {
      // 1. Create membership order
      const orderRes = await api.createMembershipOrder();

      // If mock mode on dev without keys
      if (orderRes.mock_mode || isMockPayment(orderRes.razorpay_key_id, orderRes.order_id)) {
        // Direct simulation / verification
        const verifyRes = await api.verifyMembershipPayment({
          razorpay_order_id: orderRes.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });

        await refreshUser();
        setCelebrate(true);
        toast(verifyRes.message || "Welcome to B² Membership!", "ok");
        return;
      }

      // 2. Open live Razorpay overlay
      const paymentResult = await openCheckout({
        keyId: orderRes.razorpay_key_id,
        orderId: orderRes.order_id,
        amountPaise: orderRes.amount_paise,
        eventTitle: "B² Club Monthly Membership (Early Bird)",
        userName: user.name,
        userEmail: user.email,
        contact: user.phone,
      });

      // 3. Verify signature on backend
      const verifyRes = await api.verifyMembershipPayment({
        razorpay_order_id: paymentResult.razorpay_order_id,
        razorpay_payment_id: paymentResult.razorpay_payment_id,
        razorpay_signature: paymentResult.razorpay_signature,
      });

      await refreshUser();
      setCelebrate(true);
      toast(verifyRes.message || "Membership activated! You now have free entry to all runs.", "ok");
    } catch (err: any) {
      if (err?.name === "CheckoutDismissed") {
        toast("Payment cancelled. You can activate your membership anytime.", "info");
      } else {
        toast(err?.message || "Could not complete membership payment", "err");
      }
    } finally {
      setBusy(false);
    }
  };

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

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
              {/* Left Column: Heading, Perks, Details */}
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gold shadow-sm">
                  <span className="inline-block size-1.5 rounded-full bg-gold animate-pulse" />
                  Early Bird Offer · Limited Slots
                </div>

                <h2 className="display mt-3 text-2xl font-bold sm:text-3xl lg:text-4xl text-ink tracking-tight">
                  B² Club Monthly Membership
                </h2>

                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  Unlock the full B² experience. Train with the community, race harder, and never pay per event again.
                </p>

                {/* Pricing Display */}
                <div className="mt-5 flex items-baseline gap-2.5">
                  <span className="text-xl sm:text-2xl font-medium text-ink-3 line-through">
                    ₹699
                  </span>
                  <span className="display text-4xl sm:text-5xl font-extrabold text-gold tracking-tight">
                    ₹1
                  </span>
                  <span className="text-[14px] font-semibold text-ink-2">/ month (test)</span>
                </div>
              </div>

              {/* Right Column: CTA Box / Active Member Status */}
              <div className="lg:min-w-[280px] flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-surface-3/80 p-6 text-center backdrop-blur-sm">
                {isMembershipActive ? (
                  <div className="space-y-3 w-full">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold">
                      ★ Active B² Member
                    </div>
                    <p className="text-sm text-ink-2 font-medium">
                      Your Early Bird membership is active.
                    </p>
                    {user?.membership_expires_at && (
                      <p className="text-xs text-ink-3">
                        Valid until {fullDate(user.membership_expires_at)}
                      </p>
                    )}
                    <Link
                      to="/events"
                      className="mt-2 block w-full rounded-xl bg-gold px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wider text-[color:var(--color-gold-ink)] transition-transform hover:scale-[1.02]"
                    >
                      Browse Free Runs →
                    </Link>
                  </div>
                ) : (
                  <div className="w-full">
                    <Button
                      variant="gold"
                      size="lg"
                      className="w-full justify-center text-sm font-bold shadow-lg shadow-gold/20"
                      onClick={handleJoin}
                      loading={busy}
                    >
                      {busy ? "Processing..." : "Get Early Bird Membership — ₹1"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      </section>
    </>
  );
}

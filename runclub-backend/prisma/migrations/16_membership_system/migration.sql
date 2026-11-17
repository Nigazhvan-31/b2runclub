-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "membership_status" TEXT DEFAULT 'INACTIVE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "membership_tier" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "membership_expires_at" TIMESTAMP(3);

-- CreateTable MembershipPayment
CREATE TABLE IF NOT EXISTS "MembershipPayment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'MONTHLY_EARLY_BIRD',
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MembershipPayment_user_id_idx" ON "MembershipPayment"("user_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'MembershipPayment_user_id_fkey'
    ) THEN
        ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Stripe Connect columns on creator_profiles
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT FALSE;

-- Payout-tracking columns on user_library
ALTER TABLE user_library
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS creator_paid_out BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS creator_amount_cents INTEGER;

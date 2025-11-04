-- X402 User Wallet Signing Mode Migration
-- Created: 2025-11-05
-- Author: AABC Labs
-- Description: Add user wallet signing mode support for X402 payments

BEGIN;

-- ============================================================================
-- 1. Add user wallet mode fields to x402_payments table
-- ============================================================================

-- Add payment_mode column (custodial or user_wallet)
ALTER TABLE x402_payments
ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'custodial'
CHECK (payment_mode IN ('custodial', 'user_wallet'));

-- Add user_wallet_address for user wallet signing mode
ALTER TABLE x402_payments
ADD COLUMN IF NOT EXISTS user_wallet_address VARCHAR(64);

-- Add unsigned_transaction for storing base64 encoded unsigned transaction
ALTER TABLE x402_payments
ADD COLUMN IF NOT EXISTS unsigned_transaction TEXT;

-- Add expires_at for transaction expiration tracking
ALTER TABLE x402_payments
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ============================================================================
-- 2. Update status CHECK constraint to support new statuses
-- ============================================================================

-- Drop existing constraint
ALTER TABLE x402_payments
DROP CONSTRAINT IF EXISTS x402_payments_status_check;

-- Add new constraint with additional statuses
ALTER TABLE x402_payments
ADD CONSTRAINT x402_payments_status_check
CHECK (status IN (
  'pending',           -- Initial state
  'pending_signature', -- Waiting for user wallet signature (user_wallet mode)
  'processing',        -- Transaction being processed
  'confirmed',         -- Transaction confirmed on blockchain
  'failed',            -- Transaction failed
  'cancelled',         -- Payment cancelled by user
  'expired'            -- Payment expired (blockhash expired)
));

-- ============================================================================
-- 3. Add indexes for new fields
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_x402_payments_payment_mode
ON x402_payments(payment_mode);

CREATE INDEX IF NOT EXISTS idx_x402_payments_user_wallet
ON x402_payments(user_wallet_address);

CREATE INDEX IF NOT EXISTS idx_x402_payments_expires_at
ON x402_payments(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- 4. Add comments for new fields
-- ============================================================================

COMMENT ON COLUMN x402_payments.payment_mode IS
'Payment execution mode: custodial (backend signs) or user_wallet (user signs with Phantom/Solflare)';

COMMENT ON COLUMN x402_payments.user_wallet_address IS
'User wallet address for user_wallet payment mode';

COMMENT ON COLUMN x402_payments.unsigned_transaction IS
'Base64 encoded unsigned transaction for user wallet signing';

COMMENT ON COLUMN x402_payments.expires_at IS
'Transaction expiration time (blockhash expiration for Solana)';

-- ============================================================================
-- 5. Update existing records to have default payment_mode
-- ============================================================================

-- Set existing records to custodial mode
UPDATE x402_payments
SET payment_mode = 'custodial'
WHERE payment_mode IS NULL;

COMMIT;

-- ============================================================================
-- Migration completed
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'X402 User Wallet Mode Migration completed successfully!';
  RAISE NOTICE '  - Added payment_mode field (custodial/user_wallet)';
  RAISE NOTICE '  - Added user_wallet_address field';
  RAISE NOTICE '  - Added unsigned_transaction field';
  RAISE NOTICE '  - Added expires_at field';
  RAISE NOTICE '  - Updated status constraint (added pending_signature, expired)';
  RAISE NOTICE '  - Added indexes for new fields';
END $$;

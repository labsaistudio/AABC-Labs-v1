-- Fix agent_reputation table creation
-- Date: 2025-10-29
-- Description: Create agent_reputation table separately (fix UNIQUE constraint syntax)

BEGIN;

-- ============================================================================
-- Create agent_reputation table - Agent Reputation System
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_reputation (
  -- Primary key
  reputation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Agent information
  agent_id UUID NOT NULL UNIQUE REFERENCES agents(agent_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Reputation score (0-1000)
  reputation_score INTEGER DEFAULT 500 CHECK (reputation_score >= 0 AND reputation_score <= 1000),

  -- Transaction statistics
  total_transactions INTEGER DEFAULT 0,
  successful_transactions INTEGER DEFAULT 0,
  failed_transactions INTEGER DEFAULT 0,

  -- Amount statistics (USDC)
  total_volume DECIMAL(18, 9) DEFAULT 0,
  total_earned DECIMAL(18, 9) DEFAULT 0,
  total_spent DECIMAL(18, 9) DEFAULT 0,

  -- User ratings
  user_rating_count INTEGER DEFAULT 0,
  user_rating_average DECIMAL(3, 2) DEFAULT 0 CHECK (user_rating_average >= 0 AND user_rating_average <= 5),

  -- Trust level
  trust_level VARCHAR(20) DEFAULT 'bronze'
    CHECK (trust_level IN ('bronze', 'silver', 'gold', 'platinum')),

  -- Blacklist flag
  is_blacklisted BOOLEAN DEFAULT FALSE,
  blacklist_reason TEXT,

  -- NFT identity (optional)
  nft_mint_address VARCHAR(44),
  nft_metadata_uri TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_transaction_at TIMESTAMPTZ
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agent_reputation_agent ON agent_reputation(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_reputation_user ON agent_reputation(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_reputation_score ON agent_reputation(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_agent_reputation_trust ON agent_reputation(trust_level);

-- Enable RLS
ALTER TABLE agent_reputation ENABLE ROW LEVEL SECURITY;

-- RLS policies: Anyone can view reputation
DROP POLICY IF EXISTS "Anyone can view reputation" ON agent_reputation;
CREATE POLICY "Anyone can view reputation" ON agent_reputation
  FOR SELECT USING (TRUE);

-- Only system can update reputation (via triggers)
DROP POLICY IF EXISTS "System can update reputation" ON agent_reputation;
CREATE POLICY "System can update reputation" ON agent_reputation
  FOR UPDATE USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Users can create reputation for their agents" ON agent_reputation;
CREATE POLICY "Users can create reputation for their agents" ON agent_reputation
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE agent_reputation IS 'Agent reputation system, records Agent transaction history and credit scores';
COMMENT ON COLUMN agent_reputation.reputation_score IS 'Reputation score 0-1000, initial value 500';
COMMENT ON COLUMN agent_reputation.trust_level IS 'bronze: 0-400 points, silver: 401-700 points, gold: 701-900 points, platinum: 901-1000 points';

-- Grant permissions
GRANT SELECT ON agent_reputation TO authenticated;

COMMIT;

-- Output success message
DO $$
BEGIN
  RAISE NOTICE '✅ agent_reputation table created!';
END $$;

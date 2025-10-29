-- X402 Integration Migration
-- Created: 2025-10-29
-- Author: AABC Labs
-- Description: Add X402 payment protocol support including payment records, service registration, and agent reputation system

BEGIN;

-- ============================================================================
-- 1. Create x402_payments table - X402 Payment Records
-- ============================================================================

CREATE TABLE IF NOT EXISTS x402_payments (
  -- Primary key
  payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User and Agent associations
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(agent_id) ON DELETE SET NULL,
  thread_id UUID REFERENCES threads(thread_id) ON DELETE CASCADE,

  -- Payment direction (outgoing: Agent pays for service, incoming: User pays Agent)
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('outgoing', 'incoming')),

  -- Service information
  service_url TEXT,
  service_name VARCHAR(200),
  service_description TEXT,

  -- Payment amount and token
  amount DECIMAL(18, 9) NOT NULL CHECK (amount > 0),
  token VARCHAR(10) NOT NULL DEFAULT 'USDC',

  -- Solana transaction information
  tx_signature VARCHAR(88) UNIQUE,
  blockchain VARCHAR(20) DEFAULT 'solana',
  from_address VARCHAR(44) NOT NULL,
  to_address VARCHAR(44) NOT NULL,

  -- Payment status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'confirmed', 'failed', 'cancelled')),

  -- Verification information
  verified_at TIMESTAMPTZ,
  verification_attempts INTEGER DEFAULT 0,

  -- Error information
  error_message TEXT,

  -- Metadata
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_x402_payments_user ON x402_payments(user_id);
CREATE INDEX idx_x402_payments_agent ON x402_payments(agent_id);
CREATE INDEX idx_x402_payments_thread ON x402_payments(thread_id);
CREATE INDEX idx_x402_payments_status ON x402_payments(status);
CREATE INDEX idx_x402_payments_direction ON x402_payments(direction);
CREATE INDEX idx_x402_payments_tx ON x402_payments(tx_signature);
CREATE INDEX idx_x402_payments_created ON x402_payments(created_at DESC);
CREATE INDEX idx_x402_payments_user_created ON x402_payments(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE x402_payments ENABLE ROW LEVEL SECURITY;

-- RLS policies: Users can only view their own payment records
CREATE POLICY "Users can view their own payments" ON x402_payments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own payments" ON x402_payments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own payments" ON x402_payments
  FOR UPDATE USING (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE x402_payments IS 'X402 payment records table, stores all payments made through X402 protocol';
COMMENT ON COLUMN x402_payments.direction IS 'outgoing: Agent pays for external service, incoming: User pays Agent';
COMMENT ON COLUMN x402_payments.amount IS 'Payment amount, 9 decimal places precision';
COMMENT ON COLUMN x402_payments.tx_signature IS 'Solana transaction signature, 88 character Base58 encoding';

-- ============================================================================
-- 2. Create x402_services table - X402 Service Registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS x402_services (
  -- Primary key
  service_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Service provider
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(agent_id) ON DELETE CASCADE,

  -- Service information
  service_name VARCHAR(100) NOT NULL,
  service_description TEXT,
  service_category VARCHAR(50),
  service_url TEXT NOT NULL,

  -- Pricing
  price DECIMAL(18, 9) NOT NULL CHECK (price >= 0),
  price_token VARCHAR(10) DEFAULT 'USDC',
  pricing_model VARCHAR(20) DEFAULT 'per_call'
    CHECK (pricing_model IN ('per_call', 'per_minute', 'per_mb', 'fixed')),

  -- Wallet address for receiving payments
  payment_address VARCHAR(44) NOT NULL,

  -- Statistics
  total_calls INTEGER DEFAULT 0,
  successful_calls INTEGER DEFAULT 0,
  failed_calls INTEGER DEFAULT 0,
  total_revenue DECIMAL(18, 9) DEFAULT 0,

  -- Service limits
  rate_limit INTEGER DEFAULT 100, -- Requests per minute
  max_concurrent INTEGER DEFAULT 10,

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  is_verified BOOLEAN DEFAULT FALSE,

  -- Metadata
  metadata JSONB,
  tags TEXT[],

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Create indexes
CREATE INDEX idx_x402_services_provider ON x402_services(provider_id);
CREATE INDEX idx_x402_services_agent ON x402_services(agent_id);
CREATE INDEX idx_x402_services_active ON x402_services(is_active);
CREATE INDEX idx_x402_services_category ON x402_services(service_category);
CREATE INDEX idx_x402_services_tags ON x402_services USING GIN(tags);
CREATE INDEX idx_x402_services_category_active ON x402_services(service_category, is_active)
  WHERE is_active = TRUE;

-- Enable RLS
ALTER TABLE x402_services ENABLE ROW LEVEL SECURITY;

-- RLS policies: Anyone can view active services
CREATE POLICY "Anyone can view active services" ON x402_services
  FOR SELECT USING (is_active = TRUE);

-- Providers can manage their own services
CREATE POLICY "Providers can manage their own services" ON x402_services
  FOR ALL USING (auth.uid() = provider_id);

-- Add comments
COMMENT ON TABLE x402_services IS 'X402 service registry, Agents can register and provide paid services';
COMMENT ON COLUMN x402_services.pricing_model IS 'per_call: 每次调用, per_minute: 按分钟, per_mb: 按数据量, fixed: 固Pricing格';
COMMENT ON COLUMN x402_services.payment_address IS 'Solana wallet address for receiving payments';

-- ============================================================================
-- 3. Create agent_reputation table - Agent Reputation System
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
CREATE INDEX idx_agent_reputation_agent ON agent_reputation(agent_id);
CREATE INDEX idx_agent_reputation_user ON agent_reputation(user_id);
CREATE INDEX idx_agent_reputation_score ON agent_reputation(reputation_score DESC);
CREATE INDEX idx_agent_reputation_trust ON agent_reputation(trust_level);

-- Enable RLS
ALTER TABLE agent_reputation ENABLE ROW LEVEL SECURITY;

-- RLS policies: Anyone can view reputation
CREATE POLICY "Anyone can view reputation" ON agent_reputation
  FOR SELECT USING (TRUE);

-- Only system can update reputation (via triggers)
CREATE POLICY "System can update reputation" ON agent_reputation
  FOR UPDATE USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can create reputation for their agents" ON agent_reputation
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE agent_reputation IS 'Agent reputation system, records Agent transaction history and credit scores';
COMMENT ON COLUMN agent_reputation.reputation_score IS 'Reputation score 0-1000, initial value 500';
COMMENT ON COLUMN agent_reputation.trust_level IS 'bronze: 0-400 points, silver: 401-700 points, gold: 701-900 points, platinum: 901-1000 points';

-- ============================================================================
-- 4. Create helper functions and triggers
-- ============================================================================

-- 4.1 Function to update updated_at field (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4.2 Create trigger for x402_payments
DROP TRIGGER IF EXISTS update_x402_payments_updated_at ON x402_payments;
CREATE TRIGGER update_x402_payments_updated_at
  BEFORE UPDATE ON x402_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4.3 Create trigger for x402_services
DROP TRIGGER IF EXISTS update_x402_services_updated_at ON x402_services;
CREATE TRIGGER update_x402_services_updated_at
  BEFORE UPDATE ON x402_services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4.4 Create trigger for agent_reputation
DROP TRIGGER IF EXISTS update_agent_reputation_updated_at ON agent_reputation;
CREATE TRIGGER update_agent_reputation_updated_at
  BEFORE UPDATE ON agent_reputation
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4.5 Create function: Automatically update Agent reputation when payment is confirmed
CREATE OR REPLACE FUNCTION update_agent_reputation_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only process confirmed payments
  IF NEW.status = 'confirmed' AND (OLD.status IS NULL OR OLD.status != 'confirmed') THEN
    -- Update reputation statistics
    UPDATE agent_reputation
    SET
      total_transactions = total_transactions + 1,
      successful_transactions = successful_transactions + 1,
      total_volume = total_volume + NEW.amount,
      total_earned = CASE
        WHEN NEW.direction = 'incoming' THEN total_earned + NEW.amount
        ELSE total_earned
      END,
      total_spent = CASE
        WHEN NEW.direction = 'outgoing' THEN total_spent + NEW.amount
        ELSE total_spent
      END,
      last_transaction_at = NOW(),
      updated_at = NOW()
    WHERE agent_id = NEW.agent_id;

    -- Create reputation record if it does not exist for Agent
    IF NOT FOUND AND NEW.agent_id IS NOT NULL THEN
      INSERT INTO agent_reputation (agent_id, user_id, total_transactions, successful_transactions, total_volume)
      SELECT NEW.agent_id, NEW.user_id, 1, 1, NEW.amount
      WHERE NOT EXISTS (SELECT 1 FROM agent_reputation WHERE agent_id = NEW.agent_id);
    END IF;

  -- Handle failed payments
  ELSIF NEW.status = 'failed' AND (OLD.status IS NULL OR OLD.status != 'failed') THEN
    UPDATE agent_reputation
    SET
      total_transactions = total_transactions + 1,
      failed_transactions = failed_transactions + 1,
      updated_at = NOW()
    WHERE agent_id = NEW.agent_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.6 Create trigger
DROP TRIGGER IF EXISTS trigger_update_agent_reputation_on_payment ON x402_payments;
CREATE TRIGGER trigger_update_agent_reputation_on_payment
  AFTER INSERT OR UPDATE ON x402_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_reputation_on_payment();

-- 4.7 Create function: Calculate reputation score
CREATE OR REPLACE FUNCTION calculate_reputation_score(p_agent_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER;
  v_total_tx INTEGER;
  v_success_rate DECIMAL;
  v_volume DECIMAL;
  v_user_rating DECIMAL;
BEGIN
  -- 获取Statistics
  SELECT
    total_transactions,
    CASE WHEN total_transactions > 0 THEN
      successful_transactions::DECIMAL / total_transactions
    ELSE 0 END,
    total_volume,
    user_rating_average
  INTO v_total_tx, v_success_rate, v_volume, v_user_rating
  FROM agent_reputation
  WHERE agent_id = p_agent_id;

  -- Return default score if no record
  IF v_total_tx IS NULL THEN
    RETURN 500;
  END IF;

  -- Calculate score (total 1000 points)
  v_score :=
    -- Transaction count (max 400 points)
    LEAST(v_total_tx, 400) +
    -- Success rate (max 300 points)
    ROUND(v_success_rate * 300) +
    -- Transaction amount (max 200 points)
    LEAST(ROUND(v_volume / 10), 200) +
    -- User ratings (最多 100 分)
    ROUND((v_user_rating / 5) * 100);

  RETURN LEAST(v_score, 1000);
END;
$$ LANGUAGE plpgsql;

-- 4.8 创建函数: 更新Trust level
CREATE OR REPLACE FUNCTION update_trust_level()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate new reputation score
  NEW.reputation_score := calculate_reputation_score(NEW.agent_id);

  -- 根据分数更新Trust level
  IF NEW.reputation_score >= 901 THEN
    NEW.trust_level := 'platinum';
  ELSIF NEW.reputation_score >= 701 THEN
    NEW.trust_level := 'gold';
  ELSIF NEW.reputation_score >= 401 THEN
    NEW.trust_level := 'silver';
  ELSE
    NEW.trust_level := 'bronze';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4.9 Create trigger：更新声誉时自动计算等级
DROP TRIGGER IF EXISTS trigger_update_trust_level ON agent_reputation;
CREATE TRIGGER trigger_update_trust_level
  BEFORE UPDATE ON agent_reputation
  FOR EACH ROW
  EXECUTE FUNCTION update_trust_level();

-- ============================================================================
-- 5. Create views
-- ============================================================================

-- 5.1 Service statistics view
CREATE OR REPLACE VIEW x402_service_stats AS
SELECT
  s.service_id,
  s.service_name,
  s.service_category,
  s.provider_id,
  s.price,
  s.price_token,
  s.total_calls,
  s.successful_calls,
  s.failed_calls,
  s.total_revenue,
  CASE
    WHEN s.total_calls > 0 THEN
      ROUND((s.successful_calls::DECIMAL / s.total_calls) * 100, 2)
    ELSE 0
  END as success_rate_percent,
  ar.reputation_score,
  ar.trust_level,
  s.is_active,
  s.created_at,
  s.last_used_at
FROM x402_services s
LEFT JOIN agent_reputation ar ON s.agent_id = ar.agent_id
WHERE s.is_active = TRUE;

COMMENT ON VIEW x402_service_stats IS 'X402 Service statistics view，包含成功率和声誉信息';

-- 5.2 User payment statistics view
CREATE OR REPLACE VIEW x402_user_payment_stats AS
SELECT
  user_id,
  COUNT(*) as total_payments,
  COUNT(*) FILTER (WHERE status = 'confirmed') as successful_payments,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_payments,
  SUM(amount) FILTER (WHERE status = 'confirmed' AND direction = 'outgoing') as total_spent,
  SUM(amount) FILTER (WHERE status = 'confirmed' AND direction = 'incoming') as total_earned,
  MAX(created_at) as last_payment_at
FROM x402_payments
GROUP BY user_id;

COMMENT ON VIEW x402_user_payment_stats IS 'User payment statistics view';

-- ============================================================================
-- 6. Grant permissions
-- ============================================================================

-- Allow authenticated users to access tables
GRANT SELECT, INSERT, UPDATE ON x402_payments TO authenticated;
GRANT SELECT ON x402_services TO authenticated;
GRANT INSERT, UPDATE ON x402_services TO authenticated;
GRANT SELECT ON agent_reputation TO authenticated;

-- Allow authenticated users to access views
GRANT SELECT ON x402_service_stats TO authenticated;
GRANT SELECT ON x402_user_payment_stats TO authenticated;

-- ============================================================================
-- 7. Insert test data (development only)
-- ============================================================================

-- Note: This section should be removed in production

-- Example: Create a test service (if needed)
-- INSERT INTO x402_services (provider_id, service_name, service_description, service_url, price, payment_address)
-- VALUES (
--   (SELECT id FROM auth.users LIMIT 1),
--   'Test AI Analysis Service',
--   'Provides AI-powered cryptocurrency analysis',
--   'https://api.example.com/analyze',
--   0.1,
--   '11111111111111111111111111111111'
-- );

COMMIT;

-- ============================================================================
-- Migration completed
-- ============================================================================

-- Output success message
DO $$
BEGIN
  RAISE NOTICE '✅ X402 Integration Migration completed！';
  RAISE NOTICE '   - x402_payments table created';
  RAISE NOTICE '   - x402_services table created';
  RAISE NOTICE '   - agent_reputation table created';
  RAISE NOTICE '   - All indexes, triggers, and functions created';
  RAISE NOTICE '   - RLS policies enabled';
END $$;

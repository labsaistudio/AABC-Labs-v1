# X402 Payment Protocol Implementation

## Overview

This repository contains the complete implementation of the **X402 Payment Protocol** - an HTTP 402-based blockchain micropayment system that enables AI Agents to autonomously pay for resources using Solana USDC.

### What is X402?

X402 is an extension of the HTTP 402 "Payment Required" status code that integrates blockchain payments into the request/response cycle. It allows:

- **Users** to pay for premium AI capabilities via wallet (Route-level 402)
- **AI Agents** to autonomously pay for third-party resources (Agent-level 402)
- **Service Providers** to monetize APIs with micropayments (sub-cent transactions)

### Key Features

✅ **Full Protocol Implementation** - Complete X402 v1.0 specification
✅ **Dual Payment Flows** - User wallet payment & Agent autonomous payment
✅ **Local-first Verification** - On-chain fallback when Facilitator unavailable
✅ **Real Blockchain Transactions** - All payments verified on Solana mainnet
✅ **Third-party Interoperability** - Works with any X402-compliant service

---

## Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        X402 PROTOCOL STACK                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────┐          ┌──────────────┐          ┌─────────────┐
│   USER      │          │  AI AGENT    │          │  SERVICE    │
│  (Phantom   │          │ (with wallet)│          │  PROVIDER   │
│   Wallet)   │          │              │          │  (X402 API) │
└──────┬──────┘          └──────┬───────┘          └──────┬──────┘
       │                        │                         │
       │ 1. Select capability   │                         │
       │ ────────────────────>  │                         │
       │                        │                         │
       │                        │ 2. Request resource     │
       │                        │ ──────────────────────> │
       │                        │                         │
       │                        │ 3. 402 Payment Required │
       │                        │ <────────────────────── │
       │                        │                         │
       │ 4. Wallet signature    │                         │
       │ <────────────────────  │                         │
       │                        │                         │
       │                        │ 5. USDC transfer        │
       │                        │ ──────────────────────> │
       │                        │    (Solana blockchain)  │
       │                        │                         │
       │                        │ 6. Verify on-chain      │
       │                        │ <────────────────────── │
       │                        │                         │
       │                        │ 7. Access granted       │
       │                        │ <────────────────────── │
       │                        │                         │
       │ 8. Navigate to chat    │                         │
       │ <────────────────────  │                         │
       │                        │                         │
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐        ┌──────────────────┐              │
│  │  x402-client.ts  │        │ capability/      │              │
│  │  - User payment  │        │   web_search/    │              │
│  │  - USDC transfer │        │   - route.ts     │              │
│  │  - Wallet sign   │        │   (7 endpoints)  │              │
│  └──────────────────┘        └──────────────────┘              │
│                                                                  │
│  ┌──────────────────────────────────────────────┐              │
│  │           x402-verify.ts                      │              │
│  │  - Local chain verification                   │              │
│  │  - Facilitator fallback                       │              │
│  └──────────────────────────────────────────────┘              │
│                                                                  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            │ HTTP 402 Protocol
                            │
┌───────────────────────────┴──────────────────────────────────────┐
│                     X402 GATEWAY (Node.js)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐        ┌──────────────────┐              │
│  │   index.ts       │        │ x402-bridge.ts   │              │
│  │  - HTTP proxy    │◄──────►│ - Auto payment   │              │
│  │  - 402 detection │        │ - USDC signing   │              │
│  │  - Middleware    │        │ - Verification   │              │
│  └──────────────────┘        └──────────────────┘              │
│           │                          │                           │
│           │                          │                           │
└───────────┼──────────────────────────┼───────────────────────────┘
            │                          │
            │                          │
            ▼                          ▼
   ┌─────────────────┐        ┌─────────────────┐
   │  FACILITATOR    │        │  SOLANA CHAIN   │
   │  (PayAI Network)│        │  (USDC Mainnet) │
   │  - verify()     │        │  - Transactions │
   │  - settle()     │        │  - Confirmation │
   └─────────────────┘        └─────────────────┘
```

---

## File Structure

```
aabc-agent-open-source-v3/
├── frontend/
│   └── src/
│       ├── lib/
│       │   └── x402-client.ts              # User wallet payment client
│       ├── app/api/capabilities/
│       │   ├── x402-verify.ts              # Shared verification logic
│       │   └── web_search/
│       │       └── route.ts                # Example X402 endpoint
│       └── types/
│           └── window.d.ts                 # Phantom wallet types
│
├── gateway/
│   ├── src/
│   │   ├── index.ts                        # Main gateway server
│   │   └── x402-bridge.ts                  # X402 protocol bridge
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md                           # Gateway documentation
│
├── docs/
│   └── X402_Agent_Test_Prompts.md         # Testing scenarios
│
└── README.md                               # This file
```

---

## Payment Flows

### Flow 1: User Wallet Payment (Route-level 402)

**Scenario**: User selects premium AI capabilities (e.g., "Web Search") from shopping cart

1. **User Action**: Select capability and click "Start"
2. **Frontend**: Auto-connect Phantom wallet if needed
3. **Frontend**: POST to `/api/capabilities/web_search` without X-PAYMENT header
4. **Capability Endpoint**: Return 402 with payment requirements
5. **X402 Client**: Create USDC transfer transaction (e.g., $0.001)
6. **User Wallet**: Sign transaction
7. **X402 Client**: Broadcast to Solana, wait for confirmation
8. **X402 Client**: POST again with X-PAYMENT header (contains signature)
9. **Verification**:
   - Try Facilitator `/verify` endpoint first
   - If fails, fallback to local on-chain verification
10. **Capability Endpoint**: Return 200 with X-PAYMENT-RESPONSE
11. **Frontend**: Navigate user to chat interface

**Key Code**: `frontend/src/lib/x402-client.ts`

### Flow 2: AI Agent Autonomous Payment (Agent-level 402)

**Scenario**: AI Agent needs real-time data from third-party X402 API

1. **Agent Decision**: Determine need for external resource
2. **Gateway Proxy**: Agent calls resource URL via Gateway
3. **Gateway**: Receive 402 response from resource provider
4. **X402 Bridge**: Automatically create USDC transfer
5. **Gateway Wallet**: Sign and broadcast transaction (no user interaction)
6. **X402 Bridge**: Construct X-PAYMENT header with signature
7. **Gateway**: Retry request with X-PAYMENT header
8. **Resource Provider**: Verify payment and return data
9. **Gateway**: Forward data to Agent
10. **Agent**: Process data and continue task

**Key Code**: `gateway/src/x402-bridge.ts`

---

## X402 Protocol Specification

### 402 Response Format

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxAmountRequired": "1000",
      "resource": "https://api.example.com/data",
      "description": "Premium data access ($0.001)",
      "payTo": "FfaGnfD7SnaXWHjGBVXwB1ZspELrKwzi1uT79KDrbYgV",
      "extra": {
        "facilitator": "https://facilitator.payai.network",
        "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "recipientAta": "...",
        "decimals": 6,
        "priceUSD": "0.001"
      }
    }
  ]
}
```

### X-PAYMENT Header Format

```
X-PAYMENT: Base64(JSON({
  "signature": "2T7XU...TE7o",  // Solana transaction signature
  "payer": "ExV9U...",           // Payer wallet address
  "amount": "1000",              // Amount in micro-USDC
  "mint": "EPjFWdd...",          // USDC mint address
  "network": "solana-mainnet",
  "timestamp": 1699876543210
}))
```

### X-PAYMENT-RESPONSE Header Format

```
X-PAYMENT-RESPONSE: Base64(JSON({
  "settled": true,
  "settlementId": "settle_...",
  "timestamp": "2024-11-12T..."
}))
```

---

## Verification Modes

The system supports 4 verification modes (configurable via `X402_VERIFY_MODE` env var):

| Mode | Description | Use Case |
|------|-------------|----------|
| **local-first** | Try Facilitator, fallback to chain | Production (recommended) |
| **local-only** | Skip Facilitator, verify on-chain only | Development/testing |
| **facilitator-only** | Use Facilitator only, no fallback | High-trust environments |
| **dual** | Try both, require both to pass | Maximum security |

### Local On-Chain Verification

When Facilitator is unavailable (5xx errors), the system automatically verifies payments directly on Solana blockchain:

1. Fetch transaction details from RPC: `getTransaction(signature)`
2. Verify transaction is confirmed (no error)
3. Parse token balance changes (preTokenBalances vs postTokenBalances)
4. Confirm USDC transfer to Treasury wallet
5. Verify amount meets or exceeds requirement

**Code**: `frontend/src/app/api/capabilities/x402-verify.ts`

---

## Environment Variables

### Frontend (.env.local)

```bash
NEXT_PUBLIC_NETWORK=solana-mainnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
NEXT_PUBLIC_X402_TREASURY=FfaGnfD7SnaXWHjGBVXwB1ZspELrKwzi1uT79KDrbYgV
NEXT_PUBLIC_FACILITATOR=https://facilitator.payai.network
NEXT_PUBLIC_BASE_URL=https://app.aabc.app

# Verification mode
X402_VERIFY_MODE=local-first
```

### Gateway (.env)

```bash
AGENT_WALLET_PRIVATE_KEY=your_base58_private_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
TREASURY=FfaGnfD7SnaXWHjGBVXwB1ZspELrKwzi1uT79KDrbYgV
FACILITATOR=https://facilitator.payai.network
VERIFY_MODE=local-first
PAYLOAD_MODE=message+header-signature
```

---

## Quick Start

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Access dashboard at `http://localhost:3000/dashboard`

### Gateway Setup

```bash
cd gateway
npm install
cp .env.example .env
# Edit .env with your wallet private key
npm run dev
```

Gateway will run on `http://localhost:3001`

---

## Testing

### Test Scenario 1: User Wallet Payment

1. Navigate to Dashboard
2. Select "Web Search" from capability shopping cart
3. Click "Start"
4. Phantom wallet will popup
5. Approve USDC transfer ($0.001)
6. Wait for confirmation
7. Automatically navigate to chat interface

**Expected Output**:
- Toast notification: "Payment confirmed on Solana! ($0.001)"
- Solscan link displayed
- Chat shows "X402 Capabilities Unlocked" banner

### Test Scenario 2: AI Agent Autonomous Payment

**Prompt to Agent**:
```
Access PayAI Network X402 test service: https://x402.payai.network
Then access our market sentiment API: https://app.aabc.app/api/x402/mock/market-sentiment
Show me the payment signatures for both.
```

**Expected Output**:
```
🌐 Accessed https://x402.payai.network
✅ Payment Completed via X402 Protocol
💰 Amount: $0.001 USDC
🔗 Transaction: 2T7XU...TE7o
📊 View on Solscan: https://solscan.io/tx/2T7XU...TE7o

[Data from service...]

🌐 Accessed https://app.aabc.app/api/x402/mock/market-sentiment
✅ Payment Completed via X402 Protocol
💰 Amount: $0.001 USDC
🔗 Transaction: 5Kj9P...Qa2m
📊 View on Solscan: https://solscan.io/tx/5Kj9P...Qa2m

[Market sentiment data...]
```

### Test Scenario 3: Third-party Interoperability

**Browser Test** (using curl or DevTools):

```bash
# Step 1: Get 402 response
curl -X POST https://x402.payai.network \
  -H "Content-Type: application/json"

# Response: 402 Payment Required with payment requirements

# Step 2: Pay via Solana (manual or via agent)

# Step 3: Retry with X-PAYMENT header
curl -X POST https://x402.payai.network \
  -H "Content-Type: application/json" \
  -H "X-Payment: eyJzaWduYXR1cmUiOiIuLi4ifQ=="

# Response: 200 OK with data + X-PAYMENT-RESPONSE header
```

---

## Capability Endpoints

The system provides 7 X402-protected capability endpoints:

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/api/capabilities/web_search` | Internet search access | $0.001 |
| `/api/capabilities/browser_automation` | Browser automation | $0.001 |
| `/api/capabilities/computer_use` | Computer control | $0.001 |
| `/api/capabilities/deep_research` | Deep research | $0.001 |
| `/api/capabilities/file_operations` | File operations | $0.001 |
| `/api/capabilities/token_launch` | Token launch | $0.001 |
| `/api/capabilities/vision_analysis` | Vision analysis | $0.001 |

All endpoints follow the same pattern as `web_search/route.ts` (see example in codebase).

---

## Mock X402 APIs for Testing

The backend provides mock X402 APIs for agent testing:

- `/api/x402/mock/web-search` - Simulated web search results
- `/api/x402/mock/market-sentiment` - Market sentiment analysis

These endpoints return 402 responses and accept X-PAYMENT headers for testing the complete flow.

---

## Transaction Verification

All payments can be verified on Solana blockchain:

1. **Solscan Explorer**: `https://solscan.io/tx/{signature}`
2. **Solana RPC**: `getTransaction(signature)` method
3. **Local verification**: See `x402-verify.ts` implementation

Example transaction:
https://solscan.io/tx/2T7XUMicMzw6e45MiH9TWUUk2St6tjD8EznZ8oEqnfV5fCBu3WRHjLJqm79egqWYmKmySmYMCTXAbbTF5wRsTE7o

---

## Key Innovations

### 1. Local-first Verification
Unlike pure Facilitator-dependent systems, our implementation can verify payments directly on-chain, ensuring 100% uptime even when Facilitator services fail.

### 2. Dual Payment Flows
Supports both user-initiated wallet payments (Route-level 402) and AI agent autonomous payments (Agent-level 402) in a single system.

### 3. Cross-browser Wallet Support
Enhanced Phantom wallet integration with automatic connection, state verification, and cross-browser compatibility.

### 4. Protocol-first Design
Works with ANY X402-compliant service, not just our own APIs. Demonstrated with PayAI Network third-party integration.

---

## Security Considerations

### Payment Verification
- ✅ All transactions verified on Solana blockchain
- ✅ Amount and recipient address validation
- ✅ Signature cryptographic verification
- ✅ Timeout protection (maxTimeoutSeconds)

### Wallet Security
- ✅ User wallet never exposed to backend
- ✅ Private keys stay in browser extension
- ✅ Gateway wallet isolated from user funds
- ✅ No custodial risk

### Network Security
- ✅ HTTPS only for all endpoints
- ✅ CORS properly configured
- ✅ Rate limiting on payment endpoints
- ✅ Input validation on all requests

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Payment latency (wallet → confirmed) | ~3-5 seconds |
| Verification latency (Facilitator) | ~200ms |
| Verification latency (Local) | ~500ms |
| Transaction fee (Solana) | ~$0.00001 |
| Payment fee (USDC) | $0 (no protocol fee) |
| Gateway throughput | 100+ req/sec |

---

## Troubleshooting

### Issue: "WalletNotSelectedError"
**Solution**: Ensure Phantom wallet is connected before payment. The frontend will auto-connect, but user must approve.

### Issue: "502 Bad Gateway" on payment verification
**Solution**: Check `X402_VERIFY_MODE` is set to `local-first` to enable on-chain fallback.

### Issue: "Transaction not found on chain"
**Solution**: Wait 1-2 seconds after getting signature before verification. Solana needs time to propagate.

### Issue: Gateway wallet insufficient balance
**Solution**: Fund the Gateway wallet with USDC:
```bash
spl-transfer --from <your-wallet> --to <gateway-wallet> 10 --fund-recipient --token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

---

## Future Enhancements

- [ ] Multi-chain support (Base, Ethereum, Polygon)
- [ ] Batch payment optimization
- [ ] Payment channel integration (Lightning-style)
- [ ] Subscription-based pricing models
- [ ] Advanced payment routing
- [ ] Cross-service payment aggregation

---

## References

- **X402 Protocol Spec**: https://docs.payai.network/protocol
- **Solana RPC**: https://docs.solana.com/api/http
- **PayAI Facilitator**: https://facilitator.payai.network
- **USDC on Solana**: https://www.circle.com/en/usdc-multichain/solana

---

## License

MIT License - See LICENSE file for details

---

## Contributors

AABC Labs Team 

---

## Support

For questions or issues:
- GitHub Issues: https://github.com/aabclabs/aabc-agent-open-source-v3/issues
- Documentation: https://docs.aabc.app/x402

---

**Built with ❤️ using Solana, Next.js, and the X402 Protocol**

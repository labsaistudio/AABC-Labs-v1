# X402 Payment Gateway

Node.js service that handles X402 protocol payments for AABC Agent autonomous capability purchases.

## Architecture

```
Python Agent (backend/)
  → Node Gateway (x402-gateway/)
    → x402-solana SDK
      → Facilitator (verify/settle)
        → External Capability
```

## Protocol Compliance

This gateway ensures 100% X402 protocol compliance:

- ✅ Uses USDC SPL Token `transfer_checked` (NOT SOL)
- ✅ Atomic units (micro-USDC) in all amounts
- ✅ SDK-generated X-PAYMENT payloads
- ✅ Correct Facilitator request fields
- ✅ Proper X-PAYMENT-RESPONSE handling

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Generate agent wallet (if needed):
```bash
solana-keygen new --outfile agent-wallet.json
# Copy private key to .env as AGENT_PRIVATE_KEY
```

4. Fund agent wallet with devnet USDC:
```bash
# Get devnet SOL for fees
solana airdrop 1 <AGENT_PUBLIC_KEY> --url devnet

# Get devnet USDC (use Solana faucet or manual transfer)
```

## Development

```bash
npm run dev
```

Gateway runs on http://localhost:3001

## Production (Railway)

Deploy alongside Python backend on Railway:

1. Add Node.js buildpack
2. Set environment variables
3. Expose port 3001
4. Start command: `npm run build && npm start`

## API Endpoints

### POST /pay
Create and execute X402 payment for capability

Request:
```json
{
  "capabilityUrl": "https://capability.example/api/search",
  "maxAmountRequired": "1000",
  "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "payload": { "query": "example" }
}
```

Response:
```json
{
  "success": true,
  "result": { "searchResults": [...] },
  "paymentProof": "base64_payment_response_header"
}
```

### GET /health
Health check

## Testing

```bash
# Test gateway is running
curl http://localhost:3001/health

# Test payment (requires funded wallet)
curl -X POST http://localhost:3001/pay \
  -H "Content-Type: application/json" \
  -d '{
    "capabilityUrl": "http://localhost:3000/api/capabilities/web_search",
    "maxAmountRequired": "1000",
    "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "payload": { "query": "test" }
  }'
```

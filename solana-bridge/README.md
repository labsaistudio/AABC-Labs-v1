# Solana Bridge - Node.js API Server

> Blockchain API bridge for AABC Agent - Solana blockchain operations

## Overview

The Solana Bridge is a Node.js Express server that provides HTTP API endpoints for Solana blockchain operations. It acts as a bridge between the Python AI Agent and the Solana blockchain, enabling token operations, swaps, NFTs, and Blinks.

## Features

### 🪙 Token Operations
- Balance checking (SOL & SPL tokens)
- Token transfers
- Token information lookup
- Token metadata retrieval

### 🔄 DEX Integration
- **Jupiter Aggregator**: Best price token swaps
- **Raydium**: AMM pool operations
- **Meteora**: DLMM and liquidity pools
- **Orca**: Whirlpool integration

### 💰 DeFi Services
- Staking operations
- Liquidity provision
- Price feeds (Pyth Network)
- Risk analysis (Rugcheck)

### 🖼️ NFT Operations
- NFT minting
- NFT transfers
- Metadata upload (Pinata/IPFS)

### 🔗 Blinks (Blockchain Links)
- Create shareable blockchain action URLs
- Support for transfer, swap, stake, NFT actions
- One-click execution for recipients

## Architecture

```
solana-bridge/
├── index.js              # Main Express server
├── routes/               # API route handlers
│   ├── solana.js         # Solana wallet operations
│   ├── token.js          # Token operations
│   ├── defi.js           # DeFi operations
│   ├── blinks.js         # Blinks creation
│   ├── nft.js            # NFT operations
│   └── liquidity.js      # Liquidity operations
├── services/             # Business logic
│   ├── agentService.js   # Solana Agent Kit integration
│   ├── jupiterService.js # Jupiter swap service
│   ├── tokenService.js   # Token info service
│   ├── blinksService.js  # Blinks generation
│   ├── defiService.js    # DeFi operations
│   └── pinataHelper.js   # IPFS upload
└── package.json          # Dependencies
```

## API Endpoints

### Wallet Operations

```bash
# Get SOL balance
GET /solana/balance/:address

# Get all token balances
GET /solana/tokens/:address

# Transfer SOL
POST /solana/transfer
{
  "to": "RECIPIENT_ADDRESS",
  "amount": 1.5
}
```

### Token Operations

```bash
# Get token info
GET /token/info/:mintAddress

# Swap tokens
POST /token/swap
{
  "fromToken": "SOL",
  "toToken": "USDC",
  "amount": 1.0,
  "slippage": 1
}

# Deploy new token
POST /token/deploy
{
  "name": "My Token",
  "symbol": "MTK",
  "decimals": 9,
  "initialSupply": 1000000
}
```

### Blinks Operations

```bash
# Create transfer Blink
POST /blinks/create
{
  "type": "transfer",
  "token": "SOL",
  "amount": 0.1,
  "recipient": "ADDRESS"
}

# Create swap Blink
POST /blinks/create
{
  "type": "swap",
  "fromToken": "SOL",
  "toToken": "USDC",
  "amount": 1.0
}

# Execute Blink
POST /blinks/execute/:blinkId
{
  "signature": "TRANSACTION_SIGNATURE"
}
```

### DeFi Operations

```bash
# Stake SOL
POST /defi/stake
{
  "amount": 10.0,
  "validator": "VALIDATOR_ADDRESS"
}

# Add liquidity
POST /liquidity/add
{
  "pool": "SOL-USDC",
  "tokenA": { "mint": "SOL", "amount": 1.0 },
  "tokenB": { "mint": "USDC", "amount": 100 }
}
```

## Installation

### Prerequisites

```bash
Node.js 20+
npm or yarn
Solana wallet private key
```

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Edit .env with your configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_private_key
PORT=3001
```

### Environment Variables

```bash
# Required
SOLANA_RPC_URL         # Solana RPC endpoint
SOLANA_PRIVATE_KEY     # Agent wallet private key (base58)
PORT                   # Server port (default: 3001)

# Optional
HELIUS_API_KEY         # For enhanced RPC features
PINATA_JWT             # For NFT metadata upload
PINATA_GATEWAY         # Custom IPFS gateway
JUPITER_QUOTE_API      # Jupiter quote API endpoint
```

## Running

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

### Docker

```bash
# Build image
docker build -t solana-bridge .

# Run container
docker run -p 3001:3001 --env-file .env solana-bridge
```

## Integration with Python Agent

The Python Agent communicates with this bridge via HTTP:

```python
# Python Agent Tool
class SolanaSwapTool(BaseBlockchainTool):
    async def swap_tokens(self, from_token, to_token, amount):
        response = await self.http_client.post(
            f"{self.bridge_url}/token/swap",
            json={
                "fromToken": from_token,
                "toToken": to_token,
                "amount": amount
            }
        )
        return response.json()
```

## Key Dependencies

- `@solana/web3.js`: Solana JavaScript SDK
- `solana-agent-kit`: Agent-optimized Solana operations
- `@jup-ag/api`: Jupiter DEX integration
- `express`: HTTP server framework
- `axios`: HTTP client
- `bs58`: Base58 encoding/decoding

## Security Notes

⚠️ **Important Security Considerations:**

1. **Private Key Management**
   - Never commit `.env` files
   - Use environment variables in production
   - Rotate keys regularly

2. **API Authentication**
   - Implement authentication for production
   - Use API keys or JWT tokens
   - Rate limiting recommended

3. **Transaction Validation**
   - Always validate transaction parameters
   - Implement slippage protection
   - Set maximum transaction amounts

4. **Error Handling**
   - Never expose private keys in errors
   - Log security events
   - Implement proper error recovery

## Testing

```bash
# Test balance endpoint
curl http://localhost:3001/solana/balance/YOUR_WALLET_ADDRESS

# Test swap quote
curl -X POST http://localhost:3001/token/swap \
  -H "Content-Type: application/json" \
  -d '{
    "fromToken": "SOL",
    "toToken": "USDC",
    "amount": 0.1,
    "dryRun": true
  }'
```

## Troubleshooting

### Common Issues

1. **RPC Connection Errors**
   - Check `SOLANA_RPC_URL` is valid
   - Try using Helius or QuickNode RPC
   - Verify network connectivity

2. **Transaction Failures**
   - Ensure sufficient SOL for gas fees
   - Check slippage settings
   - Verify token addresses

3. **Private Key Issues**
   - Confirm key is in base58 format
   - Check key has proper permissions
   - Verify wallet has funds

## Contributing

See main [CONTRIBUTING.md](../CONTRIBUTING.md)

## License

MIT License - see [LICENSE](../LICENSE)

---

**Part of AABC Agent Open Source Project**

Built for COLOSSEUM Hackathon | Powered by Solana

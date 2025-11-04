<p align="center">
  <img src="./assets/banner.png" alt="AABC Labs" width="100%"/>
</p>

# AABC Agent - Blockchain AI Agent Framework

> Advanced AI agent framework with Solana blockchain integration

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Node.js 20+](https://img.shields.io/badge/node-20+-green.svg)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Blockchain-purple.svg)](https://solana.com/)

## Overview

AABC Agent is an advanced AI agent framework that combines intelligent automation with comprehensive Solana blockchain operations. Built on top of [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit), the framework provides both a Python-based AI agent system and a Node.js blockchain bridge for seamless Web3 integration.

## Core Blockchain Features

### Token Operations
- Deploy SPL tokens by Metaplex
- Transfer assets
- Balance checks
- Stake SOL
- Zk compressed Airdrop by Light Protocol and Helius
- Bridge tokens across chains using Wormhole

### NFTs on 3.Land
- Create your own collection
- NFT creation and automatic listing on 3.land
- List your NFT for sale in any SPL token
- NFT Management via Metaplex
  - Collection deployment
  - NFT minting
  - Metadata management
  - Royalty configuration

### DeFi Integration
- Jupiter Exchange swaps
- Launch on Pump via PumpPortal
- Raydium pool creation (CPMM, CLMM, AMMv4)
- Orca Whirlpool integration
- Manifest market creation and limit orders
- Meteora Dynamic AMM, DLMM Pool, and Alpha Vault
- Openbook market creation
- Register and Resolve SNS
- Jito Bundles
- Pyth Price feeds for fetching Asset Prices
- Register/resolve Alldomains
- Perpetuals Trading with Adrena Protocol
- Drift Vaults, Perps, Lending and Borrowing
- Cross-chain bridging via deBridge DLN
- Cross-chain bridging via Wormhole

### Solana Blinks
- Lending by Lulo (Best APR for USDC)
- Send Arcade Games
- JupSOL staking
- Solayer SOL (sSOL) staking

### Non-Financial Actions
- Gib Work for registering bounties

### X402 Payment Protocol Integration
- Autonomous HTTP 402 payment handling
- Detect and parse payment-required responses
- Execute payments on Solana blockchain
- Automatic payment proof submission
- Support for SOL and SPL token payments
- Integration with Agent payment workflow
- Test service for payment flow validation
- **User Wallet Signing Mode**: Users sign transactions with Phantom/Solflare
- **Recoverable Architecture**: Automatic retry on blockhash expiration
- **Post-mortem Verification**: Prevents false negatives after successful transactions
- **Dual Payment Modes**: Custodial (backend signs) or User Wallet (user signs)

### Market Data Integration
- CoinGecko Pro API integration
- Real-time token price data
- Trending tokens and pools
- Top gainers analysis
- Token information lookup
- Latest pool tracking

## AI Integration Features

### Autonomous Agent Capabilities
- Multi-step task execution
- Natural language command processing
- Tool-based architecture
- Context-aware decision making
- Parallel operation execution

### Crypto Research & Analysis
- Multi-source data aggregation
- Price analysis with technical indicators
- Social sentiment monitoring
- On-chain data analysis
- DeFi metrics tracking
- Risk assessment

## Architecture

### System Design

```
┌──────────────────────────────────────────────────────────────────┐
│                      Python AI Agent Layer                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Claude    │  │   Prompt     │  │  Tool Manager        │   │
│  │   Sonnet    │─▶│  Engineering │─▶│  & Orchestrator      │   │
│  └─────────────┘  └──────────────┘  └─────────┬────────────┘   │
│                                                │                 │
│  ┌──────────────────────────────────────────────┴────────────┐  │
│  │  Blockchain Tools  │  DeFi Tools  │  X402 Payment Tool   │  │
│  └──────────────────────────────────────────────┬────────────┘  │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │ HTTP/REST
                         ┌────────────────────────┴─────────────┐
                         │   X402 Gateway   │   Solana Bridge   │
                         └────────────────────────┬──────────────┘
                                                  │
                         ┌────────────────────────┴─────────────┐
                         │     Node.js Blockchain Bridge        │
                         │  ┌──────────────────────────────┐    │
                         │  │   Solana Agent Kit Service   │    │
                         │  └─────────────┬─────────────────┘   │
                         │  ┌─────────────┴─────────────────┐   │
                         │  │    Jupiter | Raydium | Orca   │   │
                         │  │  Meteora | Pyth | Rugcheck    │   │
                         │  └─────────────┬─────────────────┘   │
                         └────────────────┼─────────────────────┘
                                          │ Solana Web3.js
                         ┌────────────────┴─────────────────────┐
                         │         Solana Blockchain            │
                         │  Mainnet/Devnet/Testnet RPC Node     │
                         └──────────────────────────────────────┘
```

### Core Components

```
aabc-agent-open-source/
├── backend/
│   ├── agent/                     # Python AI Agent
│   │   ├── prompt.py              # System prompts and agent behavior
│   │   ├── run.py                 # Agent execution engine
│   │   ├── tools/                 # Tool implementations
│   │   │   ├── blockchain_tools/  # Solana blockchain tools
│   │   │   │   ├── solana_balance_tool.py
│   │   │   │   ├── solana_swap_tool.py
│   │   │   │   ├── solana_token_tool.py
│   │   │   │   ├── solana_transfer_tool.py
│   │   │   │   └── solana_blinks_tool.py
│   │   │   └── x402_tools/        # X402 payment tools
│   │   │       └── x402_payment.py
│   │   └── utils.py               # Utility functions
│   ├── blockchain/
│   │   ├── solana_bridge_client.py    # Python client for Solana bridge
│   │   └── solana-bridge/             # Node.js Blockchain Bridge
│   │       ├── index.js               # Express API server
│   │       ├── routes/                # API endpoints
│   │       │   ├── solana.js          # Wallet operations
│   │       │   ├── token.js           # Token operations
│   │       │   ├── defi.js            # DeFi operations
│   │       │   ├── blinks.js          # Blinks creation
│   │       │   └── nft.js             # NFT operations
│   │       └── services/              # Business logic
│   │           ├── agentService.js    # Solana Agent Kit integration
│   │           ├── jupiterService.js  # Jupiter DEX
│   │           ├── tokenService.js    # Token info
│   │           └── blinksService.js   # Blinks generation
│   ├── services/                      # Core services
│   │   ├── x402_gateway.py            # X402 payment gateway
│   │   └── x402_api.py                # X402 API routes
│   └── tests/                         # Test suite
│       ├── x402_test_service.py       # X402 test service
│       └── test_x402_gateway.py       # Gateway unit tests
└── blockchain_tools/                  # Standalone blockchain tools
```

## Quick Start

### Prerequisites

```bash
Python 3.11+
Node.js 20+
Solana CLI (optional)
```

### Installation

```bash
# Clone the repository
git clone https://github.com/labsaistudio/aabc-agent-open-source.git
cd aabc-agent-open-source

# Install Python dependencies (Agent)
pip install -r requirements.txt

# Install Node.js dependencies (Solana Bridge)
cd solana-bridge
npm install
cd ..

# Set up environment variables
cp .env.example .env
cp solana-bridge/.env.example solana-bridge/.env
# Edit .env files with your configuration
```

### Running the Services

```bash
# Terminal 1: Start Solana Bridge
cd solana-bridge
npm start
# Bridge running on http://localhost:3001

# Terminal 2: Start Agent
python -m agent.run
```

### Basic Usage

```python
from agent.run import AgentRunner
from agent.prompt import get_system_prompt

# Initialize agent
agent = AgentRunner(
    model="claude-sonnet-4",
    system_prompt=get_system_prompt()
)

# Execute a task
response = await agent.run(
    "Check my SOL balance"
)
```

## Configuration

### Environment Variables

#### Python Agent (.env)
```bash
# AI Model Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key
MODEL_NAME=claude-sonnet-4

# Blockchain Bridge
BLOCKCHAIN_BRIDGE_URL=http://localhost:3001
```

#### Solana Bridge (solana-bridge/.env)
```bash
# Required
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_PRIVATE_KEY=your_base58_private_key
PORT=3001

# Optional
HELIUS_API_KEY=your_helius_key
PINATA_JWT=your_pinata_jwt
COINGECKO_API_KEY=your_coingecko_key
```

## Blockchain Tools

### SolanaBalanceTool
Check SOL and SPL token balances.

```python
from blockchain_tools.solana_balance_tool import SolanaBalanceTool

tool = SolanaBalanceTool()
result = await tool.get_balance(wallet_address="YOUR_WALLET")
```

### SolanaSwapTool
Execute token swaps via Jupiter, Raydium, or Orca.

```python
from blockchain_tools.solana_swap_tool import SolanaSwapTool

tool = SolanaSwapTool()
result = await tool.swap_tokens(
    from_token="SOL",
    to_token="USDC",
    amount=1.0
)
```

### SolanaTokenTool
Get token information and metadata.

```python
from blockchain_tools.solana_token_tool import SolanaTokenTool

tool = SolanaTokenTool()
result = await tool.get_token_info(token_address="TOKEN_MINT")
```

### SolanaBinksTool
Create and execute blockchain action links.

```python
from blockchain_tools.solana_blinks_tool import SolanaBinksTool

tool = SolanaBinksTool()
result = await tool.create_blink(
    action="transfer",
    token="SOL",
    amount=0.1
)
```

## API Reference

See [Solana Bridge README](solana-bridge/README.md) for complete API documentation.

## Use Cases

### Token Operations
```python
# Check balance
agent.run("What's my SOL balance?")

# Transfer tokens
agent.run("Send 1 SOL to ADDRESS")

# Swap tokens
agent.run("Swap 1 SOL to USDC")
```

### NFT Operations
```python
# Create NFT collection
agent.run("Create an NFT collection named 'My Art'")

# Mint NFT
agent.run("Mint an NFT with image at path/to/image.png")
```

### DeFi Operations
```python
# Stake SOL
agent.run("Stake 10 SOL")

# Add liquidity
agent.run("Add liquidity to SOL-USDC pool")

# Launch token
agent.run("Launch a token named TEST on Pump.fun")
```

### X402 Payment Operations

#### User Wallet Signing Mode
```python
# 1. Prepare payment (creates unsigned transaction)
from backend.services.x402_api import prepare_payment

payment = await prepare_payment(
    service_url="https://api.example.com/service",
    amount=0.001,
    token="SOL",
    recipient_address="RECIPIENT_WALLET",
    user_wallet_address="USER_WALLET"
)
# Returns: payment_id, transaction_data, expires_at

# 2. User signs with wallet (frontend)
# signed_tx = await wallet.signTransaction(payment.transaction_data)

# 3. Submit signed transaction
from backend.services.x402_api import submit_signed_payment

result = await submit_signed_payment(
    payment_id=payment.payment_id,
    signed_transaction=signed_tx
)
# Returns: success, signature, confirmation

# Automatic retry on blockhash expiration (409 error)
# Frontend automatically refreshes transaction and requests re-signing
```

#### Custodial Mode (Backend Signs)
```python
# Agent automatically handles payment
agent.run("Pay 0.001 SOL to access https://api.example.com/service")
```

#### Key Features

**Recoverable Architecture**:
- Returns 409 (Conflict) for expired blockhash instead of 500 (Error)
- Automatically reverts payment status to `pending_signature`
- Frontend can retry with fresh blockhash (up to 2 times)
- No manual intervention required

**Post-mortem Verification**:
- After transaction broadcast, checks on-chain status before returning error
- Prevents false negatives when confirmation fails but transaction succeeds
- Uses `getSignatureStatus()` to verify actual on-chain state

**Defensive Programming**:
- Safe field access with multiple fallbacks
- Once transaction is confirmed, subsequent errors don't fail the flow
- Optional verification skipped if data is missing (not failed)

#### Database Migration

Run the user wallet mode migration:
```bash
# Apply migration to add user_wallet fields
psql -d your_database -f backend/supabase/migrations/20251105000000_x402_user_wallet_mode.sql
```

Adds:
- `payment_mode` (custodial/user_wallet)
- `user_wallet_address`
- `unsigned_transaction`
- `expires_at`
- New statuses: `pending_signature`, `expired`

## Development

### Project Structure
- `agent/` - Core AI agent implementation
- `solana-bridge/` - Blockchain API server
- `blockchain_tools/` - Reusable blockchain utilities

### Adding New Tools
1. Create tool file in `agent/tools/`
2. Implement tool interface
3. Register in `agent/run.py`
4. Add corresponding bridge endpoint if needed

## Testing

```bash
# Test Python agent
pytest tests/

# Test Solana Bridge
cd solana-bridge
npm test
```

## Security

- Never commit private keys or `.env` files
- Use environment variables for sensitive data
- Implement proper authentication in production
- Review transaction parameters before execution
- Set appropriate slippage limits for swaps

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
# Install development dependencies
pip install -r requirements-dev.txt
cd solana-bridge && npm install --save-dev

# Format code
black agent/
prettier --write "solana-bridge/**/*.js"
```

## Powered By

This project is built on top of excellent open-source projects:

- **[Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit)** - Core Solana blockchain integration
- **[Sendai Documentation](https://docs.sendai.fun/docs/v2/introduction)** - Comprehensive agent framework
- (https://github.com/solana-foundation/templates/tree/main/community/x402-template)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This software is provided for educational and research purposes. Cryptocurrency trading and blockchain operations involve significant risk. Always do your own research and never invest more than you can afford to lose.

---

**Built by AABC Labs**

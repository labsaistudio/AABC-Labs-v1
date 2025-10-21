# AABC Agent - Blockchain AI Agent Framework

> **The Ultimate Form of Blockchain AI Agents** - Open Source Edition

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Solana](https://img.shields.io/badge/Solana-Blockchain-purple.svg)](https://solana.com/)

## 🌟 Overview

AABC Agent is an advanced AI agent framework specialized in blockchain operations and cryptocurrency research. Built for the **COLOSSEUM Hackathon**, this framework combines cutting-edge AI capabilities with Solana blockchain integration to enable autonomous crypto trading, research, and DeFi operations.

## ✨ Key Features

### 🔗 Blockchain Integration
- **Solana Network Operations**
  - Token balance checking (SOL & SPL tokens)
  - Token transfers and swaps
  - Token deployment and management
  - Blinks (Blockchain Links) creation and execution

### 📊 Advanced Crypto Research
- **6-Source Parallel Analysis**
  - Price analysis with technical indicators (MA, RSI, MACD)
  - Social sentiment monitoring (Twitter/X, KOL opinions)
  - On-chain data analysis (Dune Analytics integration)
  - News aggregation (Delphi, Messari, CoinDesk)
  - DeFi metrics (DEX liquidity, TVL, Staking APY)
  - Technical analysis (support/resistance levels, chart patterns)

### 🤖 AI Agent Capabilities
- Multi-step task execution
- Tool-based architecture
- Extensible plugin system
- MCP (Model Context Protocol) support
- Custom workflow management

## 🚀 Quick Start

### Prerequisites

```bash
Python 3.11+
Node.js 20+ (for blockchain bridge)
```

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_ORG/aabc-agent-open-source.git
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

# Execute a crypto research task
response = await agent.run(
    "Analyze $SOL token investment potential"
)
```

## 📚 Architecture

### Core Components

```
aabc-agent-open-source/
├── agent/                     # Python AI Agent
│   ├── prompt.py              # System prompts and agent behavior
│   ├── run.py                 # Agent execution engine
│   ├── tools/                 # Tool implementations
│   │   └── blockchain_tools/  # Solana blockchain tools
│   │       ├── solana_balance_tool.py
│   │       ├── solana_swap_tool.py
│   │       ├── solana_token_tool.py
│   │       ├── solana_transfer_tool.py
│   │       └── solana_blinks_tool.py
│   └── utils.py               # Utility functions
├── solana-bridge/             # Node.js Blockchain Bridge
│   ├── index.js               # Express API server
│   ├── routes/                # API endpoints
│   │   ├── solana.js          # Wallet operations
│   │   ├── token.js           # Token operations
│   │   ├── defi.js            # DeFi operations
│   │   ├── blinks.js          # Blinks creation
│   │   └── nft.js             # NFT operations
│   └── services/              # Business logic
│       ├── agentService.js    # Solana Agent Kit
│       ├── jupiterService.js  # Jupiter DEX
│       ├── tokenService.js    # Token info
│       └── blinksService.js   # Blinks generation
└── blockchain_tools/          # Standalone blockchain tools
```

### Blockchain Tools

#### SolanaBalanceTool
Check SOL and SPL token balances on Solana blockchain.

```python
from blockchain_tools.solana_balance_tool import SolanaBalanceTool

tool = SolanaBalanceTool()
result = await tool.get_balance(wallet_address="YOUR_WALLET")
```

#### SolanaSwapTool
Execute token swaps on Solana DEXs (Jupiter, Raydium, Orca).

```python
from blockchain_tools.solana_swap_tool import SolanaSwapTool

tool = SolanaSwapTool()
result = await tool.swap_tokens(
    from_token="SOL",
    to_token="USDC",
    amount=1.0
)
```

#### SolanaTokenTool
Get detailed token information and metadata.

```python
from blockchain_tools.solana_token_tool import SolanaTokenTool

tool = SolanaTokenTool()
result = await tool.get_token_info(token_address="TOKEN_MINT")
```

## 🎯 Use Cases

### 1. Cryptocurrency Research
```python
# Automatic 6-source parallel analysis
agent.run("Analyze $WIF investment value")

# Output: Comprehensive report with:
# - Price trends and technical indicators
# - Social sentiment score (0-100)
# - On-chain metrics
# - Latest news and research
# - DeFi performance
# - Investment recommendations
```

### 2. Token Operations
```python
# Check balance
agent.run("What's my SOL balance?")

# Swap tokens
agent.run("Swap 1 SOL to USDC")

# Get token info
agent.run("Get information about $BONK token")
```

### 3. Blinks Creation
```python
# Create a Blink for token transfer
agent.run("Create a Blink to transfer 0.1 SOL to ADDRESS")

# Shareable URL for one-click blockchain action
```

## 🔧 Configuration

### Environment Variables

```bash
# .env.example

# Blockchain Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WALLET_PRIVATE_KEY=your_private_key

# AI Model Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key
MODEL_NAME=claude-sonnet-4

# Optional: Additional Data Sources
MESSARI_API_KEY=your_messari_key
DELPHI_API_KEY=your_delphi_key
```

## 🤝 Contributing

We welcome contributions! This project was created for the COLOSSEUM Hackathon and is now open source.

### Development Setup

```bash
# Install development dependencies
pip install -r requirements-dev.txt

# Run tests
pytest tests/

# Format code
black agent/
```

### Contribution Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📖 Documentation

- [Agent Architecture](docs/architecture.md)
- [Blockchain Tools API](docs/blockchain-tools.md)
- [Prompt Engineering Guide](docs/prompts.md)
- [MCP Integration](docs/mcp.md)

## 🏆 COLOSSEUM Hackathon

This project is part of our submission to the **COLOSSEUM Hackathon**.

**Key Innovations:**
- First AI agent with native Solana Blinks integration
- 6-source parallel cryptocurrency research framework
- Advanced prompt engineering for blockchain operations
- Extensible tool architecture for DeFi protocols

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Demo**: [app.aabc.app](https://app.aabc.app)
- **Documentation**: [docs.aabc.app](https://docs.aabc.app)
- **Twitter**: [@AABC_Labs](https://twitter.com/AABC_Labs)
- **Discord**: [Join our community](https://discord.gg/aabc)

## 🙏 Acknowledgments

- Built with [Anthropic Claude](https://anthropic.com)
- Powered by [Solana](https://solana.com)
- Integrated with [Jupiter](https://jup.ag), [Raydium](https://raydium.io), [Orca](https://orca.so)
- Research data from [Messari](https://messari.io), [Delphi Digital](https://delphidigital.io), [Dune Analytics](https://dune.com)

## ⚠️ Disclaimer

This software is provided for educational and research purposes only. Cryptocurrency trading involves significant risk. Always do your own research and never invest more than you can afford to lose.

---

**Built with ❤️ by AABC Labs for the COLOSSEUM Hackathon**

*The Ultimate Form of Blockchain AI Agents*

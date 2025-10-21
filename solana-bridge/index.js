import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { createLogger, format, transports } from 'winston';
import { solanaRoutes } from './routes/solana.js';
import { tokenRoutes } from './routes/token.js';
import { nftRoutes } from './routes/nft.js';
import { defiRoutes } from './routes/defi.js';
import { blinksRoutes } from './routes/blinks.js';
import { liquidityRoutes } from './routes/liquidity.js';
import { priceRoutes } from './routes/price.js';
import { riskRoutes } from './routes/risk.js';
import { uploadRoutes } from './routes/upload.js';
import { walletRoutes, initializeWalletBridge } from './routes/wallet.js';
import { AgentService } from './services/agentService.js';
import { TokenFallbackService } from './services/tokenFallbackService.js';
import { Connection } from '@solana/web3.js';

// Load environment variables
dotenv.config();

// Create logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'aabc-solana-bridge' },
  transports: [
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' }),
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    })
  ]
});

// Create Express app
const app = express();

// ✅ Special CORS for Blink endpoints - must allow all origins per Solana Actions spec
// NOTE: This MUST come BEFORE the general CORS middleware!
app.use('/api/blinks', cors({
  origin: '*',  // Allow all origins for Actions/Blinks
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));

app.use('/blinks', cors({
  origin: '*',  // Allow all origins for Actions/Blinks
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));

// General CORS middleware (for other routes)
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:8000', 'https://app.aabc.app', 'https://aabc.app'],
  credentials: true
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    body: req.body,
    query: req.query
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Network diagnostic endpoint
app.get('/debug/network', async (req, res) => {
  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };


  try {
    const dns = await import('dns');
    const addresses = await dns.promises.resolve('lite-api.jup.ag');
    results.tests.dns = { success: true, addresses, endpoint: 'lite-api.jup.ag' };
  } catch (error) {
    results.tests.dns = { success: false, error: error.message, endpoint: 'lite-api.jup.ag' };
  }

  // Test 2: Fetch to Jupiter Lite API (V1)
  try {
    const response = await fetch('https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50', {
      signal: AbortSignal.timeout(10000)
    });
    results.tests.jupiter = {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      endpoint: 'lite-api.jup.ag/swap/v1'
    };
    if (response.ok) {
      const data = await response.json();
      results.tests.jupiter.hasData = !!data.outAmount;
      results.tests.jupiter.outputAmount = data.outAmount;
      results.tests.jupiter.usdValue = data.swapUsdValue;
    }
  } catch (error) {
    results.tests.jupiter = {
      success: false,
      error: error.message,
      code: error.code,
      endpoint: 'lite-api.jup.ag/swap/v1'
    };
  }

  // Test 3: DexScreener (for Token Plugin)
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=USDC', {
      signal: AbortSignal.timeout(10000)
    });
    results.tests.dexscreener = {
      success: response.ok,
      status: response.status
    };
  } catch (error) {
    results.tests.dexscreener = { success: false, error: error.message };
  }

  // Test 4: TokenFallbackService
  try {
    const tokenFallback = new TokenFallbackService();
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    const testTokens = ['USDC', 'SOL', 'BONK'];
    const tokenResults = {};

    testTokens.forEach(symbol => {
      tokenResults[symbol] = tokenFallback.getTokenAddress(symbol, network);
    });

    results.tests.tokenFallback = {
      success: true,
      network,
      tokens: tokenResults,
      totalSupported: tokenFallback.getSupportedTokens(network).length
    };
  } catch (error) {
    results.tests.tokenFallback = { success: false, error: error.message };
  }

  res.json(results);
});

// Initialize connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  'confirmed'
);

// Initialize agent service (legacy support)
let agentService;
try {
  agentService = new AgentService({
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    network: process.env.SOLANA_NETWORK || 'devnet',
    privateKey: process.env.SOLANA_PRIVATE_KEY

  });
  await agentService.initialize();
  logger.info('Agent service initialized successfully (legacy mode)');
} catch (error) {
  logger.error('Failed to initialize agent service:', error);
  // Don't exit - embedded wallets can still work without legacy service
  logger.info('Continuing with embedded wallets only');
}

// Initialize wallet bridge for embedded wallets (new secure mode)
initializeWalletBridge(connection, app);
logger.info('Wallet bridge initialized for embedded wallets');

// Make services available to routes
app.locals.agentService = agentService;
app.locals.connection = connection;

// Actions endpoint - list all available actions
app.get('/api/actions', (req, res) => {
  try {
    const actions = agentService.listActions();
    res.json({
      success: true,
      actions,
      count: actions.length
    });
  } catch (error) {
    logger.error('Failed to list actions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list available actions'
    });
  }
});

// ========================================
// Solana Actions Configuration (Required for Blinks)
// ========================================

// actions.json - Required by Solana Actions spec
app.get('/actions.json', (req, res) => {
  const baseUrl = process.env.BLINKS_BASE_URL || 'https://solana-aabc.up.railway.app';

  res.json({
    rules: [
      {
        pathPattern: '/blinks/**',
        apiPath: '/blinks/**'
      },
      {
        pathPattern: '/api/blinks/**',
        apiPath: '/api/blinks/**'
      }
    ]
  });
});

// API Routes
app.use('/api/wallet', walletRoutes);  // New embedded wallets API
app.use('/api/solana', solanaRoutes);
app.use('/api/token', tokenRoutes);
app.use('/api/nft', nftRoutes);
app.use('/api/defi', defiRoutes);
app.use('/api/blinks', blinksRoutes);
app.use('/api/liquidity', liquidityRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/upload', uploadRoutes);

// Blink public routes (for wallets to access, no /api prefix)
// This allows URLs like https://domain.com/blinks/:blinkId
app.use('/blinks', blinksRoutes);

// Compatibility route for pump.fun - forward to defi routes
app.post('/api/launch/pumpfun', async (req, res) => {
  logger.info('Forwarding /api/launch/pumpfun to defi handler');

  // Get the defi router handler directly
  const { name, symbol, description, imageUrl, twitter, telegram, website } = req.body;

  if (!name || !symbol) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: name, symbol'
    });
  }

  try {
    const agentService = app.locals.agentService;

    // Try token plugin first
    const tokenPlugin = agentService.getPlugin('token');
    if (tokenPlugin && tokenPlugin.methods && tokenPlugin.methods.launchPumpFunToken) {
      try {
        const result = await tokenPlugin.methods.launchPumpFunToken({
          tokenName: name,
          tokenTicker: symbol,
          description: description || '',
          imageUrl: imageUrl || '',
          twitter: twitter || '',
          telegram: telegram || '',
          website: website || ''
        });
        return res.json(result);
      } catch (tokenError) {
        logger.warn('Token plugin failed, trying defi plugin:', tokenError.message);
      }
    }

    // Fallback to defi plugin
    const defiPlugin = agentService.getPlugin('defi');
    if (defiPlugin && defiPlugin.launchOnPumpFun) {
      const result = await defiPlugin.launchOnPumpFun({
        name,
        symbol,
        description,
        imageUrl,
        twitter,
        telegram,
        website
      });

      return res.json({
        success: true,
        ...result
      });
    }

    // No suitable plugin found
    return res.status(503).json({
      success: false,
      error: 'Pump.fun launch service not available - no compatible plugins loaded'
    });

  } catch (error) {
    logger.error('Pump.fun launch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info(`AABC Solana Bridge running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Network: ${process.env.SOLANA_NETWORK || 'devnet'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;

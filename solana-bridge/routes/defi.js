/**
 * DeFi Routes - Enhanced with Embedded Wallets support
 *
 * Provides comprehensive DeFi functionality through both:
 * 1. Traditional private key method (legacy support)
 * 2. New embedded wallets method (recommended)
 */

import { Router } from 'express';
import { DefiService } from '../services/defiService.js';
import { TokenFallbackService } from '../services/tokenFallbackService.js';

const router = Router();
const tokenFallback = new TokenFallbackService();

/**
 * Middleware to check for session (embedded wallets) or fallback to agent service
 */
function getAgentForRequest(req) {
  // First check for embedded wallet session
  const sessionId = req.headers['x-session-id'] || req.body.sessionId;

  if (sessionId && req.app.locals.walletBridge) {
    try {
      const session = req.app.locals.walletBridge.getSession(sessionId);
      if (session && session.agent) {
        console.log('Using embedded wallet agent for request');
        return { agent: session.agent, isEmbedded: true };
      }
    } catch (e) {
      // Session not found, will fallback to legacy
    }
  }

  // Fallback to legacy agent service
  const agentService = req.app.locals.agentService;
  if (agentService && agentService.agent) {
    console.log('Using legacy agent for request');
    return { agent: agentService, isEmbedded: false };
  }

  throw new Error('No agent available. Please connect wallet or configure private key.');
}

/**
 * Helper to handle transactions that need signing (for embedded wallets)
 */
function handleSignatureResponse(error, res, req) {
  if (!req.app.locals.walletBridge) {
    // No wallet bridge, can't handle signature requests
    throw error;
  }

  if (error.message && error.message.startsWith('NEEDS_SIGNATURE:')) {
    const txId = error.message.split(':')[1];
    const txData = req.app.locals.walletBridge.getTransactionForSigning(txId);

    res.json({
      success: false,
      needsSignature: true,
      txId,
      transaction: txData.transaction,
      transactionType: txData.type,
      expiresAt: txData.expiresAt,
      message: 'Transaction requires wallet signature'
    });
  } else if (error.message && error.message.startsWith('NEEDS_SIGNATURES:')) {
    const txIds = error.message.split(':')[1].split(',');
    const transactions = txIds.map(txId =>
      req.app.locals.walletBridge.getTransactionForSigning(txId)
    );

    res.json({
      success: false,
      needsSignatures: true,
      transactions,
      message: 'Multiple transactions require wallet signatures'
    });
  } else {
    throw error;
  }
}

// ========================================
// Token Swaps (Jupiter)
// ========================================

/**
 * POST /swap
 * Swap tokens using best available method
 */
router.post('/swap', async (req, res) => {
  try {
    let { inputMint, outputMint, amount, slippage } = req.body;

    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: inputMint, outputMint, amount'
      });
    }


    const agentService = req.app.locals.agentService;
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';


    async function resolveToken(symbol) {

      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(symbol)) {
        return symbol;
      }

      console.log(`Resolving token: ${symbol}`);


      const tokenPlugin = agentService.getPlugin('token');
      if (tokenPlugin && tokenPlugin.methods && tokenPlugin.methods.getTokenAddressFromTicker) {
        try {

          const resolved = await tokenPlugin.methods.getTokenAddressFromTicker(symbol);
          if (resolved) {
            console.log(`✅ Token Plugin resolved: ${symbol} → ${resolved}`);
            return resolved;
          }
        } catch (error) {
          console.warn(`Token Plugin failed for ${symbol}:`, error.message);
        }
      }


      const fallbackAddress = tokenFallback.getTokenAddress(symbol, network);
      if (fallbackAddress) {
        console.log(`✅ Fallback resolved: ${symbol} → ${fallbackAddress}`);
        return fallbackAddress;
      }

      console.warn(`❌ Failed to resolve: ${symbol}`);
      return symbol;
    }


    inputMint = await resolveToken(inputMint);
    outputMint = await resolveToken(outputMint);

    const { agent, isEmbedded } = getAgentForRequest(req);

    try {
      let result;

      if (isEmbedded) {
        // Use DeFi service for embedded wallet
        const defiService = new DefiService(agent);
        result = await defiService.swap({
          inputMint,
          outputMint,
          amount,
          slippage: slippage || 0.5
        });
      } else {
        // Use legacy method
        result = await agent.swapTokens(
          inputMint,
          outputMint,
          amount,
          slippage
        );
      }

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      if (isEmbedded) {
        handleSignatureResponse(error, res, req);
      } else {
        throw error;
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get swap quote
router.post('/quote', async (req, res) => {
  try {
    let { inputMint, outputMint, amount } = req.body;

    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: inputMint, outputMint, amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';


    async function resolveToken(symbol) {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(symbol)) return symbol;


      const tokenPlugin = agentService.getPlugin('token');
      if (tokenPlugin?.methods?.getTokenAddressFromTicker) {
        try {

          const resolved = await tokenPlugin.methods.getTokenAddressFromTicker(symbol);
          if (resolved) {
            console.log(`✅ Token Plugin: ${symbol} → ${resolved}`);
            return resolved;
          }
        } catch (error) {
          console.warn(`Token Plugin failed for ${symbol}`);
        }
      }

      // Fallback
      const fallbackAddress = tokenFallback.getTokenAddress(symbol, network);
      if (fallbackAddress) {
        console.log(`✅ Fallback: ${symbol} → ${fallbackAddress}`);
        return fallbackAddress;
      }

      return symbol;
    }


    inputMint = await resolveToken(inputMint);
    outputMint = await resolveToken(outputMint);


    const quote = await agentService.jupiterService.getQuote(
      inputMint,
      outputMint,
      amount
    );

    if (quote.success) {
      res.json(quote);
    } else {
      res.status(400).json(quote);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Stake SOL
router.post('/stake', async (req, res) => {
  try {
    const { amount, validator } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const defiPlugin = agentService.getPlugin('defi');

    const result = await defiPlugin.stakeSol({
      amount,
      validator
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Provide liquidity
router.post('/liquidity/add', async (req, res) => {
  try {
    const { poolAddress, tokenA, tokenB, amountA, amountB } = req.body;

    if (!poolAddress || !tokenA || !tokenB || !amountA || !amountB) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    const agentService = req.app.locals.agentService;
    const defiPlugin = agentService.getPlugin('defi');

    const result = await defiPlugin.addLiquidity({
      poolAddress,
      tokenA,
      tokenB,
      amountA,
      amountB
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Remove liquidity
router.post('/liquidity/remove', async (req, res) => {
  try {
    const { poolAddress, lpTokenAmount } = req.body;

    if (!poolAddress || !lpTokenAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: poolAddress, lpTokenAmount'
      });
    }

    const agentService = req.app.locals.agentService;
    const defiPlugin = agentService.getPlugin('defi');

    const result = await defiPlugin.removeLiquidity({
      poolAddress,
      lpTokenAmount
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Launch token on Pump.fun - unified route with fallback
router.post('/launch/pumpfun', async (req, res) => {
  try {
    const { name, symbol, description, imageUrl, twitter, telegram, website } = req.body;

    if (!name || !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: name, symbol'
      });
    }

    const agentService = req.app.locals.agentService;

    // Try token plugin first (more specific)
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
        console.warn('Token plugin failed, trying defi plugin:', tokenError.message);
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
        // Note: decimals (6) and supply (1B) are fixed by Pump.fun protocol
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
    console.error('Pump.fun launch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Resolve token symbol to mint address using Token Plugin
router.post('/tokens/resolve', async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'symbol is required'
      });
    }

    const agentService = req.app.locals.agentService;
    const network = process.env.SOLANA_NETWORK || 'mainnet-beta';
    let address = null;
    let source = 'unknown';


    const tokenPlugin = agentService.getPlugin('token');
    if (tokenPlugin?.methods?.getTokenAddressFromTicker) {
      try {

        address = await tokenPlugin.methods.getTokenAddressFromTicker(symbol);
        if (address) {
          source = 'token-plugin';
        }
      } catch (error) {
        console.warn(`Token Plugin failed for ${symbol}:`, error.message);
      }
    }


    if (!address) {
      address = tokenFallback.getTokenAddress(symbol, network);
      if (address) {
        source = 'fallback';
      }
    }

    res.json({
      success: true,
      symbol,
      address,
      source,
      network
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as defiRoutes };

/**
 * Wallet Routes - API endpoints for embedded wallet interactions
 *
 * Provides secure wallet connection and transaction signing flow
 * without exposing private keys to the backend.
 */

import { Router } from 'express';
import { WalletBridgeService } from '../services/walletBridge.js';
import { Connection } from '@solana/web3.js';
import crypto from 'crypto';

const router = Router();

// Initialize wallet bridge service
let walletBridge;

/**
 * Initialize wallet bridge with connection
 * Called from main server initialization
 */
export function initializeWalletBridge(connection, app) {
  walletBridge = new WalletBridgeService(connection);

  // Make wallet bridge available to other routes via app.locals
  if (app) {
    app.locals.walletBridge = walletBridge;
  }

  console.log('✅ Wallet Bridge service initialized');
  return walletBridge;
}

/**
 * Middleware to check session
 */
function requireSession(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.body.sessionId;

  if (!sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Session ID required'
    });
  }

  try {
    const session = walletBridge.getSession(sessionId);
    req.userSession = session;
    req.sessionId = sessionId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session'
    });
  }
}

/**
 * POST /wallet/session/create
 * Create a new wallet session
 *
 * Body:
 * - walletPublicKey: string - User's wallet public key
 *
 * Returns:
 * - sessionId: string - Session identifier for subsequent requests
 * - walletAddress: string - Connected wallet address
 */
router.post('/session/create', async (req, res) => {
  try {
    const { walletPublicKey } = req.body;

    if (!walletPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Wallet public key required'
      });
    }

    // Generate session ID
    const sessionId = crypto.randomUUID();

    // Create user agent with embedded wallet
    const agent = walletBridge.createUserAgent(walletPublicKey, sessionId);

    // Configure plugins
    await walletBridge.configurePlugins(agent);

    res.json({
      success: true,
      sessionId,
      walletAddress: walletPublicKey,
      message: 'Wallet connected successfully',
      capabilities: [
        'token_operations',
        'defi_swaps',
        'nft_minting',
        'staking'
      ]
    });
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /wallet/session/close
 * Close an existing session
 *
 * Headers:
 * - x-session-id: string - Session ID
 */
router.post('/session/close', requireSession, async (req, res) => {
  try {
    const result = walletBridge.closeSession(req.sessionId);

    res.json({
      success: true,
      message: 'Session closed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /wallet/session/info
 * Get session information
 *
 * Headers:
 * - x-session-id: string - Session ID
 */
router.get('/session/info', requireSession, async (req, res) => {
  try {
    const session = req.userSession;

    res.json({
      success: true,
      walletAddress: session.walletPublicKey,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /wallet/execute
 * Execute an operation that may require wallet signing
 *
 * Headers:
 * - x-session-id: string - Session ID
 *
 * Body:
 * - action: string - Action to execute
 * - params: object - Parameters for the action
 */
router.post('/execute', requireSession, async (req, res) => {
  try {
    const { action, params } = req.body;
    const agent = req.userSession.agent;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Action required'
      });
    }

    console.log(`Executing action: ${action}`, params);

    try {
      // Attempt to execute the action
      let result;

      // Check if it's a direct agent method
      if (typeof agent[action] === 'function') {
        result = await agent[action](params);
      }
      // Check if it's a plugin method
      else if (agent.plugins) {
        for (const plugin of agent.plugins.values()) {
          if (plugin.methods && plugin.methods[action]) {
            result = await plugin.methods[action](params);
            break;
          }
        }

        if (!result) {
          throw new Error(`Unknown action: ${action}`);
        }
      } else {
        throw new Error(`Unknown action: ${action}`);
      }

      // Action completed without needing signature
      res.json({
        success: true,
        result
      });
    } catch (error) {
      // Check if signature is needed
      if (error.message && error.message.startsWith('NEEDS_SIGNATURE:')) {
        const txId = error.message.split(':')[1];
        const txData = walletBridge.getTransactionForSigning(txId);

        res.json({
          success: false,
          needsSignature: true,
          txId,
          transaction: txData.transaction,
          transactionType: txData.type,
          expiresAt: txData.expiresAt,
          message: 'Transaction requires wallet signature'
        });
      }
      // Check if multiple signatures are needed
      else if (error.message && error.message.startsWith('NEEDS_SIGNATURES:')) {
        const txIds = error.message.split(':')[1].split(',');
        const transactions = txIds.map(txId => walletBridge.getTransactionForSigning(txId));

        res.json({
          success: false,
          needsSignatures: true,
          transactions,
          message: 'Multiple transactions require wallet signatures'
        });
      } else {
        // Regular error
        throw error;
      }
    }
  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /wallet/transaction/:txId
 * Get a pending transaction for signing
 *
 * Params:
 * - txId: string - Transaction ID
 */
router.get('/transaction/:txId', async (req, res) => {
  try {
    const { txId } = req.params;
    const txData = walletBridge.getTransactionForSigning(txId);

    res.json({
      success: true,
      ...txData
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /wallet/transaction/submit
 * Submit a signed transaction
 *
 * Body:
 * - txId: string - Transaction ID
 * - signedTransaction: string - Base64 encoded signed transaction
 */
router.post('/transaction/submit', async (req, res) => {
  try {
    const { txId, signedTransaction } = req.body;

    if (!txId || !signedTransaction) {
      return res.status(400).json({
        success: false,
        error: 'Transaction ID and signed transaction required'
      });
    }

    const result = await walletBridge.submitSignedTransaction(txId, signedTransaction);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Transaction submission error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /wallet/transaction/cancel
 * Cancel a pending transaction
 *
 * Body:
 * - txId: string - Transaction ID to cancel
 */
router.post('/transaction/cancel', async (req, res) => {
  try {
    const { txId } = req.body;

    if (!txId) {
      return res.status(400).json({
        success: false,
        error: 'Transaction ID required'
      });
    }

    const result = walletBridge.cancelTransaction(txId);

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

/**
 * GET /wallet/balance
 * Get wallet balance
 *
 * Headers:
 * - x-session-id: string - Session ID
 *
 * Query:
 * - mint: string (optional) - Token mint address, defaults to SOL
 */
router.get('/balance', requireSession, async (req, res) => {
  try {
    const { mint } = req.query;
    const agent = req.userSession.agent;

    let balance;

    if (!mint || mint === 'SOL') {
      // Get SOL balance
      const lamports = await agent.connection.getBalance(agent.wallet.publicKey);
      balance = {
        mint: 'SOL',
        balance: lamports / 1e9,
        lamports
      };
    } else {
      // Get token balance using token plugin
      const tokenPlugin = agent.plugins?.get('token');
      if (!tokenPlugin) {
        throw new Error('Token plugin not available');
      }

      const tokenBalance = await tokenPlugin.methods.get_balance(mint);
      balance = {
        mint,
        balance: tokenBalance
      };
    }

    res.json({
      success: true,
      ...balance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /wallet/transfer
 * Transfer SOL or tokens
 *
 * Headers:
 * - x-session-id: string - Session ID
 *
 * Body:
 * - to: string - Recipient address
 * - amount: number - Amount to transfer
 * - mint: string (optional) - Token mint, defaults to SOL
 */
router.post('/transfer', requireSession, async (req, res) => {
  try {
    const { to, amount, mint } = req.body;
    const agent = req.userSession.agent;

    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Recipient and amount required'
      });
    }

    try {
      let result;

      if (!mint || mint === 'SOL') {
        // Transfer SOL
        result = await agent.transfer({
          to,
          amount,
          mint: 'SOL'
        });
      } else {
        // Transfer tokens using token plugin
        const tokenPlugin = agent.plugins?.get('token');
        if (!tokenPlugin) {
          throw new Error('Token plugin not available');
        }

        result = await tokenPlugin.methods.transfer({
          to,
          amount,
          mint
        });
      }

      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      // Handle signature requirement
      if (error.needsSignature) {
        const txData = walletBridge.getTransactionForSigning(error.txId);

        res.json({
          success: false,
          needsSignature: true,
          txId: error.txId,
          transaction: txData.transaction,
          transactionType: txData.type,
          expiresAt: txData.expiresAt,
          message: 'Transfer requires wallet signature'
        });
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

/**
 * GET /wallet/stats
 * Get wallet bridge statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = walletBridge.getStats();

    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Store wallet bridge reference for other routes
router.walletBridge = walletBridge;

export { router as walletRoutes };
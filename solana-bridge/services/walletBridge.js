/**
 * WalletBridge Service - Enables secure wallet interactions without exposing private keys
 *
 * This service implements the Embedded Wallets pattern from Solana Agent Kit v2,
 * allowing users to sign transactions with their own wallets instead of providing private keys.
 *
 * Architecture:
 * 1. User connects wallet in frontend (Phantom, Solflare, etc.)
 * 2. Backend creates agent with wallet adapter that defers signing to frontend
 * 3. When transaction needs signing, it's sent to frontend for user approval
 * 4. User signs in their wallet, signed transaction is sent back to backend
 * 5. Backend broadcasts the signed transaction to blockchain
 */

import { SolanaAgentKit } from 'solana-agent-kit';
import { Connection, Transaction, PublicKey, VersionedTransaction } from '@solana/web3.js';
import crypto from 'crypto';

export class WalletBridgeService {
  constructor(connection) {
    this.connection = connection;
    this.pendingTransactions = new Map();
    this.userSessions = new Map();
    this.transactionTimeout = 5 * 60 * 1000; // 5 minutes timeout for pending transactions

    // Clean up expired transactions periodically
    this.startCleanupInterval();
  }

  /**
   * Creates a user-specific agent instance using frontend wallet
   * @param {string} walletPublicKey - User's wallet public key
   * @param {string} sessionId - Unique session identifier
   * @returns {SolanaAgentKit} Configured agent instance
   */
  createUserAgent(walletPublicKey, sessionId) {
    const publicKey = new PublicKey(walletPublicKey);

    // Create wallet adapter that requires frontend signing
    const walletAdapter = {
      publicKey,

      // Single transaction signing
      signTransaction: async (tx) => {
        const txId = this.generateTxId();

        // Store transaction for frontend retrieval
        this.pendingTransactions.set(txId, {
          transaction: tx,
          sessionId,
          status: 'pending_signature',
          createdAt: Date.now(),
          type: tx instanceof VersionedTransaction ? 'versioned' : 'legacy'
        });

        // Throw special error that indicates signing is needed
        const error = new Error(`NEEDS_SIGNATURE:${txId}`);
        error.txId = txId;
        error.needsSignature = true;
        throw error;
      },

      // Multiple transaction signing
      signAllTransactions: async (txs) => {
        const txIds = [];

        for (const tx of txs) {
          const txId = this.generateTxId();

          this.pendingTransactions.set(txId, {
            transaction: tx,
            sessionId,
            status: 'pending_signature',
            createdAt: Date.now(),
            type: tx instanceof VersionedTransaction ? 'versioned' : 'legacy'
          });

          txIds.push(txId);
        }

        // Throw special error with multiple transaction IDs
        const error = new Error(`NEEDS_SIGNATURES:${txIds.join(',')}`);
        error.txIds = txIds;
        error.needsSignatures = true;
        throw error;
      },

      // Sign and send transaction (not used in our flow)
      signAndSendTransaction: async (tx) => {
        // This method is typically not used with embedded wallets
        // as we want to separate signing and sending
        throw new Error('Please use signTransaction followed by submitSignedTransaction');
      }
    };

    // Create agent with embedded wallet configuration
    const agentConfig = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      PINATA_JWT: process.env.PINATA_JWT,
      PINATA_GATEWAY: process.env.PINATA_GATEWAY,
      COINGECKO_DEMO_API_KEY: process.env.COINGECKO_DEMO_API_KEY,
      COINGECKO_PRO_API_KEY: process.env.COINGECKO_PRO_API_KEY
    };

    const agent = new SolanaAgentKit(
      walletAdapter,
      this.connection.rpcEndpoint,
      agentConfig
    );

    // Store session info
    this.userSessions.set(sessionId, {
      walletPublicKey: publicKey.toString(),
      agent,
      createdAt: Date.now(),
      lastActivity: Date.now()
    });

    console.log(`✅ Created embedded wallet agent for ${publicKey.toString()} (session: ${sessionId})`);

    return agent;
  }

  /**
   * Load and configure plugins for an agent
   * @param {SolanaAgentKit} agent - The agent to configure
   */
  async configurePlugins(agent) {
    try {
      // Load Token Plugin
      const TokenPlugin = (await import('@solana-agent-kit/plugin-token')).default;
      agent.use(TokenPlugin);
      console.log('✅ Token plugin loaded');

      // Load DeFi Plugin
      const DefiPlugin = (await import('@solana-agent-kit/plugin-defi')).default;
      agent.use(DefiPlugin);
      console.log('✅ DeFi plugin loaded');

      // Load NFT Plugin
      const NFTPlugin = (await import('@solana-agent-kit/plugin-nft')).default;
      agent.use(NFTPlugin);
      console.log('✅ NFT plugin loaded');

      // Load Blinks Plugin
      const BlinksPlugin = (await import('@solana-agent-kit/plugin-blinks')).default;
      agent.use(BlinksPlugin);
      console.log('✅ Blinks plugin loaded');

    } catch (error) {
      console.error('Error loading plugins:', error);
      // Continue even if some plugins fail to load
    }

    return agent;
  }

  /**
   * Get a pending transaction by ID
   * @param {string} txId - Transaction ID
   * @returns {Object} Transaction details
   */
  getPendingTransaction(txId) {
    const pending = this.pendingTransactions.get(txId);

    if (!pending) {
      throw new Error('Transaction not found or expired');
    }

    // Check if transaction has expired
    if (Date.now() - pending.createdAt > this.transactionTimeout) {
      this.pendingTransactions.delete(txId);
      throw new Error('Transaction expired');
    }

    return pending;
  }

  /**
   * Get transaction for frontend signing
   * @param {string} txId - Transaction ID
   * @returns {Object} Serialized transaction data
   */
  getTransactionForSigning(txId) {
    const pending = this.getPendingTransaction(txId);

    // Serialize transaction for frontend
    const serialized = pending.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    return {
      txId,
      transaction: serialized.toString('base64'),
      type: pending.type,
      createdAt: pending.createdAt,
      expiresAt: pending.createdAt + this.transactionTimeout
    };
  }

  /**
   * Submit a signed transaction to the blockchain
   * @param {string} txId - Transaction ID
   * @param {string} signedTxBase64 - Base64 encoded signed transaction
   * @returns {Object} Transaction result
   */
  async submitSignedTransaction(txId, signedTxBase64) {
    const pending = this.getPendingTransaction(txId);

    if (pending.status !== 'pending_signature') {
      throw new Error('Transaction already processed');
    }

    try {
      // Update status
      pending.status = 'broadcasting';

      // Decode signed transaction
      const signedTxBuffer = Buffer.from(signedTxBase64, 'base64');

      // Send raw transaction
      console.log(`Broadcasting transaction ${txId}...`);
      const signature = await this.connection.sendRawTransaction(signedTxBuffer, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      });

      // Wait for confirmation
      pending.status = 'confirming';
      console.log(`Confirming transaction ${signature}...`);

      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      // Clean up
      this.pendingTransactions.delete(txId);

      // Update session activity
      const session = this.userSessions.get(pending.sessionId);
      if (session) {
        session.lastActivity = Date.now();
      }

      console.log(`✅ Transaction ${signature} confirmed`);

      return {
        success: true,
        signature,
        explorer: `https://explorer.solana.com/tx/${signature}`
      };
    } catch (error) {
      // Update status on error
      pending.status = 'failed';
      pending.error = error.message;

      throw error;
    }
  }

  /**
   * Cancel a pending transaction
   * @param {string} txId - Transaction ID to cancel
   */
  cancelTransaction(txId) {
    const pending = this.pendingTransactions.get(txId);

    if (pending && pending.status === 'pending_signature') {
      this.pendingTransactions.delete(txId);
      return { success: true, message: 'Transaction cancelled' };
    }

    throw new Error('Transaction not found or cannot be cancelled');
  }

  /**
   * Get user session
   * @param {string} sessionId - Session ID
   * @returns {Object} Session details
   */
  getSession(sessionId) {
    const session = this.userSessions.get(sessionId);

    if (!session) {
      throw new Error('Session not found');
    }

    // Update activity timestamp
    session.lastActivity = Date.now();

    return session;
  }

  /**
   * Close user session
   * @param {string} sessionId - Session ID to close
   */
  closeSession(sessionId) {
    // Cancel all pending transactions for this session
    for (const [txId, pending] of this.pendingTransactions) {
      if (pending.sessionId === sessionId) {
        this.pendingTransactions.delete(txId);
      }
    }

    // Remove session
    this.userSessions.delete(sessionId);

    console.log(`Session ${sessionId} closed`);

    return { success: true };
  }

  /**
   * Generate unique transaction ID
   * @returns {string} Transaction ID
   */
  generateTxId() {
    return `tx_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Start cleanup interval for expired transactions and sessions
   */
  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();

      // Clean up expired transactions
      for (const [txId, pending] of this.pendingTransactions) {
        if (now - pending.createdAt > this.transactionTimeout) {
          console.log(`Cleaning up expired transaction ${txId}`);
          this.pendingTransactions.delete(txId);
        }
      }

      // Clean up inactive sessions (1 hour timeout)
      const sessionTimeout = 60 * 60 * 1000;
      for (const [sessionId, session] of this.userSessions) {
        if (now - session.lastActivity > sessionTimeout) {
          console.log(`Cleaning up inactive session ${sessionId}`);
          this.closeSession(sessionId);
        }
      }
    }, 60 * 1000); // Run every minute
  }

  /**
   * Get statistics about the bridge service
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      activeSessions: this.userSessions.size,
      pendingTransactions: this.pendingTransactions.size,
      transactionsByStatus: this.getTransactionsByStatus()
    };
  }

  /**
   * Get transactions grouped by status
   * @returns {Object} Transaction counts by status
   */
  getTransactionsByStatus() {
    const statusCounts = {};

    for (const pending of this.pendingTransactions.values()) {
      statusCounts[pending.status] = (statusCounts[pending.status] || 0) + 1;
    }

    return statusCounts;
  }
}

export default WalletBridgeService;
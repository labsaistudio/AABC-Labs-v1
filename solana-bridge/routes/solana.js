import { Router } from 'express';
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';

const router = Router();

// Get wallet balance
router.get('/balance/:address?', async (req, res) => {
  try {
    const { address } = req.params;
    const agentService = req.app.locals.agentService;

    const result = await agentService.getBalance(address);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Transfer SOL
router.post('/transfer', async (req, res) => {
  try {
    const { to, amount } = req.body;

    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: to, amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const result = await agentService.transfer(to, amount);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wallet info
router.get('/wallet', async (req, res) => {
  try {
    const agentService = req.app.locals.agentService;

    res.json({
      success: true,
      address: agentService.getWalletAddress(),
      network: agentService.getNetwork()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get transaction status
router.get('/transaction/:signature', async (req, res) => {
  try {
    const { signature } = req.params;
    const agentService = req.app.locals.agentService;
    const connection = agentService.getConnection();

    const status = await connection.getSignatureStatus(signature);

    res.json({
      success: true,
      signature,
      status: status.value
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create unsigned transfer transaction for user wallet signing
router.post('/create-transfer-transaction', async (req, res) => {
  try {
    const { from, to, amount } = req.body;

    if (!from || !to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: from, to, amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const connection = agentService.getConnection();

    // Create public keys
    const fromPubkey = new PublicKey(from);
    const toPubkey = new PublicKey(to);

    // Create transfer instruction
    const transferInstruction = SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: amount * LAMPORTS_PER_SOL
    });

    // Create transaction
    const transaction = new Transaction().add(transferInstruction);

    // Get recent blockhash - use 'processed' for freshest blockhash
    // 'processed' gives us the absolute latest blockhash with maximum validity window
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = fromPubkey;

    // Serialize transaction to base64
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });
    const transactionBase64 = serializedTransaction.toString('base64');

    res.json({
      success: true,
      transaction: transactionBase64,
      blockhash,
      lastValidBlockHeight
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Submit signed transaction from user wallet
router.post('/submit-signed-transaction', async (req, res) => {
  let signature; // Hoist to outer scope for post-mortem reconciliation

  try {
    const { signedTransaction } = req.body;

    if (!signedTransaction) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: signedTransaction'
      });
    }

    const agentService = req.app.locals.agentService;
    const connection = agentService.getConnection();

    // Deserialize transaction from base64
    const transactionBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = Transaction.from(transactionBuffer);

    // Check if transaction blockhash is still valid
    const currentBlockHeight = await connection.getBlockHeight('processed');
    if (transaction.lastValidBlockHeight && currentBlockHeight > transaction.lastValidBlockHeight) {
      return res.status(400).json({
        success: false,
        error: 'TRANSACTION_EXPIRED',
        message: 'Transaction blockhash has expired. Please create a new payment request.',
        details: {
          currentBlockHeight,
          lastValidBlockHeight: transaction.lastValidBlockHeight,
          blocksExpired: currentBlockHeight - transaction.lastValidBlockHeight
        }
      });
    }

    console.log(`[Submit] Current block: ${currentBlockHeight}, Last valid: ${transaction.lastValidBlockHeight}, Remaining: ${transaction.lastValidBlockHeight - currentBlockHeight}`);

    // Send transaction to blockchain with skipPreflight for fastest submission
    signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,  // Skip simulation to submit faster and avoid expiration
      maxRetries: 5,        // Retry up to 5 times
      preflightCommitment: 'processed'  // Use processed for fastest response
    });

    console.log(`[Submit] Transaction sent: ${signature}`);

    // Wait for confirmation - DON'T use blockhash/lastValidBlockHeight
    // as they may be expired even though transaction succeeded
    // Use signature-only confirmation instead
    let confirmation;
    try {
      confirmation = await connection.confirmTransaction(signature, 'processed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
    } catch (confirmError) {
      // If confirmTransaction fails due to blockhash expiration,
      // check if transaction actually succeeded on-chain
      console.warn(`[Submit] Confirmation error: ${confirmError.message}`);
      console.log(`[Submit] Checking transaction status directly...`);

      const status = await connection.getSignatureStatus(signature);
      if (status.value?.confirmationStatus) {
        console.log(`[Submit] Transaction found on-chain with status: ${status.value.confirmationStatus}`);
        confirmation = { value: status.value };
      } else {
        // Transaction really failed or not found
        throw confirmError;
      }
    }

    res.json({
      success: true,
      signature,
      confirmation: confirmation.value
    });
  } catch (error) {
    const errorMsg = error.message || '';

    // ✅ CRITICAL: Post-mortem reconciliation
    // If we have a signature, ALWAYS check on-chain status before returning error
    // This prevents false negatives where tx succeeded but confirmation failed
    if (signature && typeof signature === 'string' && signature.length > 0) {
      try {
        console.log(`[Submit][Reconcile] Checking on-chain status for signature: ${signature}`);
        const agentService = req.app.locals.agentService;
        const connection = agentService.getConnection();

        const status = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: true
        });

        const value = status?.value;

        // If transaction is confirmed/finalized/processed, return SUCCESS
        if (value && (
          value.confirmationStatus === 'confirmed' ||
          value.confirmationStatus === 'finalized' ||
          value.confirmationStatus === 'processed'
        )) {
          console.warn(`[Submit][Reconcile] ✅ Tx ${signature} is actually ${value.confirmationStatus}, returning success despite error`);
          return res.json({
            success: true,
            signature,
            confirmation: value,
            reconciled: true  // Flag to indicate this was reconciled
          });
        }

        console.log(`[Submit][Reconcile] Transaction not confirmed yet or failed: ${value?.confirmationStatus || 'not found'}`);
      } catch (reconcileError) {
        console.error(`[Submit][Reconcile] Failed to check status: ${reconcileError?.message || reconcileError}`);
        // Continue to error handling below
      }
    }

    // Check if error is blockhash expiration - return 409 instead of 500
    if (errorMsg.includes('block height exceeded') ||
        errorMsg.includes('blockhash') ||
        errorMsg.includes('expired')) {
      console.error(`[Submit] Blockhash expired: ${errorMsg}`);
      return res.status(409).json({
        success: false,
        error: 'BLOCKHASH_EXPIRED',
        message: 'Transaction blockhash has expired. Please create a new payment request with fresh blockhash.',
        details: errorMsg
      });
    }

    // Other errors return 500
    console.error(`[Submit] Error: ${errorMsg}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as solanaRoutes };

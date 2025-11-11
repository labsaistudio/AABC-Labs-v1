/**
 * X402 Protocol Client Utility
 * Handles user wallet payment for X402-protected routes
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferCheckedInstruction } from '@solana/spl-token';
import { toast } from 'sonner';

const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'solana-mainnet';
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;

export interface X402PaymentResult {
  success: boolean;
  signature?: string;
  xPaymentResponse?: string;
  error?: string;
  capabilityKey: string;
  capabilityName: string;
}

export interface X402PaymentOptions {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  capabilityKey: string;
  capabilityName: string;
  silent?: boolean;
}

/**
 * Pay for a single X402-protected capability using user's wallet
 *
 * Flow:
 * 1. POST to capability route without X-PAYMENT header
 * 2. Receive 402 response with payment requirements
 * 3. Create Solana USDC transfer transaction
 * 4. Sign with user's wallet
 * 5. Broadcast and confirm transaction
 * 6. POST again with X-PAYMENT header containing signature
 * 7. Receive 200 response with X-PAYMENT-RESPONSE header
 */
export async function payForCapability(
  options: X402PaymentOptions
): Promise<X402PaymentResult> {
  const { publicKey, signTransaction, capabilityKey, capabilityName, silent = false } = options;

  try {
    const capabilityUrl = `/api/capabilities/${capabilityKey}`;

    if (!silent) {
      toast.info(`Checking payment requirements for ${capabilityName}...`);
    }

    const initialResponse = await fetch(capabilityUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'access' })
    });

    if (initialResponse.status !== 402) {
      throw new Error(`Expected 402 response but got ${initialResponse.status}`);
    }

    const paymentRequired = await initialResponse.json();
    console.log(`[X402Client] Payment required for ${capabilityKey}:`, paymentRequired);

    if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
      throw new Error('Invalid 402 response: missing accepts array');
    }

    const paymentRequirements = paymentRequired.accepts[0];
    const amountMicroUsdc = parseInt(paymentRequirements.maxAmountRequired);
    const treasuryAddress = paymentRequirements.payTo;
    const priceUSD = (amountMicroUsdc / 1000000).toFixed(3);

    if (!silent) {
      toast.info(`Creating USDC transfer: $${priceUSD} to treasury...`);
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const usdcMint = new PublicKey(USDC_MINT);
    const treasuryPubkey = new PublicKey(treasuryAddress);

    const senderTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      publicKey
    );

    const recipientTokenAccount = await getAssociatedTokenAddress(
      usdcMint,
      treasuryPubkey
    );

    const transferInstruction = createTransferCheckedInstruction(
      senderTokenAccount,
      usdcMint,
      recipientTokenAccount,
      publicKey,
      amountMicroUsdc,
      USDC_DECIMALS
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: publicKey
    }).add(transferInstruction);

    if (!silent) {
      toast.info('Please approve the transaction in your wallet...');
    }

    const signed = await signTransaction(transaction);

    if (!silent) {
      toast.info('Broadcasting transaction to Solana...');
    }

    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`[X402Client] Transaction signature for ${capabilityKey}:`, signature);

    const confirmation = await connection.confirmTransaction({
      signature: signature,
      blockhash: blockhash,
      lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
    });

    if (confirmation.value.err) {
      throw new Error('Transaction failed on blockchain');
    }

    if (!silent) {
      toast.success(`Payment confirmed on Solana! ($${priceUSD})`);
    }

    const paymentPayload = {
      signature: signature,
      payer: publicKey.toString(),
      amount: amountMicroUsdc.toString(),
      mint: USDC_MINT,
      network: NETWORK,
      timestamp: Date.now()
    };

    const xPaymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

    console.log(`[X402Client] Verifying payment for ${capabilityKey}...`);

    const verifyResponse = await fetch(capabilityUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': xPaymentHeader
      },
      body: JSON.stringify({ action: 'access' })
    });

    const verifyData = await verifyResponse.json();
    const xPaymentResponse = verifyResponse.headers.get('X-PAYMENT-RESPONSE') ||
                             verifyResponse.headers.get('x-payment-response');

    console.log(`[X402Client] Verification response for ${capabilityKey}:`, verifyData);
    if (xPaymentResponse) {
      try {
        const settlement = JSON.parse(Buffer.from(xPaymentResponse, 'base64').toString('utf-8'));
        console.log(`[X402Client] Settlement data for ${capabilityKey}:`, settlement);
      } catch (e) {
        console.log(`[X402Client] Raw X-PAYMENT-RESPONSE for ${capabilityKey}:`, xPaymentResponse);
      }
    }

    if (!verifyResponse.ok || !verifyData.success) {
      throw new Error(verifyData.error || 'Payment verification failed');
    }

    if (!silent) {
      toast.success(`${capabilityName} access granted!`);
    }

    return {
      success: true,
      signature,
      xPaymentResponse: xPaymentResponse || undefined,
      capabilityKey,
      capabilityName
    };

  } catch (error: any) {
    console.error(`[X402Client] Payment failed for ${capabilityKey}:`, error);

    if (!silent) {
      toast.error(`Payment failed for ${capabilityName}: ${error.message}`);
    }

    return {
      success: false,
      error: error.message,
      capabilityKey,
      capabilityName
    };
  }
}

/**
 * Pay for multiple capabilities sequentially
 * Returns array of payment results
 */
export async function payForCapabilities(
  capabilities: Array<{ key: string; name: string }>,
  publicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>
): Promise<X402PaymentResult[]> {
  const results: X402PaymentResult[] = [];

  for (const cap of capabilities) {
    const result = await payForCapability({
      publicKey,
      signTransaction,
      capabilityKey: cap.key,
      capabilityName: cap.name,
      silent: false
    });

    results.push(result);

    if (!result.success) {
      toast.error('Payment process stopped due to failure');
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

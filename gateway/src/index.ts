// gateway/src/index.ts
// X402 Payment Gateway - Agent autonomous payment handler
// Based on teacher's comprehensive execution plan v3.1

import express from 'express'
import fetch from 'node-fetch'
import bs58 from 'bs58'
import base64url from 'base64url'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token'

// No Memo needed - Facilitator expects single transferChecked instruction for 'exact' scheme
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(express.json())

// New: Read environment variable to control payload mode
const PAYLOAD_MODE = process.env.X402_PAYLOAD_MODE || 'transaction';
// Valid values: 'transaction' | 'message' | 'transaction+signature' | 'message+header-signature'

// New: Verification mode - controls fallback strategy when Facilitator fails
const VERIFY_MODE = process.env.X402_VERIFY_MODE || 'facilitator-first';
// Valid values:
//   'facilitator-first': Try Facilitator, fallback to local chain verification on error (default)
//   'local-first': Try local verification first, Facilitator as backup
//   'local-only': Only use local chain verification, skip Facilitator
//   'facilitator-only': Only use Facilitator (fail if Facilitator fails)

// Environment variables
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'
const NETWORK = process.env.X402_NETWORK ?? 'solana'
const USDC = process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY
const FACILITATOR = process.env.FACILITATOR_URL ?? 'https://facilitator.payai.network'
const TREASURY = process.env.X402_TREASURY

if (!AGENT_PRIVATE_KEY) {
  console.error('[Gateway] ERROR: AGENT_PRIVATE_KEY not set in environment')
  process.exit(1)
}

if (!TREASURY) {
  console.error('[Gateway] ERROR: X402_TREASURY not set in environment')
  process.exit(1)
}

const conn = new Connection(RPC, 'confirmed')
const agent = Keypair.fromSecretKey(bs58.decode(AGENT_PRIVATE_KEY))

console.log('========================================')
console.log('X402 Gateway Starting...')
console.log('========================================')
console.log('Agent wallet:', agent.publicKey.toBase58())
console.log('Network:', NETWORK)
console.log('USDC:', USDC)
console.log('Treasury:', TREASURY)
console.log('Facilitator:', FACILITATOR)
console.log('Verification mode:', VERIFY_MODE)
console.log('Payload mode:', PAYLOAD_MODE)
console.log('========================================')

/**
 * Assert transaction contains exactly 1 transferChecked instruction
 * Per teacher's guidance: Facilitator expects single transferChecked for 'exact' scheme
 */
function assertSingleTransferChecked(tx: Transaction): void {
  const ixs = tx.instructions

  // Check exactly 1 instruction
  if (ixs.length !== 1) {
    throw new Error(`Expected exactly 1 instruction, got ${ixs.length}`)
  }

  const ix = ixs[0]

  // Check programId is Token Program
  if (!ix.programId.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`ProgramId not Token Program: ${ix.programId.toBase58()}`)
  }

  // Check instruction discriminator is TransferChecked (12 = 0x0C)
  if (ix.data.length < 1 || ix.data[0] !== 12) {
    throw new Error(`Not TransferChecked; first data byte=${ix.data[0] ?? -1}`)
  }

  // Check account count is 4 (sourceATA, mint, destATA, owner)
  if (ix.keys.length !== 4) {
    throw new Error(`Unexpected key length for TransferChecked: ${ix.keys.length}`)
  }

  console.log('[Gateway] ✅ Transaction assertion passed:')
  console.log('[Gateway]    - Instructions: 1')
  console.log('[Gateway]    - ProgramId: Token Program')
  console.log('[Gateway]    - Discriminator: 12 (TransferChecked)')
  console.log('[Gateway]    - Accounts: 4')
}

/**
 * Local on-chain verification fallback
 * Verifies payment directly on Solana blockchain when Facilitator is unavailable
 */
async function localVerifyOnChain(signature: string, accept: any): Promise<boolean> {
  try {
    console.log('[LocalVerify] Checking transaction on-chain:', signature)

    // 1) Get transaction status
    const status = await conn.getSignatureStatus(signature, { searchTransactionHistory: true })
    if (!status || !status.value) {
      console.log('[LocalVerify] Transaction not found')
      return false
    }

    if (status.value.err) {
      console.log('[LocalVerify] Transaction failed:', status.value.err)
      return false
    }

    if (status.value.confirmationStatus !== 'confirmed' && status.value.confirmationStatus !== 'finalized') {
      console.log('[LocalVerify] Transaction not confirmed yet')
      return false
    }

    // 2) Get transaction details
    const tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
    if (!tx || !tx.meta) {
      console.log('[LocalVerify] Cannot fetch transaction details')
      return false
    }

    // 3) Verify it's a USDC transfer
    const usdcMint = accept.asset
    const expectedAmount = accept.maxAmountRequired
    const treasuryOwner = accept.payTo

    // Check token balances change
    const preBalances = tx.meta.preTokenBalances || []
    const postBalances = tx.meta.postTokenBalances || []

    // Find Treasury's USDC balance change
    const treasuryPost = postBalances.find(b => b.mint === usdcMint && b.owner === treasuryOwner)
    const treasuryPre = preBalances.find(b => b.mint === usdcMint && b.owner === treasuryOwner)

    if (!treasuryPost) {
      console.log('[LocalVerify] Treasury token account not found in post balances')
      return false
    }

    const preAmount = treasuryPre ? BigInt(treasuryPre.uiTokenAmount.amount) : BigInt(0)
    const postAmount = BigInt(treasuryPost.uiTokenAmount.amount)
    const delta = postAmount - preAmount

    console.log('[LocalVerify] Amount delta:', delta.toString(), 'expected:', expectedAmount)

    if (delta < BigInt(expectedAmount)) {
      console.log('[LocalVerify] Insufficient amount transferred')
      return false
    }

    console.log('[LocalVerify] ✅ All checks passed')
    return true

  } catch (error: any) {
    console.error('[LocalVerify] Error:', error.message)
    return false
  }
}

/**
 * POST /agent/fetch-x402
 * Automatic 402 payment + replay
 *
 * This is the CORE endpoint for Agent autonomous payment
 * Flow: Initial request → 402 response → Pay → Verify → Replay
 */
app.post('/agent/fetch-x402', async (req, res) => {
  const { url, method = 'GET', headers = {}, body } = req.body
  console.log('[Gateway] ============================================')
  console.log('[Gateway] New request:', { url, method })

  try {
    // 1) Initial request
    console.log('[Gateway] Step 1: Making initial request...')
    const r1 = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    console.log('[Gateway] Initial response status:', r1.status)

    // Not 402? Pass through
    if (r1.status !== 402) {
      const data = await r1.text()
      console.log('[Gateway] Not a 402 response, passing through')
      return res.status(r1.status).send(data)
    }

    // 2) Parse 402 response
    console.log('[Gateway] Step 2: Parsing 402 response...')
    const reqs = await r1.json() as any
    const accept = reqs.accepts?.[0]
    if (!accept) {
      console.error('[Gateway] ERROR: No payment requirements in 402 response')
      return res.status(500).json({ error: 'No payment requirements in 402 response' })
    }

    // Extract price for transaction construction (used before destructuring)
    const priceAtomic = Number(accept.maxAmountRequired ?? '0')

    console.log('[Gateway] Payment required:', {
      priceAtomic,
      resource: accept.resource,
      asset: accept.asset,
      description: accept.description
    })

    // 3) Generate USDC transferChecked transaction
    console.log('[Gateway] Step 3: Creating USDC transfer transaction...')
    const dest = new PublicKey(TREASURY!)
    const agentAta = await getAssociatedTokenAddress(
      new PublicKey(USDC),
      agent.publicKey
    )
    const destAta = await getAssociatedTokenAddress(
      new PublicKey(USDC),
      dest
    )

    console.log('[Gateway] Transfer details:', {
      from: agentAta.toBase58(),
      to: destAta.toBase58(),
      amount: priceAtomic,
      decimals: 6
    })

    // Check if Treasury's USDC token account exists
    console.log('[Gateway] Checking if Treasury token account exists...')
    let ataExists = false
    try {
      await getAccount(conn, destAta)
      console.log('[Gateway] Treasury token account exists ✓')
      ataExists = true
    } catch (e) {
      console.log('[Gateway] Treasury token account does not exist')
    }

    // If ATA doesn't exist, create it SEPARATELY and confirm
    // DO NOT mix creation with payment transaction
    if (!ataExists) {
      console.log('[Gateway] Creating Treasury token account separately...')
      const createIx = createAssociatedTokenAccountInstruction(
        agent.publicKey,  // payer
        destAta,          // ata
        dest,             // owner
        new PublicKey(USDC)  // mint
      )
      const createTx = new Transaction().add(createIx)
      createTx.feePayer = agent.publicKey
      const createBlockhash = await conn.getLatestBlockhash('finalized')
      createTx.recentBlockhash = createBlockhash.blockhash
      createTx.sign(agent)

      const createSig = await conn.sendRawTransaction(createTx.serialize(), { skipPreflight: false })
      console.log('[Gateway] Create ATA transaction sent:', createSig)
      await conn.confirmTransaction(createSig, 'confirmed')
      console.log('[Gateway] Treasury token account created ✓')
    }

    // Per teacher's guidance (010.txt line 138-146):
    // Only 1 transferChecked instruction, no Memo
    const transferIx = createTransferCheckedInstruction(
      agentAta,
      new PublicKey(USDC),  // Must use mint address from accept.asset
      destAta,
      agent.publicKey,
      priceAtomic,
      6  // USDC decimals
    )

    // Transaction with single instruction
    const tx = new Transaction()
    tx.add(transferIx)  // Only transferChecked
    tx.feePayer = agent.publicKey
    const latestBlockhash = await conn.getLatestBlockhash('finalized')
    tx.recentBlockhash = latestBlockhash.blockhash

    // CRITICAL: Assert single transferChecked instruction BEFORE signing
    // Per teacher's guidance (老师.md): Facilitator expects exactly 1 transferChecked
    assertSingleTransferChecked(tx)

    // Sign transaction but DO NOT broadcast yet
    // Per PayAI Facilitator requirements: verify first, then settle broadcasts
    tx.sign(agent)

    // Serialize for verification (not yet broadcasted)
    const rawTx = tx.serialize()
    const rawTxBase64 = rawTx.toString('base64')

    // Extract signature (required by some Facilitator SVM validators)
    const sig = bs58.encode(tx.signature!)

    console.log('[Gateway] Step 4: Transaction signed (not yet broadcasted)')
    console.log('[Gateway] Serialized transaction length:', rawTx.length, 'bytes')
    console.log('[Gateway] Base64 transaction length:', rawTxBase64.length, 'chars')
    console.log('[Gateway] Signature (bs58):', sig)
    console.log('[Gateway] Transaction will be verified first, then broadcasted by Facilitator')

    // DEBUG: Decompile transaction to verify instruction structure
    console.log('[Gateway] ===== DEBUG: Transaction Instruction Analysis =====')
    try {
      const decodedTx = Transaction.from(rawTx)
      console.log('[Gateway] Instructions count:', decodedTx.instructions.length)
      decodedTx.instructions.forEach((ix, idx) => {
        console.log(`[Gateway] Instruction ${idx}:`)
        console.log(`  - programId: ${ix.programId.toBase58()}`)
        console.log(`  - accounts.length: ${ix.keys.length}`)
        console.log(`  - data.length: ${ix.data.length}`)
        if (ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length > 0) {
          console.log(`  - discriminator (data[0]): ${ix.data[0]} (should be 12 for TransferChecked)`)
        }
      })
    } catch (e: any) {
      console.error('[Gateway] ERROR: Failed to decompile transaction:', e.message)
    }
    console.log('[Gateway] ===== END DEBUG =====')

    // 4) Prepare all payload variants for "Minimum Validation Matrix" experiment
    console.log('[Gateway] Step 4: Preparing payload variants for experiment...')

    const messageBase64 = tx.serializeMessage().toString('base64')
    // rawTxBase64 already defined above at line 296
    const sigBase58 = sig  // sig already defined above at line 299

    // --- Strong assertion to ensure payload object purity ---
    type Payload = { transaction?: string; message?: string; signature?: string };
    let payload: Payload = {};

    if (PAYLOAD_MODE === 'transaction') {
      payload = { transaction: rawTxBase64 };
    } else if (PAYLOAD_MODE === 'message') {
      payload = { message: messageBase64 };
    } else if (PAYLOAD_MODE === 'transaction+signature') {
      payload = { transaction: rawTxBase64, signature: sigBase58 };
    } else if (PAYLOAD_MODE === 'message+header-signature') {
      payload = { message: messageBase64 }; // Signature will be in HTTP header
    } else {
      // If mode is wrong, crash immediately with helpful message
      throw new Error(`[FATAL] Unknown X402_PAYLOAD_MODE specified: ${PAYLOAD_MODE}`);
    }

    // Assertion: Ensure payload object contains no unexpected keys
    const allowedKeys = ['transaction', 'message', 'signature'];
    const extraKeys = Object.keys(payload).filter(k => !allowedKeys.includes(k));
    if (extraKeys.length > 0) {
      throw new Error(`[FATAL] Payload object is contaminated with unexpected keys: ${extraKeys.join(',')}`);
    }

    // Build paymentHeaderJson
    const paymentHeaderJson = {
      x402Version: 1,
      scheme: 'exact',
      network: 'solana',
      payload // Use our freshly built pure payload object
    };
    const paymentHeader = Buffer.from(JSON.stringify(paymentHeaderJson)).toString('base64');

    // Add stricter, clearer logs for reproducibility
    console.log(`[Gateway] ===== MODE: ${PAYLOAD_MODE} =====`);
    console.log('[Gateway] paymentHeader.payload.keys:', Object.keys(payload));
    console.log('[Gateway] transaction.len(base64):', rawTxBase64.length);
    console.log('[Gateway] message.len(base64):', messageBase64.length);
    console.log('[Gateway] signature.len(base58):', sigBase58.length);
    console.log('[Gateway] ===== DEBUG: Payment Header (before Base64) =====')
    console.log(JSON.stringify(paymentHeaderJson, null, 2))
    console.log('[Gateway] ===== DEBUG: Payment Header (Base64) =====')
    console.log(paymentHeader)
    console.log('[Gateway] ===== END DEBUG =====')

    // 5) Use complete accept as paymentRequirements (this part remains unchanged)
    console.log('[Gateway] Step 5: Using complete accept as paymentRequirements...')
    console.log('[Gateway] Accept asset:', accept.asset)

    if (!accept.asset.startsWith('EPjF')) {
      console.error('[Gateway] ⚠️  WARNING: asset is not USDC mint address:', accept.asset)
      console.error('[Gateway] ⚠️  This will cause Facilitator SVM validator to fail!')
    }

    const paymentRequirements = accept

    console.log('[Gateway] paymentRequirements (complete accept):', JSON.stringify(paymentRequirements, null, 2))

    // 6) Build final verify request body in OFFICIAL CONTRACT FORM
    console.log('[Gateway] Step 6: Building verify request in official contract form...')

    const verifyBody = {
      x402Version: 1,
      paymentHeader: paymentHeader,      // CRITICAL: Top-level key is paymentHeader (Base64 string)
      paymentRequirements: paymentRequirements
    }

    const requestBodyString = JSON.stringify(verifyBody, null, 2)

    // DEBUG: Print complete verify request body in OFFICIAL CONTRACT FORM
    console.log('[Gateway] ===== DEBUG: Final Request Body (Contract Form) =====')
    console.log(requestBodyString)
    console.log('[Gateway] ===== END DEBUG =====')

    // Generate unique trace ID for this request
    const traceId = `exp-${PAYLOAD_MODE}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const verifyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'X402-Gateway/3.1-MinValidMatrix',
      'X-Trace-Id': traceId
    }

    // Add signature to HTTP header for 'message+header-signature' mode
    if (PAYLOAD_MODE === 'message+header-signature') {
      verifyHeaders['X-Signature'] = sigBase58;
      console.log('[Gateway] Added X-Signature header:', sigBase58);
    }

    // DEBUG: Print HTTP request headers
    console.log('[Gateway] ===== DEBUG: /verify HTTP Request Headers =====')
    console.log(JSON.stringify(verifyHeaders, null, 2))
    console.log('[Gateway] ===== END DEBUG =====')

    // 7) Verify and settle payment (with fallback strategy based on VERIFY_MODE)
    console.log('[Gateway] Step 7: Verifying payment...')
    console.log(`[Gateway] Verification mode: ${VERIFY_MODE}`)
    console.log(`[Gateway] Trace ID: ${traceId}`)

    let verificationPassed = false
    let txSignature = sigBase58  // Default to our calculated signature
    let verificationMethod = 'none'

    // Strategy 1: Try Facilitator first (or only)
    if (VERIFY_MODE === 'facilitator-only' || VERIFY_MODE === 'facilitator-first') {
      console.log('[Gateway] Attempting Facilitator verification...')

      try {
        const vf = await fetch(`${FACILITATOR}/verify`, {
          method: 'POST',
          headers: verifyHeaders,
          body: requestBodyString
        })

        // DEBUG: Print HTTP response
        console.log('[Gateway] ===== DEBUG: /verify HTTP Response =====')
        console.log('Status:', vf.status, vf.statusText)
        vf.headers.forEach((value, key) => {
          console.log(`  ${key}: ${value}`)
        })
        console.log('[Gateway] ===== END DEBUG =====')

        if (vf.ok) {
          const verifyResult = await vf.json() as any

          console.log('[Gateway] ===== DEBUG: /verify Response JSON =====')
          console.log(JSON.stringify(verifyResult, null, 2))
          console.log('[Gateway] ===== END DEBUG =====')

          if (verifyResult.isValid) {
            console.log('[Gateway] ✅ Facilitator verify passed')

            // Now settle (broadcast transaction)
            console.log('[Gateway] Step 8: Settling with Facilitator...')
            const sf = await fetch(`${FACILITATOR}/settle`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(verifyBody)
            })

            if (sf.ok) {
              const settlement = await sf.json() as any
              if (settlement.success) {
                txSignature = settlement.signature || settlement.txSignature || settlement.transactionSignature
                verificationPassed = true
                verificationMethod = 'facilitator'
                console.log('[Gateway] ✅ Facilitator settlement successful')
                console.log('[Gateway] Transaction signature:', txSignature)
              } else {
                console.warn('[Gateway] Facilitator settle returned success=false')
              }
            } else {
              const settleError = await sf.text()
              console.warn('[Gateway] Facilitator settle failed:', sf.status, settleError)
            }
          } else {
            console.warn('[Gateway] Facilitator verify returned isValid=false:', verifyResult.invalidReason)
          }
        } else {
          const errorText = await vf.text()
          console.warn('[Gateway] Facilitator verify failed:', vf.status, errorText)
        }
      } catch (error: any) {
        console.warn('[Gateway] Facilitator error (non-fatal):', error.message)
      }

      // If facilitator-only mode and failed, stop here
      if (VERIFY_MODE === 'facilitator-only' && !verificationPassed) {
        console.error('[Gateway] ERROR: Facilitator-only mode, verification failed')
        return res.status(502).json({
          error: 'Facilitator verification failed in facilitator-only mode',
          mode: VERIFY_MODE
        })
      }
    }

    // Strategy 2: Use local chain verification (fallback or primary)
    if (!verificationPassed && VERIFY_MODE !== 'facilitator-only') {
      console.log('[Gateway] Using local chain verification fallback')

      try {
        // Broadcast transaction ourselves
        console.log('[Gateway] Broadcasting transaction to chain...')
        const broadcastSig = await conn.sendRawTransaction(rawTx, {
          skipPreflight: false,
          maxRetries: 3
        })
        console.log('[Gateway] Transaction broadcasted:', broadcastSig)

        // Wait for confirmation
        console.log('[Gateway] Waiting for confirmation...')
        const confirmation = await conn.confirmTransaction(broadcastSig, 'confirmed')

        if (confirmation.value.err) {
          console.error('[Gateway] Transaction failed on-chain:', confirmation.value.err)
          return res.status(502).json({
            error: 'Transaction failed on-chain',
            details: confirmation.value.err
          })
        }

        console.log('[Gateway] Transaction confirmed on-chain')

        // Verify payment details on-chain
        console.log('[Gateway] Verifying payment details on-chain...')
        const isValid = await localVerifyOnChain(broadcastSig, accept)

        if (isValid) {
          txSignature = broadcastSig
          verificationPassed = true
          verificationMethod = 'local-chain'
          console.log('[Gateway] ✅ Local chain verification passed')
        } else {
          console.error('[Gateway] Local chain verification failed')
          return res.status(502).json({
            error: 'Local chain verification failed',
            signature: broadcastSig
          })
        }
      } catch (error: any) {
        console.error('[Gateway] Local verification error:', error.message)
        return res.status(502).json({
          error: 'Local verification error',
          details: error.message
        })
      }
    }

    // Final check
    if (!verificationPassed) {
      console.error('[Gateway] ERROR: All verification methods failed')
      return res.status(502).json({
        error: 'Payment verification failed',
        mode: VERIFY_MODE,
        methods_tried: VERIFY_MODE === 'facilitator-only' ? ['facilitator'] : ['facilitator', 'local-chain']
      })
    }

    console.log('[Gateway] ✅ Payment verification complete')
    console.log(`[Gateway] Verification method: ${verificationMethod}`)
    console.log(`[Gateway] Final signature: ${txSignature}`)

    // 9) Construct X-PAYMENT header for resource replay
    // In official contract form, X-PAYMENT contains the paymentHeader (already Base64)
    console.log('[Gateway] Step 9: Using paymentHeader as X-PAYMENT header...')
    const xPayment = paymentHeader  // paymentHeader is already Base64-encoded
    console.log('[Gateway] X-PAYMENT header set (Base64-encoded paymentHeader)')

    // 10) Replay request with X-PAYMENT
    console.log('[Gateway] Step 10: Replaying request with X-PAYMENT...')
    const r2 = await fetch(url, {
      method,
      headers: {
        ...headers,
        'X-PAYMENT': xPayment
      },
      body: body ? JSON.stringify(body) : undefined
    })

    console.log('[Gateway] Replay response status:', r2.status)

    // 11) Pass through response
    const text = await r2.text()
    res.status(r2.status)

    // Forward Content-Type from upstream
    const contentType = r2.headers.get('content-type')
    if (contentType) {
      res.setHeader('content-type', contentType)
    }

    // Forward X-PAYMENT-RESPONSE and add signature
    const xpr = r2.headers.get('x-payment-response')
    if (xpr) {
      res.setHeader('x-payment-response', xpr)
      res.setHeader('x-payment-signature', txSignature)  // Signature from Facilitator
      console.log('[Gateway] X-PAYMENT-RESPONSE forwarded with signature')
    }

    console.log('[Gateway] ✅ Request completed successfully')
    console.log('[Gateway] ============================================')
    return res.send(text)

  } catch (error: any) {
    console.error('[Gateway] ============================================')
    console.error('[Gateway] ❌ ERROR:', error.message)
    console.error('[Gateway] Stack:', error.stack)
    console.error('[Gateway] ============================================')
    return res.status(500).json({
      error: 'gateway error',
      details: error.message
    })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'x402-gateway',
    version: '3.1',
    agent: agent.publicKey.toBase58(),
    network: NETWORK,
    facilitator: FACILITATOR,
    timestamp: new Date().toISOString()
  })
})

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'X402 Payment Gateway',
    version: '3.1',
    description: 'Agent autonomous payment handler for x402 protocol',
    endpoints: {
      'POST /agent/fetch-x402': 'Automatic 402 payment + replay',
      'GET /health': 'Health check'
    },
    agent: agent.publicKey.toBase58(),
    network: NETWORK
  })
})

const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log('========================================')
  console.log(`✅ X402 Gateway listening on port ${PORT}`)
  console.log('========================================')
})

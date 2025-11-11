import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { createTransferCheckedInstruction, getAssociatedTokenAddress } from '@solana/spl-token'
import bs58 from 'bs58'

// X402 Payment Protocol Types
interface PaymentRequirements {
  maxAmountRequired: string // Atomic units (micro-USDC on mainnet, lamports on devnet)
  asset: string // USDC mint address (mainnet) or 'SOL' (devnet)
  description: string
  resource: string
}

interface X402Payment {
  x402Version: number  // v1.0 uses number 1, not string
  scheme: string
  network: string
  payload: string // Base64 encoded transaction
}

// Initialize Solana connection (mainnet by default)
const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
)

// Load agent wallet from environment
function loadAgentWallet(): Keypair {
  const privateKeyStr = process.env.AGENT_PRIVATE_KEY

  if (!privateKeyStr) {
    throw new Error('AGENT_PRIVATE_KEY not set in environment')
  }

  try {
    // Try base58 format first (most common for Solana)
    const privateKeyBytes = bs58.decode(privateKeyStr)
    return Keypair.fromSecretKey(privateKeyBytes)
  } catch (e1) {
    try {
      // Try JSON array format [1,2,3,...]
      const privateKeyArray = JSON.parse(privateKeyStr)
      return Keypair.fromSecretKey(Uint8Array.from(privateKeyArray))
    } catch (e2) {
      throw new Error('Invalid AGENT_PRIVATE_KEY format. Expected base58 or JSON array')
    }
  }
}

const agentWallet = loadAgentWallet()

console.log(`[X402 Bridge] Agent wallet: ${agentWallet.publicKey.toBase58()}`)

/**
 * Create X402 payment header - USDC on Mainnet, SOL on Devnet
 *
 * Protocol Compliance:
 * - Mainnet: USDC SPL Token transfer_checked
 * - Devnet: SOL SystemProgram.transfer (for testing)
 * - Amount in atomic units (micro-USDC or lamports)
 * - Scheme: "exact@SVM"
 */
export async function createX402Payment(
  resourceUrl: string,
  maxAmountRequired: string,
  assetMint: string
): Promise<string> {
  try {
    const treasuryPublicKey = extractTreasuryFromUrl(resourceUrl)
    const amount = parseInt(maxAmountRequired)
    const network = process.env.NETWORK || 'solana-mainnet'

    let transferInstruction

    if (network === 'solana-mainnet') {
      // MAINNET: Use USDC SPL Token transfer_checked
      const usdcMint = new PublicKey(assetMint)

      const senderTokenAccount = await getAssociatedTokenAddress(
        usdcMint,
        agentWallet.publicKey
      )

      const recipientTokenAccount = await getAssociatedTokenAddress(
        usdcMint,
        treasuryPublicKey
      )

      transferInstruction = createTransferCheckedInstruction(
        senderTokenAccount,
        usdcMint,
        recipientTokenAccount,
        agentWallet.publicKey,
        amount,
        6 // USDC has 6 decimals
      )

      console.log(`[X402 Bridge] Mainnet USDC payment: ${amount} micro-USDC`)
    } else {
      // DEVNET: Use SOL transfer for testing
      transferInstruction = SystemProgram.transfer({
        fromPubkey: agentWallet.publicKey,
        toPubkey: treasuryPublicKey,
        lamports: amount
      })

      console.log(`[X402 Bridge] Devnet SOL payment: ${amount} lamports`)
    }

    // Build and sign transaction
    const { blockhash } = await connection.getLatestBlockhash()
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: agentWallet.publicKey
    }).add(transferInstruction)

    transaction.sign(agentWallet)

    // Serialize signed transaction
    const serializedTx = transaction.serialize().toString('base64')

    // Construct X-PAYMENT header (protocol compliant)
    const payment: X402Payment = {
      x402Version: 1,
      scheme: 'exact',
      network: 'solana',  // Must be 'solana', not 'solana-mainnet'
      payload: serializedTx
    }

    const paymentHeader = Buffer.from(JSON.stringify(payment)).toString('base64')

    console.log(`[X402 Bridge] Created payment to ${treasuryPublicKey.toBase58()}`)

    return paymentHeader

  } catch (error) {
    console.error('[X402 Bridge] Payment creation failed:', error)
    throw error
  }
}

/**
 * Verify payment via Facilitator /verify endpoint
 *
 * Protocol compliant request:
 * POST /verify
 * Body: { x402Version, paymentHeader, paymentRequirements }
 */
export async function verifyPayment(
  paymentHeader: string,
  paymentRequirements: PaymentRequirements
): Promise<any> {
  const facilitatorUrl = process.env.FACILITATOR_URL

  if (!facilitatorUrl) {
    throw new Error('FACILITATOR_URL not configured')
  }

  const response = await fetch(`${facilitatorUrl}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      x402Version: 1,
      paymentHeader,
      paymentRequirements
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Facilitator /verify failed: ${errorText}`)
  }

  return await response.json()
}

/**
 * Settle payment via Facilitator /settle endpoint
 *
 * Protocol compliant request:
 * POST /settle
 * Body: { x402Version, paymentHeader, paymentRequirements }
 */
export async function settlePayment(
  paymentHeader: string,
  paymentRequirements: PaymentRequirements
): Promise<any> {
  const facilitatorUrl = process.env.FACILITATOR_URL

  if (!facilitatorUrl) {
    throw new Error('FACILITATOR_URL not configured')
  }

  const response = await fetch(`${facilitatorUrl}/settle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      x402Version: 1,
      paymentHeader,
      paymentRequirements
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Facilitator /settle failed: ${errorText}`)
  }

  return await response.json()
}

/**
 * Extract treasury wallet address from capability URL
 * Assumes URL format includes treasury in path or query params
 */
function extractTreasuryFromUrl(url: string): PublicKey {
  // For now, use treasury from environment
  // In production, parse from 402 response or URL
  const treasuryAddress = process.env.NEXT_PUBLIC_X402_TREASURY || process.env.X402_TREASURY

  if (!treasuryAddress) {
    throw new Error('Treasury address not configured')
  }

  return new PublicKey(treasuryAddress)
}

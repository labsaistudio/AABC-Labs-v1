import { NextRequest, NextResponse } from 'next/server'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TREASURY_WALLET = process.env.X402_TREASURY_WALLET || '4tJmBXXGHV6YfE5bKLpkPYPYqaJX5PfXWNbJJRF5VwvR'
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://facilitator.payai.network'
const PRICE_USDC = process.env.X402_PRICE_USDC || '10000' // 0.01 USDC (6 decimals)
const PRICE_SOL_LAMPORTS = '10000' // 0.00001 SOL (for devnet testing)
const IS_DEVNET = process.env.NEXT_PUBLIC_ENV_MODE !== 'PRODUCTION'

export async function GET(request: NextRequest) {
  const paymentHeader = request.headers.get('X-Payment')

  if (!paymentHeader) {
    const acceptsConfig: any = {
      scheme: 'exact',
      network: IS_DEVNET ? 'solana-devnet' : 'solana',
      maxAmountRequired: IS_DEVNET ? PRICE_SOL_LAMPORTS : PRICE_USDC,
      resource: request.url,
      description: 'AABC Agent Chat Access - Advanced AI agent powered by Solana',
      mimeType: 'application/json',
      payTo: TREASURY_WALLET,
      maxTimeoutSeconds: 3600,
      outputSchema: {
        input: {
          type: 'http',
          method: 'GET',
          headerFields: {
            'X-Payment': {
              type: 'string',
              required: true,
              description: 'Payment proof signature from Solana transaction'
            }
          }
        },
        output: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          accessToken: { type: 'string' },
          expiresIn: { type: 'number' },
          chatUrl: { type: 'string' },
          apiUrl: { type: 'string' }
        }
      },
      extra: {
        facilitator: FACILITATOR_URL,
        discoverable: true,
        service: 'AABC Labs',
        features: [
          'Advanced AI conversation',
          'Solana blockchain operations',
          'Token swaps and transfers',
          'DeFi protocol interactions'
        ],
        priceUSD: '0.01',
        paymentMethod: IS_DEVNET ? 'SOL' : 'USDC'
      }
    }

    if (!IS_DEVNET) {
      acceptsConfig.asset = USDC_MINT
      acceptsConfig.extra.usdcDecimals = 6
    }

    const x402Response = {
      x402Version: 1,
      accepts: [acceptsConfig]
    }

    return new NextResponse(JSON.stringify(x402Response), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'X-Payment-Required': 'true',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Payment'
      }
    })
  }

  try {
    const isValid = await verifyPayment(paymentHeader)

    if (!isValid) {
      return new NextResponse(JSON.stringify({ error: 'Invalid payment proof' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified. Access granted to AABC Agent',
      accessToken: generateAccessToken(),
      expiresIn: 3600,
      chatUrl: '/chat',
      apiUrl: '/api/chat'
    })
  } catch (error) {
    console.error('Payment verification error:', error)
    return new NextResponse(JSON.stringify({ error: 'Payment verification failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Payment'
    }
  })
}

async function verifyPayment(paymentProof: string): Promise<boolean> {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js')

    const RPC_URL = IS_DEVNET
      ? 'https://api.devnet.solana.com'
      : 'https://api.mainnet-beta.solana.com'

    const connection = new Connection(RPC_URL, 'confirmed')

    const transaction = await connection.getTransaction(paymentProof, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    })

    if (!transaction || !transaction.meta) {
      console.error('Transaction not found or has no metadata')
      return false
    }

    if (transaction.meta.err) {
      console.error('Transaction failed on-chain:', transaction.meta.err)
      return false
    }

    const recipientPubkey = new PublicKey(TREASURY_WALLET)
    const accountKeys = transaction.transaction.message.getAccountKeys()

    const recipientIndex = accountKeys.staticAccountKeys.findIndex(
      (key: any) => key.equals(recipientPubkey)
    )

    if (recipientIndex === -1) {
      console.error('Recipient not found in transaction')
      return false
    }

    const preBalance = transaction.meta.preBalances[recipientIndex]
    const postBalance = transaction.meta.postBalances[recipientIndex]
    const received = postBalance - preBalance

    const expectedAmount = IS_DEVNET
      ? parseInt(PRICE_SOL_LAMPORTS)
      : parseInt(PRICE_USDC)

    if (received >= expectedAmount) {
      console.log(`Payment verified: ${received} lamports received (expected ${expectedAmount})`)
      return true
    }

    console.error(`Insufficient payment: ${received} lamports (expected ${expectedAmount})`)
    return false

  } catch (error) {
    console.error('On-chain verification failed:', error)
    return false
  }
}

function generateAccessToken(): string {
  return Buffer.from(JSON.stringify({
    timestamp: Date.now(),
    expiresAt: Date.now() + 3600000,
    service: 'aabc-agent'
  })).toString('base64')
}

import { NextRequest, NextResponse } from 'next/server'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TREASURY_WALLET = process.env.X402_TREASURY_WALLET || '4tJmBXXGHV6YfE5bKLpkPYPYqaJX5PfXWNbJJRF5VwvR'
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://facilitator.payai.network'
const PRICE_USDC = process.env.X402_PRICE_USDC || '10000' // 0.01 USDC (6 decimals)
const IS_DEVNET = process.env.NEXT_PUBLIC_ENV_MODE !== 'PRODUCTION'

export async function GET(request: NextRequest) {
  const paymentHeader = request.headers.get('X-Payment')

  if (!paymentHeader) {
    const x402Response = {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: IS_DEVNET ? 'solana-devnet' : 'solana',
          maxAmountRequired: PRICE_USDC,
          resource: request.url,
          description: 'AABC Agent Chat Access - Advanced AI agent powered by Solana',
          mimeType: 'application/json',
          payTo: TREASURY_WALLET,
          maxTimeoutSeconds: 3600,
          asset: USDC_MINT,
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
            usdcDecimals: 6,
            priceUSD: '0.01'
          }
        }
      ]
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
    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature: paymentProof,
        network: IS_DEVNET ? 'solana-devnet' : 'solana-mainnet'
      })
    })

    if (response.ok) {
      const data = await response.json()
      return data.verified === true
    }

    return false
  } catch (error) {
    console.error('Facilitator verification failed:', error)
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

// X402 payment-gated capability endpoint for Web Search
// Protocol reference: https://solana.com/developers/guides/getstarted/intro-to-x402

import { NextRequest, NextResponse } from 'next/server'
import { verifyPayment } from '../x402-verify'

const FACILITATOR = process.env.NEXT_PUBLIC_FACILITATOR!
const NETWORK = 'solana'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!
const TREASURY = process.env.NEXT_PUBLIC_X402_TREASURY!
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT

const PAYMENT_REQUIREMENTS = {
  scheme: 'exact',
  network: NETWORK,
  maxAmountRequired: '1000',
  resource: `${BASE_URL}/api/capabilities/web_search`,
  description: 'AABC Capability: Internet Search ($0.001)',
  mimeType: 'application/json',
  payTo: TREASURY,
  maxTimeoutSeconds: 60,
  asset: USDC_MINT,
  outputSchema: {
    input: {
      type: 'http' as const,
      method: 'GET' as const,
      headerFields: {
        'X-Payment': {
          type: 'string',
          required: true,
          description: 'Payment proof (Base64 encoded JSON)'
        }
      }
    },
    output: {
      success: { type: 'boolean' },
      capability: { type: 'string' },
      message: { type: 'string' },
      payer: { type: 'string' },
      timestamp: { type: 'string' }
    }
  },
  extra: {
    facilitator: FACILITATOR,
    discoverable: true,
    service: 'AABC Labs',
    category: 'Data Acquisition',
    priceUSD: '0.001',
    usdcDecimals: 6
  }
}

function build402Response() {
  return new NextResponse(JSON.stringify({
    x402Version: 1,
    accepts: [PAYMENT_REQUIREMENTS]
  }), {
    status: 402,
    headers: {
      'content-type': 'application/json',
      'access-control-expose-headers': 'X-PAYMENT-RESPONSE',
    }
  })
}

async function handleRequest(req: NextRequest) {
  const xPayment = req.headers.get('x-payment') || req.headers.get('X-PAYMENT')

  if (!xPayment) {
    return build402Response()
  }

  let paymentPayload: any
  try {
    paymentPayload = JSON.parse(Buffer.from(xPayment, 'base64').toString('utf-8'))
  } catch (e) {
    return NextResponse.json({ error: 'invalid X-PAYMENT format' }, { status: 400 })
  }

  const verificationResult = await verifyPayment(paymentPayload, PAYMENT_REQUIREMENTS)

  if (verificationResult.error) {
    return NextResponse.json(
      { error: verificationResult.error },
      { status: verificationResult.status || 502 }
    )
  }

  const { verify, usedLocalVerify } = verificationResult

  let settlement: any = { settled: false }
  try {
    const settleRes = await fetch(`${FACILITATOR}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload,
        paymentRequirements: PAYMENT_REQUIREMENTS
      })
    })
    if (settleRes.ok) {
      settlement = await settleRes.json()
    }
  } catch (e: any) {
    // Settlement is optional
  }

  const data = {
    success: true,
    capability: 'web_search',
    message: 'Web search capability accessed successfully',
    payer: verify.payer,
    timestamp: new Date().toISOString()
  }

  const res = NextResponse.json(data, { status: 200 })
  res.headers.set('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify(settlement)).toString('base64'))
  res.headers.set('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE')

  return res
}

export async function GET(req: NextRequest) {
  return handleRequest(req)
}

export async function POST(req: NextRequest) {
  return handleRequest(req)
}

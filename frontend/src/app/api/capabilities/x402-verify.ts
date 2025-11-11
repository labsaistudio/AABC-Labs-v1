// Shared X402 verification logic for all capability routes
// Implements local-first fallback when Facilitator fails

import { Connection } from '@solana/web3.js'

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
const TREASURY = process.env.NEXT_PUBLIC_X402_TREASURY!
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT!
const FACILITATOR = process.env.NEXT_PUBLIC_FACILITATOR!
export const VERIFY_MODE = process.env.X402_VERIFY_MODE || 'local-first'

/**
 * Local on-chain verification (fallback when Facilitator fails)
 * Verifies transaction directly on Solana blockchain
 */
export async function localVerifyOnChain(
  paymentPayload: any,
  paymentRequirements: any
): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }> {
  try {
    const { signature, payer } = paymentPayload

    if (!signature || !payer) {
      return { isValid: false, invalidReason: 'Missing signature or payer in paymentPayload' }
    }

    console.log('[LocalVerify] Verifying transaction on-chain:', signature)

    const connection = new Connection(RPC_URL, 'confirmed')

    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    })

    if (!tx) {
      return { isValid: false, invalidReason: 'Transaction not found on chain' }
    }

    if (tx.meta?.err) {
      return { isValid: false, invalidReason: 'Transaction failed on chain' }
    }

    console.log('[LocalVerify] Transaction confirmed on-chain')

    const preTokenBalances = tx.meta?.preTokenBalances || []
    const postTokenBalances = tx.meta?.postTokenBalances || []

    let transferAmount = 0
    let transferredToTreasury = false

    for (let i = 0; i < preTokenBalances.length; i++) {
      const preBal = preTokenBalances[i]
      const postBal = postTokenBalances.find(p => p.accountIndex === preBal.accountIndex)

      if (!postBal) continue

      const preAmount = preBal.uiTokenAmount.uiAmount || 0
      const postAmount = postBal.uiTokenAmount.uiAmount || 0
      const delta = preAmount - postAmount

      if (delta > 0 && preBal.mint === USDC_MINT) {
        transferAmount = Math.round(delta * 1000000)
      }
    }

    for (const postBal of postTokenBalances) {
      const preBal = preTokenBalances.find(p => p.accountIndex === postBal.accountIndex)
      if (!preBal) continue

      const preAmount = preBal.uiTokenAmount.uiAmount || 0
      const postAmount = postBal.uiTokenAmount.uiAmount || 0
      const delta = postAmount - preAmount

      if (delta > 0 && postBal.mint === USDC_MINT && postBal.owner === TREASURY) {
        transferredToTreasury = true
        console.log('[LocalVerify] Confirmed transfer to Treasury')
      }
    }

    if (!transferredToTreasury) {
      return { isValid: false, invalidReason: 'No USDC transfer to Treasury found' }
    }

    const requiredAmount = parseInt(paymentRequirements.maxAmountRequired)
    if (transferAmount < requiredAmount) {
      return {
        isValid: false,
        invalidReason: `Insufficient amount: ${transferAmount} < ${requiredAmount} micro-USDC`
      }
    }

    console.log('[LocalVerify] All checks passed')
    return { isValid: true, payer }

  } catch (error: any) {
    console.error('[LocalVerify] Error:', error)
    return { isValid: false, invalidReason: `Local verification error: ${error.message}` }
  }
}

/**
 * Unified verification logic with local-first fallback
 * Tries Facilitator first, falls back to chain verification on failure
 */
export async function verifyPayment(
  paymentPayload: any,
  paymentRequirements: any
): Promise<{ verify: any; usedLocalVerify: boolean; error?: string; status?: number }> {
  let verify: any = null
  let usedLocalVerify = false

  if (VERIFY_MODE === 'local-only') {
    console.log('[Verify] Using local-only verification mode')
    verify = await localVerifyOnChain(paymentPayload, paymentRequirements)
    usedLocalVerify = true
  } else {
    try {
      const verifyRes = await fetch(`${FACILITATOR}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentPayload,
          paymentRequirements
        })
      })

      if (verifyRes.ok) {
        verify = await verifyRes.json()
        console.log('[Verify] Facilitator verification result:', verify.isValid)
      } else {
        console.warn('[Verify] Facilitator returned non-200:', verifyRes.status)
        verify = null
      }
    } catch (e: any) {
      console.warn('[Verify] Facilitator unreachable:', e.message)
      verify = null
    }

    if (!verify || !verify.isValid) {
      if (VERIFY_MODE === 'local-first' || VERIFY_MODE === 'dual') {
        console.log('[Verify] Falling back to local on-chain verification')
        verify = await localVerifyOnChain(paymentPayload, paymentRequirements)
        usedLocalVerify = true
      } else if (VERIFY_MODE === 'facilitator-only') {
        return {
          verify: null,
          usedLocalVerify: false,
          error: 'Facilitator verification failed and local fallback disabled',
          status: 502
        }
      }
    }
  }

  if (!verify || !verify.isValid) {
    return {
      verify,
      usedLocalVerify,
      error: `Payment verification failed: ${verify?.invalidReason || 'unknown'}`,
      status: 402
    }
  }

  console.log(`[Verify] Payment verified via ${usedLocalVerify ? 'LOCAL CHAIN' : 'FACILITATOR'} ✅`)
  return { verify, usedLocalVerify }
}

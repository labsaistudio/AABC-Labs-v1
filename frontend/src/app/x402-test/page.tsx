'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState } from 'react'
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token'

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
const TREASURY_WALLET = new PublicKey('ExV9U4FoXYBaEgUS1M7iYXsCGnctU6rmf4P4sU4TFN94')
const PRICE_USDC = 10000 // 0.01 USDC

export default function X402TestPage() {
  const { publicKey, signTransaction, connected } = useWallet()
  const [status, setStatus] = useState('')
  const [signature, setSignature] = useState('')
  const [apiResponse, setApiResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const testX402Flow = async () => {
    if (!publicKey || !signTransaction) {
      setStatus('Please connect your wallet first')
      return
    }

    try {
      setLoading(true)
      setStatus('Step 1: Fetching 402 payment requirements...')

      // Step 1: Get 402 response
      const response402 = await fetch('/api/x402/chat')
      const paymentReq = await response402.json()

      setStatus('Step 2: Creating USDC transfer transaction...')

      // Step 2: Create USDC transfer
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
      )

      const fromTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        publicKey
      )

      const toTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        TREASURY_WALLET
      )

      const transaction = new Transaction().add(
        createTransferInstruction(
          fromTokenAccount,
          toTokenAccount,
          publicKey,
          PRICE_USDC
        )
      )

      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      setStatus('Step 3: Requesting wallet signature...')

      // Step 3: Sign transaction
      const signed = await signTransaction(transaction)

      setStatus('Step 4: Sending transaction to Solana...')

      // Step 4: Send transaction
      const txSignature = await connection.sendRawTransaction(signed.serialize())

      setStatus('Step 5: Waiting for confirmation...')

      // Step 5: Confirm
      await connection.confirmTransaction(txSignature)

      setSignature(txSignature)
      setStatus('Step 6: Accessing API with payment proof...')

      // Step 6: Access API with payment proof
      const accessResponse = await fetch('/api/x402/chat', {
        headers: {
          'X-Payment': txSignature
        }
      })

      const accessData = await accessResponse.json()
      setApiResponse(accessData)

      setStatus('✅ Success! Payment verified and access granted.')

    } catch (error: any) {
      setStatus(`❌ Error: ${error.message}`)
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20">
          <h1 className="text-4xl font-bold text-white mb-4">
            AABC Labs X402 Test
          </h1>

          <p className="text-white/80 mb-8">
            Test the complete X402 payment flow: pay 0.01 USDC to access AABC Agent
          </p>

          <div className="space-y-6">
            {/* Wallet Connection */}
            <div className="bg-white/5 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">
                1. Connect Wallet
              </h2>
              <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
            </div>

            {/* Payment Info */}
            {connected && (
              <div className="bg-white/5 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">
                  2. Payment Details
                </h2>
                <div className="space-y-2 text-white/80">
                  <p><strong>Price:</strong> 0.01 USDC</p>
                  <p><strong>To:</strong> {TREASURY_WALLET.toString().slice(0, 20)}...</p>
                  <p><strong>Access Duration:</strong> 1 hour</p>
                </div>
              </div>
            )}

            {/* Test Button */}
            {connected && (
              <button
                onClick={testX402Flow}
                disabled={loading}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 text-white font-semibold py-4 px-8 rounded-xl transition-all"
              >
                {loading ? 'Processing...' : 'Test X402 Payment Flow'}
              </button>
            )}

            {/* Status */}
            {status && (
              <div className="bg-white/5 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-2">Status</h3>
                <p className="text-white/80">{status}</p>
              </div>
            )}

            {/* Transaction Signature */}
            {signature && (
              <div className="bg-white/5 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Transaction Signature
                </h3>
                <a
                  href={`https://solscan.io/tx/${signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 break-all"
                >
                  {signature}
                </a>
              </div>
            )}

            {/* API Response */}
            {apiResponse && (
              <div className="bg-white/5 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-2">
                  API Response
                </h3>
                <pre className="text-white/80 text-sm overflow-auto">
                  {JSON.stringify(apiResponse, null, 2)}
                </pre>
              </div>
            )}

            {/* X402scan Link */}
            <div className="bg-white/5 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                View on X402scan
              </h3>
              <a
                href="https://www.x402scan.com/?chain=solana"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-all"
              >
                Open X402scan
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

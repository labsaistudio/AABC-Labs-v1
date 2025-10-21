
import { Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { TokenFallbackService } from './tokenFallbackService.js';


const blinkStorage = new Map();

export class BlinksService {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;

    this.baseUrl = process.env.BLINKS_BASE_URL || 'https://solana-aabc.up.railway.app';
    // Initialize token fallback service for address resolution
    this.tokenFallbackService = new TokenFallbackService();

    // ⚠️ IMPORTANT: Blinks MUST use mainnet tokens
    // Jupiter only supports mainnet, regardless of SOLANA_NETWORK setting
    // Blinks are designed for production use with real liquidity
    this.network = 'mainnet-beta';
    console.log('🌐 BlinksService initialized with mainnet-beta tokens (Jupiter requirement)');
  }


  getBlink(blinkId) {
    return blinkStorage.get(blinkId);
  }


  saveBlink(blinkId, data) {
    blinkStorage.set(blinkId, data);
  }


  resolveTokenAddress(tokenIdentifier) {

    if (tokenIdentifier.length > 32) {
      return tokenIdentifier;
    }


    const address = this.tokenFallbackService.getTokenAddress(tokenIdentifier, this.network);

    if (address) {
      return address;
    }


    console.warn(`⚠️ Token ${tokenIdentifier} not found in fallback service, using as-is`);
    return tokenIdentifier;
  }


  async createTransferBlink(to, amount, token = 'SOL') {
    try {

      const transaction = new Transaction();

      if (token === 'SOL') {
        const toPubkey = new PublicKey(to);
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: toPubkey,
            lamports: amount * LAMPORTS_PER_SOL
          })
        );
      }


      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;


      const serializedTx = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      const encodedTx = bs58.encode(serializedTx);


      const blinkId = `blink_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const blinkUrl = `${this.baseUrl}/blinks/${blinkId}`;


      const blinkData = {
        id: blinkId,
        type: 'transfer',
        url: blinkUrl,
        to,
        amount,
        token,
        transaction: encodedTx,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        status: 'pending'
      };


      this.saveBlink(blinkId, blinkData);



      const dialectUrl = `https://dial.to/?action=${encodeURIComponent(blinkUrl)}`;

      return {
        success: true,
        blink: {
          id: blinkId,
          url: dialectUrl,
          rawBlinkUrl: blinkUrl,
          shareUrl: dialectUrl,
          to,
          amount,
          token,
          expiresAt: blinkData.expiresAt,
          metadata: {
            title: `Transfer ${amount} ${token}`,
            description: `Send ${amount} ${token} to ${to.substring(0, 8)}...`,

            icon: 'https://solana.com/favicon.ico'
          }
        }
      };
    } catch (error) {
      console.error('Create transfer blink error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async createSwapBlink(inputMint, outputMint, amount, slippage = 0.5) {
    try {
      const blinkId = `blink_swap_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const blinkUrl = `${this.baseUrl}/blinks/${blinkId}`;


      const dialectUrl = `https://dial.to/?action=${encodeURIComponent(blinkUrl)}`;

      const blinkData = {
        id: blinkId,
        type: 'swap',
        url: dialectUrl,
        rawBlinkUrl: blinkUrl,
        shareUrl: dialectUrl,
        inputMint,
        outputMint,
        amount,
        slippage,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'pending',
        metadata: {
          title: `Swap ${amount} tokens`,
          description: `Swap via Jupiter Aggregator`,

          icon: 'https://jup.ag/favicon.ico'
        }
      };


      this.saveBlink(blinkId, blinkData);

      return {
        success: true,
        blink: blinkData
      };
    } catch (error) {
      console.error('Create swap blink error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async executeSwapBlink(blinkData, userWalletAddress) {
    try {
      console.log('📝 Executing Swap Blink:', {
        blinkId: blinkData.id,
        userWallet: userWalletAddress,
        swap: `${blinkData.inputMint} -> ${blinkData.outputMint}`,
        amount: blinkData.amount
      });

      const userPubkey = new PublicKey(userWalletAddress);

      // Resolve token addresses using TokenFallbackService
      const inputMintAddr = this.resolveTokenAddress(blinkData.inputMint);
      const outputMintAddr = this.resolveTokenAddress(blinkData.outputMint);

      console.log('🔍 Resolved token addresses:', {
        input: `${blinkData.inputMint} -> ${inputMintAddr}`,
        output: `${blinkData.outputMint} -> ${outputMintAddr}`,
        network: this.network
      });

      // Convert amount to smallest units
      const amountInSmallestUnits = Math.floor(blinkData.amount * LAMPORTS_PER_SOL);
      const slippageBps = Math.round(blinkData.slippage * 100);

      // Step 1: Get quote from Jupiter
      const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMintAddr}&outputMint=${outputMintAddr}&amount=${amountInSmallestUnits}&slippageBps=${slippageBps}`;

      console.log('🔄 Fetching Jupiter quote:', quoteUrl);
      const quoteResponse = await fetch(quoteUrl);

      if (!quoteResponse.ok) {
        throw new Error(`Jupiter quote failed: ${quoteResponse.status} ${quoteResponse.statusText}`);
      }

      const quoteData = await quoteResponse.json();

      if (!quoteData) {
        throw new Error('Failed to get quote from Jupiter');
      }

      console.log('✅ Got Jupiter quote:', {
        inputAmount: quoteData.inAmount,
        outputAmount: quoteData.outAmount
      });

      // Step 2: Get swap transaction from Jupiter
      const swapUrl = 'https://lite-api.jup.ag/swap/v1/swap';
      const swapResponse = await fetch(swapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: userPubkey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            autoMultiplier: 2
          }
        })
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        throw new Error(`Jupiter swap failed: ${swapResponse.status} ${errorText}`);
      }

      const swapData = await swapResponse.json();

      if (!swapData || !swapData.swapTransaction) {
        throw new Error('Failed to get swap transaction from Jupiter');
      }

      // Return the serialized transaction (already in base64)
      console.log('✅ Swap Blink transaction built successfully');
      return swapData.swapTransaction;

    } catch (error) {
      console.error('❌ Execute Swap Blink error:', error);
      throw new Error(`Failed to build swap transaction: ${error.message}`);
    }
  }


  async executeTransferBlink(blinkData, userWalletAddress) {
    try {
      console.log('📝 Executing Transfer Blink:', {
        blinkId: blinkData.id,
        userWallet: userWalletAddress,
        to: blinkData.to,
        amount: blinkData.amount,
        token: blinkData.token
      });

      const userPubkey = new PublicKey(userWalletAddress);
      const toPubkey = new PublicKey(blinkData.to);

      // Create transfer transaction
      const transaction = new Transaction();

      if (blinkData.token === 'SOL') {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: userPubkey,
            toPubkey: toPubkey,
            lamports: Math.floor(blinkData.amount * LAMPORTS_PER_SOL)
          })
        );
      } else {
        throw new Error('SPL token transfers not yet implemented in Blinks');
      }

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userPubkey;

      // Serialize transaction to base64
      const serializedTransaction = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      const base64Transaction = serializedTransaction.toString('base64');

      console.log('✅ Transfer Blink transaction built successfully');
      return base64Transaction;

    } catch (error) {
      console.error('❌ Execute Transfer Blink error:', error);
      throw new Error(`Failed to build transfer transaction: ${error.message}`);
    }
  }


  async executeBlink(blinkUrl) {
    try {

      const blinkId = blinkUrl.split('/').pop();



      return {
        success: true,
        executed: true,
        blinkId,
        message: 'Blink executed successfully (simulation)',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Execute blink error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

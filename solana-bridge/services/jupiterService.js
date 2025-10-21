


import dns from 'dns';


dns.setServers([
  '8.8.8.8',   // Google DNS
  '8.8.4.4',   // Google DNS backup
  '1.1.1.1',   // Cloudflare DNS
  '1.0.0.1'    // Cloudflare DNS backup
]);





export class JupiterService {
  constructor() {


    this.apiUrl = 'https://lite-api.jup.ag/swap/v1';
    this.timeout = 15000;
  }

  async getQuote(inputMint, outputMint, amount) {
    try {

      const normalizedInputMint = inputMint === 'SOL'
        ? 'So11111111111111111111111111111111111111112'  // Wrapped SOL
        : inputMint;

      const normalizedOutputMint = outputMint === 'SOL'
        ? 'So11111111111111111111111111111111111111112'
        : outputMint;

      const params = new URLSearchParams({
        inputMint: normalizedInputMint,
        outputMint: normalizedOutputMint,
        amount: Math.floor(amount * 1e9).toString(),
        slippageBps: '50', // 0.5%
        feeBps: '0'
      });

      console.log(`Jupiter quote request: ${this.apiUrl}/quote?${params.toString()}`);
      console.log('DNS servers:', dns.getServers());





      const response = await fetch(`${this.apiUrl}/quote?${params}`, {

        signal: AbortSignal.timeout(this.timeout),
        headers: {
          'User-Agent': 'AABC-Solana-Bridge/1.0',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Jupiter API error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();







      const outputAmountRaw = parseInt(data.outAmount);
      const inputAmountRaw = parseInt(data.inAmount);



      const usdValue = parseFloat(data.swapUsdValue || '0');

      return {
        success: true,
        quote: {
          inputMint,
          outputMint,
          inputAmount: amount,
          outputAmount: outputAmountRaw,
          outputAmountFormatted: usdValue,
          price: amount > 0 ? outputAmountRaw / (amount * 1e9) : 0,
          priceImpact: parseFloat(data.priceImpactPct || '0'),
          route: 'Jupiter Lite API',
          fees: data.platformFee?.amount || 0,
          rawData: data
        }
      };
    } catch (error) {
      console.error('Jupiter quote error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async swap(connection, wallet, inputMint, outputMint, amount) {
    try {

      const quoteResponse = await this.getQuote(inputMint, outputMint, amount);
      if (!quoteResponse.success) {
        return quoteResponse;
      }


      const swapResponse = await fetch(`${this.apiUrl}/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse: quoteResponse.quote,
          userPublicKey: wallet.publicKey.toString(),
          wrapUnwrapSOL: true,
          computeUnitPriceMicroLamports: 'auto'
        })
      });

      const swapData = await swapResponse.json();

      if (!swapResponse.ok) {
        throw new Error(swapData.error || 'Failed to get swap transaction');
      }


      return {
        success: true,
        transaction: swapData.swapTransaction,
        quote: quoteResponse.quote
      };
    } catch (error) {
      console.error('Jupiter swap error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

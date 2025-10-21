// Jupiter API Proxy Service


export class JupiterProxyService {
  constructor() {

    this.endpoints = [
      'https:
      'https:
      'https:
    ];
    this.currentEndpointIndex = 0;
    this.timeout = 15000;
  }

  async getQuote(inputMint, outputMint, amount) {

    const normalizedInputMint = inputMint === 'SOL'
      ? 'So11111111111111111111111111111111111111112'
      : inputMint;

    const normalizedOutputMint = outputMint === 'SOL'
      ? 'So11111111111111111111111111111111111111112'
      : outputMint;

    const params = new URLSearchParams({
      inputMint: normalizedInputMint,
      outputMint: normalizedOutputMint,
      amount: Math.floor(amount * 1e9).toString(),
      slippageBps: '50',
      feeBps: '0'
    });


    for (let i = 0; i < this.endpoints.length; i++) {
      const endpoint = this.endpoints[(this.currentEndpointIndex + i) % this.endpoints.length];

      try {
        console.log(`Trying Jupiter endpoint: ${endpoint}/quote`);

        const response = await fetch(`${endpoint}/quote?${params}`, {
          signal: AbortSignal.timeout(this.timeout),
          headers: {
            'User-Agent': 'AABC-Solana-Bridge/1.0',
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          console.error(`Endpoint ${endpoint} returned ${response.status}`);
          continue;
        }

        const data = await response.json();


        this.currentEndpointIndex = (this.currentEndpointIndex + i) % this.endpoints.length;
        console.log(`✅ Jupiter quote successful via ${endpoint}`);

        return {
          success: true,
          quote: {
            inputMint,
            outputMint,
            inputAmount: amount,
            outputAmount: parseFloat(data.outAmount) / 1e9,
            price: parseFloat(data.outAmount) / (amount * 1e9),
            priceImpact: data.priceImpactPct || 0,
            route: 'Jupiter Aggregator V6',
            fees: data.platformFee?.amount || 0,
            endpoint: endpoint
          }
        };
      } catch (error) {
        console.error(`Endpoint ${endpoint} failed:`, error.message);

      }
    }


    return {
      success: false,
      error: 'All Jupiter endpoints failed. Jupiter API may be unavailable in Railway environment.',
      triedEndpoints: this.endpoints
    };
  }

  async swap(connection, wallet, inputMint, outputMint, amount) {

    const quoteResponse = await this.getQuote(inputMint, outputMint, amount);
    if (!quoteResponse.success) {
      return quoteResponse;
    }


    const endpoint = this.endpoints[this.currentEndpointIndex];

    try {
      const swapResponse = await fetch(`${endpoint}/swap`, {
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

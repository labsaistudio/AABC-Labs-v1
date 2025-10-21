
import { PublicKey, Connection } from '@solana/web3.js';
import fetch from 'node-fetch';

// Pyth Price Feed IDs (Devnet/Mainnet)
const PRICE_FEED_IDS = {
  'SOL/USD': {
    devnet: 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix',
    mainnet: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'
  },
  'BTC/USD': {
    devnet: 'HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J',
    mainnet: 'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU'
  },
  'ETH/USD': {
    devnet: 'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw',
    mainnet: 'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB'
  },
  'USDC/USD': {
    devnet: '5SSkXsEKQepHHAewytPVwdej4epN1nxgLVM84L4KXgy7',
    mainnet: 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'
  },
  'USDT/USD': {
    devnet: '38xoQ4oeJCBrcVvca2cGk7iV1dAfrmTR1kmhSCJQ8Jto',
    mainnet: '3vxLXJqLqF3JG5TCbYycbKWRBbCJQLxQmBGCkyqEEefL'
  }
};


const PYTH_ENDPOINTS = {
  devnet: 'https://api.devnet.pythnetwork.com',
  testnet: 'https://api.testnet.pythnetwork.com',
  mainnet: 'https://api.pythnetwork.com'
};

export class PythService {
  constructor(connection, network = 'devnet') {
    this.connection = connection;
    this.network = network;
    this.endpoint = PYTH_ENDPOINTS[network] || PYTH_ENDPOINTS.devnet;
    this.priceFeeds = new Map();
    this.subscriptions = new Map();
  }


  async getPrice(symbol) {
    try {

      const feedId = this.getPriceFeedId(symbol);
      if (!feedId) {
        throw new Error(`Unsupported price feed: ${symbol}`);
      }


      const response = await fetch(`${this.endpoint}/api/latest_price_feeds?ids[]=${feedId}`);

      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.statusText}`);
      }

      const data = await response.json();
      const priceData = data[0];

      if (!priceData || !priceData.price) {
        throw new Error('No price data available');
      }


      const price = this.parsePriceData(priceData.price);

      return {
        success: true,
        symbol,
        price: price.price,
        confidence: price.confidence,
        timestamp: price.publishTime,
        expo: price.expo,
        formattedPrice: this.formatPrice(price.price, price.expo),
        status: priceData.price.status
      };
    } catch (error) {
      console.error('Get price error:', error);
      return {
        success: false,
        symbol,
        error: error.message
      };
    }
  }


  async getPrices(symbols) {
    try {

      const feedIds = symbols.map(symbol => this.getPriceFeedId(symbol)).filter(id => id);

      if (feedIds.length === 0) {
        throw new Error('No valid price feeds');
      }


      const idsParam = feedIds.map(id => `ids[]=${id}`).join('&');
      const response = await fetch(`${this.endpoint}/api/latest_price_feeds?${idsParam}`);

      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.statusText}`);
      }

      const data = await response.json();


      const prices = {};
      symbols.forEach((symbol, index) => {
        if (data[index] && data[index].price) {
          const priceData = this.parsePriceData(data[index].price);
          prices[symbol] = {
            price: priceData.price,
            confidence: priceData.confidence,
            formatted: this.formatPrice(priceData.price, priceData.expo),
            timestamp: priceData.publishTime
          };
        } else {
          prices[symbol] = {
            error: 'No data available'
          };
        }
      });

      return {
        success: true,
        prices,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Get prices error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async subscribePriceUpdates(symbol, callback) {
    try {
      const feedId = this.getPriceFeedId(symbol);
      if (!feedId) {
        throw new Error(`Unsupported price feed: ${symbol}`);
      }


      if (this.subscriptions.has(symbol)) {
        this.unsubscribePriceUpdates(symbol);
      }


      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`${this.endpoint.replace('https', 'wss')}/ws`);

      ws.on('open', () => {

        ws.send(JSON.stringify({
          type: 'subscribe',
          ids: [feedId]
        }));
        console.log(`Subscribed to price updates for ${symbol}`);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'price_update' && message.price_feed) {
            const priceData = this.parsePriceData(message.price_feed.price);
            callback({
              symbol,
              price: priceData.price,
              confidence: priceData.confidence,
              formatted: this.formatPrice(priceData.price, priceData.expo),
              timestamp: priceData.publishTime
            });
          }
        } catch (e) {
          console.error('Error parsing price update:', e);
        }
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${symbol}:`, error);
        callback({ symbol, error: error.message });
      });

      ws.on('close', () => {
        console.log(`Price subscription closed for ${symbol}`);
        this.subscriptions.delete(symbol);
      });


      this.subscriptions.set(symbol, ws);

      return {
        success: true,
        symbol,
        message: 'Subscription started'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  unsubscribePriceUpdates(symbol) {
    const ws = this.subscriptions.get(symbol);
    if (ws) {
      ws.close();
      this.subscriptions.delete(symbol);
      return {
        success: true,
        symbol,
        message: 'Subscription cancelled'
      };
    }
    return {
      success: false,
      error: 'No active subscription'
    };
  }


  async getHistoricalPrices(symbol, fromTimestamp, toTimestamp) {
    try {
      const feedId = this.getPriceFeedId(symbol);
      if (!feedId) {
        throw new Error(`Unsupported price feed: ${symbol}`);
      }


      const response = await fetch(
        `${this.endpoint}/api/get_price_feed_timeseries?id=${feedId}&from=${fromTimestamp}&to=${toTimestamp}`
      );

      if (!response.ok) {
        throw new Error(`Pyth API error: ${response.statusText}`);
      }

      const data = await response.json();


      const prices = data.prices.map(pricePoint => {
        const parsed = this.parsePriceData(pricePoint);
        return {
          timestamp: parsed.publishTime,
          price: parsed.price,
          formatted: this.formatPrice(parsed.price, parsed.expo),
          confidence: parsed.confidence
        };
      });

      return {
        success: true,
        symbol,
        fromTimestamp,
        toTimestamp,
        prices,
        count: prices.length
      };
    } catch (error) {
      console.error('Get historical prices error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getPriceStats(symbol, period = '24h') {
    try {
      const feedId = this.getPriceFeedId(symbol);
      if (!feedId) {
        throw new Error(`Unsupported price feed: ${symbol}`);
      }


      const now = Math.floor(Date.now() / 1000);
      const periodSeconds = this.parsePeriod(period);
      const fromTimestamp = now - periodSeconds;


      const historical = await this.getHistoricalPrices(symbol, fromTimestamp, now);
      if (!historical.success || historical.prices.length === 0) {
        throw new Error('No historical data available');
      }


      const prices = historical.prices.map(p => p.price);
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      const open = prices[0];
      const close = prices[prices.length - 1];
      const average = prices.reduce((a, b) => a + b, 0) / prices.length;
      const change = close - open;
      const changePercent = (change / open) * 100;


      const variance = prices.reduce((sum, price) => {
        return sum + Math.pow(price - average, 2);
      }, 0) / prices.length;
      const volatility = Math.sqrt(variance);

      return {
        success: true,
        symbol,
        period,
        stats: {
          current: close,
          high,
          low,
          open,
          close,
          average,
          change,
          changePercent: changePercent.toFixed(2) + '%',
          volatility: volatility.toFixed(6),
          dataPoints: prices.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getSwapPrice(tokenIn, tokenOut, amountIn) {
    try {

      const [priceIn, priceOut] = await Promise.all([
        this.getPrice(tokenIn + '/USD'),
        this.getPrice(tokenOut + '/USD')
      ]);

      if (!priceIn.success || !priceOut.success) {
        throw new Error('Failed to fetch prices');
      }


      const rate = priceIn.price / priceOut.price;
      const amountOut = amountIn * rate;

      return {
        success: true,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        rate,
        priceIn: priceIn.formattedPrice,
        priceOut: priceOut.formattedPrice,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  getPriceFeedId(symbol) {
    const upperSymbol = symbol.toUpperCase();
    const feedConfig = PRICE_FEED_IDS[upperSymbol];
    if (feedConfig) {
      return feedConfig[this.network] || feedConfig.devnet;
    }

    const withUSD = upperSymbol + '/USD';
    const feedConfigUSD = PRICE_FEED_IDS[withUSD];
    if (feedConfigUSD) {
      return feedConfigUSD[this.network] || feedConfigUSD.devnet;
    }
    return null;
  }


  parsePriceData(priceData) {
    return {
      price: parseInt(priceData.price),
      confidence: parseInt(priceData.conf),
      expo: priceData.expo,
      publishTime: priceData.publish_time * 1000
    };
  }


  formatPrice(price, expo) {
    const actualPrice = price * Math.pow(10, expo);
    return actualPrice.toFixed(Math.abs(expo));
  }


  parsePeriod(period) {
    const periods = {
      '1h': 3600,
      '4h': 14400,
      '24h': 86400,
      '7d': 604800,
      '30d': 2592000
    };
    return periods[period] || 86400;
  }


  getSupportedSymbols() {
    return Object.keys(PRICE_FEED_IDS);
  }


  async checkFeedHealth(symbol) {
    try {
      const price = await this.getPrice(symbol);
      if (price.success) {
        const age = Date.now() - price.timestamp;
        const ageSeconds = age / 1000;

        return {
          success: true,
          symbol,
          healthy: ageSeconds < 60,
          lastUpdate: price.timestamp,
          ageSeconds: ageSeconds.toFixed(0),
          status: price.status
        };
      }
      return price;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

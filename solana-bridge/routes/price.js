import { Router } from 'express';

const router = Router();


router.get('/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = await agentService.pythService.getPrice(symbol);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/prices', async (req, res) => {
  try {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: symbols (array)'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = await agentService.pythService.getPrices(symbols);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/historical/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameters: from, to (timestamps)'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = await agentService.pythService.getHistoricalPrices(
        symbol,
        parseInt(from),
        parseInt(to)
      );
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/stats/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { period } = req.query;

    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = await agentService.pythService.getPriceStats(symbol, period);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/swap-price', async (req, res) => {
  try {
    const { tokenIn, tokenOut, amountIn } = req.body;

    if (!tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tokenIn, tokenOut, amountIn'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = await agentService.pythService.getSwapPrice(
        tokenIn,
        tokenOut,
        amountIn
      );
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/subscribe', async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: symbol'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');


      const result = await agentService.pythService.subscribePriceUpdates(
        symbol,
        (priceUpdate) => {
          res.write(`data: ${JSON.stringify(priceUpdate)}\n\n`);
        }
      );

      if (!result.success) {
        res.end();
        return;
      }


      req.on('close', () => {
        agentService.pythService.unsubscribePriceUpdates(symbol);
      });
    } else {
      res.json({
        success: false,
        error: 'Pyth service not available'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/unsubscribe', async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: symbol'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = agentService.pythService.unsubscribePriceUpdates(symbol);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/supported-symbols', async (req, res) => {
  try {
    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const symbols = agentService.pythService.getSupportedSymbols();
      return res.json({
        success: true,
        symbols
      });
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/health/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const agentService = req.app.locals.agentService;

    if (agentService.pythService) {
      const result = await agentService.pythService.checkFeedHealth(symbol);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Pyth service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== CoinGecko Integration Endpoints =====

// Get token price data from CoinGecko (batch)
router.post('/coingecko/batch', async (req, res) => {
  try {
    const { tokenAddresses } = req.body;

    if (!tokenAddresses || !Array.isArray(tokenAddresses)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: tokenAddresses (array)'
      });
    }

    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.fetchPrice) {
      return res.status(503).json({
        success: false,
        error: 'CoinGecko price data method not available. Check if COINGECKO_DEMO_API_KEY is configured.'
      });
    }

    const { PublicKey } = await import('@solana/web3.js');

    // Fetch prices for all tokens
    const prices = {};
    for (const address of tokenAddresses) {
      try {
        const price = await tokenPlugin.methods.fetchPrice(new PublicKey(address));
        prices[address] = {
          usd: parseFloat(price),
          source: 'CoinGecko'
        };
      } catch (error) {
        prices[address] = {
          error: error.message
        };
      }
    }

    res.json({
      success: true,
      data: prices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get single token price from CoinGecko
router.get('/coingecko/:tokenAddress', async (req, res) => {
  try {
    const { tokenAddress } = req.params;

    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.fetchPrice) {
      return res.status(503).json({
        success: false,
        error: 'CoinGecko price method not available'
      });
    }

    const { PublicKey } = await import('@solana/web3.js');
    const price = await tokenPlugin.methods.fetchPrice(new PublicKey(tokenAddress));

    res.json({
      success: true,
      tokenAddress,
      price: parseFloat(price),
      currency: 'USD',
      source: 'CoinGecko'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get token data by address (Jupiter API via TokenPlugin)
router.get('/coingecko/data/:tokenAddress', async (req, res) => {
  try {
    const { tokenAddress } = req.params;

    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.getTokenDataByAddress) {
      return res.status(503).json({
        success: false,
        error: 'Token data method not available'
      });
    }

    const { PublicKey } = await import('@solana/web3.js');
    const data = await tokenPlugin.methods.getTokenDataByAddress(new PublicKey(tokenAddress));

    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get token address from ticker symbol
router.get('/coingecko/ticker/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;

    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.getTokenAddressFromTicker) {
      return res.status(503).json({
        success: false,
        error: 'Token ticker lookup method not available'
      });
    }

    const address = await tokenPlugin.methods.getTokenAddressFromTicker(ticker);

    if (!address) {
      return res.status(404).json({
        success: false,
        error: `Token not found for ticker: ${ticker}`
      });
    }

    res.json({
      success: true,
      ticker: ticker.toUpperCase(),
      address
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as priceRoutes };

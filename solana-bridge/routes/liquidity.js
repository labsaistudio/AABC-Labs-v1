import { Router } from 'express';

const router = Router();


router.post('/create-pool', async (req, res) => {
  try {
    const {
      tokenA,
      tokenB,
      binStep,
      initialPricePerToken,
      depositAmountA,
      depositAmountB
    } = req.body;

    if (!tokenA || !tokenB || !initialPricePerToken) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tokenA, tokenB, initialPricePerToken'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.createPool({
        tokenA,
        tokenB,
        binStep,
        initialPricePerToken,
        depositAmountA,
        depositAmountB
      });
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/add-liquidity', async (req, res) => {
  try {
    const {
      poolAddress,
      amountA,
      amountB,
      slippage
    } = req.body;

    if (!poolAddress || !amountA || !amountB) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: poolAddress, amountA, amountB'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.addLiquidity({
        poolAddress,
        amountA,
        amountB,
        slippage
      });
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/remove-liquidity', async (req, res) => {
  try {
    const {
      poolAddress,
      lpTokenAmount,
      minAmountA,
      minAmountB
    } = req.body;

    if (!poolAddress || !lpTokenAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: poolAddress, lpTokenAmount'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.removeLiquidity({
        poolAddress,
        lpTokenAmount,
        minAmountA,
        minAmountB
      });
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/pool/:poolAddress', async (req, res) => {
  try {
    const { poolAddress } = req.params;
    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.getPoolInfo(poolAddress);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/positions/:walletAddress?', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.getUserPositions(walletAddress);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/pools', async (req, res) => {
  try {
    const { tokenA, tokenB } = req.query;
    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.getPoolList(tokenA, tokenB);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/price-impact', async (req, res) => {
  try {
    const { poolAddress, tokenIn, amountIn } = req.body;

    if (!poolAddress || !tokenIn || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: poolAddress, tokenIn, amountIn'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.meteoraService) {
      const result = await agentService.meteoraService.calculatePriceImpact(
        poolAddress,
        tokenIn,
        amountIn
      );
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Meteora service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as liquidityRoutes };

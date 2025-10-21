import { Router } from 'express';

const router = Router();




router.post('/rugcheck/check', async (req, res) => {
  try {
    const { tokenAddress } = req.body;

    if (!tokenAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: tokenAddress'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.rugcheckService) {
      const result = await agentService.rugcheckService.checkToken(tokenAddress);


      if (result.success) {
        result.recommendation = agentService.rugcheckService.getRiskRecommendation(result.riskLevel);
      }

      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Rugcheck service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/rugcheck/batch', async (req, res) => {
  try {
    const { tokenAddresses } = req.body;

    if (!tokenAddresses || !Array.isArray(tokenAddresses)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: tokenAddresses (array)'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.rugcheckService) {
      const result = await agentService.rugcheckService.checkMultipleTokens(tokenAddresses);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Rugcheck service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});




router.post('/simulate/transaction', async (req, res) => {
  try {
    const { transaction } = req.body;

    if (!transaction) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: transaction'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.simulationService) {
      const result = await agentService.simulationService.simulateTransaction(transaction);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Simulation service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/simulate/transfer', async (req, res) => {
  try {
    const { tokenAddress, fromAddress, toAddress, amount, decimals } = req.body;

    if (!tokenAddress || !fromAddress || !toAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.simulationService) {
      const result = await agentService.simulationService.simulateTokenTransfer({
        tokenAddress,
        fromAddress,
        toAddress,
        amount,
        decimals
      });
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Simulation service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/simulate/swap', async (req, res) => {
  try {
    const { inputToken, outputToken, inputAmount, slippage, dex } = req.body;

    if (!inputToken || !outputToken || !inputAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.simulationService) {
      const result = await agentService.simulationService.simulateSwap({
        inputToken,
        outputToken,
        inputAmount,
        slippage,
        dex
      });
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Simulation service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/simulate/liquidity', async (req, res) => {
  try {
    const { operation, poolAddress, tokenA, tokenB, amountA, amountB, lpAmount } = req.body;

    if (!operation || !poolAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.simulationService) {
      const result = await agentService.simulationService.simulateLiquidityOperation({
        operation,
        poolAddress,
        tokenA,
        tokenB,
        amountA,
        amountB,
        lpAmount
      });
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'Simulation service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/simulate/gas-price', async (req, res) => {
  try {
    const agentService = req.app.locals.agentService;

    if (agentService.simulationService) {
      const result = await agentService.simulationService.getGasPriceRecommendation();
      return res.json({
        success: true,
        ...result
      });
    }

    res.json({
      success: false,
      error: 'Simulation service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});




router.post('/hitl/request', async (req, res) => {
  try {
    const { operation } = req.body;

    if (!operation || !operation.type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: operation with type'
      });
    }

    const agentService = req.app.locals.agentService;

    if (agentService.hitlService) {
      const result = await agentService.hitlService.requestConfirmation(operation);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'HITL service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/hitl/approve/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approverInfo } = req.body;

    const agentService = req.app.locals.agentService;

    if (agentService.hitlService) {
      const result = await agentService.hitlService.approve(requestId, approverInfo);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'HITL service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/hitl/reject/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason, rejectorInfo } = req.body;

    const agentService = req.app.locals.agentService;

    if (agentService.hitlService) {
      const result = await agentService.hitlService.reject(requestId, reason, rejectorInfo);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'HITL service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/hitl/status/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;

    const agentService = req.app.locals.agentService;

    if (agentService.hitlService) {
      const result = agentService.hitlService.getRequestStatus(requestId);
      return res.json(result);
    }

    res.json({
      success: false,
      error: 'HITL service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/hitl/pending', async (req, res) => {
  try {
    const agentService = req.app.locals.agentService;

    if (agentService.hitlService) {
      const requests = agentService.hitlService.getPendingRequests();
      return res.json({
        success: true,
        count: requests.length,
        requests
      });
    }

    res.json({
      success: false,
      error: 'HITL service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.get('/hitl/history', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const agentService = req.app.locals.agentService;

    if (agentService.hitlService) {
      const history = agentService.hitlService.getHistory(parseInt(limit));
      return res.json({
        success: true,
        count: history.length,
        history
      });
    }

    res.json({
      success: false,
      error: 'HITL service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});




router.post('/assess', async (req, res) => {
  try {
    const { operation } = req.body;

    if (!operation) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: operation'
      });
    }

    const agentService = req.app.locals.agentService;


    const assessments = {};


    if (operation.tokenAddress && agentService.rugcheckService) {
      assessments.tokenRisk = await agentService.rugcheckService.checkToken(operation.tokenAddress);
    }


    if (operation.transaction && agentService.simulationService) {
      assessments.simulation = await agentService.simulationService.simulateTransaction(operation.transaction);
    }


    if (agentService.hitlService) {
      assessments.operationalRisk = await agentService.hitlService.assessRisk(operation);
    }


    const overallRisk = calculateOverallRisk(assessments);

    res.json({
      success: true,
      assessments,
      overallRisk,
      requiresConfirmation: overallRisk.level === 'HIGH' || overallRisk.level === 'CRITICAL',
      recommendations: overallRisk.recommendations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


function calculateOverallRisk(assessments) {
  const risks = [];
  const recommendations = new Set();


  if (assessments.tokenRisk?.riskLevel) {
    risks.push(assessments.tokenRisk.riskLevel);
    if (assessments.tokenRisk.details?.warnings) {
      assessments.tokenRisk.details.warnings.forEach(w =>
        recommendations.add(w.message)
      );
    }
  }

  if (assessments.simulation?.status === 'WARNING' || assessments.simulation?.status === 'FAILED') {
    risks.push('HIGH');
    if (assessments.simulation.recommendations) {
      assessments.simulation.recommendations.forEach(r =>
        recommendations.add(r)
      );
    }
  }

  if (assessments.operationalRisk?.level) {
    risks.push(assessments.operationalRisk.level);
    if (assessments.operationalRisk.recommendations) {
      assessments.operationalRisk.recommendations.forEach(r =>
        recommendations.add(r)
      );
    }
  }


  const riskLevels = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  let maxRiskIndex = 0;

  risks.forEach(risk => {
    const index = riskLevels.indexOf(risk);
    if (index > maxRiskIndex) {
      maxRiskIndex = index;
    }
  });

  return {
    level: riskLevels[maxRiskIndex],
    factors: risks,
    recommendations: Array.from(recommendations)
  };
}

export { router as riskRoutes };

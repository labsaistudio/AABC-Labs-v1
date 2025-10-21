import { Router } from 'express';

const router = Router();

// Get wallet balance
router.get('/balance/:address?', async (req, res) => {
  try {
    const { address } = req.params;
    const agentService = req.app.locals.agentService;

    const result = await agentService.getBalance(address);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Transfer SOL
router.post('/transfer', async (req, res) => {
  try {
    const { to, amount } = req.body;

    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: to, amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const result = await agentService.transfer(to, amount);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wallet info
router.get('/wallet', async (req, res) => {
  try {
    const agentService = req.app.locals.agentService;

    res.json({
      success: true,
      address: agentService.getWalletAddress(),
      network: agentService.getNetwork()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get transaction status
router.get('/transaction/:signature', async (req, res) => {
  try {
    const { signature } = req.params;
    const agentService = req.app.locals.agentService;
    const connection = agentService.getConnection();

    const status = await connection.getSignatureStatus(signature);

    res.json({
      success: true,
      signature,
      status: status.value
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as solanaRoutes };

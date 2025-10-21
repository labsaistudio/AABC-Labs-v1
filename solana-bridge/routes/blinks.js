import { Router } from 'express';

const router = Router();

// ========================================
// Blink GET endpoint (for wallets)
// ========================================

/**
 * GET /:blinkId
 * Get Blink details and action metadata (Solana Actions format)

 */
router.get('/:blinkId', async (req, res) => {
  try {
    const { blinkId } = req.params;


    const agentService = req.app.locals.agentService;
    if (!agentService || !agentService.blinksService) {
      return res.status(503).json({
        error: 'Blinks service not available'
      });
    }

    const blinkData = agentService.blinksService.getBlink(blinkId);

    if (!blinkData) {
      return res.status(404).json({
        error: 'Blink not found',
        blinkId
      });
    }


    if (new Date(blinkData.expiresAt) < new Date()) {
      return res.status(410).json({
        error: 'Blink expired',
        expiresAt: blinkData.expiresAt
      });
    }


    const baseUrl = process.env.BLINKS_BASE_URL || 'https://solana-aabc.up.railway.app';

    let actionsResponse;
    if (blinkData.type === 'swap') {
      actionsResponse = {
        type: 'action',

        icon: blinkData.metadata?.icon || 'https://jup.ag/favicon.ico',
        title: blinkData.metadata?.title || `Swap ${blinkData.amount} tokens`,
        description: blinkData.metadata?.description || `Swap ${blinkData.inputMint} to ${blinkData.outputMint}`,
        label: 'Swap Tokens',
        links: {
          actions: [
            {
              label: `Swap ${blinkData.amount} tokens`,
              href: `${baseUrl}/api/blinks/${blinkId}/execute`,
              parameters: []
            }
          ]
        }
      };
    } else if (blinkData.type === 'transfer') {
      actionsResponse = {
        type: 'action',

        icon: blinkData.metadata?.icon || 'https://solana.com/favicon.ico',
        title: blinkData.metadata?.title || `Transfer ${blinkData.amount} ${blinkData.token}`,
        description: blinkData.metadata?.description || `Send ${blinkData.amount} ${blinkData.token}`,
        label: 'Transfer',
        links: {
          actions: [
            {
              label: `Send ${blinkData.amount} ${blinkData.token}`,
              href: `${baseUrl}/api/blinks/${blinkId}/execute`,
              parameters: []
            }
          ]
        }
      };
    } else {
      actionsResponse = {
        type: 'action',

        icon: blinkData.metadata?.icon || 'https://solana.com/favicon.ico',
        title: blinkData.metadata?.title || 'Execute Action',
        description: blinkData.metadata?.description || `${blinkData.type} action`,
        label: 'Execute',
        links: {
          actions: [
            {
              label: 'Execute',
              href: `${baseUrl}/api/blinks/${blinkId}/execute`,
              parameters: []
            }
          ]
        }
      };
    }

    res.json(actionsResponse);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========================================
// Create and Manage Blinks
// ========================================

// Create a Blink
router.post('/create', async (req, res) => {
  try {
    const { type, params } = req.body;

    if (!type || !params) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: type, params'
      });
    }

    const agentService = req.app.locals.agentService;
    const result = await agentService.createBlink(type, params);

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

// ========================================
// Execute Blink endpoint (Solana Actions spec)
// ========================================

/**
 * POST /api/blinks/:blinkId/execute
 * Execute a specific Blink and return transaction for wallet to sign
 * Required by Solana Actions spec
 */
router.post('/:blinkId/execute', async (req, res) => {
  try {
    const { blinkId } = req.params;
    const { account } = req.body;

    if (!account) {
      return res.status(400).json({
        error: 'Missing required parameter: account (wallet address)'
      });
    }

    // Get Blink data from service
    const agentService = req.app.locals.agentService;
    if (!agentService || !agentService.blinksService) {
      return res.status(503).json({
        error: 'Blinks service not available'
      });
    }

    const blinkData = agentService.blinksService.getBlink(blinkId);

    if (!blinkData) {
      return res.status(404).json({
        error: 'Blink not found',
        blinkId
      });
    }

    // Check if expired
    if (new Date(blinkData.expiresAt) < new Date()) {
      return res.status(410).json({
        error: 'Blink expired',
        expiresAt: blinkData.expiresAt
      });
    }

    // Build transaction based on Blink type
    let transaction;
    if (blinkData.type === 'swap') {
      // Execute swap and get transaction
      transaction = await agentService.blinksService.executeSwapBlink(
        blinkData,
        account
      );
    } else if (blinkData.type === 'transfer') {
      // Execute transfer and get transaction
      transaction = await agentService.blinksService.executeTransferBlink(
        blinkData,
        account
      );
    } else {
      return res.status(400).json({
        error: `Unsupported Blink type: ${blinkData.type}`
      });
    }

    // Return transaction in Solana Actions format
    res.json({
      transaction: transaction, // base64 encoded serialized transaction
      message: `Execute ${blinkData.type} action`
    });

  } catch (error) {
    console.error('Blink execute error:', error);
    res.status(500).json({
      error: error.message || 'Failed to execute Blink'
    });
  }
});

// Execute a Blink (legacy endpoint)
router.post('/execute', async (req, res) => {
  try {
    const { blinkUrl } = req.body;

    if (!blinkUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: blinkUrl'
      });
    }

    const agentService = req.app.locals.agentService;
    const result = await agentService.executeBlink(blinkUrl);

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

// Validate a Blink
router.post('/validate', async (req, res) => {
  try {
    const { blinkUrl } = req.body;

    if (!blinkUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: blinkUrl'
      });
    }

    const agentService = req.app.locals.agentService;
    const blinksPlugin = agentService.getPlugin('blinks');

    const isValid = await blinksPlugin.validateBlink(blinkUrl);

    res.json({
      success: true,
      valid: isValid,
      blinkUrl
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Parse a Blink to get its details
router.post('/parse', async (req, res) => {
  try {
    const { blinkUrl } = req.body;

    if (!blinkUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: blinkUrl'
      });
    }

    const agentService = req.app.locals.agentService;
    const blinksPlugin = agentService.getPlugin('blinks');

    const details = await blinksPlugin.parseBlink(blinkUrl);

    res.json({
      success: true,
      details
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create different types of Blinks with specific endpoints

// Swap Blink
router.post('/create/swap', async (req, res) => {
  try {
    const { inputMint, outputMint, amount, slippage } = req.body;

    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: inputMint, outputMint, amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const result = await agentService.blinksService.createSwapBlink(
      inputMint,
      outputMint,
      amount,
      slippage || 0.5
    );

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

// Transfer Blink
router.post('/create/transfer', async (req, res) => {
  try {
    const { to, amount, token } = req.body;

    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: to, amount'
      });
    }

    const agentService = req.app.locals.agentService;

    const result = await agentService.blinksService.createTransferBlink(
      to,
      amount,
      token || 'SOL'
    );

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

// NFT Purchase Blink
router.post('/create/nft', async (req, res) => {
  try {
    const { nftAddress, price } = req.body;

    if (!nftAddress || !price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: nftAddress, price'
      });
    }

    const agentService = req.app.locals.agentService;
    const blinksPlugin = agentService.getPlugin('blinks');

    const blink = await blinksPlugin.createNFTBlink({
      nftAddress,
      price
    });

    res.json({
      success: true,
      blink
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as blinksRoutes };

import { Router } from 'express';
import { uploadJsonToPinataCustom, uploadImageToPinataCustom } from '../services/pinataHelper.js';

const router = Router();


router.post('/launch-pumpfun', async (req, res) => {
  try {
    const {
      name,
      symbol,
      description,
      image,
      twitter,
      telegram,
      website
    } = req.body;

    if (!name || !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: name, symbol'
      });
    }

    const agentService = req.app.locals.agentService;


    const tokenPlugin = agentService.getPlugin('token');
    if (tokenPlugin && tokenPlugin.methods) {

      const agent = agentService.getAgent();
      const hasPinataJWT = agent && agent.config && agent.config.PINATA_JWT;


      if (!hasPinataJWT || !tokenPlugin.methods.launchPumpFunToken) {
        console.log('⚠️ PINATA_JWT not available or launchPumpFunToken not supported, using createToken fallback...');


        if (tokenPlugin.methods.createToken) {
          try {
            console.log('🚀 Using createToken as fallback for token creation...');
            const result = await tokenPlugin.methods.createToken({
              name: name,
              symbol: symbol,
              decimals: 9,
              initialSupply: 1000000000,
              uri: ''
            });

            return res.json({
              success: true,
              mint: result.mint || result.tokenAddress || result.mintAddress,
              signature: result.signature || result.transactionSignature,
              message: 'Token created successfully (standard SPL token without Pump.fun)',
              details: {
                name,
                symbol,
                decimals: 9,
                initialSupply: 1000000000,
                type: 'SPL Token'
              }
            });
          } catch (error) {
            console.error('CreateToken fallback error:', error);
            return res.status(500).json({
              success: false,
              error: `Token creation failed: ${error.message}`,
              hint: 'Unable to create token using fallback method'
            });
          }
        } else {
          return res.status(503).json({
            success: false,
            error: 'No token creation method available',
            hint: 'Neither Pump.fun nor standard token creation is available'
          });
        }
      }


      try {
        console.log('✅ PINATA_JWT configured, launching on Pump.fun...');


        const pumpFunParams = {
          tokenName: name,
          tokenTicker: symbol,
          description: description || `${name} - Launched via AABC Labs`,
          twitter: twitter || '',
          telegram: telegram || '',
          website: website || '',
          imageUrl: image || ''
        };

        console.log('Pump.fun Parameters:', pumpFunParams);


        const result = await tokenPlugin.methods.launchPumpFunToken(pumpFunParams);

        console.log('Pump.fun launch result:', result);


        if (result && typeof result === 'object') {

          return res.json({
            success: true,
            mint: result.mint || result.tokenMint || result.tokenAddress,
            signature: result.signature || result.txSignature,
            pumpUrl: result.metadataUrl || `https://pump.fun`,
            bondingCurve: result.bondingCurve || 'created',
            type: 'Pump.fun Token',
            details: {
              name,
              symbol,
              description: description || `${name} - Launched via AABC Labs`,
              twitter,
              telegram,
              website
            },
            rawResult: result
          });
        } else {

          return res.json({
            success: true,
            signature: result,
            mint: 'pending_confirmation',
            pumpUrl: 'https://pump.fun',
            type: 'Pump.fun Token',
            details: {
              name,
              symbol,
              description
            }
          });
        }
      } catch (error) {
        console.error('Pump.fun launch error:', error);


        if (error.message?.includes('PINATA') || error.message?.includes('IPFS')) {
          console.log('⚠️ IPFS upload failed, falling back to standard token creation...');

          if (tokenPlugin.methods.createToken) {
            try {
              const fallbackResult = await tokenPlugin.methods.createToken({
                name: name,
                symbol: symbol,
                decimals: 9,
                initialSupply: 1000000000,
                uri: ''
              });

              return res.json({
                success: true,
                mint: fallbackResult.mint || fallbackResult.tokenAddress || fallbackResult.mintAddress,
                signature: fallbackResult.signature || fallbackResult.transactionSignature,
                message: 'Token created as standard SPL token (Pump.fun metadata upload failed)',
                type: 'SPL Token (Fallback)',
                details: {
                  name,
                  symbol,
                  decimals: 9,
                  initialSupply: 1000000000
                }
              });
            } catch (fallbackError) {
              console.error('Standard token creation also failed:', fallbackError);
              return res.status(500).json({
                success: false,
                error: `Both Pump.fun and standard token creation failed: ${fallbackError.message}`,
                originalError: error.message
              });
            }
          }
        }

        return res.status(500).json({
          success: false,
          error: error.message || 'Failed to launch on Pump.fun',
          hint: error.message?.includes('PINATA') ?
            'Configure PINATA_JWT in .env file. See .env.example for instructions.' : undefined
        });
      }
    }


    res.status(503).json({
      success: false,
      error: 'Token plugin not available. Please ensure Solana Agent Kit is properly initialized.'
    });
  } catch (error) {
    console.error('Route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


router.post('/create-spl', async (req, res) => {
  try {
    const {
      name,
      symbol,
      decimals = 9,
      supply = 1_000_000_000,
      uri,
      mintAuthority
    } = req.body;

    if (!name || !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: name, symbol'
      });
    }

    const agentService = req.app.locals.agentService;


    if (agentService.tokenService) {
      const result = await agentService.tokenService.createSPLToken({
        name,
        symbol,
        decimals,
        supply,
        uri,
        mintAuthority
      });
      return res.json(result);
    }


    const tokenPlugin = agentService.getPlugin('token');
    if (tokenPlugin && tokenPlugin.methods && tokenPlugin.methods.createToken) {
      const result = await tokenPlugin.methods.createToken({
        name,
        symbol,
        decimals,
        initialSupply: supply,
        uri
      });
      return res.json({
        success: true,
        ...result
      });
    }


    res.json({
      success: false,
      error: 'Token creation service not available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get token balance
router.get('/balance/:tokenAddress/:walletAddress?', async (req, res) => {
  try {
    const { tokenAddress, walletAddress } = req.params;
    const agentService = req.app.locals.agentService;

    const result = await agentService.getTokenBalance(tokenAddress, walletAddress);

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

// Create new token
router.post('/create', async (req, res) => {
  try {
    const { name, symbol, decimals, initialSupply, uri } = req.body;

    if (!name || !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: name, symbol'
      });
    }

    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.createToken) {
      return res.status(503).json({
        success: false,
        error: 'Token creation method not available'
      });
    }

    const result = await tokenPlugin.methods.createToken({
      name,
      symbol,
      decimals: decimals || 9,
      initialSupply: initialSupply || 1000000,
      uri
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Transfer tokens
router.post('/transfer', async (req, res) => {
  try {
    const { tokenAddress, to, amount } = req.body;

    if (!tokenAddress || !to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tokenAddress, to, amount'
      });
    }

    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    // TokenPlugin provides `transfer` method, not `transferToken`
    // Signature: transfer(agent, to: PublicKey, amount: number, mint?: PublicKey)
    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.transfer) {
      return res.status(503).json({
        success: false,
        error: 'Token transfer method not available'
      });
    }

    const { PublicKey } = await import('@solana/web3.js');

    // Call with positional parameters: (to, amount, mint)
    const result = await tokenPlugin.methods.transfer(
      new PublicKey(to),
      amount,
      new PublicKey(tokenAddress)
    );

    res.json({
      success: true,
      signature: result,
      transactionSignature: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get token metadata
router.get('/metadata/:tokenAddress', async (req, res) => {
  try {
    const { tokenAddress } = req.params;
    const agentService = req.app.locals.agentService;
    const tokenPlugin = agentService.getPlugin('token');

    if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.getTokenMetadata) {
      return res.status(503).json({
        success: false,
        error: 'Token metadata method not available'
      });
    }

    const metadata = await tokenPlugin.methods.getTokenMetadata(tokenAddress);

    res.json({
      success: true,
      metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Burn tokens
router.post('/burn', async (req, res) => {
  try {
    const { tokenAddress, amount } = req.body;

    if (!tokenAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: tokenAddress, amount'
      });
    }

    const agentService = req.app.locals.agentService;

    console.log('🔥 Burning tokens using SPL Token burn instruction');

    try {
      const { PublicKey } = await import('@solana/web3.js');
      const { createBurnCheckedInstruction, getAssociatedTokenAddress, getMint } = await import('@solana/spl-token');
      const { sendTx } = await import('solana-agent-kit');

      const mintPubkey = new PublicKey(tokenAddress);
      const ownerPubkey = agentService.wallet.publicKey;

      // Get associated token account
      const tokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        ownerPubkey
      );

      // Get mint info to get decimals
      const mintInfo = await getMint(
        agentService.connection,
        mintPubkey
      );

      // Convert amount to token units (considering decimals)
      const burnAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

      // Check balance before burning
      const tokenPlugin = agentService.getPlugin('token');
      if (tokenPlugin && tokenPlugin.methods && tokenPlugin.methods.get_balance) {
        const balance = await tokenPlugin.methods.get_balance(mintPubkey);
        if (balance < amount) {
          return res.status(400).json({
            success: false,
            error: `Insufficient token balance. Available: ${balance}, Requested: ${amount}`
          });
        }
      }

      // Create burn instruction with decimals for safer execution
      const burnIx = createBurnCheckedInstruction(
        tokenAccount,        // Token account
        mintPubkey,          // Mint
        ownerPubkey,         // Owner
        burnAmount,          // Amount (in smallest units)
        mintInfo.decimals    // Decimals
      );

      // Execute transaction using SolanaAgentKit's sendTx helper
      const signature = await sendTx(
        agentService.agent,
        [burnIx],
        []
      );

      // Get remaining balance
      let remainingBalance = 0;
      if (tokenPlugin && tokenPlugin.methods && tokenPlugin.methods.get_balance) {
        try {
          remainingBalance = await tokenPlugin.methods.get_balance(mintPubkey);
        } catch (e) {
          // Balance check failed, but burn succeeded
          console.warn('Failed to get remaining balance:', e.message);
        }
      }

      res.json({
        success: true,
        signature: signature,
        transactionSignature: signature,
        burnedAmount: amount,
        remainingBalance: remainingBalance,
        message: 'Tokens burned successfully using SPL Token burn instruction'
      });
    } catch (burnError) {
      console.error('Burn error:', burnError);
      res.status(500).json({
        success: false,
        error: `Failed to burn tokens: ${burnError.message}`
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export { router as tokenRoutes };

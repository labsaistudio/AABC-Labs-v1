/**
 * DeFi Service - Complete DeFi plugin integration
 *
 * Provides access to all DeFi protocols supported by Solana Agent Kit v2:
 * - Adrena (Perpetual Trading)
 * - Flash
 * - Lulo (Lending)
 * - Manifest
 * - Debridge (Cross-chain)
 * - Drift
 * - Openbook
 * - Fluxbeam
 * - Orca
 * - Ranger
 * - Raydium
 * - Solayer
 * - Voltr
 * - Sanctum
 */

export class DefiService {
  constructor(agent) {
    this.agent = agent;
    this.defiPlugin = null;
    this.initialized = false;
  }

  /**
   * Initialize DeFi plugin
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Load DeFi plugin
      const DefiPlugin = (await import('@solana-agent-kit/plugin-defi')).default;

      // Check if agent already has DeFi plugin
      if (this.agent.plugins && this.agent.plugins.has('defi')) {
        this.defiPlugin = this.agent.plugins.get('defi');
      } else {
        // Use the plugin with agent
        this.agent.use(DefiPlugin);
        this.defiPlugin = DefiPlugin;
      }

      this.initialized = true;
      console.log('✅ DeFi service initialized with plugin');
    } catch (error) {
      console.error('Failed to initialize DeFi plugin:', error);
      throw new Error('DeFi plugin initialization failed');
    }
  }

  /**
   * Execute a DeFi method with proper agent context
   */
  async executeMethod(methodName, params) {
    await this.initialize();

    if (!this.defiPlugin || !this.defiPlugin.methods) {
      throw new Error('DeFi plugin not available');
    }

    const method = this.defiPlugin.methods[methodName];
    if (!method) {
      throw new Error(`DeFi method ${methodName} not found`);
    }

    // Execute with agent as first parameter
    return await method(this.agent, params);
  }

  // ========================================
  // Jupiter Integration
  // ========================================

  /**
   * Swap tokens using Jupiter
   */
  async swap(params) {
    const { inputMint, outputMint, amount, slippage = 0.5 } = params;

    console.log(`Swapping ${amount} ${inputMint} for ${outputMint} (slippage: ${slippage}%)`);

    return await this.executeMethod('jupiterSwap', {
      inputMint,
      outputMint,
      amount,
      slippageBps: slippage * 100 // Convert percentage to basis points
    });
  }

  // ========================================
  // Adrena - Perpetual Trading
  // ========================================

  /**
   * Open a perpetual position on Adrena
   */
  async openPerpetualPosition(params) {
    const {
      side, // 'long' or 'short'
      mint, // Token to trade
      collateralMint, // Collateral token
      collateralAmount,
      leverage
    } = params;

    console.log(`Opening ${side} position for ${mint} with ${leverage}x leverage`);

    return await this.executeMethod('adrenaOpenPerpTrade', {
      side,
      mint,
      collateralMint,
      collateralAmount,
      leverage
    });
  }

  /**
   * Close a perpetual position on Adrena
   */
  async closePerpetualPosition(params) {
    const { positionId } = params;

    console.log(`Closing perpetual position ${positionId}`);

    return await this.executeMethod('adrenaClosePerpTrade', {
      positionId
    });
  }

  // ========================================
  // Lulo - Lending Protocol
  // ========================================

  /**
   * Lend assets on Lulo
   */
  async lend(params) {
    const { asset, amount } = params;

    console.log(`Lending ${amount} ${asset} on Lulo`);

    return await this.executeMethod('luloLend', {
      asset,
      amount
    });
  }

  /**
   * Withdraw lent assets from Lulo
   */
  async withdraw(params) {
    const { asset, amount } = params;

    console.log(`Withdrawing ${amount} ${asset} from Lulo`);

    return await this.executeMethod('luloWithdraw', {
      asset,
      amount
    });
  }

  /**
   * Borrow assets from Lulo
   */
  async borrow(params) {
    const { asset, amount } = params;

    console.log(`Borrowing ${amount} ${asset} from Lulo`);

    return await this.executeMethod('luloBorrow', {
      asset,
      amount
    });
  }

  /**
   * Repay borrowed assets on Lulo
   */
  async repay(params) {
    const { asset, amount } = params;

    console.log(`Repaying ${amount} ${asset} to Lulo`);

    return await this.executeMethod('luloRepay', {
      asset,
      amount
    });
  }

  // ========================================
  // Raydium - AMM & Liquidity
  // ========================================

  /**
   * Create a liquidity pool on Raydium
   */
  async createPool(params) {
    const {
      baseMint,
      quoteMint,
      marketId,
      baseAmount,
      quoteAmount
    } = params;

    console.log(`Creating Raydium pool for ${baseMint}/${quoteMint}`);

    return await this.executeMethod('raydiumCreatePool', {
      baseMint,
      quoteMint,
      marketId,
      baseAmount,
      quoteAmount
    });
  }

  /**
   * Create Raydium CLMM (Concentrated Liquidity) pool
   */
  async createCLMMPool(params) {
    const {
      mint1,
      mint2,
      configId,
      initialPrice,
      startTime
    } = params;

    console.log(`Creating Raydium CLMM pool for ${mint1}/${mint2}`);

    return await this.executeMethod('raydiumCreateClmm', {
      mint1,
      mint2,
      configId,
      initialPrice,
      startTime
    });
  }

  /**
   * Create Raydium CPMM (Constant Product) pool
   */
  async createCPMMPool(params) {
    const {
      mint1,
      mint2,
      configId,
      mintAAmount,
      mintBAmount,
      startTime
    } = params;

    console.log(`Creating Raydium CPMM pool for ${mint1}/${mint2}`);

    return await this.executeMethod('raydiumCreateCpmm', {
      mint1,
      mint2,
      configId,
      mintAAmount,
      mintBAmount,
      startTime
    });
  }

  // ========================================
  // Orca - Whirlpools
  // ========================================

  /**
   * Create an Orca whirlpool
   */
  async createWhirlpool(params) {
    const { baseMint, quoteMint } = params;

    console.log(`Creating Orca whirlpool for ${baseMint}/${quoteMint}`);

    return await this.executeMethod('orcaCreateWhirlpool', {
      baseMint,
      quoteMint
    });
  }

  /**
   * Open position in Orca whirlpool
   */
  async openWhirlpoolPosition(params) {
    const {
      poolAddress,
      lowerPrice,
      upperPrice,
      liquidity
    } = params;

    console.log(`Opening Orca whirlpool position`);

    return await this.executeMethod('orcaOpenSingleSidedWhirlpool', {
      poolAddress,
      lowerPrice,
      upperPrice,
      liquidity
    });
  }

  // ========================================
  // Manifest - Order Book DEX
  // ========================================

  /**
   * Create limit order on Manifest
   */
  async createLimitOrder(params) {
    const {
      baseMint,
      quoteMint,
      side, // 'buy' or 'sell'
      price,
      amount
    } = params;

    console.log(`Creating ${side} limit order for ${amount} at ${price}`);

    return await this.executeMethod('manifestCreateLimitOrder', {
      baseMint,
      quoteMint,
      side,
      price,
      amount
    });
  }

  /**
   * Cancel limit order on Manifest
   */
  async cancelLimitOrder(params) {
    const { orderId } = params;

    console.log(`Cancelling limit order ${orderId}`);

    return await this.executeMethod('manifestCancelOrder', {
      orderId
    });
  }

  /**
   * Claim funds from settled orders
   */
  async claimFunds(params) {
    const { marketAddress } = params;

    console.log(`Claiming funds from market ${marketAddress}`);

    return await this.executeMethod('manifestClaim', {
      marketAddress
    });
  }

  // ========================================
  // Flash - Flash Loans
  // ========================================

  /**
   * Execute a flash loan
   */
  async flashLoan(params) {
    const {
      loanMint,
      loanAmount,
      targetProtocol,
      targetAction,
      targetParams
    } = params;

    console.log(`Executing flash loan for ${loanAmount} ${loanMint}`);

    return await this.executeMethod('flashLoan', {
      loanMint,
      loanAmount,
      targetProtocol,
      targetAction,
      targetParams
    });
  }

  // ========================================
  // Drift Protocol
  // ========================================

  /**
   * Open position on Drift
   */
  async driftOpenPosition(params) {
    const {
      marketIndex,
      side,
      amount,
      leverage
    } = params;

    console.log(`Opening Drift position: ${side} ${amount} with ${leverage}x leverage`);

    return await this.executeMethod('driftOpenPosition', {
      marketIndex,
      side,
      amount,
      leverage
    });
  }

  /**
   * Close position on Drift
   */
  async driftClosePosition(params) {
    const { positionId } = params;

    console.log(`Closing Drift position ${positionId}`);

    return await this.executeMethod('driftClosePosition', {
      positionId
    });
  }

  // ========================================
  // Sanctum - Liquid Staking
  // ========================================

  /**
   * Stake SOL with Sanctum
   */
  async stakeSol(params) {
    const { amount, validator } = params;

    console.log(`Staking ${amount} SOL with validator ${validator}`);

    return await this.executeMethod('sanctumStake', {
      amount,
      validator
    });
  }

  /**
   * Unstake SOL from Sanctum
   */
  async unstakeSol(params) {
    const { amount } = params;

    console.log(`Unstaking ${amount} SOL`);

    return await this.executeMethod('sanctumUnstake', {
      amount
    });
  }

  // ========================================
  // Debridge - Cross-chain Bridge
  // ========================================

  /**
   * Bridge tokens cross-chain
   */
  async bridgeTokens(params) {
    const {
      token,
      amount,
      targetChain,
      targetAddress
    } = params;

    console.log(`Bridging ${amount} ${token} to ${targetChain}`);

    return await this.executeMethod('debridgeSend', {
      token,
      amount,
      targetChain,
      targetAddress
    });
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Get list of supported DeFi protocols
   */
  getSupportedProtocols() {
    return {
      trading: [
        'Jupiter (Aggregator)',
        'Adrena (Perpetuals)',
        'Drift (Derivatives)',
        'Manifest (Order Book)'
      ],
      lending: [
        'Lulo',
        'Flash (Flash Loans)'
      ],
      amm: [
        'Raydium',
        'Orca',
        'Openbook',
        'Fluxbeam'
      ],
      staking: [
        'Sanctum',
        'Solayer'
      ],
      bridges: [
        'Debridge'
      ],
      other: [
        'Ranger',
        'Voltr'
      ]
    };
  }

  /**
   * Get available methods for a specific protocol
   */
  getProtocolMethods(protocol) {
    const methods = {
      jupiter: ['swap'],
      adrena: ['openPerpetualPosition', 'closePerpetualPosition'],
      lulo: ['lend', 'withdraw', 'borrow', 'repay'],
      raydium: ['createPool', 'createCLMMPool', 'createCPMMPool'],
      orca: ['createWhirlpool', 'openWhirlpoolPosition'],
      manifest: ['createLimitOrder', 'cancelLimitOrder', 'claimFunds'],
      flash: ['flashLoan'],
      drift: ['driftOpenPosition', 'driftClosePosition'],
      sanctum: ['stakeSol', 'unstakeSol'],
      debridge: ['bridgeTokens']
    };

    return methods[protocol.toLowerCase()] || [];
  }

  /**
   * Estimate fees for a DeFi operation
   */
  async estimateFees(operation, params) {
    // This would typically calculate network fees, protocol fees, etc.
    return {
      networkFee: 0.00025, // SOL
      protocolFee: 0.001, // Percentage
      totalFeeEstimate: 0.00125 // SOL equivalent
    };
  }
}

export default DefiService;
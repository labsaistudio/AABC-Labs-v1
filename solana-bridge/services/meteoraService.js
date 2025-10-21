
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getMint,
  getAccount
} from '@solana/spl-token';
import fetch from 'node-fetch';

// Meteora DLMM Program ID (Devnet)
const METEORA_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

export class MeteoraService {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.meteoraAPI = process.env.METEORA_API_URL || 'https://dlmm-api.meteora.ag';
    this.network = process.env.SOLANA_NETWORK || 'devnet';
  }


  async createPool(params) {
    try {
      const {
        tokenA,
        tokenB,
        binStep = 25,
        initialPricePerToken,
        depositAmountA,
        depositAmountB
      } = params;


      const mintA = new PublicKey(tokenA);
      const mintB = new PublicKey(tokenB);


      const tokenAInfo = await getMint(this.connection, mintA);
      const tokenBInfo = await getMint(this.connection, mintB);


      const activeId = this.calculateActiveId(initialPricePerToken, binStep);


      const response = await fetch(`${this.meteoraAPI}/create-pool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tokenA: tokenA,
          tokenB: tokenB,
          binStep,
          activeId,
          creator: this.wallet.publicKey.toString(),
          network: this.network
        })
      });

      if (!response.ok) {

        return await this.createPoolLocally(params);
      }

      const result = await response.json();


      if (depositAmountA > 0 && depositAmountB > 0) {
        await this.addLiquidity({
          poolAddress: result.poolAddress,
          amountA: depositAmountA,
          amountB: depositAmountB
        });
      }

      return {
        success: true,
        poolAddress: result.poolAddress,
        lpTokenMint: result.lpTokenMint,
        txHash: result.txHash,
        explorer: `https://explorer.solana.com/address/${result.poolAddress}?cluster=${this.network}`,
        details: {
          tokenA,
          tokenB,
          binStep,
          activeId,
          initialPrice: initialPricePerToken
        }
      };
    } catch (error) {
      console.error('Meteora pool creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async addLiquidity(params) {
    try {
      const {
        poolAddress,
        amountA,
        amountB,
        slippage = 0.5
      } = params;

      const pool = new PublicKey(poolAddress);


      const poolInfo = await this.getPoolInfo(poolAddress);
      if (!poolInfo.success) {
        throw new Error('Failed to fetch pool info');
      }


      const minAmountA = amountA * (1 - slippage / 100);
      const minAmountB = amountB * (1 - slippage / 100);


      const response = await fetch(`${this.meteoraAPI}/add-liquidity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poolAddress,
          amountA,
          amountB,
          minAmountA,
          minAmountB,
          wallet: this.wallet.publicKey.toString(),
          network: this.network
        })
      });

      if (!response.ok) {
        return await this.addLiquidityLocally(params);
      }

      const result = await response.json();

      return {
        success: true,
        txHash: result.txHash,
        lpTokensReceived: result.lpTokensReceived,
        actualDepositA: result.actualDepositA,
        actualDepositB: result.actualDepositB,
        explorer: `https://explorer.solana.com/tx/${result.txHash}?cluster=${this.network}`
      };
    } catch (error) {
      console.error('Add liquidity error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async removeLiquidity(params) {
    try {
      const {
        poolAddress,
        lpTokenAmount,
        minAmountA = 0,
        minAmountB = 0
      } = params;

      const pool = new PublicKey(poolAddress);


      const response = await fetch(`${this.meteoraAPI}/remove-liquidity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poolAddress,
          lpTokenAmount,
          minAmountA,
          minAmountB,
          wallet: this.wallet.publicKey.toString(),
          network: this.network
        })
      });

      if (!response.ok) {
        return await this.removeLiquidityLocally(params);
      }

      const result = await response.json();

      return {
        success: true,
        txHash: result.txHash,
        withdrawnA: result.withdrawnA,
        withdrawnB: result.withdrawnB,
        explorer: `https://explorer.solana.com/tx/${result.txHash}?cluster=${this.network}`
      };
    } catch (error) {
      console.error('Remove liquidity error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getPoolInfo(poolAddress) {
    try {

      const response = await fetch(`${this.meteoraAPI}/pool/${poolAddress}?network=${this.network}`);

      if (response.ok) {
        const poolData = await response.json();
        return {
          success: true,
          pool: poolAddress,
          tokenA: poolData.tokenA,
          tokenB: poolData.tokenB,
          reserveA: poolData.reserveA,
          reserveB: poolData.reserveB,
          lpSupply: poolData.lpSupply,
          price: poolData.price,
          volume24h: poolData.volume24h,
          tvl: poolData.tvl,
          apr: poolData.apr
        };
      }


      return {
        success: true,
        pool: poolAddress,
        message: 'Pool info from API unavailable, showing basic info'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getUserPositions(walletAddress = null) {
    try {
      const wallet = walletAddress || this.wallet.publicKey.toString();

      const response = await fetch(`${this.meteoraAPI}/positions/${wallet}?network=${this.network}`);

      if (response.ok) {
        const positions = await response.json();
        return {
          success: true,
          wallet,
          positions: positions.map(pos => ({
            pool: pos.poolAddress,
            lpTokens: pos.lpTokenBalance,
            tokenA: pos.tokenA,
            tokenB: pos.tokenB,
            valueA: pos.underlyingA,
            valueB: pos.underlyingB,
            totalValue: pos.totalValueUSD
          }))
        };
      }

      return {
        success: true,
        wallet,
        positions: [],
        message: 'Positions API unavailable'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getPoolList(tokenA = null, tokenB = null) {
    try {
      let url = `${this.meteoraAPI}/pools?network=${this.network}`;
      if (tokenA) url += `&tokenA=${tokenA}`;
      if (tokenB) url += `&tokenB=${tokenB}`;

      const response = await fetch(url);

      if (response.ok) {
        const pools = await response.json();
        return {
          success: true,
          pools: pools.map(pool => ({
            address: pool.address,
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
            tvl: pool.tvl,
            volume24h: pool.volume24h,
            apr: pool.apr,
            binStep: pool.binStep
          }))
        };
      }

      return {
        success: true,
        pools: [],
        message: 'Pool list API unavailable'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  calculateActiveId(price, binStep) {

    // activeId = log(price) / log(1 + binStep/10000) + 2^23
    const binStepDecimal = binStep / 10000;
    const logPrice = Math.log(price);
    const logBinStep = Math.log(1 + binStepDecimal);
    const activeId = Math.floor(logPrice / logBinStep) + Math.pow(2, 23);
    return activeId;
  }


  async createPoolLocally(params) {
    try {


      console.log('Creating pool locally (simulated)...');

      return {
        success: true,
        poolAddress: Keypair.generate().publicKey.toString(),
        lpTokenMint: Keypair.generate().publicKey.toString(),
        message: 'Pool created locally (simulated)',
        details: params
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  async addLiquidityLocally(params) {
    console.log('Adding liquidity locally (simulated)...');
    return {
      success: true,
      message: 'Liquidity added locally (simulated)',
      details: params
    };
  }


  async removeLiquidityLocally(params) {
    console.log('Removing liquidity locally (simulated)...');
    return {
      success: true,
      message: 'Liquidity removed locally (simulated)',
      details: params
    };
  }


  async calculatePriceImpact(poolAddress, tokenIn, amountIn) {
    try {
      const poolInfo = await this.getPoolInfo(poolAddress);
      if (!poolInfo.success) {
        throw new Error('Failed to fetch pool info');
      }


      const isTokenA = tokenIn === poolInfo.tokenA;
      const reserveIn = isTokenA ? poolInfo.reserveA : poolInfo.reserveB;
      const reserveOut = isTokenA ? poolInfo.reserveB : poolInfo.reserveA;


      const k = reserveIn * reserveOut;
      const newReserveIn = reserveIn + amountIn;
      const newReserveOut = k / newReserveIn;
      const amountOut = reserveOut - newReserveOut;

      const priceImpact = (amountIn / reserveIn) * 100;

      return {
        success: true,
        amountOut,
        priceImpact: priceImpact.toFixed(2) + '%',
        warning: priceImpact > 5 ? 'High price impact!' : null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

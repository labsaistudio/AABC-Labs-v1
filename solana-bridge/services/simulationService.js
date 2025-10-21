
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';


const SIMULATION_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  WARNING: 'WARNING',
  ERROR: 'ERROR'
};

export class SimulationService {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.simulationCache = new Map();
  }


  async simulateTransaction(transaction) {
    try {

      if (!transaction.recentBlockhash) {
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
      }


      if (!transaction.feePayer) {
        transaction.feePayer = this.wallet.publicKey;
      }


      const simulationResult = await this.connection.simulateTransaction(transaction);


      const analysis = this.analyzeSimulationResult(simulationResult);

      return {
        success: !simulationResult.value.err,
        status: analysis.status,
        result: simulationResult.value,
        analysis,
        logs: simulationResult.value.logs || [],
        unitsConsumed: simulationResult.value.unitsConsumed || 0,
        error: simulationResult.value.err,
        warnings: analysis.warnings,
        recommendations: analysis.recommendations
      };
    } catch (error) {
      console.error('Transaction simulation error:', error);
      return {
        success: false,
        status: SIMULATION_STATUS.ERROR,
        error: error.message,
        recommendations: ['Review transaction parameters', 'Check account balances']
      };
    }
  }


  async simulateTokenTransfer(params) {
    try {
      const {
        tokenAddress,
        fromAddress,
        toAddress,
        amount,
        decimals = 9
      } = params;


      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: new PublicKey(fromAddress), isSigner: true, isWritable: true },
          { pubkey: new PublicKey(toAddress), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(tokenAddress), isSigner: false, isWritable: false }
        ],
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        data: Buffer.from([])
      });

      const transaction = new Transaction().add(instruction);


      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
      );

      return await this.simulateTransaction(transaction);
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  async simulateSwap(params) {
    try {
      const {
        inputToken,
        outputToken,
        inputAmount,
        slippage = 0.5,
        dex = 'jupiter'
      } = params;


      const estimatedOutput = await this.estimateSwapOutput(
        inputToken,
        outputToken,
        inputAmount,
        dex
      );


      const priceImpact = await this.calculatePriceImpact(
        inputToken,
        outputToken,
        inputAmount,
        estimatedOutput
      );


      const slippageCheck = this.checkSlippage(
        estimatedOutput,
        slippage,
        priceImpact
      );


      const simulation = {
        success: true,
        status: slippageCheck.acceptable ? SIMULATION_STATUS.SUCCESS : SIMULATION_STATUS.WARNING,
        inputToken,
        outputToken,
        inputAmount,
        estimatedOutput,
        minOutput: estimatedOutput * (1 - slippage / 100),
        priceImpact: priceImpact.toFixed(2) + '%',
        slippage: slippage + '%',
        warnings: [],
        gasEstimate: 5000,
        dex
      };


      if (priceImpact > 5) {
        simulation.warnings.push({
          level: 'HIGH',
          message: `High price impact: ${priceImpact.toFixed(2)}%`
        });
      }

      if (!slippageCheck.acceptable) {
        simulation.warnings.push({
          level: 'MEDIUM',
          message: 'Slippage tolerance may be too low'
        });
      }

      return simulation;
    } catch (error) {
      return {
        success: false,
        status: SIMULATION_STATUS.ERROR,
        error: error.message
      };
    }
  }


  async simulateLiquidityOperation(params) {
    try {
      const {
        operation, // 'add' or 'remove'
        poolAddress,
        tokenA,
        tokenB,
        amountA,
        amountB,
        lpAmount
      } = params;

      if (operation === 'add') {

        const estimatedLpTokens = await this.estimateLpTokens(
          poolAddress,
          amountA,
          amountB
        );


        const ratioCheck = await this.checkLiquidityRatio(
          poolAddress,
          tokenA,
          tokenB,
          amountA,
          amountB
        );

        return {
          success: true,
          status: ratioCheck.correct ? SIMULATION_STATUS.SUCCESS : SIMULATION_STATUS.WARNING,
          operation: 'add',
          poolAddress,
          inputA: { token: tokenA, amount: amountA },
          inputB: { token: tokenB, amount: amountB },
          estimatedLpTokens,
          ratioCorrect: ratioCheck.correct,
          suggestedRatio: ratioCheck.suggested,
          warnings: ratioCheck.warnings || []
        };
      } else if (operation === 'remove') {

        const estimatedTokens = await this.estimateTokensFromLp(
          poolAddress,
          lpAmount
        );

        return {
          success: true,
          status: SIMULATION_STATUS.SUCCESS,
          operation: 'remove',
          poolAddress,
          lpAmount,
          estimatedOutputA: estimatedTokens.tokenA,
          estimatedOutputB: estimatedTokens.tokenB,
          warnings: []
        };
      }

      throw new Error('Invalid operation type');
    } catch (error) {
      return {
        success: false,
        status: SIMULATION_STATUS.ERROR,
        error: error.message
      };
    }
  }


  async simulateBatch(transactions) {
    try {
      const results = await Promise.all(
        transactions.map(tx => this.simulateTransaction(tx))
      );

      const allSuccess = results.every(r => r.success);
      const totalGas = results.reduce((sum, r) => sum + (r.unitsConsumed || 0), 0);

      return {
        success: allSuccess,
        status: allSuccess ? SIMULATION_STATUS.SUCCESS : SIMULATION_STATUS.WARNING,
        results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          totalGasEstimate: totalGas,
          warnings: results.flatMap(r => r.warnings || [])
        }
      };
    } catch (error) {
      return {
        success: false,
        status: SIMULATION_STATUS.ERROR,
        error: error.message
      };
    }
  }


  analyzeSimulationResult(simulationResult) {
    const analysis = {
      status: SIMULATION_STATUS.SUCCESS,
      warnings: [],
      recommendations: []
    };


    if (simulationResult.value.err) {
      analysis.status = SIMULATION_STATUS.FAILED;


      const errorStr = JSON.stringify(simulationResult.value.err);
      if (errorStr.includes('InsufficientFunds')) {
        analysis.recommendations.push('Check account balance');
      } else if (errorStr.includes('AccountNotFound')) {
        analysis.recommendations.push('Verify all account addresses');
      } else if (errorStr.includes('InvalidInstruction')) {
        analysis.recommendations.push('Review transaction instructions');
      }
    }


    const logs = simulationResult.value.logs || [];
    for (const log of logs) {
      if (log.includes('Warning')) {
        analysis.warnings.push({
          level: 'MEDIUM',
          message: log
        });
      }
      if (log.includes('Error')) {
        analysis.status = SIMULATION_STATUS.WARNING;
        analysis.warnings.push({
          level: 'HIGH',
          message: log
        });
      }
    }


    const units = simulationResult.value.unitsConsumed || 0;
    if (units > 1000000) {
      analysis.warnings.push({
        level: 'MEDIUM',
        message: `High compute usage: ${units} units`
      });
      analysis.recommendations.push('Consider optimizing transaction');
    }

    return analysis;
  }


  async estimateSwapOutput(inputToken, outputToken, inputAmount, dex) {


    const rate = 1.5;
    return inputAmount * rate * 0.995;
  }


  async calculatePriceImpact(inputToken, outputToken, inputAmount, outputAmount) {


    const baseRate = 1.5;
    const actualRate = outputAmount / inputAmount;
    const impact = Math.abs((actualRate - baseRate) / baseRate) * 100;
    return impact;
  }


  checkSlippage(estimatedOutput, slippageTolerance, priceImpact) {
    const maxAcceptableImpact = slippageTolerance * 2;
    return {
      acceptable: priceImpact <= maxAcceptableImpact,
      suggested: priceImpact > maxAcceptableImpact
        ? Math.ceil(priceImpact / 2)
        : slippageTolerance
    };
  }


  async estimateLpTokens(poolAddress, amountA, amountB) {

    return Math.sqrt(amountA * amountB) * 0.99;
  }


  async checkLiquidityRatio(poolAddress, tokenA, tokenB, amountA, amountB) {

    const currentRatio = 1.5;
    const providedRatio = amountA / amountB;
    const deviation = Math.abs((providedRatio - currentRatio) / currentRatio);

    const result = {
      correct: deviation < 0.02,
      currentRatio,
      providedRatio,
      deviation: (deviation * 100).toFixed(2) + '%',
      suggested: {
        amountA: amountA,
        amountB: amountA / currentRatio
      },
      warnings: []
    };

    if (!result.correct) {
      result.warnings.push({
        level: 'MEDIUM',
        message: `Ratio deviation: ${result.deviation}. Suggested ratio: 1:${currentRatio.toFixed(2)}`
      });
    }

    return result;
  }


  async estimateTokensFromLp(poolAddress, lpAmount) {

    const poolRatio = 1.5;
    const tokenA = lpAmount * 1.01;
    const tokenB = tokenA / poolRatio;

    return {
      tokenA,
      tokenB
    };
  }


  async getGasPriceRecommendation() {
    try {
      const recentFees = await this.connection.getRecentPrioritizationFees();


      const fees = recentFees.map(f => f.prioritizationFee).filter(f => f > 0);

      if (fees.length === 0) {
        return {
          slow: 0,
          standard: 0,
          fast: 0,
          recommended: 0
        };
      }

      fees.sort((a, b) => a - b);

      return {
        slow: fees[Math.floor(fees.length * 0.25)] || 0,
        standard: fees[Math.floor(fees.length * 0.5)] || 0,
        fast: fees[Math.floor(fees.length * 0.75)] || 0,
        recommended: fees[Math.floor(fees.length * 0.6)] || 0
      };
    } catch (error) {
      return {
        slow: 0,
        standard: 0,
        fast: 0,
        recommended: 0,
        error: error.message
      };
    }
  }
}

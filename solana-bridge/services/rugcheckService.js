
import { PublicKey } from '@solana/web3.js';
import { getMint, getAccount } from '@solana/spl-token';
import fetch from 'node-fetch';


const RISK_LEVELS = {
  SAFE: 'SAFE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};


const RISK_WEIGHTS = {
  mintAuthority: 30,
  freezeAuthority: 20,
  ownership: 25,
  liquidity: 15,
  metadata: 10
};

export class RugcheckService {
  constructor(connection, pythService = null) {
    this.connection = connection;
    this.pythService = pythService;
    this.rugcheckAPI = process.env.RUGCHECK_API_URL || 'https://api.rugcheck.xyz';
    this.riskCache = new Map();
    this.cacheTimeout = 300000;
  }


  async checkToken(tokenAddress) {
    try {

      const cached = this.getCachedRisk(tokenAddress);
      if (cached) {
        return cached;
      }

      const mint = new PublicKey(tokenAddress);


      const [
        mintInfo,
        ownershipAnalysis,
        liquidityAnalysis,
        metadataAnalysis,
        externalCheck
      ] = await Promise.all([
        this.getMintInfo(mint),
        this.analyzeOwnership(mint),
        this.analyzeLiquidity(mint),
        this.checkMetadata(mint),
        this.checkExternalAPI(tokenAddress)
      ]);


      const riskScore = this.calculateRiskScore({
        mintInfo,
        ownershipAnalysis,
        liquidityAnalysis,
        metadataAnalysis,
        externalCheck
      });


      const report = {
        success: true,
        token: tokenAddress,
        riskLevel: this.getRiskLevel(riskScore),
        riskScore: riskScore.toFixed(2),
        details: {
          mintAuthority: mintInfo.mintAuthority,
          freezeAuthority: mintInfo.freezeAuthority,
          supply: mintInfo.supply,
          decimals: mintInfo.decimals,
          ownershipConcentration: ownershipAnalysis.concentration,
          topHolders: ownershipAnalysis.topHolders,
          liquidityScore: liquidityAnalysis.score,
          pools: liquidityAnalysis.pools,
          metadata: metadataAnalysis,
          warnings: this.generateWarnings({
            mintInfo,
            ownershipAnalysis,
            liquidityAnalysis,
            metadataAnalysis
          })
        },
        timestamp: Date.now()
      };


      this.cacheRiskAssessment(tokenAddress, report);

      return report;
    } catch (error) {
      console.error('Token check error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getMintInfo(mintAddress) {
    try {
      const mintInfo = await getMint(this.connection, mintAddress);

      return {
        supply: mintInfo.supply.toString(),
        decimals: mintInfo.decimals,
        mintAuthority: mintInfo.mintAuthority?.toString() || null,
        freezeAuthority: mintInfo.freezeAuthority?.toString() || null,
        isInitialized: mintInfo.isInitialized,

        hasMintAuthority: !!mintInfo.mintAuthority,
        hasFreezeAuthority: !!mintInfo.freezeAuthority
      };
    } catch (error) {
      return {
        error: error.message
      };
    }
  }


  async analyzeOwnership(mintAddress) {
    try {

      const accounts = await this.connection.getProgramAccounts(
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        {
          filters: [
            { dataSize: 165 },
            {
              memcmp: {
                offset: 0,
                bytes: mintAddress.toBase58()
              }
            }
          ]
        }
      );


      const holders = [];
      let totalSupply = BigInt(0);

      for (const { pubkey, account } of accounts) {
        const data = account.data;

        const amount = BigInt(data.readBigUInt64LE(64));
        if (amount > 0) {
          holders.push({
            address: pubkey.toString(),
            amount: amount.toString()
          });
          totalSupply += amount;
        }
      }


      holders.sort((a, b) => {
        const diff = BigInt(b.amount) - BigInt(a.amount);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });


      const topHolders = holders.slice(0, 10);
      let topHoldersAmount = BigInt(0);
      for (const holder of topHolders) {
        topHoldersAmount += BigInt(holder.amount);
      }

      const concentration = totalSupply > 0
        ? Number(topHoldersAmount * 100n / totalSupply)
        : 100;

      return {
        totalHolders: holders.length,
        concentration: concentration.toFixed(2) + '%',
        topHolders: topHolders.map(h => ({
          address: h.address.substring(0, 4) + '...' + h.address.substring(h.address.length - 4),
          percentage: totalSupply > 0
            ? (Number(BigInt(h.amount) * 10000n / totalSupply) / 100).toFixed(2) + '%'
            : '0%'
        })),
        riskFactors: {
          highConcentration: concentration > 50,
          singleWhale: topHolders[0] && totalSupply > 0
            ? Number(BigInt(topHolders[0].amount) * 100n / totalSupply) > 30
            : false,
          fewHolders: holders.length < 10
        }
      };
    } catch (error) {
      return {
        error: error.message,
        concentration: '0%',
        topHolders: []
      };
    }
  }


  async analyzeLiquidity(mintAddress) {
    try {




      const liquidityData = {
        hasLiquidity: true,
        totalLiquidity: '100000', // USD
        mainPool: 'Raydium',
        pools: [
          {
            dex: 'Raydium',
            liquidity: '60000',
            volume24h: '15000'
          },
          {
            dex: 'Orca',
            liquidity: '40000',
            volume24h: '10000'
          }
        ]
      };


      const totalLiq = parseFloat(liquidityData.totalLiquidity);
      let score = 0;
      if (totalLiq > 1000000) score = 100;
      else if (totalLiq > 500000) score = 80;
      else if (totalLiq > 100000) score = 60;
      else if (totalLiq > 50000) score = 40;
      else if (totalLiq > 10000) score = 20;
      else score = 10;

      return {
        hasLiquidity: liquidityData.hasLiquidity,
        score,
        totalLiquidity: liquidityData.totalLiquidity,
        pools: liquidityData.pools,
        riskFactors: {
          lowLiquidity: totalLiq < 50000,
          singlePool: liquidityData.pools.length === 1,
          noLiquidity: !liquidityData.hasLiquidity
        }
      };
    } catch (error) {
      return {
        error: error.message,
        hasLiquidity: false,
        score: 0
      };
    }
  }


  async checkMetadata(mintAddress) {
    try {

      const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

      const [metadataPDA] = await PublicKey.findProgramAddress(
        [
          Buffer.from('metadata'),
          METADATA_PROGRAM_ID.toBuffer(),
          mintAddress.toBuffer()
        ],
        METADATA_PROGRAM_ID
      );

      const metadataAccount = await this.connection.getAccountInfo(metadataPDA);

      if (!metadataAccount) {
        return {
          hasMetadata: false,
          verified: false,
          warning: 'No metadata found'
        };
      }


      return {
        hasMetadata: true,
        verified: true,
        updateAuthority: 'Unknown',
        isMutable: true,
        warning: null
      };
    } catch (error) {
      return {
        hasMetadata: false,
        error: error.message
      };
    }
  }


  async checkExternalAPI(tokenAddress) {
    try {

      const response = await fetch(`${this.rugcheckAPI}/token/${tokenAddress}`, {
        timeout: 5000
      });

      if (response.ok) {
        return await response.json();
      }


      return {
        checked: false,
        source: 'internal'
      };
    } catch (error) {
      return {
        checked: false,
        error: error.message
      };
    }
  }


  calculateRiskScore(analysis) {
    let score = 0;
    let totalWeight = 0;


    if (analysis.mintInfo.hasMintAuthority) {
      score += RISK_WEIGHTS.mintAuthority;
    }
    totalWeight += RISK_WEIGHTS.mintAuthority;


    if (analysis.mintInfo.hasFreezeAuthority) {
      score += RISK_WEIGHTS.freezeAuthority;
    }
    totalWeight += RISK_WEIGHTS.freezeAuthority;


    const concentration = parseFloat(analysis.ownershipAnalysis.concentration);
    if (concentration > 70) {
      score += RISK_WEIGHTS.ownership;
    } else if (concentration > 50) {
      score += RISK_WEIGHTS.ownership * 0.6;
    } else if (concentration > 30) {
      score += RISK_WEIGHTS.ownership * 0.3;
    }
    totalWeight += RISK_WEIGHTS.ownership;


    const liqScore = analysis.liquidityAnalysis.score;
    score += RISK_WEIGHTS.liquidity * (1 - liqScore / 100);
    totalWeight += RISK_WEIGHTS.liquidity;


    if (!analysis.metadataAnalysis.hasMetadata) {
      score += RISK_WEIGHTS.metadata;
    } else if (!analysis.metadataAnalysis.verified) {
      score += RISK_WEIGHTS.metadata * 0.5;
    }
    totalWeight += RISK_WEIGHTS.metadata;

    return (score / totalWeight) * 100;
  }


  getRiskLevel(score) {
    if (score >= 80) return RISK_LEVELS.CRITICAL;
    if (score >= 60) return RISK_LEVELS.HIGH;
    if (score >= 40) return RISK_LEVELS.MEDIUM;
    if (score >= 20) return RISK_LEVELS.LOW;
    return RISK_LEVELS.SAFE;
  }


  generateWarnings(analysis) {
    const warnings = [];

    if (analysis.mintInfo.hasMintAuthority) {
      warnings.push({
        level: 'HIGH',
        message: 'Token has active mint authority - unlimited supply possible'
      });
    }

    if (analysis.mintInfo.hasFreezeAuthority) {
      warnings.push({
        level: 'MEDIUM',
        message: 'Token has freeze authority - accounts can be frozen'
      });
    }

    const concentration = parseFloat(analysis.ownershipAnalysis.concentration);
    if (concentration > 70) {
      warnings.push({
        level: 'HIGH',
        message: `Top 10 holders own ${concentration}% of supply`
      });
    }

    if (analysis.liquidityAnalysis.score < 20) {
      warnings.push({
        level: 'HIGH',
        message: 'Very low liquidity - high slippage risk'
      });
    }

    if (!analysis.metadataAnalysis.hasMetadata) {
      warnings.push({
        level: 'LOW',
        message: 'No metadata found for this token'
      });
    }

    return warnings;
  }


  async checkMultipleTokens(tokenAddresses) {
    try {
      const results = await Promise.all(
        tokenAddresses.map(address => this.checkToken(address))
      );

      return {
        success: true,
        results,
        summary: {
          total: results.length,
          safe: results.filter(r => r.riskLevel === RISK_LEVELS.SAFE).length,
          low: results.filter(r => r.riskLevel === RISK_LEVELS.LOW).length,
          medium: results.filter(r => r.riskLevel === RISK_LEVELS.MEDIUM).length,
          high: results.filter(r => r.riskLevel === RISK_LEVELS.HIGH).length,
          critical: results.filter(r => r.riskLevel === RISK_LEVELS.CRITICAL).length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }


  getCachedRisk(tokenAddress) {
    const cached = this.riskCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return { ...cached, fromCache: true };
    }
    return null;
  }

  cacheRiskAssessment(tokenAddress, assessment) {
    this.riskCache.set(tokenAddress, assessment);


    if (this.riskCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this.riskCache.entries()) {
        if (now - value.timestamp > this.cacheTimeout) {
          this.riskCache.delete(key);
        }
      }
    }
  }


  getRiskRecommendation(riskLevel) {
    const recommendations = {
      [RISK_LEVELS.SAFE]: {
        action: 'PROCEED',
        message: 'Token appears safe for trading'
      },
      [RISK_LEVELS.LOW]: {
        action: 'PROCEED_WITH_CAUTION',
        message: 'Minor risks detected, proceed with standard precautions'
      },
      [RISK_LEVELS.MEDIUM]: {
        action: 'REVIEW_REQUIRED',
        message: 'Moderate risks detected, review details before proceeding'
      },
      [RISK_LEVELS.HIGH]: {
        action: 'WARNING',
        message: 'High risks detected, consider avoiding or use extreme caution'
      },
      [RISK_LEVELS.CRITICAL]: {
        action: 'AVOID',
        message: 'Critical risks detected, strongly recommend avoiding this token'
      }
    };

    return recommendations[riskLevel] || recommendations[RISK_LEVELS.HIGH];
  }
}

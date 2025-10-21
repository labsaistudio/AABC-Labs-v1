
import { EventEmitter } from 'events';
import crypto from 'crypto';


const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};


const OPERATION_TYPES = {
  TRANSFER: 'TRANSFER',
  SWAP: 'SWAP',
  LIQUIDITY_ADD: 'LIQUIDITY_ADD',
  LIQUIDITY_REMOVE: 'LIQUIDITY_REMOVE',
  TOKEN_DEPLOY: 'TOKEN_DEPLOY',
  CONTRACT_INTERACTION: 'CONTRACT_INTERACTION',
  WALLET_CONNECT: 'WALLET_CONNECT',
  PERMISSION_GRANT: 'PERMISSION_GRANT'
};


const CONFIRMATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
};

export class HITLService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      defaultTimeout: config.defaultTimeout || 300000,
      requireConfirmationAbove: config.requireConfirmationAbove || RISK_LEVELS.MEDIUM,
      autoApproveBelow: config.autoApproveBelow || RISK_LEVELS.LOW,
      maxPendingRequests: config.maxPendingRequests || 10,
      ...config
    };

    this.pendingRequests = new Map();
    this.confirmationHistory = [];
    this.riskThresholds = this.initializeRiskThresholds();
  }


  initializeRiskThresholds() {
    return {
      [OPERATION_TYPES.TRANSFER]: {
        amountUSD: {
          [RISK_LEVELS.LOW]: 100,
          [RISK_LEVELS.MEDIUM]: 1000,
          [RISK_LEVELS.HIGH]: 10000,
          [RISK_LEVELS.CRITICAL]: 100000
        }
      },
      [OPERATION_TYPES.SWAP]: {
        amountUSD: {
          [RISK_LEVELS.LOW]: 100,
          [RISK_LEVELS.MEDIUM]: 1000,
          [RISK_LEVELS.HIGH]: 10000,
          [RISK_LEVELS.CRITICAL]: 100000
        },
        slippage: {
          [RISK_LEVELS.LOW]: 1,
          [RISK_LEVELS.MEDIUM]: 3,
          [RISK_LEVELS.HIGH]: 5,
          [RISK_LEVELS.CRITICAL]: 10
        }
      },
      [OPERATION_TYPES.LIQUIDITY_ADD]: {
        amountUSD: {
          [RISK_LEVELS.LOW]: 500,
          [RISK_LEVELS.MEDIUM]: 5000,
          [RISK_LEVELS.HIGH]: 50000,
          [RISK_LEVELS.CRITICAL]: 500000
        }
      },
      [OPERATION_TYPES.TOKEN_DEPLOY]: {
        alwaysRequire: true,
        defaultLevel: RISK_LEVELS.HIGH
      }
    };
  }


  async requestConfirmation(operation) {
    try {

      const requestId = crypto.randomBytes(16).toString('hex');


      const riskAssessment = await this.assessRisk(operation);


      if (this.shouldAutoApprove(riskAssessment)) {
        return {
          requestId,
          status: CONFIRMATION_STATUS.APPROVED,
          autoApproved: true,
          riskLevel: riskAssessment.level,
          message: 'Operation auto-approved due to low risk'
        };
      }


      if (this.pendingRequests.size >= this.config.maxPendingRequests) {
        throw new Error('Too many pending confirmation requests');
      }


      const request = {
        id: requestId,
        operation,
        riskAssessment,
        status: CONFIRMATION_STATUS.PENDING,
        createdAt: Date.now(),
        expiresAt: Date.now() + (operation.timeout || this.config.defaultTimeout),
        details: this.formatOperationDetails(operation),
        warnings: riskAssessment.warnings,
        recommendations: riskAssessment.recommendations
      };


      this.pendingRequests.set(requestId, request);


      this.setupTimeout(requestId);


      this.emit('confirmationRequested', request);


      return {
        requestId,
        status: CONFIRMATION_STATUS.PENDING,
        riskLevel: riskAssessment.level,
        details: request.details,
        warnings: request.warnings,
        expiresAt: request.expiresAt,
        confirmationUrl: this.generateConfirmationUrl(requestId)
      };
    } catch (error) {
      console.error('Confirmation request error:', error);
      throw error;
    }
  }


  async approve(requestId, approverInfo = {}) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      throw new Error('Request not found or already processed');
    }

    if (request.status !== CONFIRMATION_STATUS.PENDING) {
      throw new Error(`Request already ${request.status}`);
    }


    request.status = CONFIRMATION_STATUS.APPROVED;
    request.approvedAt = Date.now();
    request.approver = approverInfo;


    this.pendingRequests.delete(requestId);


    this.addToHistory(request);


    this.emit('operationApproved', request);

    return {
      success: true,
      requestId,
      status: CONFIRMATION_STATUS.APPROVED,
      message: 'Operation approved successfully'
    };
  }


  async reject(requestId, reason = '', rejectorInfo = {}) {
    const request = this.pendingRequests.get(requestId);

    if (!request) {
      throw new Error('Request not found or already processed');
    }

    if (request.status !== CONFIRMATION_STATUS.PENDING) {
      throw new Error(`Request already ${request.status}`);
    }


    request.status = CONFIRMATION_STATUS.REJECTED;
    request.rejectedAt = Date.now();
    request.rejectionReason = reason;
    request.rejector = rejectorInfo;


    this.pendingRequests.delete(requestId);


    this.addToHistory(request);


    this.emit('operationRejected', request);

    return {
      success: true,
      requestId,
      status: CONFIRMATION_STATUS.REJECTED,
      reason,
      message: 'Operation rejected'
    };
  }


  getRequestStatus(requestId) {
    const request = this.pendingRequests.get(requestId);

    if (request) {
      return {
        found: true,
        ...request
      };
    }


    const historical = this.confirmationHistory.find(r => r.id === requestId);
    if (historical) {
      return {
        found: true,
        historical: true,
        ...historical
      };
    }

    return {
      found: false,
      message: 'Request not found'
    };
  }


  async assessRisk(operation) {
    const assessment = {
      level: RISK_LEVELS.LOW,
      score: 0,
      factors: [],
      warnings: [],
      recommendations: []
    };


    switch (operation.type) {
      case OPERATION_TYPES.TRANSFER:
        this.assessTransferRisk(operation, assessment);
        break;
      case OPERATION_TYPES.SWAP:
        this.assessSwapRisk(operation, assessment);
        break;
      case OPERATION_TYPES.LIQUIDITY_ADD:
      case OPERATION_TYPES.LIQUIDITY_REMOVE:
        this.assessLiquidityRisk(operation, assessment);
        break;
      case OPERATION_TYPES.TOKEN_DEPLOY:
        assessment.level = RISK_LEVELS.HIGH;
        assessment.factors.push('Token deployment always requires confirmation');
        break;
      case OPERATION_TYPES.CONTRACT_INTERACTION:
        this.assessContractRisk(operation, assessment);
        break;
      default:
        assessment.level = RISK_LEVELS.MEDIUM;
        assessment.warnings.push('Unknown operation type');
    }


    this.addCommonRiskFactors(operation, assessment);


    assessment.level = this.calculateFinalRiskLevel(assessment);

    return assessment;
  }


  assessTransferRisk(operation, assessment) {
    const { amountUSD = 0, toAddress, isNewAddress } = operation.params || {};
    const thresholds = this.riskThresholds[OPERATION_TYPES.TRANSFER].amountUSD;


    if (amountUSD >= thresholds[RISK_LEVELS.CRITICAL]) {
      assessment.level = RISK_LEVELS.CRITICAL;
      assessment.factors.push(`Very large transfer: $${amountUSD}`);
      assessment.warnings.push({
        level: 'CRITICAL',
        message: 'Transfer amount exceeds critical threshold'
      });
    } else if (amountUSD >= thresholds[RISK_LEVELS.HIGH]) {
      assessment.level = RISK_LEVELS.HIGH;
      assessment.factors.push(`Large transfer: $${amountUSD}`);
    } else if (amountUSD >= thresholds[RISK_LEVELS.MEDIUM]) {
      assessment.level = RISK_LEVELS.MEDIUM;
      assessment.factors.push(`Moderate transfer: $${amountUSD}`);
    }


    if (isNewAddress) {
      assessment.score += 20;
      assessment.factors.push('Transfer to new/unknown address');
      assessment.recommendations.push('Verify recipient address carefully');
    }
  }


  assessSwapRisk(operation, assessment) {
    const {
      amountUSD = 0,
      slippage = 0,
      priceImpact = 0,
      isNewToken = false
    } = operation.params || {};

    const amountThresholds = this.riskThresholds[OPERATION_TYPES.SWAP].amountUSD;
    const slippageThresholds = this.riskThresholds[OPERATION_TYPES.SWAP].slippage;


    if (amountUSD >= amountThresholds[RISK_LEVELS.HIGH]) {
      assessment.level = RISK_LEVELS.HIGH;
      assessment.factors.push(`Large swap amount: $${amountUSD}`);
    }


    if (slippage >= slippageThresholds[RISK_LEVELS.HIGH]) {
      assessment.level = Math.max(assessment.level, RISK_LEVELS.HIGH);
      assessment.warnings.push({
        level: 'HIGH',
        message: `High slippage tolerance: ${slippage}%`
      });
    }


    if (priceImpact > 5) {
      assessment.score += 30;
      assessment.warnings.push({
        level: 'HIGH',
        message: `High price impact: ${priceImpact}%`
      });
    }


    if (isNewToken) {
      assessment.score += 40;
      assessment.factors.push('Swapping to/from unverified token');
      assessment.recommendations.push('Research token before proceeding');
    }
  }


  assessLiquidityRisk(operation, assessment) {
    const { amountUSD = 0, isNewPool = false } = operation.params || {};
    const thresholds = this.riskThresholds[OPERATION_TYPES.LIQUIDITY_ADD].amountUSD;

    if (amountUSD >= thresholds[RISK_LEVELS.HIGH]) {
      assessment.level = RISK_LEVELS.HIGH;
      assessment.factors.push(`Large liquidity operation: $${amountUSD}`);
    }

    if (isNewPool) {
      assessment.score += 30;
      assessment.factors.push('Interacting with new liquidity pool');
      assessment.recommendations.push('Verify pool parameters and token pairs');
    }
  }


  assessContractRisk(operation, assessment) {
    const {
      isVerified = false,
      isProxy = false,
      hasUpgradeable = false
    } = operation.params || {};

    if (!isVerified) {
      assessment.score += 50;
      assessment.warnings.push({
        level: 'HIGH',
        message: 'Interacting with unverified contract'
      });
    }

    if (isProxy || hasUpgradeable) {
      assessment.score += 20;
      assessment.factors.push('Contract is upgradeable/proxy');
      assessment.recommendations.push('Be aware of potential contract changes');
    }

    assessment.level = RISK_LEVELS.MEDIUM;
  }


  addCommonRiskFactors(operation, assessment) {

    const hour = new Date().getHours();
    if (hour >= 2 && hour <= 6) {
      assessment.factors.push('Operation during off-peak hours');
      assessment.score += 10;
    }


    if (operation.network === 'mainnet') {
      assessment.score += 10;
      assessment.factors.push('Mainnet operation');
    }


    if (operation.gasPrice && operation.gasPrice > 100) {
      assessment.warnings.push({
        level: 'MEDIUM',
        message: 'High gas price detected'
      });
    }
  }


  calculateFinalRiskLevel(assessment) {
    const score = assessment.score;

    if (score >= 80) return RISK_LEVELS.CRITICAL;
    if (score >= 60) return RISK_LEVELS.HIGH;
    if (score >= 40) return RISK_LEVELS.MEDIUM;
    if (score >= 20) return RISK_LEVELS.LOW;

    return assessment.level;
  }


  shouldAutoApprove(riskAssessment) {
    const autoApproveLevel = this.config.autoApproveBelow;
    const levels = Object.values(RISK_LEVELS);
    const autoIndex = levels.indexOf(autoApproveLevel);
    const currentIndex = levels.indexOf(riskAssessment.level);

    return currentIndex <= autoIndex && riskAssessment.warnings.length === 0;
  }


  formatOperationDetails(operation) {
    const details = {
      type: operation.type,
      network: operation.network || 'unknown',
      timestamp: new Date().toISOString()
    };

    switch (operation.type) {
      case OPERATION_TYPES.TRANSFER:
        return {
          ...details,
          from: operation.params?.fromAddress,
          to: operation.params?.toAddress,
          amount: operation.params?.amount,
          token: operation.params?.token || 'SOL',
          valueUSD: operation.params?.amountUSD
        };

      case OPERATION_TYPES.SWAP:
        return {
          ...details,
          inputToken: operation.params?.inputToken,
          outputToken: operation.params?.outputToken,
          inputAmount: operation.params?.inputAmount,
          expectedOutput: operation.params?.expectedOutput,
          slippage: operation.params?.slippage,
          dex: operation.params?.dex
        };

      default:
        return {
          ...details,
          ...operation.params
        };
    }
  }


  setupTimeout(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;

    const timeUntilExpiry = request.expiresAt - Date.now();

    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        const expiredRequest = this.pendingRequests.get(requestId);
        expiredRequest.status = CONFIRMATION_STATUS.EXPIRED;
        this.pendingRequests.delete(requestId);
        this.addToHistory(expiredRequest);
        this.emit('requestExpired', expiredRequest);
      }
    }, timeUntilExpiry);
  }


  addToHistory(request) {
    this.confirmationHistory.push(request);


    if (this.confirmationHistory.length > 1000) {
      this.confirmationHistory.shift();
    }
  }


  generateConfirmationUrl(requestId) {
    const baseUrl = process.env.CONFIRMATION_BASE_URL || 'http://localhost:8000';
    return `${baseUrl}/confirm/${requestId}`;
  }


  getPendingRequests() {
    return Array.from(this.pendingRequests.values());
  }


  getHistory(limit = 100) {
    return this.confirmationHistory.slice(-limit);
  }


  cleanupExpiredRequests() {
    const now = Date.now();
    for (const [id, request] of this.pendingRequests.entries()) {
      if (request.expiresAt <= now) {
        request.status = CONFIRMATION_STATUS.EXPIRED;
        this.pendingRequests.delete(id);
        this.addToHistory(request);
      }
    }
  }
}

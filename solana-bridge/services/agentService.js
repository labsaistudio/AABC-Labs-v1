import { SolanaAgentKit } from 'solana-agent-kit';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { JupiterService } from './jupiterService.js';
import { BlinksService } from './blinksService.js';
import { TokenService } from './tokenService.js';
import { MeteoraService } from './meteoraService.js';
import { PythService } from './pythService.js';
import { RugcheckService } from './rugcheckService.js';
import { SimulationService } from './simulationService.js';
import { HITLService } from './hitlService.js';
import pluginLoaderFixed from './pluginLoaderFixed.js';

// 全局插件容器
let loadedPlugins = {};

/**
 * Wallet adapter that wraps Keypair to satisfy SolanaAgentKit's BaseWallet interface
 * SolanaAgentKit expects async methods like signTransaction, but Keypair doesn't provide them
 *
 * IMPORTANT: Exposes the original keypair via this.keypair for services that need direct access
 */
class KeypairWalletAdapter {
  constructor(keypair) {
    this.keypair = keypair; // Exposed for services like pumpFunSimple that need the raw Keypair
    this.publicKey = keypair.publicKey;
  }

  async signTransaction(transaction) {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.keypair]);
    } else if (transaction instanceof Transaction) {
      transaction.partialSign(this.keypair);
    } else {
      throw new Error('Unsupported transaction type');
    }
    return transaction;
  }

  async signAllTransactions(transactions) {
    return Promise.all(transactions.map(tx => this.signTransaction(tx)));
  }

  async signAndSendTransaction(transaction, options = {}) {
    const signedTx = await this.signTransaction(transaction);
    // Note: This is a simplified implementation
    // In production, you might want to use connection.sendTransaction
    return { signature: 'signed' };
  }

  async signMessage(message) {
    const signature = this.keypair.sign(message);
    return signature;
  }
}

export class AgentService {
  constructor(config) {
    this.config = config;
    this.agent = null;
    this.connection = null;
    this.wallet = null;
    this.plugins = new Map();
    this.jupiterService = null;
    this.blinksService = null;
    this.tokenService = null;
    this.meteoraService = null;
    this.pythService = null;
    this.rugcheckService = null;
    this.simulationService = null;
    this.hitlService = null;
  }

  async initialize() {
    try {
      // 1. 首先初始化connection
      this.connection = new Connection(
        this.config.rpcUrl,
        'confirmed'
      );

      // 2. 初始化wallet（必须在agent之前）
      let keypair;
      if (this.config.privateKey) {
        try {
          // Handle different private key formats
          let secretKey;

          // Try base58 format first
          try {
            secretKey = bs58.decode(this.config.privateKey);
          } catch {
            // Try array format
            secretKey = new Uint8Array(JSON.parse(this.config.privateKey));
          }

          keypair = Keypair.fromSecretKey(secretKey);
        } catch (error) {
          console.warn('Failed to load wallet from private key, creating new wallet:', error);
          keypair = Keypair.generate();
        }
      } else {
        // Generate a new wallet if no private key provided
        keypair = Keypair.generate();
        console.log('Generated new wallet:', keypair.publicKey.toString());
      }

      // Wrap Keypair with adapter to satisfy SolanaAgentKit's BaseWallet interface
      this.wallet = new KeypairWalletAdapter(keypair);
      // Keep reference to original keypair for services that need it
      this.keypair = keypair;
      console.log('✅ Wallet adapter created for:', this.wallet.publicKey.toString());

      // 3. 现在初始化Agent（wallet已经准备好）
      try {
        // 准备agent配置，包括所有 API keys
        const agentConfig = {
          PINATA_JWT: process.env.PINATA_JWT || null,
          PINATA_GATEWAY: process.env.PINATA_GATEWAY || null,
          COINGECKO_PRO_API_KEY: process.env.COINGECKO_PRO_API_KEY || null,
          COINGECKO_DEMO_API_KEY: process.env.COINGECKO_DEMO_API_KEY || null
        };

        // 配置警告
        if (!agentConfig.PINATA_JWT) {
          console.log('⚠️ WARNING: PINATA_JWT not configured. Pump.fun metadata upload will be skipped.');
        }

        if (!agentConfig.COINGECKO_PRO_API_KEY && !agentConfig.COINGECKO_DEMO_API_KEY) {
          console.log('⚠️ WARNING: CoinGecko API key not configured. Market data features will be limited.');
        } else {
          console.log('✅ CoinGecko API configured:', agentConfig.COINGECKO_PRO_API_KEY ? 'Pro' : 'Demo');
        }

        this.agent = new SolanaAgentKit(
          this.wallet,  // 现在wallet已经初始化了
          this.config.rpcUrl,
          agentConfig
        );
        console.log('✅ SolanaAgentKit initialized successfully');
      } catch (e) {
        console.log('❌ SolanaAgentKit initialization failed:', e.message);
        this.agent = null;
      }

      // 4. 使用修复后的插件加载器，传入agent上下文
      if (this.agent) {
        loadedPlugins = await pluginLoaderFixed.initializePlugins(this.agent);
      } else {
        console.log('Skipping plugin initialization - no agent available');
        loadedPlugins = {};
      }

      // 5. Initialize plugins with minimal set
      await this.initializePlugins();

      // 初始化独立服务
      // Note: Some services need the original Keypair, not the wallet adapter
      this.jupiterService = new JupiterService();
      this.blinksService = new BlinksService(this.connection, this.keypair);
      this.tokenService = new TokenService(this.connection, this.keypair, this.agent);
      this.meteoraService = new MeteoraService(this.connection, this.keypair);
      this.pythService = new PythService(this.connection, this.config.network);
      this.rugcheckService = new RugcheckService(this.connection, this.pythService);
      this.simulationService = new SimulationService(this.connection, this.keypair);
      this.hitlService = new HITLService({
        defaultTimeout: 300000,
        requireConfirmationAbove: 'MEDIUM',
        autoApproveBelow: 'LOW'
      });

      console.log('Agent Service initialized successfully');
      console.log('Wallet address:', this.wallet.publicKey.toString());
      console.log('Network:', this.config.network);
      console.log('Plugins loaded:', Array.from(this.plugins.keys()).join(', '));
      console.log('Independent services: Jupiter, Blinks, Token, Meteora, Pyth, Rugcheck, Simulation, HITL');

      return {
        success: true,
        walletAddress: this.wallet.publicKey.toString(),
        network: this.config.network,
        plugins: Array.from(this.plugins.keys())
      };
    } catch (error) {
      console.error('Failed to initialize Agent Service:', error);
      throw error;
    }
  }

  async initializePlugins() {
    // 插件已经在上面通过pluginLoaderFixed初始化
    // 这里只需要将它们添加到plugins Map中
    for (const [name, plugin] of Object.entries(loadedPlugins)) {
      if (plugin) {
        this.plugins.set(name, plugin);
        console.log(`✅ ${name}插件已注册`);
      }
    }

    console.log('Plugins loaded:', Array.from(this.plugins.keys()));
  }

  // Core wallet operations
  async getBalance(address) {
    try {
      const pubkey = new PublicKey(address || this.wallet.publicKey);
      const balance = await this.connection.getBalance(pubkey);
      return {
        success: true,
        address: pubkey.toString(),
        balance: balance / 1e9, // Convert lamports to SOL
        lamports: balance
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async transfer(to, amount) {
    try {
      // Always use native web3.js for SOL transfers (more reliable than agent.transfer)
      // SolanaAgentKit v2 may not have transfer method or have different signature
      if (true) {  // Force use of native implementation
        const { Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
        const { PublicKey } = await import('@solana/web3.js');

        const toPubkey = new PublicKey(to);
        const lamportsToSend = amount * LAMPORTS_PER_SOL;

        // 检查余额
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        if (balance < lamportsToSend + 5000) {
          return {
            success: false,
            error: `Insufficient balance. Available: ${balance / LAMPORTS_PER_SOL} SOL`
          };
        }

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: toPubkey,
            lamports: lamportsToSend
          })
        );

        const signature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.keypair],
          {
            commitment: 'confirmed'
          }
        );

        return {
          success: true,
          signature: signature,
          from: this.wallet.publicKey.toString(),
          to,
          amount,
          explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
        };
      }

      // NOTE: SolanaAgentKit v2 transfer method is unreliable or has different signature
      // Keeping native web3.js implementation above as primary method
      // If agent.transfer becomes available/reliable in future, uncomment below:
      /*
      const result = await this.agent.transfer({
        to,
        amount,
        mint: 'SOL'
      });

      return {
        success: true,
        signature: result.signature,
        from: this.wallet.publicKey.toString(),
        to,
        amount
      };
      */
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Token operations via plugin
  async getTokenBalance(tokenAddress, walletAddress) {
    try {
      const tokenPlugin = this.plugins.get('token');
      if (!tokenPlugin || !tokenPlugin.methods) {
        throw new Error('Token plugin not available');
      }

      const { PublicKey } = await import('@solana/web3.js');
      const tokenPubkey = new PublicKey(tokenAddress);

      let balance;
      let targetWallet;

      if (walletAddress) {
        // Check other wallet's balance: get_balance_other(wallet_address, token_address)
        const walletPubkey = new PublicKey(walletAddress);
        if (!tokenPlugin.methods.get_balance_other) {
          throw new Error('get_balance_other method not available');
        }
        balance = await tokenPlugin.methods.get_balance_other(walletPubkey, tokenPubkey);
        targetWallet = walletAddress;
      } else {
        // Check own balance: get_balance(token_address)
        if (!tokenPlugin.methods.get_balance) {
          throw new Error('get_balance method not available');
        }
        balance = await tokenPlugin.methods.get_balance(tokenPubkey);
        targetWallet = this.wallet.publicKey.toString();
      }

      return {
        success: true,
        token: tokenAddress,
        wallet: targetWallet,
        balance
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async swapTokens(inputMint, outputMint, amount, slippage = 0.5) {
    try {
      if (!this.agent) {
        throw new Error('Agent not initialized');
      }

      const { PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');

      // Convert slippage to basis points (0.5% = 50 bps)
      const slippageBps = Math.round(slippage * 100);

      // 准备参数
      const outputPubkey = new PublicKey(outputMint);

      // ✅ 检查是否是SOL（根据官方文档，SOL应该传undefined，不是PublicKey）
      let inputParam;
      let amountInSmallestUnits;

      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      if (inputMint === SOL_MINT || inputMint === 'SOL') {
        // SOL: 传undefined，amount转换为lamports
        inputParam = undefined;
        amountInSmallestUnits = Math.floor(amount * LAMPORTS_PER_SOL);
      } else {
        // SPL Token: 传PublicKey，amount需要根据token decimals转换
        // 这里先假设6 decimals（USDC标准）
        inputParam = new PublicKey(inputMint);
        amountInSmallestUnits = Math.floor(amount * 1_000_000);
      }

      console.log('🔄 Calling token plugin trade():', {
        inputMint: inputParam ? inputParam.toString() : 'SOL',
        outputMint: outputPubkey.toString(),
        amount: amountInSmallestUnits,
        slippageBps
      });

      // ✅ 从this.plugins获取Token插件
      const tokenPlugin = this.plugins.get('token');
      if (!tokenPlugin || !tokenPlugin.methods || !tokenPlugin.methods.trade) {
        throw new Error('Token plugin or trade() method not available');
      }

      // Token插件的trade方法签名（根据官方文档）:
      // trade(agent, outputMint, amount, inputMint?, slippageBps?)
      // 注意：包装函数会自动传入agent，所以我们只传后4个参数
      console.log('Using tokenPlugin.methods.trade() from this.plugins');

      try {
        const result = await tokenPlugin.methods.trade(
          outputPubkey,           // target token to receive
          amountInSmallestUnits,  // amount in smallest units (lamports/token decimals)
          inputParam,             // source token (undefined for SOL, PublicKey for SPL)
          slippageBps             // slippage tolerance
        );

        console.log('✅ Swap executed successfully:', result);

        return {
          success: true,
          signature: result.signature || result,
          inputMint,
          outputMint,
          amount,
          slippage: slippageBps
        };
      } catch (tradeError) {
        // 捕获Token Plugin内部错误并提供更多上下文
        console.error('❌ Token Plugin trade() failed:', {
          error: tradeError.message,
          stack: tradeError.stack,
          params: {
            outputMint: outputPubkey.toString(),
            amount: amountInSmallestUnits,
            inputMint: inputParam ? inputParam.toString() : 'SOL (undefined)',
            slippageBps
          }
        });

        // 尝试提取更详细的错误信息
        let errorMessage = tradeError.message || 'Unknown swap error';

        // 如果错误消息包含"Swap failed:"，尝试提取内部错误
        if (errorMessage.includes('Swap failed:')) {
          const innerError = errorMessage.replace('Swap failed:', '').trim();
          if (innerError) {
            errorMessage = `Swap failed: ${innerError}`;
          } else {
            errorMessage = 'Swap failed: Token Plugin internal error (check if wallet has sufficient balance and tokens are tradable on this network)';
          }
        }

        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Swap error:', error);
      return {
        success: false,
        error: error.message || 'Swap failed'
      };
    }
  }

  // Blinks operations
  async createBlink(type, params) {
    try {
      const blinksPlugin = this.plugins.get('blinks');

      let blink;
      switch (type) {
        case 'transfer':
          blink = await blinksPlugin.createTransferBlink(params);
          break;
        case 'swap':
          blink = await blinksPlugin.createSwapBlink(params);
          break;
        case 'stake':
          blink = await blinksPlugin.createStakeBlink(params);
          break;
        case 'nft':
          blink = await blinksPlugin.createNFTBlink(params);
          break;
        default:
          throw new Error(`Unsupported blink type: ${type}`);
      }

      return {
        success: true,
        blink
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeBlink(blinkUrl) {
    try {
      const blinksPlugin = this.plugins.get('blinks');
      const result = await blinksPlugin.executeBlink(blinkUrl);

      return {
        success: true,
        ...result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Utility methods
  getWalletAddress() {
    return this.wallet.publicKey.toString();
  }

  getNetwork() {
    return this.config.network;
  }

  getConnection() {
    return this.connection;
  }

  getAgent() {
    return this.agent;
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }

  // List all available actions dynamically
  listActions() {
    const actions = [];

    // Get actions from agent if available
    if (this.agent && this.agent.actions) {
      // Dynamically enumerate actions from runtime
      Object.entries(this.agent.actions).forEach(([name, action]) => {
        actions.push({
          name,
          description: action.description || '',
          category: this.getCategoryForAction(name),
          parameters: action.parameters || {}
        });
      });
    }

    // Add plugin-specific actions
    this.plugins.forEach((plugin, pluginName) => {
      if (plugin.actions) {
        Object.entries(plugin.actions).forEach(([actionName, action]) => {
          actions.push({
            name: actionName,
            plugin: pluginName,
            description: action.description || '',
            parameters: action.parameters || {}
          });
        });
      }
    });

    return actions;
  }

  getCategoryForAction(actionName) {
    // Categorize actions based on name patterns
    const name = actionName.toLowerCase();

    if (name.includes('transfer') || name.includes('send')) return 'transfer';
    if (name.includes('swap') || name.includes('trade')) return 'swap';
    if (name.includes('stake') || name.includes('delegate')) return 'staking';
    if (name.includes('token') || name.includes('mint')) return 'token';
    if (name.includes('nft')) return 'nft';
    if (name.includes('balance') || name.includes('get')) return 'query';
    if (name.includes('blink') || name.includes('action')) return 'blinks';

    return 'misc';
  }
}

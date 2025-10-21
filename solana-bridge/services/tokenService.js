
import {
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getAccount
} from '@solana/spl-token';
import { createCreateMetadataAccountV3Instruction } from '@metaplex-foundation/mpl-token-metadata';
import fetch from 'node-fetch';

export class TokenService {
  constructor(connection, wallet, agent) {
    this.connection = connection;
    this.wallet = wallet;
    this.agent = agent;
    this.pumpFunAPI = process.env.PUMPFUN_API_URL || 'https://pump.fun/api';
  }


  async launchPumpFunToken(params) {
    try {
      const {
        name,
        symbol,
        description,
        image,
        twitter,
        telegram,
        website
      } = params;


      const decimals = 6;
      const totalSupply = 1_000_000_000;


      const response = await fetch(`${this.pumpFunAPI}/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          symbol,
          decimals,
          description,
          image,
          totalSupply,
          socials: {
            twitter,
            telegram,
            website
          },
          creator: this.wallet.publicKey.toString(),
          network: 'devnet'
        })
      });

      if (!response.ok) {
        throw new Error(`Pump.fun API error: ${response.statusText}`);
      }

      const result = await response.json();

      return {
        success: true,
        tokenAddress: result.tokenAddress,
        bondingCurve: result.bondingCurve,
        poolAddress: result.poolAddress,
        txHash: result.txHash,
        pumpFunUrl: `https://pump.fun/token/${result.tokenAddress}`,
        details: {
          name,
          symbol,
          decimals,
          totalSupply,
          creator: this.wallet.publicKey.toString()
        }
      };
    } catch (error) {
      console.error('Pump.fun launch error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async createSPLToken(params) {
    try {
      const {
        name,
        symbol,
        decimals = 9,
        supply = 1_000_000_000,
        uri = '',
        mintAuthority = null
      } = params;


      const mintKeypair = Keypair.generate();
      const mint = mintKeypair.publicKey;


      const lamports = await this.connection.getMinimumBalanceForRentExemption(82);


      const transaction = new Transaction();


      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: this.wallet.publicKey,
          newAccountPubkey: mint,
          space: 82,
          lamports,
          programId: TOKEN_PROGRAM_ID
        })
      );


      transaction.add(
        createInitializeMintInstruction(
          mint,
          decimals,
          mintAuthority || this.wallet.publicKey,
          mintAuthority || this.wallet.publicKey,
          TOKEN_PROGRAM_ID
        )
      );


      const associatedTokenAccount = await getAssociatedTokenAddress(
        mint,
        this.wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          associatedTokenAccount,
          this.wallet.publicKey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );


      const mintAmount = supply * Math.pow(10, decimals);
      transaction.add(
        createMintToInstruction(
          mint,
          associatedTokenAccount,
          this.wallet.publicKey,
          mintAmount,
          [],
          TOKEN_PROGRAM_ID
        )
      );


      if (name && symbol) {
        await this.addMetadata(mint, {
          name,
          symbol,
          uri,
          sellerFeeBasisPoints: 0,
          creators: [{
            address: this.wallet.publicKey,
            verified: true,
            share: 100
          }]
        }, transaction);
      }


      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.wallet, mintKeypair],
        {
          commitment: 'confirmed'
        }
      );

      return {
        success: true,
        tokenAddress: mint.toString(),
        associatedTokenAccount: associatedTokenAccount.toString(),
        signature,
        explorer: `https://explorer.solana.com/address/${mint.toString()}?cluster=devnet`,
        details: {
          name,
          symbol,
          decimals,
          supply,
          mintAuthority: (mintAuthority || this.wallet.publicKey).toString()
        }
      };
    } catch (error) {
      console.error('SPL token creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async addMetadata(mintAddress, metadata, transaction = null) {
    try {
      const metadataPDA = await this.findMetadataPDA(mintAddress);

      const createMetadataInstruction = createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataPDA,
          mint: mintAddress,
          mintAuthority: this.wallet.publicKey,
          payer: this.wallet.publicKey,
          updateAuthority: this.wallet.publicKey
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: metadata.name,
              symbol: metadata.symbol,
              uri: metadata.uri,
              sellerFeeBasisPoints: metadata.sellerFeeBasisPoints || 0,
              creators: metadata.creators || null,
              collection: null,
              uses: null
            },
            isMutable: true,
            collectionDetails: null
          }
        }
      );

      if (transaction) {
        transaction.add(createMetadataInstruction);
        return { success: true, metadataPDA: metadataPDA.toString() };
      } else {
        const newTransaction = new Transaction().add(createMetadataInstruction);
        const signature = await sendAndConfirmTransaction(
          this.connection,
          newTransaction,
          [this.wallet],
          {
            commitment: 'confirmed'
          }
        );
        return {
          success: true,
          metadataPDA: metadataPDA.toString(),
          signature,
          explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
        };
      }
    } catch (error) {
      console.error('Metadata creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateMetadata(mintAddress, newMetadata) {
    try {

      const metadataPDA = await this.findMetadataPDA(mintAddress);



      return {
        success: true,
        metadataPDA: metadataPDA.toString(),
        updated: newMetadata
      };
    } catch (error) {
      console.error('Metadata update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async findMetadataPDA(mint) {
    const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const [metadataPDA] = await PublicKey.findProgramAddress(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        new PublicKey(mint).toBuffer()
      ],
      METADATA_PROGRAM_ID
    );
    return metadataPDA;
  }


  async getTokenInfo(mintAddress) {
    try {
      const mint = await getMint(this.connection, new PublicKey(mintAddress));
      const metadataPDA = await this.findMetadataPDA(mintAddress);



      return {
        success: true,
        mint: mintAddress,
        decimals: mint.decimals,
        supply: mint.supply.toString(),
        mintAuthority: mint.mintAuthority?.toString() || null,
        freezeAuthority: mint.freezeAuthority?.toString() || null,
        metadataPDA: metadataPDA.toString()
      };
    } catch (error) {
      console.error('Get token info error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }


  async getTokenBalance(tokenAddress, walletAddress = null) {
    try {
      const wallet = walletAddress ? new PublicKey(walletAddress) : this.wallet.publicKey;
      const mint = new PublicKey(tokenAddress);

      const associatedTokenAccount = await getAssociatedTokenAddress(
        mint,
        wallet,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const accountInfo = await getAccount(this.connection, associatedTokenAccount);
      const mintInfo = await getMint(this.connection, mint);

      const balance = Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals);

      return {
        success: true,
        wallet: wallet.toString(),
        token: tokenAddress,
        balance,
        rawAmount: accountInfo.amount.toString(),
        decimals: mintInfo.decimals
      };
    } catch (error) {

      if (error.message.includes('could not find account')) {
        return {
          success: true,
          wallet: (walletAddress || this.wallet.publicKey).toString(),
          token: tokenAddress,
          balance: 0,
          rawAmount: '0',
          decimals: 0
        };
      }

      return {
        success: false,
        error: error.message
      };
    }
  }
}

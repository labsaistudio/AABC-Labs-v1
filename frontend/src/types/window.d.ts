// Phantom Wallet global type definitions
export {};

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: () => Promise<{ publicKey: string }>;
      disconnect: () => Promise<void>;
      signTransaction: (transaction: any) => Promise<any>;
      signAllTransactions: (transactions: any[]) => Promise<any[]>;
    };
  }
}

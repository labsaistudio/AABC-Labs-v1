import { Router } from 'express';

const router = Router();

// Mint NFT
router.post('/mint', async (req, res) => {
  try {
    const { name, symbol, uri, sellerFeeBasisPoints, creators } = req.body;

    if (!name || !symbol || !uri) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: name, symbol, uri'
      });
    }

    const agentService = req.app.locals.agentService;
    const nftPlugin = agentService.getPlugin('nft');

    const result = await nftPlugin.mintNFT({
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: sellerFeeBasisPoints || 500, // 5% default
      creators
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

// Transfer NFT
router.post('/transfer', async (req, res) => {
  try {
    const { nftAddress, to } = req.body;

    if (!nftAddress || !to) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: nftAddress, to'
      });
    }

    const agentService = req.app.locals.agentService;
    const nftPlugin = agentService.getPlugin('nft');

    const result = await nftPlugin.transferNFT({
      mint: nftAddress,
      to
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

// Get NFTs owned by wallet
router.get('/owned/:walletAddress?', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const agentService = req.app.locals.agentService;
    const nftPlugin = agentService.getPlugin('nft');

    const address = walletAddress || agentService.getWalletAddress();
    const nfts = await nftPlugin.getNFTsByOwner(address);

    res.json({
      success: true,
      wallet: address,
      nfts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get NFT metadata
router.get('/metadata/:nftAddress', async (req, res) => {
  try {
    const { nftAddress } = req.params;
    const agentService = req.app.locals.agentService;
    const nftPlugin = agentService.getPlugin('nft');

    const metadata = await nftPlugin.getNFTMetadata(nftAddress);

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

// List NFT on marketplace
router.post('/list', async (req, res) => {
  try {
    const { nftAddress, price, marketplace } = req.body;

    if (!nftAddress || !price) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: nftAddress, price'
      });
    }

    const agentService = req.app.locals.agentService;
    const nftPlugin = agentService.getPlugin('nft');

    const result = await nftPlugin.listNFT({
      mint: nftAddress,
      price,
      marketplace: marketplace || 'tensor' // Default to Tensor
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

export { router as nftRoutes };

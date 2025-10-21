import express from 'express';
import { createLogger } from 'winston';
import fetch from 'node-fetch';
import { uploadImageToPinataCustom } from '../services/pinataHelper.js';

const router = express.Router();
const logger = createLogger();

/**
 * Upload image to IPFS via Pinata
 * POST /api/upload/image
 * Body: {
 *   imageData: string (base64 encoded image data),
 *   filename: string (optional filename)
 * }
 */
router.post('/image', async (req, res) => {
  try {
    const { imageData, filename = 'token-image.png' } = req.body;

    if (!imageData) {
      return res.status(400).json({
        success: false,
        error: 'Missing imageData in request body'
      });
    }

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      return res.status(500).json({
        success: false,
        error: 'PINATA_JWT not configured'
      });
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageData, 'base64');

    // Upload to Pinata
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('file', imageBuffer, {
      filename: filename,
      contentType: 'image/png'
    });

    // Use fetch to upload
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pinataJwt}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Pinata upload failed:', errorText);
      return res.status(500).json({
        success: false,
        error: 'Failed to upload to IPFS'
      });
    }

    const result = await response.json();
    const ipfsUrl = `https://ipfs.io/ipfs/${result.IpfsHash}`;

    logger.info(`Image uploaded to IPFS: ${ipfsUrl}`);

    return res.json({
      success: true,
      ipfsUrl: ipfsUrl,
      ipfsHash: result.IpfsHash
    });

  } catch (error) {
    logger.error('Image upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Upload image from URL to IPFS
 * POST /api/upload/image-url
 * Body: {
 *   imageUrl: string
 * }
 */
router.post('/image-url', async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing imageUrl in request body'
      });
    }

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      return res.status(500).json({
        success: false,
        error: 'PINATA_JWT not configured'
      });
    }

    // Use existing helper function
    const ipfsUrl = await uploadImageToPinataCustom(imageUrl, pinataJwt);

    if (!ipfsUrl) {
      return res.status(500).json({
        success: false,
        error: 'Failed to upload image from URL'
      });
    }

    return res.json({
      success: true,
      ipfsUrl: ipfsUrl
    });

  } catch (error) {
    logger.error('Image URL upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export const uploadRoutes = router;
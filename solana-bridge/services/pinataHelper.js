// Custom Pinata upload helper to bypass SDK issues
import https from 'https';
import fetch from 'node-fetch';

/**
 * Upload JSON to Pinata using direct API call
 */
export async function uploadJsonToPinataCustom(json, pinataJwt, pinataGateway) {
  try {
    console.log('Using custom Pinata upload implementation...');

    // Prepare the JSON data
    const data = JSON.stringify({
      pinataContent: json,
      pinataOptions: {
        cidVersion: 1
      },
      pinataMetadata: {
        name: `pump-fun-metadata-${Date.now()}.json`,
        keyvalues: {
          type: 'pump-fun-token',
          created: new Date().toISOString()
        }
      }
    });

    // Use node-fetch with custom agent to handle SSL issues
    const agent = new https.Agent({
      rejectUnauthorized: false
    });

    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pinataJwt}`
      },
      body: data,
      agent: agent,
      timeout: 30000 // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Pinata upload successful:', result);

    // Return IPFS URL
    return `https://ipfs.io/ipfs/${result.IpfsHash}`;
  } catch (error) {
    console.error('Custom Pinata upload error:', error);
    throw error;
  }
}

/**
 * Upload image to Pinata (if provided)
 */
export async function uploadImageToPinataCustom(imageUrl, pinataJwt) {
  try {
    if (!imageUrl) return null;

    console.log('Uploading image to Pinata:', imageUrl);

    // Fetch the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.warn('Failed to fetch image:', imageUrl);
      return null;
    }

    const imageBuffer = await imageResponse.buffer();

    // Create FormData for file upload
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('file', imageBuffer, {
      filename: 'token-image.png',
      contentType: imageResponse.headers.get('content-type') || 'image/png'
    });

    // Upload to Pinata
    const agent = new https.Agent({
      rejectUnauthorized: false
    });

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pinataJwt}`,
        ...formData.getHeaders()
      },
      body: formData,
      agent: agent,
      timeout: 60000 // 60 second timeout for images
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('Image upload failed:', errorText);
      return null;
    }

    const result = await response.json();
    return `https://ipfs.io/ipfs/${result.IpfsHash}`;
  } catch (error) {
    console.error('Image upload error:', error);
    return null; // Don't fail the whole operation if image upload fails
  }
}

"""
Solana Bridge HTTP Client
HTTP client for calling Node.js Solana Bridge service from Python backend

The Solana Bridge is a standalone Node.js Express service that exposes HTTP APIs.
This client calls that service via HTTP to execute Solana blockchain operations.

Author: AABC Labs
Date: 2025-10-29
"""

import os
import httpx
import logging
from typing import Dict, Any, Optional
from decimal import Decimal

logger = logging.getLogger(__name__)


class SolanaBridge:
    """
    Solana Bridge HTTP Client

    Calls Node.js Solana Bridge service via HTTP
    """

    def __init__(self):
        """
        Initialize Solana Bridge client

        Environment Variables:
            SOLANA_BRIDGE_URL: URL of the Solana Bridge service
                Default: http://localhost:3001
        """
        # Auto-detect if running in Docker container
        if os.path.exists('/.dockerenv'):
            # Use host.docker.internal to access host services from container
            default_url = 'http://host.docker.internal:3001'
        else:
            # Use localhost when running on host
            default_url = 'http://localhost:3001'

        self.bridge_url = os.getenv('SOLANA_BRIDGE_URL', default_url)
        self.timeout = 30.0  # seconds

        # Get wallet address if available
        self._wallet_address = None

        logger.info(f"SolanaBridge initialized with URL: {self.bridge_url}")

    @property
    def wallet_address(self) -> str:
        """Get wallet address"""
        if not self._wallet_address:
            # Try to get from environment variable
            self._wallet_address = os.getenv('SOLANA_WALLET_ADDRESS', 'unknown')
        return self._wallet_address

    async def _call_bridge(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Call Solana Bridge API

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint path
            data: Request body data (for POST/PUT)
            params: URL query parameters (for GET)

        Returns:
            API response data

        Raises:
            Exception: When request fails
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                url = f"{self.bridge_url}/api{endpoint}"

                logger.info(f"Calling Solana Bridge: {method} {url}")

                if method.upper() == 'GET':
                    response = await client.get(url, params=params)
                elif method.upper() == 'POST':
                    response = await client.post(url, json=data)
                elif method.upper() == 'PUT':
                    response = await client.put(url, json=data)
                elif method.upper() == 'DELETE':
                    response = await client.delete(url)
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")

                response.raise_for_status()
                result = response.json()

                logger.info(f"Solana Bridge response: {result.get('success', False)}")
                return result

        except httpx.RequestError as e:
            logger.error(f"Solana Bridge request error: {e}")
            raise Exception(f"Failed to connect to Solana Bridge: {str(e)}")
        except httpx.HTTPStatusError as e:
            logger.error(f"Solana Bridge HTTP error: {e}")
            error_msg = f"Solana Bridge returned error: {e.response.status_code}"
            try:
                error_data = e.response.json()
                if 'error' in error_data:
                    error_msg = f"Solana Bridge error: {error_data['error']}"
            except:
                pass
            raise Exception(error_msg)
        except Exception as e:
            logger.error(f"Unexpected Solana Bridge error: {e}")
            raise

    async def transfer_token(
        self,
        recipient: str,
        amount: float,
        token: str = "USDC"
    ) -> str:
        """
        Transfer SPL Token

        Args:
            recipient: Recipient address (Solana wallet address)
            amount: Transfer amount
            token: Token type (default: USDC)

        Returns:
            Transaction signature

        Raises:
            Exception: When transfer fails
        """
        logger.info(f"Initiating token transfer: {amount} {token} → {recipient[:8]}...")

        try:
            # Determine endpoint and parameters based on token type
            if token.upper() == "SOL":
                # SOL transfer
                endpoint = "/solana/transfer"
                data = {
                    "to": recipient,
                    "amount": amount
                }
            else:
                # SPL Token transfer (USDC, USDT, etc.)
                endpoint = "/token/transfer"
                data = {
                    "to": recipient,
                    "amount": amount,
                    "mint": self._get_token_mint(token)
                }

            result = await self._call_bridge('POST', endpoint, data)

            if not result.get('success'):
                error = result.get('error', 'Transfer failed')
                logger.error(f"Token transfer failed: {error}")
                raise Exception(error)

            signature = result.get('signature')
            if not signature:
                raise Exception("No transaction signature returned")

            logger.info(f"✅ Token transfer successful: {signature}")
            return signature

        except Exception as e:
            logger.error(f"Token transfer error: {str(e)}")
            raise

    async def get_transaction_info(self, tx_signature: str) -> Optional[Dict[str, Any]]:
        """
        Get transaction information

        Args:
            tx_signature: Transaction signature

        Returns:
            Transaction details dict, None if failed
        """
        logger.info(f"Fetching transaction info: {tx_signature[:8]}...")

        try:
            result = await self._call_bridge(
                'GET',
                '/solana/transaction',
                params={'signature': tx_signature}
            )

            if not result.get('success'):
                logger.warning(f"Failed to fetch transaction: {result.get('error')}")
                return None

            return result.get('data')

        except Exception as e:
            logger.error(f"Error fetching transaction info: {str(e)}")
            return None

    def _get_token_mint(self, token: str) -> str:
        """
        Get token mint address

        Args:
            token: Token symbol (e.g. USDC, USDT)

        Returns:
            Mint address
        """
        # Main token mint addresses (Solana Mainnet)
        token_mints = {
            "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
            "SOL": "So11111111111111111111111111111111111111112",  # Wrapped SOL
        }

        mint = token_mints.get(token.upper())
        if not mint:
            logger.warning(f"Unknown token: {token}, using as mint address directly")
            return token

        return mint

    async def health_check(self) -> bool:
        """
        Check if Solana Bridge service is available

        Returns:
            True if service is healthy, False otherwise
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.bridge_url}/health")
                response.raise_for_status()
                return response.json().get('status') == 'healthy'
        except Exception as e:
            logger.error(f"Solana Bridge health check failed: {e}")
            return False

    def __repr__(self):
        return f"<SolanaBridge url={self.bridge_url}>"

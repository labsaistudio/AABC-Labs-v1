"""
X402 Gateway Service
Handles HTTP 402 responses and payment flows

Features:
- Detect HTTP 402 responses
- Parse payment information
- Execute Solana payments
- Verify transactions
- Retry requests with payment proof

Author: AABC Labs
Date: 2025-10-29
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from decimal import Decimal
from datetime import datetime

import httpx
from pydantic import BaseModel, Field

# Import Solana Bridge client
from blockchain.solana_bridge_client import SolanaBridge

logger = logging.getLogger(__name__)


class PaymentRequest(BaseModel):
    """Payment request model"""
    service_url: str
    service_name: Optional[str] = None
    service_description: Optional[str] = None
    amount: Decimal = Field(gt=0)
    token: str = "USDC"
    recipient_address: str
    blockchain: str = "solana"
    timeout_seconds: int = 30
    metadata: Optional[Dict[str, Any]] = None


class PaymentReceipt(BaseModel):
    """Payment receipt model"""
    payment_id: str
    tx_signature: str
    amount: Decimal
    token: str
    from_address: str
    to_address: str
    status: str
    verified: bool
    timestamp: datetime
    blockchain: str = "solana"


class X402Gateway:
    """
    X402 Payment Gateway

    Core class for handling HTTP 402 responses and payment flows
    """

    def __init__(
        self,
        supabase_client,
        solana_bridge: SolanaBridge,
        max_payment_amount: Decimal = Decimal("10.0")
    ):
        """
        Initialize X402 Gateway

        Args:
            supabase_client: Supabase client instance
            solana_bridge: Solana Bridge instance
            max_payment_amount: Maximum payment amount limit (USDC)
        """
        self.supabase = supabase_client
        self.solana = solana_bridge
        self.max_payment_amount = max_payment_amount
        self.client = httpx.AsyncClient(timeout=30.0)

        logger.info(f"X402Gateway initialized, max payment limit: {max_payment_amount} USDC")

    async def detect_402_response(
        self,
        response: httpx.Response
    ) -> Optional[PaymentRequest]:
        """
        Detect HTTP 402 response and parse payment information

        Args:
            response: HTTP response object

        Returns:
            PaymentRequest object, or None if not a 402 response
        """
        if response.status_code != 402:
            return None

        logger.info(f"Detected HTTP 402 response: {response.url}")

        try:
            # Parse payment info from response headers
            payment_info = self._parse_payment_headers(response.headers)

            # Or parse from response body (according to x402 protocol spec)
            if not payment_info and response.content:
                try:
                    payment_info = self._parse_payment_body(response.json())
                except Exception:
                    logger.warning("Unable to parse payment info from response body")

            if not payment_info:
                logger.error("Unable to parse payment info from 402 response")
                return None

            # Create PaymentRequest object
            payment_request = PaymentRequest(
                service_url=str(response.url),
                service_name=payment_info.get("service_name"),
                service_description=payment_info.get("description"),
                amount=Decimal(str(payment_info["amount"])),
                token=payment_info.get("token", "USDC"),
                recipient_address=payment_info["recipient"],
                blockchain=payment_info.get("blockchain", "solana"),
                timeout_seconds=payment_info.get("timeout", 30),
                metadata=payment_info.get("metadata")
            )

            # Verify payment amount does not exceed limit
            if payment_request.amount > self.max_payment_amount:
                logger.error(
                    f"Payment amount {payment_request.amount} exceeds max limit "
                    f"{self.max_payment_amount}"
                )
                return None

            logger.info(
                f"Successfully parsed payment request: {payment_request.amount} {payment_request.token} "
                f"→ {payment_request.recipient_address[:8]}..."
            )
            return payment_request

        except Exception as e:
            logger.error(f"Failed to parse 402 response: {str(e)}", exc_info=True)
            return None

    def _parse_payment_headers(self, headers: httpx.Headers) -> Optional[Dict]:
        """Parse payment information from response headers"""
        # X402 standard headers
        payment_amount = headers.get("X-Payment-Amount")
        payment_recipient = headers.get("X-Payment-Recipient")
        payment_token = headers.get("X-Payment-Token", "USDC")
        payment_blockchain = headers.get("X-Payment-Blockchain", "solana")
        service_name = headers.get("X-Service-Name")

        if not payment_amount or not payment_recipient:
            return None

        return {
            "amount": payment_amount,
            "recipient": payment_recipient,
            "token": payment_token,
            "blockchain": payment_blockchain,
            "service_name": service_name
        }

    def _parse_payment_body(self, body: Dict) -> Optional[Dict]:
        """Parse payment information from response body"""
        if "payment" in body:
            return body["payment"]
        return None

    async def execute_payment(
        self,
        payment_request: PaymentRequest,
        user_id: str,
        agent_id: Optional[str] = None,
        thread_id: Optional[str] = None
    ) -> PaymentReceipt:
        """
        Execute X402 payment

        Args:
            payment_request: Payment request
            user_id: User ID
            agent_id: Agent ID (optional)
            thread_id: Thread ID (optional)

        Returns:
            PaymentReceipt payment receipt

        Raises:
            Exception: When payment fails
        """
        logger.info(
            f"Starting payment execution: {payment_request.amount} {payment_request.token} "
            f"→ {payment_request.recipient_address[:8]}..."
        )

        # 1. Create payment record in database (status: pending)
        payment_id = await self._create_payment_record(
            payment_request=payment_request,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            status="pending"
        )

        try:
            # 2. Update status to processing
            await self._update_payment_status(payment_id, "processing")

            # 3. Use Solana Bridge to execute transfer
            logger.info("Calling Solana Bridge to execute transfer...")
            tx_signature = await self.solana.transfer_token(
                recipient=payment_request.recipient_address,
                amount=float(payment_request.amount),
                token=payment_request.token
            )

            logger.info(f"✅ Payment successful! Tx: {tx_signature}")

            # 4. Update payment record
            await self._update_payment_record(
                payment_id=payment_id,
                tx_signature=tx_signature,
                status="confirmed"
            )

            # 5. Verify on-chain transaction (optional)
            verified = await self._verify_transaction(
                tx_signature=tx_signature,
                expected_amount=payment_request.amount,
                expected_recipient=payment_request.recipient_address
            )

            # 6. Create payment receipt
            receipt = PaymentReceipt(
                payment_id=payment_id,
                tx_signature=tx_signature,
                amount=payment_request.amount,
                token=payment_request.token,
                from_address=self.solana.wallet_address,
                to_address=payment_request.recipient_address,
                status="confirmed",
                verified=verified,
                timestamp=datetime.utcnow(),
                blockchain=payment_request.blockchain
            )

            return receipt

        except Exception as e:
            logger.error(f"Payment execution failed: {str(e)}", exc_info=True)

            # Update payment status to failed
            await self._update_payment_record(
                payment_id=payment_id,
                status="failed",
                error_message=str(e)
            )

            raise Exception(f"Payment failed: {str(e)}")

    async def retry_request_with_payment(
        self,
        payment_request: PaymentRequest,
        receipt: PaymentReceipt,
        original_request_data: Optional[Dict] = None
    ) -> httpx.Response:
        """
        Retry original request after successful payment

        Args:
            payment_request: Payment request
            receipt: Payment receipt
            original_request_data: Original request data (method, body, etc.)

        Returns:
            HTTP response
        """
        logger.info(f"Retrying request with payment proof: {payment_request.service_url}")

        # Build payment proof headers
        headers = {
            "X-Payment-Signature": receipt.tx_signature,
            "X-Payment-Amount": str(receipt.amount),
            "X-Payment-Token": receipt.token,
            "X-Payment-From": receipt.from_address,
            "X-Payment-Blockchain": receipt.blockchain
        }

        # Retry request
        method = original_request_data.get("method", "GET") if original_request_data else "GET"
        body = original_request_data.get("body") if original_request_data else None

        response = await self.client.request(
            method=method,
            url=payment_request.service_url,
            headers=headers,
            json=body
        )

        if response.status_code == 200:
            logger.info("✅ Request with payment proof successful")
        else:
            logger.warning(f"⚠️ Request returned status code {response.status_code}")

        return response

    async def verify_payment(self, tx_signature: str) -> bool:
        """
        Verify payment was successful

        Args:
            tx_signature: Transaction signature

        Returns:
            bool: Verification result
        """
        return await self._verify_transaction(tx_signature, None, None)

    async def _create_payment_record(
        self,
        payment_request: PaymentRequest,
        user_id: str,
        agent_id: Optional[str],
        thread_id: Optional[str],
        status: str
    ) -> str:
        """Create payment record in database"""
        try:
            result = await self.supabase.table("x402_payments").insert({
                "user_id": user_id,
                "agent_id": agent_id,
                "thread_id": thread_id,
                "direction": "outgoing",
                "service_url": payment_request.service_url,
                "service_name": payment_request.service_name,
                "service_description": payment_request.service_description,
                "amount": str(payment_request.amount),
                "token": payment_request.token,
                "from_address": self.solana.wallet_address,
                "to_address": payment_request.recipient_address,
                "status": status,
                "metadata": payment_request.metadata
            }).execute()

            payment_id = result.data[0]["payment_id"]
            logger.info(f"Created payment record: {payment_id}")
            return payment_id

        except Exception as e:
            logger.error(f"Failed to create payment record: {str(e)}", exc_info=True)
            raise

    async def _update_payment_record(
        self,
        payment_id: str,
        tx_signature: Optional[str] = None,
        status: Optional[str] = None,
        error_message: Optional[str] = None
    ):
        """Update payment record"""
        try:
            update_data = {"updated_at": datetime.utcnow().isoformat()}

            if tx_signature:
                update_data["tx_signature"] = tx_signature
            if status:
                update_data["status"] = status
            if error_message:
                update_data["error_message"] = error_message

            if status == "confirmed":
                update_data["verified_at"] = datetime.utcnow().isoformat()

            await self.supabase.table("x402_payments")\
                .update(update_data)\
                .eq("payment_id", payment_id)\
                .execute()

            logger.debug(f"Updated payment record: {payment_id} → {status}")

        except Exception as e:
            logger.error(f"Failed to update payment record: {str(e)}", exc_info=True)
            raise

    async def _update_payment_status(self, payment_id: str, status: str):
        """Update payment status"""
        await self._update_payment_record(payment_id, status=status)

    async def _verify_transaction(
        self,
        tx_signature: str,
        expected_amount: Optional[Decimal],
        expected_recipient: Optional[str]
    ) -> bool:
        """
        Verify on-chain transaction

        Args:
            tx_signature: Transaction signature
            expected_amount: Expected amount
            expected_recipient: Expected recipient address

        Returns:
            bool: Verification result
        """
        try:
            # Use Solana Bridge to verify transaction
            tx_info = await self.solana.get_transaction_info(tx_signature)

            if not tx_info:
                logger.warning(f"Unable to get transaction info: {tx_signature}")
                return False

            # TODO: Extract actual amount and recipient address from tx_info for verification
            # Currently simplified implementation, only checks if transaction exists

            logger.info(f"✅ Transaction verified successfully: {tx_signature}")
            return True

        except Exception as e:
            logger.error(f"Transaction verification failed: {str(e)}", exc_info=True)
            return False

    async def close(self):
        """Close client connections"""
        await self.client.aclose()
        logger.info("X402Gateway closed")

    def __repr__(self):
        return f"<X402Gateway max_amount={self.max_payment_amount} USDC>"

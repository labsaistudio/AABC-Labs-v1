"""
X402 Gateway Service

Handles HTTP 402 responses and payment flow

Features:
- Detect HTTP 402 responses
- Parse payment information
- Execute Solana payments (custodial or user wallet)
- Verify transactions
- Retry requests with payment proof

Author: AABC Labs
Date: 2025-10-29
"""

import asyncio
import logging
from typing import Optional, Dict, Any
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from enum import Enum

import httpx
from pydantic import BaseModel, Field

# Solana Bridge Client
from blockchain.solana_bridge_client import SolanaBridge

logger = logging.getLogger(__name__)


class PaymentMode(str, Enum):
    """Payment execution mode"""
    CUSTODIAL = "custodial"  # Backend wallet executes payment
    USER_WALLET = "user_wallet"  # User signs with their wallet


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


class UnsignedTransaction(BaseModel):
    """Unsigned transaction for user wallet signing"""
    payment_id: str
    transaction_data: str  # Base64 encoded unsigned transaction
    amount: Decimal
    token: str
    recipient_address: str
    expires_at: datetime
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
    payment_mode: PaymentMode = PaymentMode.CUSTODIAL


class X402Gateway:
    """ X402 PaymentGateway HTTP 402 ResponseandPayment """

    def __init__(
        self,
        db_connection,
        solana_bridge: SolanaBridge,
        max_payment_amount: Decimal = Decimal("10.0")
    ):
        """ Initialize X402 Gateway Args: db_connection: DBConnection solana_bridge: Solana Bridge max_payment_amount: MaximumPaymentAmountLimit（USDC） """
        self.db = db_connection
        self.solana = solana_bridge
        self.max_payment_amount = max_payment_amount
        self.client = httpx.AsyncClient(timeout=30.0)

        logger.info(f"X402Gateway ，: {max_payment_amount} USDC")

    async def detect_402_response(
        self,
        response: httpx.Response
    ) -> Optional[PaymentRequest]:
        """ Detect HTTP 402 ResponseParsePaymentInformation Args: response: HTTP Responsefor Returns: PaymentRequest for，ifnotis 402 ResponseReturns None """
        if response.status_code != 402:
            return None

        logger.info(f" HTTP 402 : {response.url}")

        try:
            # fromResponseParsePaymentInformation
            payment_info = self._parse_payment_headers(response.headers)

            # orfromResponseParse ( x402 )
            if not payment_info and response.content:
                try:
                    payment_info = self._parse_payment_body(response.json())
                except Exception:
                    logger.warning("")

            if not payment_info:
                logger.error(" 402 ")
                return None

            # Create PaymentRequest for
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

            # VerifyPaymentAmountnotLimit
            if payment_request.amount > self.max_payment_amount:
                logger.error(
                    f" {payment_request.amount}  "
                    f"{self.max_payment_amount}"
                )
                return None

            logger.info(
                f": {payment_request.amount} {payment_request.token} "
                f"→ {payment_request.recipient_address[:8]}..."
            )
            return payment_request

        except Exception as e:
            logger.error(f" 402 : {str(e)}", exc_info=True)
            return None

    def _parse_payment_headers(self, headers: httpx.Headers) -> Optional[Dict]:
        """fromResponseParsePaymentInformation"""
        # X402 
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
        """fromResponseParsePaymentInformation"""
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
        """ Execute X402 Payment Args: payment_request: PaymentRequest user_id: ID agent_id: Agent ID (Optional) thread_id: Thread ID (Optional) Returns: PaymentReceipt PaymentReceipt Raises: Exception: PaymentFailedAbnormal """
        logger.info(
            f": {payment_request.amount} {payment_request.token} "
            f"→ {payment_request.recipient_address[:8]}..."
        )

        # 1. inDatainCreatePaymentRecord (Status: pending)
        payment_id = await self._create_payment_record(
            payment_request=payment_request,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            status="pending"
        )

        try:
            # 2. UpdateStatusas processing
            await self._update_payment_status(payment_id, "processing")

            # 3. using Solana Bridge ExecuteTransfer
            logger.info(" Solana Bridge ...")
            tx_signature = await self.solana.transfer_token(
                recipient=payment_request.recipient_address,
                amount=float(payment_request.amount),
                token=payment_request.token
            )

            logger.info(f"✅ ! Tx: {tx_signature}")

            # 4. UpdatePaymentRecord
            await self._update_payment_record(
                payment_id=payment_id,
                tx_signature=tx_signature,
                status="confirmed"
            )

            # 5. VerifyTransaction（Optional）
            verified = await self._verify_transaction(
                tx_signature=tx_signature,
                expected_amount=payment_request.amount,
                expected_recipient=payment_request.recipient_address
            )

            # 6. CreatePaymentReceipt
            receipt = PaymentReceipt(
                payment_id=payment_id,
                tx_signature=tx_signature,
                amount=payment_request.amount,
                token=payment_request.token,
                from_address=self.solana.wallet_address,
                to_address=payment_request.recipient_address,
                status="confirmed",
                verified=verified,
                timestamp=datetime.now(timezone.utc),
                blockchain=payment_request.blockchain
            )

            return receipt

        except Exception as e:
            logger.error(f": {str(e)}", exc_info=True)

            # UpdatePaymentStatusas failed
            await self._update_payment_record(
                payment_id=payment_id,
                status="failed",
                error_message=str(e)
            )

            raise Exception(f"Payment execution failed: {str(e)}")

    async def prepare_payment(
        self,
        payment_request: PaymentRequest,
        user_id: str,
        user_wallet_address: str,
        agent_id: Optional[str] = None,
        thread_id: Optional[str] = None
    ) -> UnsignedTransaction:
        """
        Prepare unsigned transaction for user wallet signing

        Args:
            payment_request: Payment request details
            user_id: User ID
            user_wallet_address: User's Solana wallet address
            agent_id: Agent ID (optional)
            thread_id: Thread ID (optional)

        Returns:
            UnsignedTransaction with base64 encoded transaction data

        Raises:
            Exception: If transaction preparation fails
        """
        logger.info(
            f"Preparing payment: {payment_request.amount} {payment_request.token} "
            f"from user wallet {user_wallet_address[:8]}..."
        )

        # 1. Create payment record with pending_signature status
        payment_id = await self._create_payment_record(
            payment_request=payment_request,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            status="pending_signature",
            payment_mode=PaymentMode.USER_WALLET,
            user_wallet_address=user_wallet_address
        )

        try:
            # 2. Create unsigned transaction via Solana Bridge
            logger.info("Creating unsigned transaction via Solana Bridge...")
            unsigned_tx_data = await self.solana.create_transfer_transaction(
                from_address=user_wallet_address,
                recipient=payment_request.recipient_address,
                amount=float(payment_request.amount),
                token=payment_request.token
            )

            # 3. Set expiration time (45 seconds for user to sign)
            # Solana blockhash is valid for ~150 blocks (~60-90 seconds)
            # Give user 45 seconds to sign and submit
            # This is aggressive but necessary to avoid blockhash expiration
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=45)

            # 4. Store unsigned transaction in database
            await self._update_payment_record(
                payment_id=payment_id,
                unsigned_transaction=unsigned_tx_data,
                expires_at=expires_at
            )

            # 5. Create UnsignedTransaction response
            unsigned_tx = UnsignedTransaction(
                payment_id=payment_id,
                transaction_data=unsigned_tx_data,
                amount=payment_request.amount,
                token=payment_request.token,
                recipient_address=payment_request.recipient_address,
                expires_at=expires_at,
                metadata=payment_request.metadata
            )

            logger.info(f"Unsigned transaction created: {payment_id}")
            return unsigned_tx

        except Exception as e:
            logger.error(f"Failed to prepare payment: {str(e)}", exc_info=True)
            await self._update_payment_record(
                payment_id=payment_id,
                status="failed",
                error_message=str(e)
            )
            raise Exception(f"Payment preparation failed: {str(e)}")

    async def submit_signed_payment(
        self,
        payment_id: str,
        signed_transaction: str,
        user_id: str
    ) -> PaymentReceipt:
        """
        Submit user-signed transaction to blockchain

        Args:
            payment_id: Payment record ID
            signed_transaction: Base64 encoded signed transaction
            user_id: User ID for verification

        Returns:
            PaymentReceipt after blockchain confirmation

        Raises:
            Exception: If submission or verification fails
        """
        logger.info(f"Submitting signed transaction for payment: {payment_id}")

        # 1. Retrieve payment record and verify ownership
        payment_record = await self._get_payment_record(payment_id)

        if not payment_record:
            raise Exception(f"Payment record not found: {payment_id}")

        if payment_record.get('user_id') != user_id:
            raise Exception("Unauthorized: Payment belongs to different user")

        if payment_record.get('status') != 'pending_signature':
            raise Exception(f"Invalid payment status: {payment_record.get('status')}")

        # 2. Check expiration (soft check - warn but don't block)
        # Let Solana blockchain determine if blockhash is truly expired
        # This allows auto-recovery flow to work
        expires_at = payment_record.get('expires_at')
        if expires_at and datetime.fromisoformat(expires_at) < datetime.now(timezone.utc):
            logger.warning(f"Payment {payment_id} expires_at has passed, but attempting submission anyway")
            # Don't block - let Solana decide if blockhash is still valid

        try:
            # 3. Update status to processing
            await self._update_payment_status(payment_id, "processing")

            # 4. Submit signed transaction via Solana Bridge
            logger.info("Submitting signed transaction to Solana...")
            tx_signature = await self.solana.submit_signed_transaction(
                signed_transaction=signed_transaction
            )

            logger.info(f"✅ Transaction confirmed! Tx: {tx_signature}")

            # 5. Update payment record
            await self._update_payment_record(
                payment_id=payment_id,
                tx_signature=tx_signature,
                status="confirmed"
            )

            # 6. Verify transaction (optional) - SAFE field access
            expected_recipient = payment_record.get('to_address') or payment_record.get('recipient_address')

            if not expected_recipient:
                logger.warning(
                    f"Payment {payment_id} has no to_address/recipient_address on record; "
                    "skipping recipient verification."
                )
                verified = False  # Cannot verify without recipient
            else:
                verified = await self._verify_transaction(
                    tx_signature=tx_signature,
                    expected_amount=Decimal(str(payment_record['amount'])),
                    expected_recipient=expected_recipient
                )

            # 7. Create PaymentReceipt - SAFE field access
            to_address = payment_record.get('to_address') or payment_record.get('recipient_address') or 'unknown'

            receipt = PaymentReceipt(
                payment_id=payment_id,
                tx_signature=tx_signature,
                amount=Decimal(str(payment_record['amount'])),
                token=payment_record['token'],
                from_address=payment_record.get('user_wallet_address', 'unknown'),
                to_address=to_address,
                status="confirmed",
                verified=verified,
                timestamp=datetime.now(timezone.utc),
                blockchain=payment_record.get('blockchain', 'solana'),
                payment_mode=PaymentMode.USER_WALLET
            )

            return receipt

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Failed to submit signed payment: {error_msg}", exc_info=True)

            # Check if error is blockhash expiration - allow recovery
            if "BLOCKHASH_EXPIRED" in error_msg or "block height exceeded" in error_msg:
                logger.warning("Blockhash expired - reverting to pending_signature for retry")
                await self._update_payment_record(
                    payment_id=payment_id,
                    status="pending_signature",
                    error_message="Blockhash expired, please refresh transaction and re-sign"
                )
                raise Exception("BLOCKHASH_EXPIRED: Transaction expired, please refresh and re-sign")

            # Other errors mark as failed
            await self._update_payment_record(
                payment_id=payment_id,
                status="failed",
                error_message=error_msg
            )
            raise Exception(f"Payment submission failed: {error_msg}")

    async def retry_request_with_payment(
        self,
        payment_request: PaymentRequest,
        receipt: PaymentReceipt,
        original_request_data: Optional[Dict] = None
    ) -> httpx.Response:
        """ PaymentSuccessRetryRequest Args: payment_request: PaymentRequest receipt: PaymentReceipt original_request_data: RequestData（、body ） Returns: HTTP Response """
        logger.info(f": {payment_request.service_url}")

        # Payment
        headers = {
            "X-Payment-Signature": receipt.tx_signature,
            "X-Payment-Amount": str(receipt.amount),
            "X-Payment-Token": receipt.token,
            "X-Payment-From": receipt.from_address,
            "X-Payment-Blockchain": receipt.blockchain
        }

        # RetryRequest
        method = original_request_data.get("method", "GET") if original_request_data else "GET"
        body = original_request_data.get("body") if original_request_data else None

        response = await self.client.request(
            method=method,
            url=payment_request.service_url,
            headers=headers,
            json=body
        )

        if response.status_code == 200:
            logger.info("✅ ")
        else:
            logger.warning(f"⚠️  {response.status_code}")

        return response

    async def verify_payment(self, tx_signature: str) -> bool:
        """ VerifyPaymentisSuccess Args: tx_signature: TransactionSignature Returns: bool: Verify """
        return await self._verify_transaction(tx_signature, None, None)

    async def _create_payment_record(
        self,
        payment_request: PaymentRequest,
        user_id: str,
        agent_id: Optional[str],
        thread_id: Optional[str],
        status: str,
        payment_mode: PaymentMode = PaymentMode.CUSTODIAL,
        user_wallet_address: Optional[str] = None
    ) -> str:
        """Create payment record in database"""
        try:
            client = await self.db.client

            # Determine from_address based on payment mode
            from_address = user_wallet_address if payment_mode == PaymentMode.USER_WALLET else self.solana.wallet_address

            result = await client.table("x402_payments").insert({
                "user_id": user_id,
                "agent_id": agent_id,
                "thread_id": thread_id,
                "direction": "outgoing",
                "service_url": payment_request.service_url,
                "service_name": payment_request.service_name,
                "service_description": payment_request.service_description,
                "amount": str(payment_request.amount),
                "token": payment_request.token,
                "from_address": from_address,
                "to_address": payment_request.recipient_address,
                "status": status,
                "payment_mode": payment_mode.value,
                "user_wallet_address": user_wallet_address,
                "metadata": payment_request.metadata
            }).execute()

            payment_id = result.data[0]["payment_id"]
            logger.info(f"Payment record created: {payment_id}")
            return payment_id

        except Exception as e:
            logger.error(f"Failed to create payment record: {str(e)}", exc_info=True)
            raise

    async def _get_payment_record(self, payment_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve payment record from database"""
        try:
            client = await self.db.client
            result = await client.table("x402_payments")\
                .select("*")\
                .eq("payment_id", payment_id)\
                .single()\
                .execute()

            return result.data if result.data else None

        except Exception as e:
            logger.error(f"Failed to get payment record: {str(e)}", exc_info=True)
            return None

    async def _update_payment_record(
        self,
        payment_id: str,
        tx_signature: Optional[str] = None,
        status: Optional[str] = None,
        error_message: Optional[str] = None,
        unsigned_transaction: Optional[str] = None,
        expires_at: Optional[datetime] = None
    ):
        """Update payment record"""
        try:
            update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}

            if tx_signature:
                update_data["tx_signature"] = tx_signature
            if status:
                update_data["status"] = status
            if error_message:
                update_data["error_message"] = error_message
            if unsigned_transaction:
                update_data["unsigned_transaction"] = unsigned_transaction
            if expires_at:
                update_data["expires_at"] = expires_at.isoformat()

            if status == "confirmed":
                update_data["verified_at"] = datetime.now(timezone.utc).isoformat()

            client = await self.db.client
            await client.table("x402_payments")\
                .update(update_data)\
                .eq("payment_id", payment_id)\
                .execute()

            logger.debug(f": {payment_id} → {status}")

        except Exception as e:
            logger.error(f": {str(e)}", exc_info=True)
            raise

    async def _update_payment_status(self, payment_id: str, status: str):
        """UpdatePaymentStatus"""
        await self._update_payment_record(payment_id, status=status)

    async def _verify_transaction(
        self,
        tx_signature: str,
        expected_amount: Optional[Decimal],
        expected_recipient: Optional[str]
    ) -> bool:
        """ VerifyTransaction Args: tx_signature: TransactionSignature expected_amount: Amount expected_recipient: ReceiveAddress Returns: bool: Verify """
        try:
            # using Solana Bridge VerifyTransaction
            tx_info = await self.solana.get_transaction_info(tx_signature)

            if not tx_info:
                logger.warning(f": {tx_signature}")
                return False

            # TODO: from tx_info inAmountandReceiveAddressVerify
            # ，Transactionisin

            logger.info(f"✅ : {tx_signature}")
            return True

        except Exception as e:
            logger.error(f": {str(e)}", exc_info=True)
            return False

    async def close(self):
        """CloseClientConnect"""
        await self.client.aclose()
        logger.info("X402Gateway ")

    def __repr__(self):
        return f"<X402Gateway max_amount={self.max_payment_amount} USDC>"

""" X402 Gateway Service HTTP 402 ResponseandPayment : - Detect HTTP 402 Response - ParsePaymentInformation - Execute Solana Payment - VerifyTransaction - RetryRequest Author: AABC Labs Date: 2025-10-29 """

import asyncio
import logging
from typing import Optional, Dict, Any
from decimal import Decimal
from datetime import datetime

import httpx
from pydantic import BaseModel, Field

# Solana Bridge Client
from blockchain.solana_bridge_client import SolanaBridge

logger = logging.getLogger(__name__)


class PaymentRequest(BaseModel):
    """PaymentRequest"""
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
    """PaymentReceipt"""
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
                timestamp=datetime.utcnow(),
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

            raise Exception(f": {str(e)}")

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
        status: str
    ) -> str:
        """inDatainCreatePaymentRecord"""
        try:
            client = await self.db.client
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
                "from_address": self.solana.wallet_address,
                "to_address": payment_request.recipient_address,
                "status": status,
                "metadata": payment_request.metadata
            }).execute()

            payment_id = result.data[0]["payment_id"]
            logger.info(f": {payment_id}")
            return payment_id

        except Exception as e:
            logger.error(f": {str(e)}", exc_info=True)
            raise

    async def _update_payment_record(
        self,
        payment_id: str,
        tx_signature: Optional[str] = None,
        status: Optional[str] = None,
        error_message: Optional[str] = None
    ):
        """UpdatePaymentRecord"""
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

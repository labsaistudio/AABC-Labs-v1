""" X402 API Routes X402 Payment REST API Endpoints: - POST /x402/payments - CreatePayment - GET /x402/payments - GetPayment - GET /x402/payments/{payment_id} - GetPayment - POST /x402/verify/{tx_signature} - VerifyPaymentTransaction - POST /x402/services - Service - GET /x402/services - Service - GET /x402/services/{service_id} - GetService Author: AABC Labs Date: 2025-10-29 """

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from typing import List, Optional
from pydantic import BaseModel, Field
from decimal import Decimal
from datetime import datetime
import logging
import json
import base64

from services.supabase import DBConnection
from services.x402_gateway import (
    X402Gateway,
    PaymentRequest as GatewayPaymentRequest,
    PaymentMode,
    UnsignedTransaction
)
from blockchain.solana_bridge_client import SolanaBridge

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/x402", tags=["X402 Payments"])

# （willinInitializeSet）
db_connection: Optional[DBConnection] = None
x402_gateway: Optional[X402Gateway] = None


# ============================================================================
# Request/Response Models
# ============================================================================

class CreatePaymentRequest(BaseModel):
    """CreatePaymentRequest"""
    service_url: str = Field(..., description=" URL")
    amount: Decimal = Field(..., gt=0, description="")
    token: str = Field(default="USDC", description="")
    recipient_address: str = Field(..., description="")
    agent_id: Optional[str] = Field(None, description="Agent ID")
    thread_id: Optional[str] = Field(None, description="Thread ID")
    service_name: Optional[str] = Field(None, description="")
    service_description: Optional[str] = Field(None, description="")


class PaymentResponse(BaseModel):
    """PaymentResponse"""
    payment_id: str
    tx_signature: str
    amount: Decimal
    token: str
    status: str
    created_at: str


class ServiceRegistration(BaseModel):
    """ServiceRequest"""
    service_name: str = Field(..., max_length=100, description="")
    service_description: str = Field(..., description="")
    service_url: str = Field(..., description=" URL")
    price: Decimal = Field(..., ge=0, description="")
    price_token: str = Field(default="USDC", description="")
    payment_address: str = Field(..., description="")
    service_category: Optional[str] = Field(None, description="")
    tags: Optional[List[str]] = Field(None, description="")
    agent_id: Optional[str] = Field(None, description=" Agent ID")


class ServiceResponse(BaseModel):
    """ServiceResponse"""
    service_id: str
    service_name: str
    service_description: str
    service_url: str
    price: Decimal
    price_token: str
    total_calls: int
    is_active: bool


class PreparePaymentRequest(BaseModel):
    """Request to prepare unsigned transaction for user wallet signing"""
    service_url: str = Field(..., description="Service URL requiring payment")
    amount: Decimal = Field(..., gt=0, description="Payment amount")
    token: str = Field(default="SOL", description="Token to use (SOL, USDC, etc)")
    recipient_address: str = Field(..., description="Payment recipient address")
    user_wallet_address: str = Field(..., description="User's wallet address")
    agent_id: Optional[str] = Field(None, description="Agent ID")
    thread_id: Optional[str] = Field(None, description="Thread ID")
    service_name: Optional[str] = Field(None, description="Service name")
    service_description: Optional[str] = Field(None, description="Service description")


class PreparePaymentResponse(BaseModel):
    """Response containing unsigned transaction"""
    payment_id: str
    transaction_data: str
    amount: Decimal
    token: str
    recipient_address: str
    expires_at: str


class SubmitPaymentRequest(BaseModel):
    """Request to submit signed transaction"""
    payment_id: str = Field(..., description="Payment ID from prepare_payment")
    signed_transaction: str = Field(..., description="Base64 encoded signed transaction")


class PaymentStatusResponse(BaseModel):
    """Payment status response"""
    payment_id: str
    status: str
    payment_mode: str
    amount: Decimal
    token: str
    tx_signature: Optional[str] = None
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    created_at: str
    expires_at: Optional[str] = None
    error_message: Optional[str] = None


# ============================================================================
# Dependencies
# ============================================================================

async def get_current_user(request: Request) -> str:
    """Get user ID (UUID) from Supabase JWT token in Authorization header"""
    # Get Authorization header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token"
        )

    # Extract token
    token = auth_header.replace("Bearer ", "")

    try:
        # Decode JWT token (without signature verification for now)
        # JWT format: header.payload.signature
        # We only need the payload which contains user info
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT token format")

        # Decode the payload (second part)
        payload_encoded = parts[1]

        # Add padding if needed (base64 requires padding)
        padding = 4 - len(payload_encoded) % 4
        if padding != 4:
            payload_encoded += "=" * padding

        # Decode from base64
        payload_json = base64.urlsafe_b64decode(payload_encoded)
        payload = json.loads(payload_json)

        # Extract user_id from 'sub' field (standard JWT claim)
        user_id = payload.get("sub")

        if not user_id:
            raise ValueError("User ID (sub) not found in token payload")

        logger.info(f"Authenticated user: {user_id}")
        return user_id  # Return UUID string

    except Exception as e:
        logger.error(f"Token verification failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(e)}"
        )


async def get_x402_gateway() -> X402Gateway:
    """Get X402 Gateway """
    if not x402_gateway:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="X402 Gateway not initialized"
        )
    return x402_gateway


# ============================================================================
# API Endpoints
# ============================================================================

@router.post("/payments", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
async def create_payment(
    request: CreatePaymentRequest,
    gateway: X402Gateway = Depends(get_x402_gateway)
):
    """ CreateExecute X402 Payment Args: request: PaymentRequest gateway: X402 Gateway Returns: PaymentResponse: PaymentReceipt Raises: HTTPException: PaymentFailed """
    try:
        logger.info(f": {request.amount} {request.token} → {request.recipient_address[:8]}...")

        # CreatePaymentRequest
        payment_request = GatewayPaymentRequest(
            service_url=request.service_url,
            service_name=request.service_name,
            service_description=request.service_description,
            amount=request.amount,
            token=request.token,
            recipient_address=request.recipient_address
        )

        # ExecutePayment（using test user ID）
        # TODO: from JWT token inGet user_id
        user_id = "test-user-id"

        receipt = await gateway.execute_payment(
            payment_request=payment_request,
            user_id=user_id,
            agent_id=request.agent_id,
            thread_id=request.thread_id
        )

        return PaymentResponse(
            payment_id=receipt.payment_id,
            tx_signature=receipt.tx_signature,
            amount=receipt.amount,
            token=receipt.token,
            status=receipt.status,
            created_at=receipt.timestamp.isoformat()
        )

    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Payment failed: {str(e)}"
        )


@router.get("/payments", response_model=List[PaymentResponse])
async def list_payments(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    """ GetPayment Args: limit: ReturnsLimit offset: Returns: List[PaymentResponse]: PaymentRecord """
    try:
        # TODO: from JWT token inGet user_id
        user_id = "test-user-id"

        client = await db_connection.client
        result = await client.table("x402_payments")\
            .select("*")\
            .eq("user_id", user_id)\
            .order("created_at", desc=True)\
            .limit(limit)\
            .offset(offset)\
            .execute()

        payments = [
            PaymentResponse(
                payment_id=p["payment_id"],
                tx_signature=p["tx_signature"] or "",
                amount=Decimal(p["amount"]),
                token=p["token"],
                status=p["status"],
                created_at=p["created_at"]
            )
            for p in result.data
        ]

        return payments

    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch payments: {str(e)}"
        )


@router.get("/payments/{payment_id}", response_model=PaymentResponse)
async def get_payment(payment_id: str):
    """ GetPaymentRecord Args: payment_id: Payment ID Returns: PaymentResponse: Payment """
    try:
        # TODO: from JWT token inGet user_id
        user_id = "test-user-id"

        client = await db_connection.client
        result = await client.table("x402_payments")\
            .select("*")\
            .eq("payment_id", payment_id)\
            .eq("user_id", user_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found"
            )

        p = result.data
        return PaymentResponse(
            payment_id=p["payment_id"],
            tx_signature=p["tx_signature"] or "",
            amount=Decimal(p["amount"]),
            token=p["token"],
            status=p["status"],
            created_at=p["created_at"]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch payment: {str(e)}"
        )


@router.post("/verify/{tx_signature}")
async def verify_payment(
    tx_signature: str,
    gateway: X402Gateway = Depends(get_x402_gateway)
):
    """ VerifyPaymentTransaction Args: tx_signature: TransactionSignature gateway: X402 Gateway Returns: dict: Verify """
    try:
        verified = await gateway.verify_payment(tx_signature)

        return {
            "tx_signature": tx_signature,
            "verified": verified,
            "blockchain": "solana"
        }

    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to verify payment: {str(e)}"
        )


@router.post("/services", status_code=status.HTTP_201_CREATED)
async def register_service(service: ServiceRegistration):
    """ X402 Service Args: service: ServiceInformation Returns: dict: CreateServiceInformation """
    try:
        # TODO: from JWT token inGet user_id
        user_id = "test-user-id"

        client = await db_connection.client
        result = await client.table("x402_services").insert({
            "provider_id": user_id,
            "agent_id": service.agent_id,
            "service_name": service.service_name,
            "service_description": service.service_description,
            "service_url": service.service_url,
            "price": str(service.price),
            "price_token": service.price_token,
            "payment_address": service.payment_address,
            "service_category": service.service_category,
            "tags": service.tags
        }).execute()

        return result.data[0]

    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register service: {str(e)}"
        )


@router.get("/services", response_model=List[ServiceResponse])
async def list_services(
    category: Optional[str] = Query(None, description=""),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    """ X402 Service Args: category: ServiceFilter limit: ReturnsLimit offset: Returns: List[ServiceResponse]: Service """
    try:
        client = await db_connection.client
        query = client.table("x402_services")\
            .select("*")\
            .eq("is_active", True)

        if category:
            query = query.eq("service_category", category)

        result = await query.order("total_calls", desc=True)\
            .limit(limit)\
            .offset(offset)\
            .execute()

        services = [
            ServiceResponse(
                service_id=s["service_id"],
                service_name=s["service_name"],
                service_description=s["service_description"],
                service_url=s["service_url"],
                price=Decimal(s["price"]),
                price_token=s["price_token"],
                total_calls=s["total_calls"],
                is_active=s["is_active"]
            )
            for s in result.data
        ]

        return services

    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch services: {str(e)}"
        )


@router.get("/services/{service_id}")
async def get_service(service_id: str):
    """ GetService Args: service_id: Service ID Returns: dict: Service """
    try:
        client = await db_connection.client
        result = await client.table("x402_services")\
            .select("*")\
            .eq("service_id", service_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Service not found"
            )

        return result.data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f": {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch service: {str(e)}"
        )


# ============================================================================
# User Wallet Signing Endpoints
# ============================================================================

@router.post("/prepare-payment", response_model=PreparePaymentResponse)
async def prepare_payment(
    request: PreparePaymentRequest,
    user_id: str = Depends(get_current_user)
):
    """
    Prepare unsigned transaction for user wallet signing

    This endpoint creates an unsigned transaction that the user can sign
    with their own wallet (Phantom, Solflare, etc.)
    """
    try:
        if not x402_gateway:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="X402 Gateway not initialized"
            )

        # Create PaymentRequest for gateway
        payment_request = GatewayPaymentRequest(
            service_url=request.service_url,
            amount=request.amount,
            token=request.token,
            recipient_address=request.recipient_address,
            service_name=request.service_name,
            service_description=request.service_description
        )

        # Prepare unsigned transaction
        unsigned_tx = await x402_gateway.prepare_payment(
            payment_request=payment_request,
            user_id=user_id,
            user_wallet_address=request.user_wallet_address,
            agent_id=request.agent_id,
            thread_id=request.thread_id
        )

        # Return response
        return PreparePaymentResponse(
            payment_id=unsigned_tx.payment_id,
            transaction_data=unsigned_tx.transaction_data,
            amount=unsigned_tx.amount,
            token=unsigned_tx.token,
            recipient_address=unsigned_tx.recipient_address,
            expires_at=unsigned_tx.expires_at.isoformat() + 'Z'  # Add 'Z' to indicate UTC
        )

    except Exception as e:
        logger.error(f"Failed to prepare payment: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to prepare payment: {str(e)}"
        )


@router.post("/submit-payment", response_model=PaymentResponse)
async def submit_payment(
    request: SubmitPaymentRequest,
    user_id: str = Depends(get_current_user)
):
    """
    Submit user-signed transaction to blockchain

    After the user signs the transaction with their wallet,
    submit it here to broadcast to Solana blockchain
    """
    try:
        if not x402_gateway:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="X402 Gateway not initialized"
            )

        # Submit signed transaction
        receipt = await x402_gateway.submit_signed_payment(
            payment_id=request.payment_id,
            signed_transaction=request.signed_transaction,
            user_id=user_id
        )

        # Return response
        return PaymentResponse(
            payment_id=receipt.payment_id,
            tx_signature=receipt.tx_signature,
            amount=receipt.amount,
            token=receipt.token,
            status=receipt.status,
            created_at=receipt.timestamp.isoformat()
        )

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Failed to submit payment: {error_msg}", exc_info=True)

        # Check if error is blockhash expiration - return 409 (recoverable)
        if "BLOCKHASH_EXPIRED" in error_msg or "block height exceeded" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "BLOCKHASH_EXPIRED",
                    "message": "Blockhash expired. Please re-prepare and re-sign.",
                    "details": error_msg
                }
            )

        # Other errors return 500
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit payment: {error_msg}"
        )


@router.get("/payment-status/{payment_id}", response_model=PaymentStatusResponse)
async def get_payment_status(
    payment_id: str,
    user_id: str = Depends(get_current_user)
):
    """
    Get real-time payment status

    Check the current status of a payment, including whether it's
    waiting for signature, processing, confirmed, or failed
    """
    try:
        client = await db_connection.client
        result = await client.table("x402_payments")\
            .select("*")\
            .eq("payment_id", payment_id)\
            .eq("user_id", user_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found"
            )

        payment = result.data

        return PaymentStatusResponse(
            payment_id=payment['payment_id'],
            status=payment['status'],
            payment_mode=payment.get('payment_mode', 'custodial'),
            amount=Decimal(str(payment['amount'])),
            token=payment['token'],
            tx_signature=payment.get('tx_signature'),
            from_address=payment.get('from_address'),
            to_address=payment.get('to_address'),
            created_at=payment['created_at'],
            expires_at=payment.get('expires_at'),
            error_message=payment.get('error_message')
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get payment status: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get payment status: {str(e)}"
        )


# ============================================================================
# Initialization
# ============================================================================

def initialize(db: DBConnection):
    """ Initialize X402 API Args: db: DataConnect """
    global db_connection, x402_gateway

    db_connection = db
    logger.info("X402 API ")

    # Initialize X402 Gateway
    try:
        # Initialize Solana Bridge
        solana_bridge = SolanaBridge()

        # Create X402 Gateway
        x402_gateway = X402Gateway(
            db_connection=db_connection,
            solana_bridge=solana_bridge,
            max_payment_amount=Decimal("10.0")
        )

        logger.info("X402 Gateway ")
    except Exception as e:
        logger.error(f"X402 Gateway : {str(e)}", exc_info=True)
        # notAbnormal，
        # X402 willnot，not

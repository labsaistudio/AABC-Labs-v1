"""
X402 API Routes
Provides X402 payment-related REST API

Endpoints:
- POST /x402/payments - Create payment
- GET /x402/payments - Get payment history
- GET /x402/payments/{payment_id} - Get single payment details
- POST /x402/verify/{tx_signature} - Verify payment transaction
- POST /x402/services - Register service
- GET /x402/services - List services
- GET /x402/services/{service_id} - Get service details

Author: AABC Labs
Date: 2025-10-29
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from pydantic import BaseModel, Field
from decimal import Decimal
from datetime import datetime
import logging

from services.supabase import DBConnection
from services.x402_gateway import X402Gateway, PaymentRequest as GatewayPaymentRequest
from blockchain.solana_bridge_client import SolanaBridge

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/x402", tags=["X402 Payments"])

# Global variables (will be set during initialization)
db_connection: Optional[DBConnection] = None
x402_gateway: Optional[X402Gateway] = None


# ============================================================================
# Request/Response Models
# ============================================================================

class CreatePaymentRequest(BaseModel):
    """Create payment request"""
    service_url: str = Field(..., description="Service URL")
    amount: Decimal = Field(..., gt=0, description="Payment amount")
    token: str = Field(default="USDC", description="Token type")
    recipient_address: str = Field(..., description="Recipient address")
    agent_id: Optional[str] = Field(None, description="Agent ID")
    thread_id: Optional[str] = Field(None, description="Thread ID")
    service_name: Optional[str] = Field(None, description="Service name")
    service_description: Optional[str] = Field(None, description="Service description")


class PaymentResponse(BaseModel):
    """Payment response"""
    payment_id: str
    tx_signature: str
    amount: Decimal
    token: str
    status: str
    created_at: str


class ServiceRegistration(BaseModel):
    """Service registration request"""
    service_name: str = Field(..., max_length=100, description="Service name")
    service_description: str = Field(..., description="Service description")
    service_url: str = Field(..., description="Service URL")
    price: Decimal = Field(..., ge=0, description="Price")
    price_token: str = Field(default="USDC", description="Price token")
    payment_address: str = Field(..., description="Wallet address for receiving payments")
    service_category: Optional[str] = Field(None, description="Service category")
    tags: Optional[List[str]] = Field(None, description="Tags")
    agent_id: Optional[str] = Field(None, description="Associated Agent ID")


class ServiceResponse(BaseModel):
    """Service response"""
    service_id: str
    service_name: str
    service_description: str
    service_url: str
    price: Decimal
    price_token: str
    total_calls: int
    is_active: bool


# ============================================================================
# Dependencies
# ============================================================================

async def get_current_user(request):
    """Get current user (from JWT token)"""
    # TODO: Implement full JWT verification
    # Currently simplified implementation, get user ID from header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token"
        )

    # Simplified implementation: extract user ID from supabase JWT
    # Production environment needs full JWT verification
    try:
        client = await db_connection.client
        # Use supabase client to verify token
        user_id = "test-user-id"  # TODO: Actually extract from token
        return {"id": user_id}
    except Exception as e:
        logger.error(f"Token verification failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )


async def get_x402_gateway() -> X402Gateway:
    """Get X402 Gateway instance"""
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
    """
    Create and execute X402 payment

    Args:
        request: Payment request
        gateway: X402 Gateway instance

    Returns:
        PaymentResponse: Payment receipt

    Raises:
        HTTPException: When payment fails
    """
    try:
        logger.info(f"Received payment request: {request.amount} {request.token} → {request.recipient_address[:8]}...")

        # Create payment request
        payment_request = GatewayPaymentRequest(
            service_url=request.service_url,
            service_name=request.service_name,
            service_description=request.service_description,
            amount=request.amount,
            token=request.token,
            recipient_address=request.recipient_address
        )

        # Execute payment (currently using test user ID)
        # TODO: Get real user_id from JWT token
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
        logger.error(f"Payment failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Payment failed: {str(e)}"
        )


@router.get("/payments", response_model=List[PaymentResponse])
async def list_payments(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    """
    Get user's payment history

    Args:
        limit: Return count limit
        offset: Offset

    Returns:
        List[PaymentResponse]: List of payment records
    """
    try:
        # TODO: Get real user_id from JWT token
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
        logger.error(f"Failed to fetch payment history: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch payments: {str(e)}"
        )


@router.get("/payments/{payment_id}", response_model=PaymentResponse)
async def get_payment(payment_id: str):
    """
    Get single payment record details

    Args:
        payment_id: Payment ID

    Returns:
        PaymentResponse: Payment details
    """
    try:
        # TODO: Get real user_id from JWT token
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
        logger.error(f"Failed to fetch payment details: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch payment: {str(e)}"
        )


@router.post("/verify/{tx_signature}")
async def verify_payment(
    tx_signature: str,
    gateway: X402Gateway = Depends(get_x402_gateway)
):
    """
    Verify payment transaction

    Args:
        tx_signature: Transaction signature
        gateway: X402 Gateway instance

    Returns:
        dict: Verification result
    """
    try:
        verified = await gateway.verify_payment(tx_signature)

        return {
            "tx_signature": tx_signature,
            "verified": verified,
            "blockchain": "solana"
        }

    except Exception as e:
        logger.error(f"Payment verification failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to verify payment: {str(e)}"
        )


@router.post("/services", status_code=status.HTTP_201_CREATED)
async def register_service(service: ServiceRegistration):
    """
    Register X402 service

    Args:
        service: Service registration information

    Returns:
        dict: Created service information
    """
    try:
        # TODO: Get real user_id from JWT token
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
        logger.error(f"Service registration failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register service: {str(e)}"
        )


@router.get("/services", response_model=List[ServiceResponse])
async def list_services(
    category: Optional[str] = Query(None, description="Service category"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0)
):
    """
    List available X402 services

    Args:
        category: Service category filter
        limit: Return count limit
        offset: Offset

    Returns:
        List[ServiceResponse]: Service list
    """
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
        logger.error(f"Failed to fetch service list: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch services: {str(e)}"
        )


@router.get("/services/{service_id}")
async def get_service(service_id: str):
    """
    Get service details

    Args:
        service_id: Service ID

    Returns:
        dict: Service details
    """
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
        logger.error(f"Failed to fetch service details: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch service: {str(e)}"
        )


# ============================================================================
# Initialization
# ============================================================================

def initialize(db: DBConnection):
    """
    Initialize X402 API module

    Args:
        db: Database connection instance
    """
    global db_connection, x402_gateway

    db_connection = db
    logger.info("X402 API module initialized")

    # Initialize X402 Gateway
    try:
        # Initialize Solana Bridge
        solana_bridge = SolanaBridge()

        # Create X402 Gateway
        x402_gateway = X402Gateway(
            supabase_client=db_connection.client,
            solana_bridge=solana_bridge,
            max_payment_amount=Decimal("10.0")
        )

        logger.info("X402 Gateway initialized")
    except Exception as e:
        logger.error(f"X402 Gateway initialization failed: {str(e)}", exc_info=True)
        # Don't throw exception, allow application to start
        # X402 functionality will be unavailable, but doesn't affect other features

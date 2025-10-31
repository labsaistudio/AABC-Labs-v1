""" X402 Test Service A simple HTTP 402 test service for testing X402 payment flow. Returns HTTP 402 with payment information, validates payment proof, and returns data. """

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from typing import Optional
import uvicorn
import os
from decimal import Decimal

app = FastAPI(title="X402 Test Service", version="1.0.0")

# Configuration
SERVICE_PRICE = Decimal("0.001")  # 0.001 SOL per request (changed from USDC to SOL for Devnet testing)
PAYMENT_TOKEN = "SOL"  # Using SOL instead of USDC since backend wallet has SOL on Devnet
PAYMENT_ADDRESS = os.getenv("X402_TEST_PAYMENT_ADDRESS", "DemoPaymentAddress11111111111111111111111")
SERVICE_NAME = "X402 Demo API"

# In-memory storage for validated transactions (in production, use database)
validated_transactions = set()


@app.get("/")
async def root():
    """Service information endpoint"""
    return {
        "service": SERVICE_NAME,
        "version": "1.0.0",
        "x402_enabled": True,
        "price": str(SERVICE_PRICE),
        "token": PAYMENT_TOKEN,
        "blockchain": "solana",
        "payment_address": PAYMENT_ADDRESS
    }


@app.get("/premium-data")
async def get_premium_data(
    request: Request,
    x_payment_signature: Optional[str] = Header(None),
    x_payment_amount: Optional[str] = Header(None),
    x_payment_token: Optional[str] = Header(None)
):
    """ Premium data endpoint that requires X402 payment First request: Returns HTTP 402 with payment information Retry with payment proof: Returns premium data """

    # Check if payment proof is provided
    if x_payment_signature and x_payment_amount and x_payment_token:
        # For testing: Accept any valid-looking transaction signature
        # In production: Verify payment on-chain via Solana RPC

        # Validate signature format (Solana transaction signatures are base58, typically 87-88 chars)
        if len(x_payment_signature) >= 80 and len(x_payment_signature) <= 90:
            # Validate amount matches requirement
            try:
                payment_amount = Decimal(x_payment_amount)
                if payment_amount < SERVICE_PRICE:
                    return JSONResponse(
                        status_code=402,
                        headers={
                            "X-Payment-Required": "true",
                            "X-Payment-Amount": str(SERVICE_PRICE),
                            "X-Payment-Recipient": PAYMENT_ADDRESS,
                            "X-Payment-Token": PAYMENT_TOKEN,
                            "X-Payment-Blockchain": "solana",
                            "X-Payment-Error": f"Payment amount {payment_amount} is less than required {SERVICE_PRICE}"
                        },
                        content={
                            "error": "Insufficient payment",
                            "message": f"Payment amount {payment_amount} {PAYMENT_TOKEN} is less than required {SERVICE_PRICE} {PAYMENT_TOKEN}"
                        }
                    )
            except (ValueError, TypeError):
                return JSONResponse(
                    status_code=402,
                    headers={
                        "X-Payment-Required": "true",
                        "X-Payment-Amount": str(SERVICE_PRICE),
                        "X-Payment-Recipient": PAYMENT_ADDRESS,
                        "X-Payment-Token": PAYMENT_TOKEN,
                        "X-Payment-Blockchain": "solana",
                        "X-Payment-Error": "Invalid payment amount format"
                    },
                    content={
                        "error": "Invalid payment amount",
                        "message": "Payment amount must be a valid number"
                    }
                )

            # Auto-add to validated set for subsequent requests
            validated_transactions.add(x_payment_signature)

            # Return premium data
            return JSONResponse(
                status_code=200,
                content={
                    "success": True,
                    "data": {
                        "message": "Premium data accessed successfully",
                        "content": {
                            "analysis": "Detailed market analysis...",
                            "metrics": {
                                "price": 100.50,
                                "volume": "1000000",
                                "market_cap": "5000000000"
                            },
                            "predictions": "Bullish trend expected..."
                        },
                        "payment_verified": True,
                        "tx_signature": x_payment_signature,
                        "payment_amount": str(payment_amount),
                        "payment_token": x_payment_token,
                        "note": "Test mode: Payment signature auto-accepted for valid format"
                    }
                }
            )
        else:
            # Invalid signature format
            return JSONResponse(
                status_code=402,
                headers={
                    "X-Payment-Required": "true",
                    "X-Payment-Amount": str(SERVICE_PRICE),
                    "X-Payment-Recipient": PAYMENT_ADDRESS,
                    "X-Payment-Token": PAYMENT_TOKEN,
                    "X-Payment-Blockchain": "solana",
                    "X-Payment-Error": "Invalid payment signature format"
                },
                content={
                    "error": "Invalid payment signature format",
                    "message": f"Payment signature must be a valid Solana transaction signature (received length: {len(x_payment_signature)})"
                }
            )

    # No payment proof provided - return HTTP 402
    return JSONResponse(
        status_code=402,
        headers={
            "X-Payment-Required": "true",
            "X-Payment-Amount": str(SERVICE_PRICE),
            "X-Payment-Recipient": PAYMENT_ADDRESS,
            "X-Payment-Token": PAYMENT_TOKEN,
            "X-Payment-Blockchain": "solana",
            "X-Service-Name": SERVICE_NAME,
            "X-Service-Description": "Premium market data and analysis API"
        },
        content={
            "error": "Payment Required",
            "message": f"This endpoint requires payment of {SERVICE_PRICE} {PAYMENT_TOKEN}",
            "payment_info": {
                "amount": str(SERVICE_PRICE),
                "token": PAYMENT_TOKEN,
                "recipient": PAYMENT_ADDRESS,
                "blockchain": "solana"
            },
            "instructions": "Please make payment and retry with X-Payment-Signature header"
        }
    )


@app.post("/validate-payment")
async def validate_payment(
    tx_signature: str,
    amount: float,
    recipient: str
):
    """ Validate a payment transaction In production, this would verify the transaction on Solana blockchain. For testing, we simply add the signature to validated set. """

    # Verify basic parameters
    if Decimal(str(amount)) < SERVICE_PRICE:
        raise HTTPException(
            status_code=400,
            detail=f"Payment amount {amount} is less than required {SERVICE_PRICE}"
        )

    if recipient != PAYMENT_ADDRESS:
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect recipient address"
        )

    # Add to validated transactions (simulating on-chain verification)
    validated_transactions.add(tx_signature)

    return {
        "success": True,
        "message": "Payment validated successfully",
        "tx_signature": tx_signature,
        "amount": amount,
        "token": PAYMENT_TOKEN
    }


@app.get("/test-free")
async def test_free():
    """Free test endpoint that doesn't require payment"""
    return {
        "success": True,
        "message": "This is a free endpoint",
        "data": "Public data accessible without payment"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": SERVICE_NAME,
        "x402_enabled": True
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", os.getenv("X402_TEST_PORT", "8001")))
    print(f""" ╔══════════════════════════════════════════════════════════╗ ║ X402 Test Service Starting ║ ╠══════════════════════════════════════════════════════════╣ ║ Service: {SERVICE_NAME} ║ ║ Port: {port} ║ ║ Price: {SERVICE_PRICE} {PAYMENT_TOKEN} ║ ║ Payment Address: {PAYMENT_ADDRESS[:20]}...║ ╠══════════════════════════════════════════════════════════╣ ║ Endpoints: ║ ║ GET / - Service info ║ ║ GET /premium-data - Requires X402 payment ║ ║ POST /validate-payment - Validate transaction ║ ║ GET /test-free - Free test endpoint ║ ║ GET /health - Health check ║ ╚══════════════════════════════════════════════════════════╝ """)

    uvicorn.run(app, host="0.0.0.0", port=port)

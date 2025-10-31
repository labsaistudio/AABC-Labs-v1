""" X402 Gateway Unit Tests Test suite for X402Gateway payment processing functionality """

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from services.x402_gateway import X402Gateway, PaymentRequest, PaymentReceipt
from blockchain.solana_bridge_client import SolanaBridge


@pytest.fixture
def mock_db_connection():
    """Mock DBConnection"""
    mock_db = AsyncMock()

    # Mock Supabase client
    mock_supabase = AsyncMock()

    # Mock table operations
    mock_table = AsyncMock()
    mock_table.insert = AsyncMock()
    mock_table.insert.return_value.execute = AsyncMock()
    mock_table.insert.return_value.execute.return_value.data = [
        {"payment_id": "test-payment-id-123"}
    ]

    mock_table.update = AsyncMock()
    mock_table.update.return_value.eq = AsyncMock()
    mock_table.update.return_value.eq.return_value.execute = AsyncMock()
    mock_table.update.return_value.eq.return_value.execute.return_value.data = [
        {"payment_id": "test-payment-id-123", "status": "completed"}
    ]

    mock_supabase.table = MagicMock(return_value=mock_table)

    # Mock the async client property
    mock_db.client = AsyncMock(return_value=mock_supabase)

    return mock_db


@pytest.fixture
def mock_solana():
    """Mock Solana Bridge"""
    mock = AsyncMock(spec=SolanaBridge)
    mock.transfer_token = AsyncMock(return_value="test-tx-signature-abc123")
    mock.get_transaction_info = AsyncMock(return_value={
        "status": "confirmed",
        "amount": 0.5,
        "recipient": "TestRecipient11111111111111111111111111",
        "timestamp": 1234567890
    })
    return mock


@pytest.fixture
def x402_gateway(mock_db_connection, mock_solana):
    """X402 Gateway instance with mocked dependencies"""
    gateway = X402Gateway(
        db_connection=mock_db_connection,
        solana_bridge=mock_solana,
        max_payment_amount=Decimal("10.0")
    )
    return gateway


class TestX402Gateway:
    """X402 Gateway test suite"""

    @pytest.mark.asyncio
    async def test_detect_402_response_from_headers(self, x402_gateway):
        """Test detecting HTTP 402 response from headers"""
        # Create mock HTTP 402 response
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.url = "https://api.example.com/service"
        mock_response.headers = {
            "X-Payment-Amount": "0.5",
            "X-Payment-Recipient": "TestRecipient11111111111111111111111111",
            "X-Payment-Token": "USDC",
            "X-Payment-Blockchain": "solana"
        }

        # Test 402 detection
        payment_request = await x402_gateway.detect_402_response(mock_response)

        # Assertions
        assert payment_request is not None
        assert payment_request.amount == Decimal("0.5")
        assert payment_request.token == "USDC"
        assert payment_request.recipient_address == "TestRecipient11111111111111111111111111"
        assert payment_request.blockchain == "solana"

    @pytest.mark.asyncio
    async def test_detect_non_402_response(self, x402_gateway):
        """Test that non-402 responses return None"""
        mock_response = MagicMock()
        mock_response.status_code = 200

        payment_request = await x402_gateway.detect_402_response(mock_response)

        assert payment_request is None

    @pytest.mark.asyncio
    async def test_execute_payment_success(self, x402_gateway, mock_solana):
        """Test successful payment execution"""
        payment_request = PaymentRequest(
            service_url="https://api.example.com/service",
            service_name="Test Service",
            amount=Decimal("0.1"),
            token="USDC",
            recipient_address="TestRecipient11111111111111111111111111",
            blockchain="solana"
        )

        receipt = await x402_gateway.execute_payment(
            payment_request=payment_request,
            user_id="test-user-id",
            agent_id="test-agent-id",
            thread_id="test-thread-id"
        )

        # Assertions
        assert receipt is not None
        assert receipt.payment_id == "test-payment-id-123"
        assert receipt.tx_signature == "test-tx-signature-abc123"
        assert receipt.amount == Decimal("0.1")
        assert receipt.token == "USDC"
        assert receipt.status == "completed"

        # Verify Solana transfer was called
        mock_solana.transfer_token.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_payment_exceeds_max_amount(self, x402_gateway):
        """Test payment rejection when amount exceeds maximum"""
        payment_request = PaymentRequest(
            service_url="https://api.example.com/service",
            service_name="Expensive Service",
            amount=Decimal("15.0"),  # Exceeds max of 10.0
            token="USDC",
            recipient_address="TestRecipient11111111111111111111111111",
            blockchain="solana"
        )

        with pytest.raises(ValueError, match="exceeds maximum"):
            await x402_gateway.execute_payment(
                payment_request=payment_request,
                user_id="test-user-id"
            )

    @pytest.mark.asyncio
    async def test_verify_payment_success(self, x402_gateway, mock_solana):
        """Test payment verification"""
        tx_signature = "test-tx-signature-abc123"

        is_verified = await x402_gateway.verify_payment(tx_signature)

        assert is_verified is True
        mock_solana.get_transaction_info.assert_called_once_with(tx_signature)

    @pytest.mark.asyncio
    async def test_retry_request_with_payment(self, x402_gateway):
        """Test retrying HTTP request with payment proof"""
        payment_request = PaymentRequest(
            service_url="https://api.example.com/service",
            service_name="Test Service",
            amount=Decimal("0.1"),
            token="USDC",
            recipient_address="TestRecipient11111111111111111111111111",
            blockchain="solana"
        )

        receipt = PaymentReceipt(
            payment_id="test-payment-123",
            tx_signature="test-tx-abc",
            amount=Decimal("0.1"),
            token="USDC",
            status="completed",
            recipient_address="TestRecipient11111111111111111111111111"
        )

        # Mock successful HTTP response
        mock_http_response = MagicMock()
        mock_http_response.status_code = 200
        mock_http_response.text = '{"success": true, "data": "premium content"}'

        with patch.object(x402_gateway.client, 'get', new=AsyncMock(return_value=mock_http_response)):
            response = await x402_gateway.retry_request_with_payment(
                payment_request=payment_request,
                receipt=receipt
            )

        assert response.status_code == 200
        assert "premium content" in response.text

    @pytest.mark.asyncio
    async def test_parse_payment_from_body(self, x402_gateway):
        """Test parsing payment info from response body"""
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.url = "https://api.example.com/service"
        mock_response.headers = {}
        mock_response.text = '''
        {
            "error": "Payment Required",
            "payment_info": {
                "amount": "1.5",
                "token": "USDC",
                "recipient": "BodyRecipient1111111111111111111111111",
                "blockchain": "solana"
            }
        }
        '''
        mock_response.json = MagicMock(return_value={
            "error": "Payment Required",
            "payment_info": {
                "amount": "1.5",
                "token": "USDC",
                "recipient": "BodyRecipient1111111111111111111111111",
                "blockchain": "solana"
            }
        })

        payment_request = await x402_gateway.detect_402_response(mock_response)

        assert payment_request is not None
        assert payment_request.amount == Decimal("1.5")
        assert payment_request.recipient_address == "BodyRecipient1111111111111111111111111"


class TestPaymentRequest:
    """Test PaymentRequest model"""

    def test_payment_request_creation(self):
        """Test creating PaymentRequest"""
        pr = PaymentRequest(
            service_url="https://api.test.com",
            service_name="Test API",
            amount=Decimal("0.5"),
            token="USDC",
            recipient_address="TestAddress111111111111111111111111111",
            blockchain="solana"
        )

        assert pr.amount == Decimal("0.5")
        assert pr.token == "USDC"
        assert pr.blockchain == "solana"

    def test_payment_request_amount_validation(self):
        """Test that negative amounts are rejected"""
        with pytest.raises(ValueError):
            PaymentRequest(
                service_url="https://api.test.com",
                amount=Decimal("-0.5"),  # Negative amount
                token="USDC",
                recipient_address="TestAddress111111111111111111111111111",
                blockchain="solana"
            )


class TestPaymentReceipt:
    """Test PaymentReceipt model"""

    def test_payment_receipt_creation(self):
        """Test creating PaymentReceipt"""
        receipt = PaymentReceipt(
            payment_id="test-123",
            tx_signature="tx-abc",
            amount=Decimal("0.5"),
            token="USDC",
            status="completed",
            recipient_address="TestAddress111111111111111111111111111"
        )

        assert receipt.payment_id == "test-123"
        assert receipt.tx_signature == "tx-abc"
        assert receipt.status == "completed"


# Run tests with: pytest backend/tests/test_x402_gateway.py -v

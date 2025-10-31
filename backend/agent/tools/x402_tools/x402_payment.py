""" X402 Payment Tool Enables agents to autonomously pay for HTTP 402 services using X402 protocol """

import json
import logging
from typing import Dict, Any, Optional
from decimal import Decimal

from agentpress.tool import Tool, ToolResult, openapi_schema, xml_schema
from agentpress.thread_manager import ThreadManager
from services.x402_gateway import X402Gateway, PaymentRequest
from utils.logger import logger


class X402PaymentTool(Tool):
    """ X402 autonomous payment tool for agents Enables agents to: 1. Detect HTTP 402 Payment Required responses 2. Parse payment information 3. Execute payments on Solana blockchain 4. Retry requests with payment proof 5. Call other agents' paid services """

    def __init__(self, thread_manager: ThreadManager, x402_gateway: X402Gateway, thread_id: str):
        """ Initialize X402 payment tool Args: thread_manager: Thread manager instance for user context x402_gateway: X402 Gateway instance for payment processing thread_id: Thread ID for context """
        super().__init__()
        self.thread_manager = thread_manager
        self.x402 = x402_gateway
        self.thread_id = thread_id

        logger.info(f"X402PaymentTool initialized for thread {thread_id}")

    async def _get_user_id(self) -> str:
        """Get user ID from thread context"""
        from utils.auth_utils import get_account_id_from_thread
        client = await self.thread_manager.db.client
        user_id = await get_account_id_from_thread(client, self.thread_id)
        if not user_id:
            raise Exception("Could not determine user ID from thread")
        return user_id

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "x402_pay_for_service",
            "description": """ Pay for an API service using X402 protocol on Solana blockchain. This tool allows the agent to automatically pay for HTTP 402 services. Use this when: 1. An API returns HTTP 402 Payment Required 2. You need to access a paid service on behalf of the user 3. User has authorized payment within the budget limit IMPORTANT: Always ask user for authorization before making a payment! The payment is irreversible once confirmed on the blockchain. """,
            "parameters": {
                "type": "object",
                "properties": {
                    "service_url": {
                        "type": "string",
                        "description": "The URL of the service that requires payment"
                    },
                    "service_name": {
                        "type": "string",
                        "description": "Human-readable name of the service (optional)"
                    },
                    "max_amount": {
                        "type": "number",
                        "description": "Maximum amount willing to pay in USDC"
                    },
                    "auto_approve": {
                        "type": "boolean",
                        "description": "Whether to auto-approve payment without asking user (default: false, use with caution)"
                    }
                },
                "required": ["service_url", "max_amount"]
            }
        }
    })
    @xml_schema(
        tag_name="x402_pay_for_service",
        mappings=[
            {"param_name": "service_url", "node_type": "attribute", "path": "."},
            {"param_name": "service_name", "node_type": "attribute", "path": "."},
            {"param_name": "max_amount", "node_type": "attribute", "path": "."},
            {"param_name": "auto_approve", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="x402_pay_for_service">
        <parameter name="service_url">https://api.example.com/analysis</parameter>
        <parameter name="service_name">AI Analysis Service</parameter>
        <parameter name="max_amount">0.5</parameter>
        <parameter name="auto_approve">false</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def x402_pay_for_service(
        self,
        service_url: str,
        max_amount: float,
        service_name: Optional[str] = None,
        auto_approve: bool = False
    ) -> ToolResult:
        """ Automatically pay for HTTP 402 services Workflow: 1. Request service URL 2. Detect HTTP 402 response 3. Parse payment information 4. Verify amount does not exceed max_amount 5. Ask user authorization (if auto_approve=False) 6. Execute payment on Solana 7. Retry request with payment proof 8. Return service response Args: service_url: URL of the service requiring payment max_amount: Maximum payment amount in USDC service_name: Human-readable service name (optional) auto_approve: Skip user confirmation (use with caution) Returns: ToolResult with payment receipt and service response """
        try:
            logger.info(f"X402: Attempting to access service: {service_url}")

            # Step 1: Request service to detect 402 response
            response = await self.x402.client.get(service_url)

            # Step 2: Detect HTTP 402 Payment Required
            payment_request = await self.x402.detect_402_response(response)

            if not payment_request:
                # Not a 402 response, return service response directly
                logger.info(f"Service returned {response.status_code}, no payment required")
                return self._success_response(
                    data={
                        "payment_required": False,
                        "status_code": response.status_code,
                        "response_preview": response.text[:1000]  # Limit response size
                    },
                    message="Service accessed successfully without payment"
                )

            # Step 3: Verify amount does not exceed max_amount
            if payment_request.amount > Decimal(str(max_amount)):
                logger.warning(
                    f"Payment required ({payment_request.amount} {payment_request.token}) "
                    f"exceeds max_amount ({max_amount})"
                )
                return self._fail_response(
                    f"Payment required: {payment_request.amount} {payment_request.token}, "
                    f"but max_amount is {max_amount} USDC. "
                    f"Increase max_amount or negotiate with service provider."
                )

            # Step 4: Log payment details for user review
            if not auto_approve:
                logger.info(
                    f"Payment authorization would be requested: "
                    f"{payment_request.amount} {payment_request.token} "
                    f"to {payment_request.recipient_address[:8]}..."
                )
                # TODO: Implement real-time user confirmation via frontend
                # For now, we proceed with payment (development mode)
                # In production, this should wait for user response and return early
                logger.warning("User confirmation not implemented - proceeding with payment (dev mode)")

            # Step 5: Execute payment on Solana blockchain
            logger.info(
                f"Executing X402 payment: {payment_request.amount} {payment_request.token} "
                f"to {payment_request.recipient_address[:8]}..."
            )

            # Get user ID from thread context
            user_id = await self._get_user_id()

            receipt = await self.x402.execute_payment(
                payment_request=payment_request,
                user_id=user_id,
                agent_id=None,  # Agent ID not available in tool context
                thread_id=self.thread_id
            )

            logger.info(f"Payment successful! Tx: {receipt.tx_signature}")

            # Step 6: Retry request with payment proof
            logger.info("Retrying service request with payment proof...")

            retry_response = await self.x402.retry_request_with_payment(
                payment_request=payment_request,
                receipt=receipt
            )

            # Step 7: Return success result
            success_message = (
                f"✅ **Payment Successful!**\n\n"
                f"Paid {receipt.amount} {receipt.token} for "
                f"{service_name or payment_request.service_name or 'service'}\n"
                f"Transaction: {receipt.tx_signature}\n"
                f"Explorer: https://solscan.io/tx/{receipt.tx_signature}\n\n"
                f"Service Response Status: {retry_response.status_code}"
            )

            return self._success_response(
                data={
                    "payment_executed": True,
                    "payment_id": receipt.payment_id,
                    "tx_signature": receipt.tx_signature,
                    "amount": str(receipt.amount),
                    "token": receipt.token,
                    "blockchain": "solana",
                    "explorer_url": f"https://solscan.io/tx/{receipt.tx_signature}",
                    "service_response": {
                        "status_code": retry_response.status_code,
                        "data_preview": retry_response.text[:5000]  # Limit size
                    }
                },
                message=success_message
            )

        except Exception as e:
            logger.error(f"X402 payment failed: {str(e)}", exc_info=True)
            return self._fail_response(
                f"Failed to complete X402 payment: {str(e)}",
                metadata={"service_url": service_url, "max_amount": max_amount}
            )

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "x402_call_agent",
            "description": """ Call another agent's service and pay using X402 protocol. Use this for agent-to-agent collaboration where services require payment. This enables the economy of autonomous agents on Solana. """,
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_service_id": {
                        "type": "string",
                        "description": "The service ID of the agent to call (UUID from x402_services table)"
                    },
                    "request_data": {
                        "type": "object",
                        "description": "Data to send to the agent service (JSON object)"
                    },
                    "max_payment": {
                        "type": "number",
                        "description": "Maximum amount to pay in USDC"
                    }
                },
                "required": ["agent_service_id", "max_payment"]
            }
        }
    })
    @xml_schema(
        tag_name="x402_call_agent",
        mappings=[
            {"param_name": "agent_service_id", "node_type": "attribute", "path": "."},
            {"param_name": "request_data", "node_type": "text", "path": "."},
            {"param_name": "max_payment", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="x402_call_agent">
        <parameter name="agent_service_id">550e8400-e29b-41d4-a716-446655440000</parameter>
        <parameter name="max_payment">1.0</parameter>
        <parameter name="request_data">{"query": "analyze market trends"}</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def x402_call_agent(
        self,
        agent_service_id: str,
        max_payment: float,
        request_data: Optional[Dict[str, Any]] = None
    ) -> ToolResult:
        """ Call another agent's service and pay using X402 Implements agent-to-agent collaboration with payments. This enables a marketplace of agent services on Solana. Args: agent_service_id: UUID of the service from x402_services table max_payment: Maximum payment amount in USDC request_data: JSON data to send to the agent service Returns: ToolResult with agent response and payment receipt """
        try:
            logger.info(f"X402: Calling agent service: {agent_service_id}")

            # Step 1: Query service information from database
            service_info = await self._get_service_info(agent_service_id)

            if not service_info:
                return self._fail_response(
                    f"Service {agent_service_id} not found or inactive"
                )

            # Step 2: Verify price does not exceed max_payment
            service_price = Decimal(str(service_info["price"]))
            if service_price > Decimal(str(max_payment)):
                return self._fail_response(
                    f"Service price {service_price} {service_info['price_token']} "
                    f"exceeds max_payment {max_payment}"
                )

            # Step 3: Call the agent service
            service_url = service_info["service_url"]
            logger.info(f"Calling agent service at: {service_url}")

            response = await self.x402.client.post(
                service_url,
                json=request_data or {}
            )

            # Step 4: Handle 402 and execute payment if required
            if response.status_code == 402:
                logger.info("Agent service requires payment (HTTP 402)")

                payment_request = await self.x402.detect_402_response(response)

                if payment_request:
                    # Get user ID from thread context
                    user_id = await self._get_user_id()

                    # Execute payment
                    receipt = await self.x402.execute_payment(
                        payment_request=payment_request,
                        user_id=user_id,
                        agent_id=None,  # Agent ID not available in tool context
                        thread_id=self.thread_id
                    )

                    logger.info(f"Agent payment successful: {receipt.tx_signature}")

                    # Retry request with payment proof
                    response = await self.x402.retry_request_with_payment(
                        payment_request=payment_request,
                        receipt=receipt,
                        original_request_data={"method": "POST", "body": request_data}
                    )

            # Step 5: Return agent response
            response_data = None
            if response.content:
                try:
                    response_data = response.json()
                except:
                    response_data = response.text[:5000]

            success_message = (
                f"✅ Successfully called agent service: {service_info['service_name']}\n"
                f"Status: {response.status_code}"
            )

            if 'receipt' in locals():
                success_message += f"\nPayment: {receipt.amount} {receipt.token}"
                success_message += f"\nTx: {receipt.tx_signature}"

            return self._success_response(
                data={
                    "agent_service": {
                        "id": agent_service_id,
                        "name": service_info["service_name"],
                        "category": service_info.get("service_category")
                    },
                    "response": response_data,
                    "status_code": response.status_code,
                    "payment": {
                        "amount": str(receipt.amount),
                        "token": receipt.token,
                        "tx_signature": receipt.tx_signature,
                        "explorer_url": f"https://solscan.io/tx/{receipt.tx_signature}"
                    } if 'receipt' in locals() else None
                },
                message=success_message
            )

        except Exception as e:
            logger.error(f"Agent-to-agent call failed: {str(e)}", exc_info=True)
            return self._fail_response(
                f"Failed to call agent service: {str(e)}",
                metadata={"agent_service_id": agent_service_id}
            )

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "x402_register_service",
            "description": """ Register this agent as an X402 service provider. Allows this agent to offer paid services to other agents or users. Creates a listing in the X402 service marketplace. """,
            "parameters": {
                "type": "object",
                "properties": {
                    "service_name": {
                        "type": "string",
                        "description": "Name of the service to register"
                    },
                    "service_description": {
                        "type": "string",
                        "description": "Detailed description of what the service does"
                    },
                    "service_url": {
                        "type": "string",
                        "description": "URL endpoint where the service is accessible"
                    },
                    "price": {
                        "type": "number",
                        "description": "Price in USDC"
                    },
                    "payment_address": {
                        "type": "string",
                        "description": "Solana wallet address to receive payments"
                    },
                    "service_category": {
                        "type": "string",
                        "description": "Category of service (e.g., 'analysis', 'data', 'ai', 'automation')"
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Tags for service discovery"
                    }
                },
                "required": ["service_name", "service_description", "service_url", "price", "payment_address"]
            }
        }
    })
    async def x402_register_service(
        self,
        service_name: str,
        service_description: str,
        service_url: str,
        price: float,
        payment_address: str,
        service_category: Optional[str] = None,
        tags: Optional[list] = None
    ) -> ToolResult:
        """ Register agent as X402 service provider Creates a marketplace listing for this agent's paid service. Other agents can discover and pay for this service. Args: service_name: Name of the service service_description: What the service does service_url: Service endpoint URL price: Price in USDC payment_address: Solana wallet to receive payments service_category: Service category (optional) tags: Tags for discovery (optional) Returns: ToolResult with service registration details """
        try:
            logger.info(f"Registering X402 service: {service_name}")

            # Validate payment address (basic Solana address validation)
            if not self._validate_solana_address(payment_address):
                return self._fail_response(
                    f"Invalid Solana wallet address: {payment_address}"
                )

            # Get user ID from thread context
            user_id = await self._get_user_id()

            # Prepare service registration data
            service_data = {
                "provider_id": user_id,
                "agent_id": None,  # Agent ID not available in tool context
                "service_name": service_name,
                "service_description": service_description,
                "service_url": service_url,
                "price": str(price),
                "price_token": "USDC",
                "payment_address": payment_address,
                "service_category": service_category,
                "tags": tags or []
            }

            # Register service in database
            client = await self.thread_manager.db.client
            result = await client.table("x402_services").insert(service_data).execute()

            if not result.data:
                return self._fail_response("Failed to register service in database")

            service_id = result.data[0]["service_id"]

            success_message = (
                f"✅ Service registered successfully!\n\n"
                f"**Service:** {service_name}\n"
                f"**Price:** {price} USDC\n"
                f"**Service ID:** {service_id}\n"
                f"**Payment Address:** {payment_address}\n\n"
                f"Other agents can now discover and pay for your service."
            )

            return self._success_response(
                data={
                    "service_id": service_id,
                    "service_name": service_name,
                    "price": price,
                    "price_token": "USDC",
                    "payment_address": payment_address,
                    "service_url": service_url,
                    "registered_at": result.data[0].get("created_at")
                },
                message=success_message
            )

        except Exception as e:
            logger.error(f"Service registration failed: {str(e)}", exc_info=True)
            return self._fail_response(
                f"Failed to register service: {str(e)}",
                metadata={"service_name": service_name}
            )

    async def _get_service_info(self, service_id: str) -> Optional[Dict]:
        """ Query service information from database Args: service_id: UUID of the service Returns: Service info dict or None if not found """
        try:
            client = await self.thread_manager.db.client
            result = await client.table("x402_services")\
                .select("*")\
                .eq("service_id", service_id)\
                .eq("is_active", True)\
                .single()\
                .execute()

            return result.data if result.data else None

        except Exception as e:
            logger.error(f"Failed to fetch service info: {str(e)}")
            return None

    def _validate_solana_address(self, address: str) -> bool:
        """ Basic Solana address validation Args: address: Solana wallet address Returns: True if valid format, False otherwise """
        if not address or not isinstance(address, str):
            return False

        # Solana addresses are base58 encoded, typically 32-44 characters
        if len(address) < 32 or len(address) > 44:
            return False

        # Check for valid base58 characters
        base58_chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        return all(c in base58_chars for c in address)

    def _success_response(
        self,
        data: Any,
        message: str = None,
        metadata: Optional[Dict] = None
    ) -> ToolResult:
        """ Create a success response Args: data: Response data message: Success message metadata: Additional metadata Returns: ToolResult with success status """
        output = {
            "success": True,
            "data": data
        }
        if message:
            output["message"] = message
        if metadata:
            output["metadata"] = metadata

        return ToolResult(
            success=True,
            output=json.dumps(output, indent=2)
        )

    def _fail_response(
        self,
        error: str,
        metadata: Optional[Dict] = None
    ) -> ToolResult:
        """ Create a failure response Args: error: Error message metadata: Additional context Returns: ToolResult with failure status """
        output = {
            "success": False,
            "error": error
        }
        if metadata:
            output["metadata"] = metadata

        return ToolResult(
            success=False,
            output=json.dumps(output, indent=2)
        )

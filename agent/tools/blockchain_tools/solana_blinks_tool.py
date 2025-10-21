from typing import Optional, Dict, Any
from .base_blockchain_tool import BaseBlockchainTool
from agentpress.tool import ToolResult, openapi_schema, xml_schema

class SolanaBinksTool(BaseBlockchainTool):
    """Tool for creating and executing Solana Blinks (Blockchain Links)"""

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "create_transfer_blink",
            "description": "Create a shareable Blink URL for transferring SOL or tokens. Recipients can execute the transfer with one click.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to_address": {
                        "type": "string",
                        "description": "The recipient's Solana wallet address"
                    },
                    "amount": {
                        "type": "number",
                        "description": "Amount to transfer"
                    },
                    "token": {
                        "type": "string",
                        "description": "Token mint address or 'SOL' for native SOL (default: SOL)"
                    },
                    "memo": {
                        "type": "string",
                        "description": "Optional memo for the transfer"
                    }
                },
                "required": ["to_address", "amount"]
            }
        }
    })
    @xml_schema(
        tag_name="create-transfer-blink",
        mappings=[
            {"param_name": "to_address", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."},
            {"param_name": "token", "node_type": "attribute", "path": "."},
            {"param_name": "memo", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="create_transfer_blink">
        <parameter name="to_address">7xKXtg2CW87d7TXQ3xgB6jWvGpUZAhrvKoNWvRmfnsMh</parameter>
        <parameter name="amount">1.5</parameter>
        <parameter name="token">SOL</parameter>
        <parameter name="memo">Payment for services</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def create_transfer_blink(
        self,
        to_address: str,
        amount: float,
        token: Optional[str] = "SOL",
        memo: Optional[str] = None
    ) -> ToolResult:
        """Create a transfer Blink"""
        try:
            # Validate inputs
            if not self.validate_address(to_address):
                return self.fail_response(f"Invalid recipient address: {to_address}")

            if amount <= 0:
                return self.fail_response("Transfer amount must be greater than 0")

            if token != "SOL" and not self.validate_address(token):
                return self.fail_response(f"Invalid token address: {token}")

            # Prepare Blink data
            data = {
                "to": to_address,
                "amount": amount,
                "token": token
            }
            if memo:
                data["memo"] = memo

            # Call the bridge API
            result = await self.call_bridge('POST', '/blinks/create/transfer', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Failed to create Blink'))

            # Format success response
            blink = result.get('blink', {})
            blink_url = blink.get('url', '')
            blink_id = blink.get('id', '')
            expires_at = blink.get('expiresAt', 'never')

            message = f"🔗 Transfer Blink Created!\n"
            message += f"URL: {blink_url}\n"
            message += f"Recipient: {to_address}\n"
            message += f"Amount: {self.format_amount(amount)} {token}\n"
            if memo:
                message += f"Memo: {memo}\n"
            message += f"Expires: {expires_at}\n"
            message += f"\nShare this link for one-click transfer execution!"

            return self.success_response(
                data={
                    "blink_url": blink_url,
                    "blink_id": blink_id,
                    "to": to_address,
                    "amount": amount,
                    "token": token,
                    "memo": memo,
                    "expires_at": expires_at
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Blink creation error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "create_swap_blink",
            "description": "Create a shareable Blink URL for token swaps. Recipients can execute the swap with one click.",
            "parameters": {
                "type": "object",
                "properties": {
                    "input_token": {
                        "type": "string",
                        "description": "Input token mint address or 'SOL'"
                    },
                    "output_token": {
                        "type": "string",
                        "description": "Output token mint address or 'SOL'"
                    },
                    "amount": {
                        "type": "number",
                        "description": "Amount of input token to swap"
                    },
                    "slippage": {
                        "type": "number",
                        "description": "Maximum slippage tolerance in percentage (default: 0.5%)"
                    }
                },
                "required": ["input_token", "output_token", "amount"]
            }
        }
    })
    @xml_schema(
        tag_name="create-swap-blink",
        mappings=[
            {"param_name": "input_token", "node_type": "attribute", "path": "."},
            {"param_name": "output_token", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."},
            {"param_name": "slippage", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="create_swap_blink">
        <parameter name="input_token">SOL</parameter>
        <parameter name="output_token">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        <parameter name="amount">2</parameter>
        <parameter name="slippage">0.5</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def create_swap_blink(
        self,
        input_token: str,
        output_token: str,
        amount: float,
        slippage: Optional[float] = 0.5
    ) -> ToolResult:
        """Create a swap Blink"""
        try:
            # Validate inputs
            if input_token != 'SOL' and not self.validate_address(input_token):
                return self.fail_response(f"Invalid input token address: {input_token}")

            if output_token != 'SOL' and not self.validate_address(output_token):
                return self.fail_response(f"Invalid output token address: {output_token}")

            if amount <= 0:
                return self.fail_response("Swap amount must be greater than 0")

            # Prepare Blink data
            data = {
                "inputMint": input_token,
                "outputMint": output_token,
                "amount": amount,
                "slippage": slippage
            }

            # Call the bridge API
            result = await self.call_bridge('POST', '/blinks/create/swap', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Failed to create swap Blink'))

            # Format success response
            blink = result.get('blink', {})
            blink_url = blink.get('url', '')
            blink_id = blink.get('id', '')

            message = f"🔗 Swap Blink Created!\n"
            message += f"URL: {blink_url}\n"
            message += f"Swap: {self.format_amount(amount)} {input_token} → {output_token}\n"
            message += f"Slippage: {slippage}%\n"
            message += f"\nShare this link for one-click swap execution!"

            return self.success_response(
                data={
                    "blink_url": blink_url,
                    "blink_id": blink_id,
                    "input_token": input_token,
                    "output_token": output_token,
                    "amount": amount,
                    "slippage": slippage
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Swap Blink creation error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "execute_blink",
            "description": "Execute a Blink from its URL. This will perform the blockchain action encoded in the Blink.",
            "parameters": {
                "type": "object",
                "properties": {
                    "blink_url": {
                        "type": "string",
                        "description": "The Blink URL to execute"
                    }
                },
                "required": ["blink_url"]
            }
        }
    })
    @xml_schema(
        tag_name="execute-blink",
        mappings=[
            {"param_name": "blink_url", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="execute_blink">
        <parameter name="blink_url">https://blinks.aabc.labs/transfer/abc123xyz</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def execute_blink(self, blink_url: str) -> ToolResult:
        """Execute a Blink from URL"""
        try:
            if not blink_url:
                return self.fail_response("Blink URL is required")

            # Call the bridge API
            result = await self.call_bridge('POST', '/blinks/execute', {"blinkUrl": blink_url})

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Failed to execute Blink'))

            # Format success response
            signature = result.get('signature', '')
            action = result.get('action', 'unknown')
            details = result.get('details', {})

            message = f"✅ Blink Executed Successfully!\n"
            message += f"Action: {action}\n"
            message += f"Signature: {signature}\n"

            # Add action-specific details
            if action == 'transfer':
                message += f"Amount: {details.get('amount', 'N/A')} {details.get('token', 'N/A')}\n"
                message += f"To: {details.get('to', 'N/A')}\n"
            elif action == 'swap':
                message += f"Swap: {details.get('inputAmount', 'N/A')} {details.get('inputToken', 'N/A')} → "
                message += f"{details.get('outputAmount', 'N/A')} {details.get('outputToken', 'N/A')}\n"

            message += f"Explorer: https://solscan.io/tx/{signature}"

            return self.success_response(
                data={
                    "signature": signature,
                    "action": action,
                    "details": details,
                    "explorer_url": f"https://solscan.io/tx/{signature}"
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Blink execution error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "validate_blink",
            "description": "Validate and parse a Blink URL to see what action it will perform without executing it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "blink_url": {
                        "type": "string",
                        "description": "The Blink URL to validate"
                    }
                },
                "required": ["blink_url"]
            }
        }
    })
    @xml_schema(
        tag_name="validate-blink",
        mappings=[
            {"param_name": "blink_url", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="validate_blink">
        <parameter name="blink_url">https://blinks.aabc.labs/transfer/abc123xyz</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def validate_blink(self, blink_url: str) -> ToolResult:
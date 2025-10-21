from typing import Optional
from .base_blockchain_tool import BaseBlockchainTool
from agentpress.tool import ToolResult, openapi_schema, xml_schema

class SolanaSwapTool(BaseBlockchainTool):
    """Tool for swapping tokens on Solana DEXs"""

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "swap_tokens",
            "description": "Swap one token for another on Solana DEXs (Jupiter, Raydium, Orca). Automatically finds the best route and price. This is a HIGH RISK operation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "input_token": {
                        "type": "string",
                        "description": "Input token mint address or 'SOL' for native SOL"
                    },
                    "output_token": {
                        "type": "string",
                        "description": "Output token mint address or 'SOL' for native SOL"
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
        tag_name="swap-tokens",
        mappings=[
            {"param_name": "input_token", "node_type": "attribute", "path": "."},
            {"param_name": "output_token", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."},
            {"param_name": "slippage", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="swap_tokens">
        <parameter name="input_token">SOL</parameter>
        <parameter name="output_token">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        <parameter name="amount">1.5</parameter>
        <parameter name="slippage">0.5</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def swap_tokens(
        self,
        input_token: str,
        output_token: str,
        amount: float,
        slippage: Optional[float] = 0.5
    ) -> ToolResult:
        """Swap tokens on Solana DEXs"""
        try:
            # Validate inputs
            if input_token != 'SOL' and not self.validate_address(input_token):
                return self.fail_response(f"Invalid input token address: {input_token}")

            if output_token != 'SOL' and not self.validate_address(output_token):
                return self.fail_response(f"Invalid output token address: {output_token}")

            if amount <= 0:
                return self.fail_response("Swap amount must be greater than 0")

            if slippage < 0 or slippage > 50:
                return self.fail_response("Slippage must be between 0 and 50%")

            # Check risk level
            risk_level = await self.check_risk_level('swap', amount)

            # Prepare swap data
            data = {
                "inputMint": input_token,
                "outputMint": output_token,
                "amount": amount,
                "slippage": slippage
            }

            # Log high-risk operations
            if risk_level == 'HIGH':
                # Status notification removed - ThreadManager doesn't have emit_status
                pass

            # Call the bridge API
            result = await self.call_bridge('POST', '/defi/swap', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Swap failed'))

            # Format success response
            signature = result.get('signature', 'unknown')
            input_amount = result.get('inputAmount', amount)
            output_amount = result.get('outputAmount', 0)
            route = result.get('route', 'Unknown')
            price_impact = result.get('priceImpact', 0)

            message = f"✅ Swap Successful!\n"
            message += f"Input: {self.format_amount(input_amount)} {input_token}\n"
            message += f"Output: {self.format_amount(output_amount)} {output_token}\n"
            message += f"Route: {route}\n"
            message += f"Price Impact: {price_impact}%\n"
            message += f"Slippage: {slippage}%\n"
            message += f"Signature: {signature}\n"
            message += f"Explorer: https://solscan.io/tx/{signature}"

            return self.success_response(
                data={
                    "signature": signature,
                    "input_token": input_token,
                    "output_token": output_token,
                    "input_amount": input_amount,
                    "output_amount": output_amount,
                    "route": route,
                    "price_impact": price_impact,
                    "slippage": slippage,
                    "explorer_url": f"https://solscan.io/tx/{signature}"
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Swap error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "get_swap_quote",
            "description": "Get a price quote for swapping tokens without executing the swap. Use this to check prices before swapping.",
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
                        "description": "Amount of input token"
                    }
                },
                "required": ["input_token", "output_token", "amount"]
            }
        }
    })
    @xml_schema(
        tag_name="get-swap-quote",
        mappings=[
            {"param_name": "input_token", "node_type": "attribute", "path": "."},
            {"param_name": "output_token", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="get_swap_quote">
        <parameter name="input_token">SOL</parameter>
        <parameter name="output_token">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        <parameter name="amount">1</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def get_swap_quote(
        self,
        input_token: str,
        output_token: str,
        amount: float
    ) -> ToolResult:
from typing import Optional
from .base_blockchain_tool import BaseBlockchainTool
from agentpress.tool import ToolResult, openapi_schema, xml_schema

class SolanaBalanceTool(BaseBlockchainTool):
    """Tool for checking Solana wallet balances"""

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "check_solana_balance",
            "description": "Check the SOL balance of a Solana wallet address. Returns the balance in SOL and lamports. Use this to verify account balances before transfers or to monitor wallet funds.",
            "parameters": {
                "type": "object",
                "properties": {
                    "address": {
                        "type": "string",
                        "description": "The Solana wallet address to check. If not provided, checks the agent's own wallet."
                    }
                },
                "required": []
            }
        }
    })
    @xml_schema(
        tag_name="check-solana-balance",
        mappings=[
            {"param_name": "address", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="check_solana_balance">
        <parameter name="address">7xKXtg2CW87d7TXQ3xgB6jWvGpUZAhrvKoNWvRmfnsMh</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def check_solana_balance(self, address: Optional[str] = None) -> ToolResult:
        """Check SOL balance of a wallet"""
        try:
            # Validate address if provided
            if address and not self.validate_address(address):
                return self.fail_response(f"Invalid Solana address: {address}")

            # Call the bridge API
            endpoint = f"/solana/balance/{address}" if address else "/solana/balance"
            result = await self.call_bridge('GET', endpoint)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Failed to get balance'))

            # Format the response
            balance_sol = result.get('balance', 0)
            balance_lamports = result.get('lamports', 0)
            wallet_address = result.get('address', address or 'agent wallet')

            message = f"Wallet Balance:\n"
            message += f"Address: {wallet_address}\n"
            message += f"Balance: {self.format_amount(balance_sol)} SOL\n"
            message += f"Lamports: {balance_lamports:,}"

            return self.success_response(
                data={
                    "address": wallet_address,
                    "balance_sol": balance_sol,
                    "balance_lamports": balance_lamports
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Error checking balance: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "check_token_balance",
            "description": "Check the balance of a specific SPL token in a wallet. Returns the token balance with proper decimal formatting.",
            "parameters": {
                "type": "object",
                "properties": {
                    "token_address": {
                        "type": "string",
                        "description": "The SPL token mint address"
                    },
                    "wallet_address": {
                        "type": "string",
                        "description": "The wallet address to check. If not provided, checks the agent's wallet."
                    }
                },
                "required": ["token_address"]
            }
        }
    })
    @xml_schema(
        tag_name="check-token-balance",
        mappings=[
            {"param_name": "token_address", "node_type": "attribute", "path": "."},
            {"param_name": "wallet_address", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="check_token_balance">
        <parameter name="token_address">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        <parameter name="wallet_address">7xKXtg2CW87d7TXQ3xgB6jWvGpUZAhrvKoNWvRmfnsMh</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def check_token_balance(
        self,
        token_address: str,
        wallet_address: Optional[str] = None
    ) -> ToolResult:
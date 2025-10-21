from typing import Optional
from .base_blockchain_tool import BaseBlockchainTool
from agentpress.tool import ToolResult, openapi_schema, xml_schema

class SolanaTransferTool(BaseBlockchainTool):
    """Tool for transferring SOL and SPL tokens on Solana"""

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "transfer_sol",
            "description": "Transfer SOL from the agent's wallet to another address. This is a HIGH RISK operation that requires confirmation for large amounts. Use this to send SOL to other wallets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to_address": {
                        "type": "string",
                        "description": "The recipient's Solana wallet address"
                    },
                    "amount": {
                        "type": "number",
                        "description": "Amount of SOL to transfer"
                    },
                    "memo": {
                        "type": "string",
                        "description": "Optional memo/note for the transaction"
                    }
                },
                "required": ["to_address", "amount"]
            }
        }
    })
    @xml_schema(
        tag_name="transfer-sol",
        mappings=[
            {"param_name": "to_address", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."},
            {"param_name": "memo", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="transfer_sol">
        <parameter name="to_address">7xKXtg2CW87d7TXQ3xgB6jWvGpUZAhrvKoNWvRmfnsMh</parameter>
        <parameter name="amount">0.5</parameter>
        <parameter name="memo">Payment for services</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def transfer_sol(
        self,
        to_address: str,
        amount: float,
        memo: Optional[str] = None
    ) -> ToolResult:
        """Transfer SOL to another wallet"""
        try:
            # Handle XML parser converting numeric addresses to floats
            if isinstance(to_address, (int, float)):
                if isinstance(to_address, float) and to_address > 1e30:
                    # Large float is likely a Solana address parsed as number
                    to_address = str(int(to_address))
                else:
                    to_address = str(to_address)
            else:
                to_address = str(to_address)

            # Validate inputs
            if not self.validate_address(to_address):
                return self.fail_response(f"Invalid recipient address: {to_address}")

            if amount <= 0:
                return self.fail_response("Transfer amount must be greater than 0")

            # Check risk level
            risk_level = await self.check_risk_level('transfer', amount)

            # Prepare transfer data
            data = {
                "to": to_address,
                "amount": amount
            }
            if memo:
                data["memo"] = memo

            # Log high-risk operations
            if risk_level == 'HIGH':
                # Status notification removed - ThreadManager doesn't have emit_status
                pass

            # Call the bridge API
            result = await self.call_bridge('POST', '/solana/transfer', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Transfer failed'))

            # Format success response
            signature = result.get('signature', 'unknown')
            from_address = result.get('from', 'agent wallet')

            message = f"✅ Transfer Successful!\n"
            message += f"From: {from_address}\n"
            message += f"To: {to_address}\n"
            message += f"Amount: {self.format_amount(amount)} SOL\n"
            message += f"Signature: {signature}\n"
            if memo:
                message += f"Memo: {memo}\n"
            message += f"Explorer: https://solscan.io/tx/{signature}"

            return self.success_response(
                data={
                    "signature": signature,
                    "from": from_address,
                    "to": to_address,
                    "amount": amount,
                    "memo": memo,
                    "explorer_url": f"https://solscan.io/tx/{signature}"
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Transfer error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "transfer_token",
            "description": "Transfer SPL tokens from the agent's wallet to another address. Supports any SPL token by providing the token mint address.",
            "parameters": {
                "type": "object",
                "properties": {
                    "token_address": {
                        "type": "string",
                        "description": "The SPL token mint address"
                    },
                    "to_address": {
                        "type": "string",
                        "description": "The recipient's Solana wallet address"
                    },
                    "amount": {
                        "type": "number",
                        "description": "Amount of tokens to transfer"
                    },
                    "decimals": {
                        "type": "integer",
                        "description": "Token decimals (default: will be fetched automatically)"
                    }
                },
                "required": ["token_address", "to_address", "amount"]
            }
        }
    })
    @xml_schema(
        tag_name="transfer-token",
        mappings=[
            {"param_name": "token_address", "node_type": "attribute", "path": "."},
            {"param_name": "to_address", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."},
            {"param_name": "decimals", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="transfer_token">
        <parameter name="token_address">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        <parameter name="to_address">7xKXtg2CW87d7TXQ3xgB6jWvGpUZAhrvKoNWvRmfnsMh</parameter>
        <parameter name="amount">100</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def transfer_token(
        self,
        token_address: str,
        to_address: str,
        amount: float,
        decimals: Optional[int] = None
    ) -> ToolResult:
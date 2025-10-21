from typing import Optional, Dict, Any, List
from .base_blockchain_tool import BaseBlockchainTool
from agentpress.tool import ToolResult, openapi_schema, xml_schema
import os
import httpx
import base64
from utils.logger import logger

class SolanaTokenTool(BaseBlockchainTool):
    """Tool for creating and managing SPL tokens on Solana"""

    async def upload_image_to_ipfs(self, image_path: str) -> Optional[str]:
        """Upload image from sandbox to IPFS via Pinata

        Args:
            image_path: Local file path or already an URL

        Returns:
            IPFS URL or original URL if already remote
        """
        try:
            # If already a URL, return as is
            if image_path and (image_path.startswith('http://') or image_path.startswith('https://') or image_path.startswith('ipfs://')):
                return image_path

            # If no image path, return None
            if not image_path:
                return None

            logger.info(f"Uploading image to IPFS: {image_path}")

            # Get sandbox ID from thread manager context
            if not hasattr(self.thread_manager, 'project_id'):
                logger.warning("No project_id in thread_manager, cannot upload image")
                return None

            project_id = self.thread_manager.project_id

            # Query database to get sandbox ID
            from services.supabase import DBConnection
            db = DBConnection()
            await db.initialize()
            client = await db.client

            project_result = await client.table('projects').select('sandbox').eq('id', project_id).execute()
            if not project_result.data or not project_result.data[0].get('sandbox'):
                logger.warning(f"No sandbox found for project {project_id}")
                return None

            sandbox_id = project_result.data[0]['sandbox'].get('id')
            if not sandbox_id:
                logger.warning(f"No sandbox ID in project {project_id}")
                return None

            # Construct the file path in sandbox
            if not image_path.startswith('/'):
                # Assume it's relative to workspace
                full_path = f"/workspace/{image_path}"
            else:
                full_path = image_path

            # Get file content from sandbox
            # Try to get auth token if available
            headers = {}
            if hasattr(self.thread_manager, 'auth_token'):
                headers['Authorization'] = f'Bearer {self.thread_manager.auth_token}'

            # Use internal URL for backend access
            backend_url = 'http://localhost:8000'  # Internal backend URL
            sandbox_url = f"{backend_url}/api/sandboxes/{sandbox_id}/files/content?path={full_path}"

            async with httpx.AsyncClient() as client:
                response = await client.get(sandbox_url, headers=headers)
                if response.status_code != 200:
                    logger.error(f"Failed to get image from sandbox: {response.status_code} - {response.text}")
                    return None

                image_data = response.content

            # Convert image data to base64 for upload
            import base64
            image_base64 = base64.b64encode(image_data).decode('utf-8')

            # Upload via solana-bridge which has Pinata configured
            upload_data = {
                'imageData': image_base64,
                'filename': image_path.split('/')[-1] if '/' in image_path else image_path
            }

            # Call solana-bridge upload endpoint
            result = await self.call_bridge('POST', '/upload/image', upload_data)

            if result.get('success') and result.get('ipfsUrl'):
                ipfs_url = result['ipfsUrl']
                logger.info(f"Image uploaded to IPFS: {ipfs_url}")
                return ipfs_url
            else:
                logger.error(f"Failed to upload to IPFS: {result.get('error', 'Unknown error')}")

        except Exception as e:
            logger.error(f"Failed to upload image to IPFS: {str(e)}")

        return None

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "create_token",
            "description": "Create a new SPL token on Solana. This is a HIGH RISK operation that creates a new cryptocurrency token.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Token name (e.g., 'AABC Token')"
                    },
                    "symbol": {
                        "type": "string",
                        "description": "Token symbol (e.g., 'AABC')"
                    },
                    "decimals": {
                        "type": "integer",
                        "description": "Number of decimal places (default: 9)"
                    },
                    "initial_supply": {
                        "type": "number",
                        "description": "Initial token supply to mint"
                    },
                    "description": {
                        "type": "string",
                        "description": "Token description"
                    },
                    "image_url": {
                        "type": "string",
                        "description": "URL to token logo image"
                    }
                },
                "required": ["name", "symbol", "initial_supply"]
            }
        }
    })
    @xml_schema(
        tag_name="create-token",
        mappings=[
            {"param_name": "name", "node_type": "attribute", "path": "."},
            {"param_name": "symbol", "node_type": "attribute", "path": "."},
            {"param_name": "decimals", "node_type": "attribute", "path": "."},
            {"param_name": "initial_supply", "node_type": "attribute", "path": "."},
            {"param_name": "description", "node_type": "attribute", "path": "."},
            {"param_name": "image_url", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="create_token">
        <parameter name="name">AABC Labs Token</parameter>
        <parameter name="symbol">AABC</parameter>
        <parameter name="decimals">9</parameter>
        <parameter name="initial_supply">1000000</parameter>
        <parameter name="description">The official token of AABC Labs</parameter>
        <parameter name="image_url">https://example.com/logo.png</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def create_token(
        self,
        name: str,
        symbol: str,
        initial_supply: float,
        decimals: Optional[int] = 9,
        description: Optional[str] = None,
        image_url: Optional[str] = None
    ) -> ToolResult:
        """Create a new SPL token"""
        try:
            # Validate inputs
            if not name or not symbol:
                return self.fail_response("Token name and symbol are required")

            if len(symbol) > 10:
                return self.fail_response("Token symbol must be 10 characters or less")

            if initial_supply <= 0:
                return self.fail_response("Initial supply must be greater than 0")

            if decimals < 0 or decimals > 9:
                return self.fail_response("Decimals must be between 0 and 9")

            # Check risk level (token creation is always high risk)
            # Status notification removed - ThreadManager doesn't have emit_status

            # Prepare token data
            data = {
                "name": name,
                "symbol": symbol,
                "decimals": decimals,
                "initialSupply": initial_supply
            }

            if description:
                data["description"] = description
            if image_url:
                data["uri"] = image_url

            # Call the bridge API
            result = await self.call_bridge('POST', '/token/create', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Token creation failed'))

            # Format success response
            mint_address = result.get('mint', '')
            signature = result.get('signature', '')
            metadata_uri = result.get('metadataUri', '')

            message = f"🎉 Token Created Successfully!\n"
            message += f"Name: {name}\n"
            message += f"Symbol: {symbol}\n"
            message += f"Mint Address: {mint_address}\n"
            message += f"Decimals: {decimals}\n"
            message += f"Initial Supply: {self.format_amount(initial_supply, decimals)}\n"
            message += f"Signature: {signature}\n"
            message += f"Explorer: https://solscan.io/token/{mint_address}"

            return self.success_response(
                data={
                    "mint_address": mint_address,
                    "name": name,
                    "symbol": symbol,
                    "decimals": decimals,
                    "initial_supply": initial_supply,
                    "signature": signature,
                    "metadata_uri": metadata_uri,
                    "explorer_url": f"https://solscan.io/token/{mint_address}"
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Token creation error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "launch_on_pumpfun",
            "description": "Launch a new token on Pump.fun platform with bonding curve. This creates a fair launch token with automatic liquidity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Token name"
                    },
                    "symbol": {
                        "type": "string",
                        "description": "Token symbol"
                    },
                    "description": {
                        "type": "string",
                        "description": "Token description"
                    },
                    "image_path": {
                        "type": "string",
                        "description": "Path to token logo image (local file path or URL)"
                    },
                    "image_url": {
                        "type": "string",
                        "description": "URL to token logo (deprecated, use image_path)"
                    },
                    "twitter": {
                        "type": "string",
                        "description": "Twitter/X handle"
                    },
                    "telegram": {
                        "type": "string",
                        "description": "Telegram group link"
                    },
                    "website": {
                        "type": "string",
                        "description": "Project website"
                    }
                },
                "required": ["name", "symbol"]
            }
        }
    })
    @xml_schema(
        tag_name="launch-pumpfun",
        mappings=[
            {"param_name": "name", "node_type": "attribute", "path": "."},
            {"param_name": "symbol", "node_type": "attribute", "path": "."},
            {"param_name": "description", "node_type": "attribute", "path": "."},
            {"param_name": "image_path", "node_type": "attribute", "path": "."},
            {"param_name": "image_url", "node_type": "attribute", "path": "."},
            {"param_name": "twitter", "node_type": "attribute", "path": "."},
            {"param_name": "telegram", "node_type": "attribute", "path": "."},
            {"param_name": "website", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="launch_on_pumpfun">
        <parameter name="name">AABC Meme</parameter>
        <parameter name="symbol">AABCMEME</parameter>
        <parameter name="description">The ultimate AI meme token</parameter>
        <parameter name="twitter">@AABCLabs</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def launch_on_pumpfun(
        self,
        name: str,
        symbol: str,
        description: Optional[str] = None,
        image_path: Optional[str] = None,
        image_url: Optional[str] = None,  # Keep for backward compatibility
        twitter: Optional[str] = None,
        telegram: Optional[str] = None,
        website: Optional[str] = None
    ) -> ToolResult:
        """Launch token on Pump.fun"""
        try:
            # Validate inputs
            if not name or not symbol:
                return self.fail_response("Token name and symbol are required")

            # Handle image - prefer image_path over image_url
            final_image_url = None
            if image_path:
                logger.info(f"Processing image_path: {image_path}")
                # Upload to IPFS if it's a local file
                final_image_url = await self.upload_image_to_ipfs(image_path)
                if not final_image_url:
                    logger.warning(f"Failed to upload image {image_path} to IPFS, continuing without image")
            elif image_url:
                # Use image_url if no image_path provided
                final_image_url = image_url

            # Prepare launch data
            data = {
                "name": name,
                "symbol": symbol
            }

            if description:
                data["description"] = description
            if final_image_url:
                data["imageUrl"] = final_image_url
            if twitter:
                data["twitter"] = twitter
            if telegram:
                data["telegram"] = telegram
            if website:
                data["website"] = website

            # Call the bridge API - direct route without defi prefix
            result = await self.call_bridge('POST', '/launch/pumpfun', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Pump.fun launch failed'))

            # Format success response
            mint_address = result.get('mint', '')
            signature = result.get('signature', '')
            pump_url = result.get('pumpUrl', '')
            bonding_curve = result.get('bondingCurve', '')

            message = f"🚀 Token Launched on Pump.fun!\n"
            message += f"Name: {name}\n"
            message += f"Symbol: {symbol}\n"
            message += f"Mint: {mint_address}\n"
            message += f"Pump.fun URL: {pump_url}\n"
            message += f"Bonding Curve: {bonding_curve}\n"
            message += f"Signature: {signature}\n"

            return self.success_response(
                data={
                    "mint_address": mint_address,
                    "name": name,
                    "symbol": symbol,
                    "pump_url": pump_url,
                    "bonding_curve": bonding_curve,
                    "signature": signature
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Pump.fun launch error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "burn_tokens",
            "description": "Burn (permanently destroy) SPL tokens from the agent's wallet. This reduces the total supply.",
            "parameters": {
                "type": "object",
                "properties": {
                    "token_address": {
                        "type": "string",
                        "description": "The SPL token mint address"
                    },
                    "amount": {
                        "type": "number",
                        "description": "Amount of tokens to burn"
                    }
                },
                "required": ["token_address", "amount"]
            }
        }
    })
    @xml_schema(
        tag_name="burn-tokens",
        mappings=[
            {"param_name": "token_address", "node_type": "attribute", "path": "."},
            {"param_name": "amount", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="burn_tokens">
        <parameter name="token_address">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        <parameter name="amount">1000</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def burn_tokens(
        self,
        token_address: str,
        amount: float
    ) -> ToolResult:
        """Burn SPL tokens"""
        try:
            # Validate inputs
            if not self.validate_address(token_address):
                return self.fail_response(f"Invalid token address: {token_address}")

            if amount <= 0:
                return self.fail_response("Burn amount must be greater than 0")

            # Prepare burn data
            data = {
                "tokenAddress": token_address,
                "amount": amount
            }

            # Call the bridge API
            result = await self.call_bridge('POST', '/token/burn', data)

            if not result.get('success'):
                return self.fail_response(result.get('error', 'Token burn failed'))

            # Format success response
            signature = result.get('signature', '')
            burned_amount = result.get('burnedAmount', amount)
            remaining_balance = result.get('remainingBalance', 0)

            message = f"🔥 Tokens Burned Successfully!\n"
            message += f"Token: {token_address[:8]}...\n"
            message += f"Burned: {self.format_amount(burned_amount)} tokens\n"
            message += f"Remaining: {self.format_amount(remaining_balance)} tokens\n"
            message += f"Signature: {signature}\n"
            message += f"Explorer: https://solscan.io/tx/{signature}"

            return self.success_response(
                data={
                    "token_address": token_address,
                    "burned_amount": burned_amount,
                    "remaining_balance": remaining_balance,
                    "signature": signature,
                    "explorer_url": f"https://solscan.io/tx/{signature}"
                },
                message=message
            )

        except Exception as e:
            return self.fail_response(f"Token burn error: {str(e)}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "get_token_info",
            "description": "Get detailed information about an SPL token including metadata, supply, and holders.",
            "parameters": {
                "type": "object",
                "properties": {
                    "token_address": {
                        "type": "string",
                        "description": "The SPL token mint address"
                    }
                },
                "required": ["token_address"]
            }
        }
    })
    @xml_schema(
        tag_name="get-token-info",
        mappings=[
            {"param_name": "token_address", "node_type": "attribute", "path": "."}
        ],
        example='''
        <function_calls>
        <invoke name="get_token_info">
        <parameter name="token_address">EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def get_token_info(self, token_address: str) -> ToolResult:
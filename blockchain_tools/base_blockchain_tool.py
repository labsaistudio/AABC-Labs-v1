import os
import httpx
import json
from typing import Dict, Any, Optional
from agentpress.tool import Tool, ToolResult, openapi_schema, xml_schema
from agentpress.thread_manager import ThreadManager
from utils.logger import logger

class BaseBlockchainTool(Tool):
    """Base class for blockchain tools that communicate with Node.js middleware"""

    def __init__(self, thread_manager: ThreadManager):
        super().__init__()
        self.thread_manager = thread_manager

        # Auto-detect if running in Docker container
        # If /.dockerenv exists, we're in a container
        if os.path.exists('/.dockerenv'):
            # Use host.docker.internal to access host services from container
            default_url = 'http://host.docker.internal:3001'
        else:
            # Use localhost when running on host
            default_url = 'http://localhost:3001'

        self.bridge_url = os.getenv('SOLANA_BRIDGE_URL', default_url)
        self.timeout = 30  # seconds

        logger.info(f"Blockchain tool initialized with bridge URL: {self.bridge_url}")

    async def call_bridge(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Call the Node.js bridge API"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                url = f"{self.bridge_url}/api{endpoint}"

                logger.info(f"Calling bridge: {method} {url}")

                if method.upper() == 'GET':
                    response = await client.get(url, params=params)
                elif method.upper() == 'POST':
                    response = await client.post(url, json=data)
                elif method.upper() == 'PUT':
                    response = await client.put(url, json=data)
                elif method.upper() == 'DELETE':
                    response = await client.delete(url)
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")

                response.raise_for_status()
                result = response.json()

                logger.info(f"Bridge response: {result.get('success', False)}")
                return result

        except httpx.RequestError as e:
            logger.error(f"Bridge request error: {e}")
            raise Exception(f"Failed to connect to blockchain bridge: {str(e)}")
        except httpx.HTTPStatusError as e:
            logger.error(f"Bridge HTTP error: {e}")
            error_msg = f"Bridge returned error: {e.response.status_code}"
            try:
                error_data = e.response.json()
                if 'error' in error_data:
                    error_msg = f"Bridge error: {error_data['error']}"
            except:
                pass
            raise Exception(error_msg)
        except Exception as e:
            logger.error(f"Unexpected bridge error: {e}")
            raise

    def success_response(self, data: Any, message: str = None) -> ToolResult:
        """Create a success response"""
        output = {
            "success": True,
            "data": data
        }
        if message:
            output["message"] = message

        return ToolResult(
            success=True,
            output=json.dumps(output, indent=2)
        )

    def fail_response(self, error: str) -> ToolResult:
        """Create a failure response"""
        return ToolResult(
            success=False,
            output=json.dumps({
                "success": False,
                "error": error
            }, indent=2)
        )

    def format_amount(self, amount: float, decimals: int = 9) -> str:
        """Format token amount for display"""
        return f"{amount:.{decimals}f}".rstrip('0').rstrip('.')

    def validate_address(self, address: str) -> bool:
        """Basic Solana address validation"""
        if not address:
            return False

        # Solana addresses are base58 encoded and typically 32-44 characters
        if len(address) < 32 or len(address) > 44:
            return False

        # Check for valid base58 characters
        base58_chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        return all(c in base58_chars for c in address)

    async def check_risk_level(self, operation: str, amount: float = None) -> str:
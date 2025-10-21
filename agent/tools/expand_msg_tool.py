from agentpress.tool import Tool, ToolResult, openapi_schema, xml_schema
from agentpress.thread_manager import ThreadManager
import json

class ExpandMessageTool(Tool):
    """Tool for expanding a previous message to the user."""

    def __init__(self, thread_id: str, thread_manager: ThreadManager):
        super().__init__()
        self.thread_manager = thread_manager
        self.thread_id = thread_id

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "expand_message",
            "description": "Expand a message from the previous conversation with the user. Use this tool to expand a message that was truncated in the earlier conversation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message_id": {
                        "type": "string",
                        "description": "The ID of the message to expand. Must be a UUID."
                    }
                },
                "required": ["message_id"]
            }
        }
    })
    @xml_schema(
        tag_name="expand-message",
        mappings=[
            {"param_name": "message_id", "node_type": "attribute", "path": "."}
        ],
        example='''
        <!-- Example 1: Expand a message that was truncated in the previous conversation -->
        <function_calls>
        <invoke name="expand_message">
        <parameter name="message_id">ecde3a4c-c7dc-4776-ae5c-8209517c5576</parameter>
        </invoke>
        </function_calls>

        <!-- Example 2: Expand a message to create reports or analyze truncated data -->
        <function_calls>
        <invoke name="expand_message">
        <parameter name="message_id">f47ac10b-58cc-4372-a567-0e02b2c3d479</parameter>
        </invoke>
        </function_calls>

        <!-- Example 3: Expand a message when you need the full content for analysis -->
        <function_calls>
        <invoke name="expand_message">
        <parameter name="message_id">550e8400-e29b-41d4-a716-446655440000</parameter>
        </invoke>
        </function_calls>
        '''
    )
    async def expand_message(self, message_id: str) -> ToolResult:
        """Expand a message from the previous conversation with the user.

        Args:
            message_id: The ID of the message to expand

        Returns:
            ToolResult indicating the message was successfully expanded
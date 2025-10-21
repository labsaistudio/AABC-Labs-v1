from typing import Optional
from agentpress.tool import ToolResult, openapi_schema, xml_schema
from sandbox.tool_base import SandboxToolsBase
from agentpress.thread_manager import ThreadManager
import httpx
from io import BytesIO
import uuid
import base64
import os
from utils.logger import logger
from daytona_sdk import SessionExecuteRequest
from uuid import uuid4


class SandboxImageEditTool(SandboxToolsBase):
    """Tool for generating images using Google Gemini."""

    def __init__(self, project_id: str, thread_id: str, thread_manager: ThreadManager):
        super().__init__(project_id, thread_manager)
        self.thread_id = thread_id
        self.thread_manager = thread_manager
        self._genai_installed = False

    async def _detect_python_cmd(self) -> str:
        """Detect a working python command in the sandbox (python3 preferred)."""
        await self._ensure_sandbox()
        # Try python3 first
        check_py3 = await self._exec_cmd("python3 -V")
        if check_py3.get("exit_code", 1) == 0:
            return "python3"
        # Fallback to python
        check_py = await self._exec_cmd("python -V")
        if check_py.get("exit_code", 1) == 0:
            return "python"
        raise RuntimeError("No Python interpreter found in sandbox (python3/python)")

    async def _exec_cmd(self, command: str, cwd: Optional[str] = None, timeout: int = 120) -> dict:
        """Execute a shell command in the sandbox using a transient session and return dict with output and exit_code."""
        await self._ensure_sandbox()
        session_id = f"imgtool-{str(uuid4())[:8]}"
        try:
            await self.sandbox.process.create_session(session_id)
            req = SessionExecuteRequest(command=command, var_async=False, cwd=cwd or self.workspace_path)
            resp = await self.sandbox.process.execute_session_command(session_id=session_id, req=req, timeout=timeout)
            logs = await self.sandbox.process.get_session_command_logs(session_id=session_id, command_id=resp.cmd_id)
            return {"output": logs, "exit_code": resp.exit_code}
        finally:
            try:
                await self.sandbox.process.delete_session(session_id)
            except Exception:
                pass

    async def _ensure_google_genai(self, py_cmd: str, ensure_pillow: bool) -> ToolResult | None:
        """Ensure google-genai (and optionally Pillow) is importable in the sandbox.

        Returns None on success, or a ToolResult failure on error.
        """
        # Helper to run import check
        async def import_check(module_expr: str) -> bool:
            cmd = f"{py_cmd} -c \"import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('{module_expr}') else 1)\""
            res = await self._exec_cmd(cmd)
            return res.get("exit_code", 1) == 0

        # Skip if already ensured in this instance
        if self._genai_installed and await import_check("google.genai"):
            return None

        logger.info("Ensuring google-genai is available in sandbox…")

        # First attempt: is it already available?
        if not await import_check("google.genai"):
            # Install using the same interpreter to avoid pip/python mismatch
            install_cmd = f"{py_cmd} -m pip install --upgrade --no-cache-dir google-genai"
            install_result = await self._exec_cmd(install_cmd)
            if install_result.get("exit_code", 1) != 0:
                return self.fail_response(
                    "Failed to install google-genai in sandbox. Output: " + str(install_result.get("output", ""))
                )

        # Re-check import and remediate common namespace conflicts
        if not await import_check("google.genai"):
            # Try removing legacy 'google' package which breaks namespace imports
            uninstall_res = await self._exec_cmd(f"{py_cmd} -m pip uninstall -y google || true")
            _ = uninstall_res  # ignore outcome
            reinstall_res = await self._exec_cmd(f"{py_cmd} -m pip install --upgrade --no-cache-dir google-genai")
            if reinstall_res.get("exit_code", 1) != 0 or not await import_check("google.genai"):
                # Provide diagnostics to help debugging
                show_res = await self._exec_cmd(f"{py_cmd} -m pip show google-genai || true")
                freeze_res = await self._exec_cmd(f"{py_cmd} -m pip freeze | head -n 120")
                details = "\n--- pip show google-genai ---\n" + str(show_res.get("output", "")) + "\n--- pip freeze ---\n" + str(freeze_res.get("output", ""))
                return self.fail_response(
                    "Google GenAI library not importable in sandbox after installation. "
                    "Please check Python environment. Details:" + details
                )

        # Optionally ensure Pillow for edit mode
        if ensure_pillow and not await import_check("PIL"):
            pillow_res = await self._exec_cmd(f"{py_cmd} -m pip install --upgrade --no-cache-dir pillow")
            if pillow_res.get("exit_code", 1) != 0 or not await import_check("PIL"):
                return self.fail_response("Failed to install Pillow in sandbox for edit mode: " + str(pillow_res.get("output", "")))

        self._genai_installed = True
        return None

    @openapi_schema(
        {
            "type": "function",
            "function": {
                "name": "image_edit_or_generate",
                "description": "Generate a new image from a prompt using Google Gemini 2.5 Flash Image Preview. Edit mode also supported with input image. Stores the result in the thread context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "mode": {
                            "type": "string",
                            "enum": ["generate", "edit"],
                            "description": "'generate' to create a new image from a prompt, 'edit' to edit an existing image.",
                        },
                        "prompt": {
                            "type": "string",
                            "description": "Text prompt describing the desired image or edit.",
                        },
                        "image_path": {
                            "type": "string",
                            "description": "(edit mode only) Path to the image file to edit, relative to /workspace. Required for 'edit'.",
                        },
                    },
                    "required": ["mode", "prompt"],
                },
            },
        }
    )
    @xml_schema(
        tag_name="image-edit-or-generate",
        mappings=[
            {"param_name": "mode", "node_type": "attribute", "path": "."},
            {"param_name": "prompt", "node_type": "attribute", "path": "."},
            {"param_name": "image_path", "node_type": "attribute", "path": "."},
        ],
        example="""
        <function_calls>
        <invoke name="image_edit_or_generate">
        <parameter name="mode">generate</parameter>
        <parameter name="prompt">A futuristic cityscape at sunset</parameter>
        </invoke>
        </function_calls>
        """,
    )
    async def image_edit_or_generate(
        self,
        mode: str,
        prompt: str,
        image_path: Optional[str] = None,
    ) -> ToolResult:
        """Generate images using Google Gemini."""
        try:
            await self._ensure_sandbox()
            # Detect python interpreter in sandbox and ensure dependencies
            py_cmd = await self._detect_python_cmd()
            logger.info(f"SandboxImageEditTool will use interpreter: {py_cmd}")

            ensure_err = await self._ensure_google_genai(py_cmd, ensure_pillow=(mode == "edit"))
            if ensure_err is not None:
                return ensure_err

            # Get Gemini API key (from backend env)
            gemini_api_key = os.getenv('GEMINI_API_KEY')

            if not gemini_api_key:
                return self.fail_response("Gemini API key not found. Please set GEMINI_API_KEY environment variable.")

            # Generate final filename upfront
            random_filename = f"generated_image_{uuid.uuid4().hex[:8]}"

            if mode == "generate":
                # Create Python script for image generation
                script_content = f'''
import os
import base64
from google import genai

# Initialize client using explicit API key
client = genai.Client(api_key='{gemini_api_key}')

# Generate image
print("🎨 Generating image...")
response = client.models.generate_content(
    model="gemini-2.5-flash-image-preview",
    contents=["""{prompt}"""]
)

# Extract first image part and save with proper extension
image_saved = False
save_path = None
mime = None
ext_map = {{
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
}}

for part in response.candidates[0].content.parts:
    if hasattr(part, 'inline_data') and part.inline_data is not None:
        data = part.inline_data.data
        mime = getattr(part.inline_data, 'mime_type', None) or 'image/png'
        ext = ext_map.get(mime.lower(), 'png')

        # Decode base64 if needed
        if isinstance(data, str):
            img_bytes = base64.b64decode(data)
        else:
            img_bytes = data

        # FIXED: Save directly to final location to avoid file operation issues
        save_path = f"/workspace/{random_filename}." + ext
        with open(save_path, 'wb') as f:
            f.write(img_bytes)

        print("✅ Image generated: " + str(len(img_bytes)) + " bytes, mime=" + str(mime) + " saved=" + str(save_path))
        print("RESULT:path=" + str(save_path) + ",mime=" + str(mime) + ",bytes=" + str(len(img_bytes)))
        image_saved = True
        break

if not image_saved:
    print("❌ No image in response")
    exit(1)
'''

            elif mode == "edit":
                if not image_path:
                    return self.fail_response("'image_path' is required for edit mode.")

                # Clean the path
                cleaned_path = self.clean_path(image_path)
                full_path = f"/workspace/{cleaned_path}"

                # Create Python script for image editing
                script_content = f'''
import os
import base64
from google import genai
from PIL import Image
from io import BytesIO

# Initialize client using explicit API key
client = genai.Client(api_key='{gemini_api_key}')

# Load input image
input_image = Image.open("{full_path}")

# Generate edited image
print("🎨 Editing image...")
response = client.models.generate_content(
    model="gemini-2.5-flash-image-preview",
    contents=["""{prompt}""", input_image]
)

# Extract first image part and save with proper extension
image_saved = False
save_path = None
mime = None
ext_map = {{
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
}}

for part in response.candidates[0].content.parts:
    if hasattr(part, 'inline_data') and part.inline_data is not None:
        data = part.inline_data.data
        mime = getattr(part.inline_data, 'mime_type', None) or 'image/png'
        ext = ext_map.get(mime.lower(), 'png')

        # Decode base64 if needed
        if isinstance(data, str):
            img_bytes = base64.b64decode(data)
        else:
            img_bytes = data

        # FIXED: Save directly to final location to avoid file operation issues
        save_path = f"/workspace/{random_filename}." + ext
        with open(save_path, 'wb') as f:
            f.write(img_bytes)

        print("✅ Image edited: " + str(len(img_bytes)) + " bytes, mime=" + str(mime) + " saved=" + str(save_path))
        print("RESULT:path=" + str(save_path) + ",mime=" + str(mime) + ",bytes=" + str(len(img_bytes)))
        image_saved = True
        break

if not image_saved:
    print("❌ No image in response")
    exit(1)
'''
            else:
                return self.fail_response("Invalid mode. Use 'generate' or 'edit'.")

            # Save script to sandbox
            script_path = "/workspace/generate_image_script.py"
            await self.sandbox.fs.upload_file(script_content.encode(), script_path)

            # Execute the script
            print(f"🚀 Executing image {mode} script...")
            result = await self._exec_cmd(f"{py_cmd} {script_path}")

            logs = str(result.get("output", ""))

            if result.get("exit_code", 1) != 0:
                # Clean up
                await self._exec_cmd(f"rm -f {script_path}")
                return self.fail_response(f"Image {mode} failed: {logs}")

            # Parse saved path from logs
            saved_filename = None
            if "RESULT:" in logs:
                try:
                    # Expected format: RESULT:path=...,mime=...,bytes=...
                    marker = logs.split("RESULT:")[-1].strip().splitlines()[0]
                    parts = marker.split(',')
                    kv = {k.strip(): v.strip() for k,v in (p.split('=',1) for p in parts)}
                    saved_path = kv.get('path')
                    if saved_path:
                        saved_filename = saved_path.split('/')[-1]
                except Exception:
                    saved_filename = None

            if not saved_filename:
                # Fallback: try to find the generated file
                probe = await self._exec_cmd(f"ls -1 /workspace/{random_filename}.* 2>/dev/null | head -n 1")
                cand = str(probe.get("output", "")).strip().splitlines()
                if cand:
                    saved_filename = cand[-1].strip().split('/')[-1]

            if not saved_filename:
                await self._exec_cmd(f"rm -f {script_path}")
                return self.fail_response("Image generation succeeded but file was not found")

            # Clean up script
            await self._exec_cmd(f"rm -f {script_path}")

            return self.success_response(
                f"Successfully generated image using mode '{mode}'. Image saved as: {saved_filename}. You can use the ask tool to display the image."
            )

        except Exception as e:
            return self.fail_response(
                f"An error occurred during image generation/editing: {str(e)}"
            )

    async def _get_image_bytes(self, image_path: str) -> bytes | ToolResult:
        """Get image bytes from URL or local file path."""
        if image_path.startswith(("http://", "https://")):
            return await self._download_image_from_url(image_path)
        else:
            return await self._read_image_from_sandbox(image_path)

    async def _download_image_from_url(self, url: str) -> bytes | ToolResult:
        """Download image from URL."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()
                return response.content
        except Exception:
            return self.fail_response(f"Could not download image from URL: {url}")

    async def _read_image_from_sandbox(self, image_path: str) -> bytes | ToolResult:
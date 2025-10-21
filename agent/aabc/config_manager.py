import datetime
from typing import Dict, Any
from dataclasses import dataclass
from agent.aabc.config import AABCConfig


@dataclass
class AABCConfiguration:
    name: str
    description: str
    configured_mcps: list
    custom_mcps: list
    restrictions: Dict[str, Any]
    version_tag: str


class AABCConfigManager:
    def get_current_config(self) -> AABCConfiguration:
        version_tag = self._generate_version_tag()

        return AABCConfiguration(
            name=AABCConfig.NAME,
            description=AABCConfig.DESCRIPTION,
            configured_mcps=AABCConfig.DEFAULT_MCPS.copy(),
            custom_mcps=AABCConfig.DEFAULT_CUSTOM_MCPS.copy(),
            restrictions=AABCConfig.USER_RESTRICTIONS.copy(),
            version_tag=version_tag
        )

    def has_config_changed(self, last_version_tag: str) -> bool:
        current = self.get_current_config()
        return current.version_tag != last_version_tag

    def validate_config(self, config: AABCConfiguration) -> tuple[bool, list[str]]:
        errors = []

        if not config.name.strip():
            errors.append("Name cannot be empty")

        return len(errors) == 0, errors

    def _generate_version_tag(self) -> str:
        import hashlib
        import json

        config_data = {
            "name": AABCConfig.NAME,
            "description": AABCConfig.DESCRIPTION,
            "system_prompt": AABCConfig.get_system_prompt(),
            "default_tools": AABCConfig.DEFAULT_TOOLS,
            "avatar": AABCConfig.AVATAR,
            "avatar_color": AABCConfig.AVATAR_COLOR,
            "restrictions": AABCConfig.USER_RESTRICTIONS
        }

        config_str = json.dumps(config_data, sort_keys=True)
        hash_obj = hashlib.md5(config_str.encode())
        return f"config-{hash_obj.hexdigest()[:8]}"

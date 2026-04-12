#!/usr/bin/env python3

from __future__ import annotations

import re


PLUGIN_COMMAND_NAMESPACE = re.compile(r'("plugin:)plugin-([a-z0-9-]+\|)')


def normalize_generated_context(source: str) -> str:
    return PLUGIN_COMMAND_NAMESPACE.sub(r"\1\2", source)

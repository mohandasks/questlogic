"""Shared dataclasses to keep client.py and provider modules cycle-free."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CompletionResult:
    text: str
    model: str
    provider: str
    tokens_in: int
    tokens_out: int

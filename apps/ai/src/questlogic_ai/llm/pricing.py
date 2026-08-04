"""Per-model pricing in micro-cents per token. Update as providers change rates.

Source: Anthropic / OpenAI list pricing, verified against current published
per-million-token rates (checked 2026-08). Previous values in this table were
stale placeholders roughly 8-10x too high — if a cost dashboard built on
`llm_calls` looks implausibly large from before this fix, that's why. Still:
don't trust these numbers for billing — they're for cost telemetry only.
Replace with provider-reported usage in invoices.
"""

# 1 cent = 10_000 micros; 1 dollar = 1_000_000 micros.
# Prices are per token (not per million): micros_per_token = $ per M tokens.
PRICING_MICROS_PER_TOKEN: dict[str, tuple[int, int]] = {
    # model_id: (input_micros_per_token, output_micros_per_token)
    "claude-sonnet-4-6": (3, 15),      # $3 / $15 per M tok
    "claude-haiku-4-5-20251001": (1, 5),  # $1 / $5 per M tok
    "claude-opus-4-6": (15, 75),
    "gpt-5": (40, 200),
    "gpt-4o-mini": (3, 12),
}

# Anthropic prompt-caching multipliers, applied to the model's base input
# rate. Standard across Claude models: writing to the (5-minute) cache costs
# more than a normal input token; reading from it costs much less.
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


def cost_micros(model: str, tokens_in: int, tokens_out: int) -> int:
    in_rate, out_rate = PRICING_MICROS_PER_TOKEN.get(model, (0, 0))
    return tokens_in * in_rate + tokens_out * out_rate


def cost_micros_detailed(
    model: str,
    *,
    tokens_in: int,
    tokens_out: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> int:
    """Cost including prompt-caching token categories.

    `tokens_in` here should be the *non-cached* input tokens only (Anthropic
    reports cache-creation and cache-read tokens as separate usage fields,
    not included in `input_tokens`). Safe to call with zeros for a normal,
    uncached request — behaves identically to `cost_micros` in that case.
    """
    in_rate, out_rate = PRICING_MICROS_PER_TOKEN.get(model, (0, 0))
    return (
        tokens_in * in_rate
        + tokens_out * out_rate
        + round(cache_creation_tokens * in_rate * CACHE_WRITE_MULTIPLIER)
        + round(cache_read_tokens * in_rate * CACHE_READ_MULTIPLIER)
    )

"""Per-model pricing in micro-cents per token. Update as providers change rates.

Source: provider pricing pages as of project start. Don't trust these numbers
for billing — they're for cost telemetry only. Replace with provider-reported
usage in invoices.
"""

# 1 cent = 10_000 micros; 1 dollar = 1_000_000 micros.
# Prices are per token (not per million).
PRICING_MICROS_PER_TOKEN: dict[str, tuple[int, int]] = {
    # model_id: (input_micros_per_token, output_micros_per_token)
    "claude-sonnet-4-6": (30, 150),
    "claude-haiku-4-5-20251001": (8, 40),
    "claude-opus-4-6": (150, 750),
    "gpt-5": (40, 200),
    "gpt-4o-mini": (3, 12),
}


def cost_micros(model: str, tokens_in: int, tokens_out: int) -> int:
    in_rate, out_rate = PRICING_MICROS_PER_TOKEN.get(model, (0, 0))
    return tokens_in * in_rate + tokens_out * out_rate

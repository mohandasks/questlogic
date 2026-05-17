# syntax=docker/dockerfile:1.7

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install only what we need for FastAPI + asyncpg at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject first to leverage the Docker layer cache when only source
# files change.
COPY pyproject.toml ./
COPY src ./src

RUN pip install --upgrade pip \
    && pip install .

# Fly sets PORT; default 8000 for local-Docker testing.
ENV PORT=8000
EXPOSE 8000

# bind 0.0.0.0 so traffic from outside the container actually reaches uvicorn
CMD ["sh", "-c", "uvicorn questlogic_ai.main:app --host 0.0.0.0 --port ${PORT}"]

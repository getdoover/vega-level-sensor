FROM python:3.11-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.7.3 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app
RUN uv venv

COPY pyproject.toml .
RUN uv pip install pymodbus>=3.9.2 transitions>=0.9.2

COPY . /app

FROM python:3.11-slim AS final_image
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
ENTRYPOINT ["python", "main.py"]

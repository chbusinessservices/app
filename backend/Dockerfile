# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app

# Install dependencies. BuildKit cache mount keeps downloaded wheels across
# rebuilds so dependency changes are fast. The private `emergentintegrations`
# package is not on public PyPI; a local stub (in the bind-mounted source)
# satisfies its import. httpx and fpdf2 are used by the app but missing from
# requirements.txt.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    sed -i '/^emergentintegrations/d' requirements.txt \
    && pip install -r requirements.txt httpx fpdf2

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

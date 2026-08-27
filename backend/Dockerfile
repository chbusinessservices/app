FROM python:3.12-slim

WORKDIR /app

# Install dependencies. The private `emergentintegrations` package is not on
# public PyPI; a local stub (in the bind-mounted source) satisfies its import.
# fpdf2 is used lazily for PDF generation but missing from requirements.txt.
COPY requirements.txt .
RUN sed -i '/^emergentintegrations/d' requirements.txt \
    && pip install --no-cache-dir -r requirements.txt httpx fpdf2

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

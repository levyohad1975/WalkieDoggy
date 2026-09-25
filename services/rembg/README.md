# Walkie Doggy rembg service

Small isolated HTTP service used by the staging background-removal flow.

- GET /health
- POST /api/remove with multipart field `file` and `model=isnet-general-use`
- Optional Bearer authentication via `REMBG_SERVICE_TOKEN`

Render settings:
- Runtime: Python 3
- Root Directory: services/rembg
- Build: pip install -r requirements.txt
- Start: uvicorn app:app --host 0.0.0.0 --port $PORT

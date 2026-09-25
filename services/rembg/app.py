import hmac
import os

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from rembg import new_session, remove

app = FastAPI(title="Walkie Doggy Background Removal")
_session = None


def get_session():
    global _session
    if _session is None:
        _session = new_session("isnet-general-use")
    return _session


def authorize(authorization: str | None) -> None:
    expected = os.getenv("REMBG_SERVICE_TOKEN")
    if not expected:
        return
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization[7:]
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/remove")
async def remove_background(
    file: UploadFile = File(...),
    model: str = Form("isnet-general-use"),
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    if model != "isnet-general-use":
        raise HTTPException(status_code=400, detail="Unsupported model")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Image required")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty image")
    try:
        output = remove(data, session=get_session())
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Background removal failed") from exc
    return Response(content=output, media_type="image/png")

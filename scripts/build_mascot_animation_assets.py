from pathlib import Path
from urllib.request import Request, urlopen
import math
import cv2
import numpy as np

OUT = Path("assets/mascot-animations")
TMP = Path("/tmp/walkie-mascot")
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)

SOURCES = {
    "high-five": ("https://cdn.openart.ai/openart-ai/production/2026-09/create-video/f6N0OYGzjtkDgE5CBQMe/a95872e1-65a2-466c-b6ab-cf1d51af6ef3_seed1544010566_1790576483873_24f3dace.mp4", "dark"),
    "tail-wag": ("https://cdn.openart.ai/openart-ai/production/2026-09/create-video/f6N0OYGzjtkDgE5CBQMe/1762dc12-8b4c-47fa-a3ac-d5ecbfb47016_seed1537550348_1790583184633_44f147e4.mp4", "green"),
}

def connected_border(mask):
    count, labels = cv2.connectedComponents(mask)
    ids = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
    ids = ids[ids > 0]
    return np.isin(labels, ids).astype(np.uint8) * 255

def green_alpha(image):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    background = (((h > 45) & (h < 110) & (s > 45) & (v > 35)).astype(np.uint8) * 255)
    background = connected_border(background)
    background = cv2.dilate(background, np.ones((5, 5), np.uint8), iterations=1)
    background = cv2.GaussianBlur(background, (5, 5), 0)
    return 255 - background

def dark_alpha(image):
    height, width = image.shape[:2]
    mask = np.full((height, width), cv2.GC_PR_BGD, np.uint8)
    border = 10
    mask[:border, :] = mask[-border:, :] = mask[:, :border] = mask[:, -border:] = cv2.GC_BGD
    mask[int(.06*height):int(.97*height), int(.05*width):int(.95*width)] = cv2.GC_PR_FGD
    edges = cv2.Canny(image, 55, 130)
    mask[edges > 0] = cv2.GC_PR_FGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(image, mask, None, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
    alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    return alpha

def validate_alpha(name, frames):
    ratios = [float(np.count_nonzero(frame[:, :, 3] > 8)) / frame[:, :, 3].size for frame in frames]
    if min(ratios) <= 0.01:
        raise RuntimeError(f"{name}: alpha extraction erased a frame ({min(ratios):.3f})")
    if max(ratios) >= 0.92:
        raise RuntimeError(f"{name}: background remains in a frame ({max(ratios):.3f})")
    # Transparent corners are a cheap but effective guard against shipping a
    # keyed square/rectangle around the mascot.
    for i, frame in enumerate(frames):
        alpha = frame[:, :, 3]
        corner = 18
        samples = np.concatenate((
            alpha[:corner, :corner].ravel(),
            alpha[:corner, -corner:].ravel(),
            alpha[-corner:, :corner].ravel(),
            alpha[-corner:, -corner:].ravel(),
        ))
        if float(np.mean(samples)) > 24:
            raise RuntimeError(f"{name}: frame {i} still has opaque background corners")

def build(name, url, key):
    source = TMP / f"{name}.mp4"
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://openart.ai/'})
    with urlopen(request, timeout=60) as response, source.open('wb') as target:
        target.write(response.read())
    capture = cv2.VideoCapture(str(source))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    # 24 evenly spaced frames across the useful first ~82% avoids vendor outro artifacts.
    indexes = np.linspace(0, max(0, int(frame_count * .82)), 24).astype(int)
    frames = []
    for index in indexes:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
        ok, image = capture.read()
        if not ok:
            continue
        image = cv2.resize(image, (256, 256), interpolation=cv2.INTER_AREA)
        alpha = green_alpha(image) if key == "green" else dark_alpha(image)
        rgba = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = alpha
        frames.append(rgba)
    if len(frames) != 24:
        raise RuntimeError(f"{name}: expected 24 frames, got {len(frames)}")
    validate_alpha(name, frames)
    columns = 6
    rows = math.ceil(len(frames) / columns)
    sheet = np.zeros((rows * 256, columns * 256, 4), np.uint8)
    for i, frame in enumerate(frames):
        y, x = (i // columns) * 256, (i % columns) * 256
        sheet[y:y+256, x:x+256] = frame
    target = OUT / f"{name}.png"
    if not cv2.imwrite(str(target), sheet, [cv2.IMWRITE_PNG_COMPRESSION, 9]):
        raise RuntimeError(f"Could not write {target}")

for animation, (source_url, key_type) in SOURCES.items():
    build(animation, source_url, key_type)

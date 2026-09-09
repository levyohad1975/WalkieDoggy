# Walkie Doggy Link celebration asset manifest

The app currently bundles one approved mascot raster at `assets/branding/walkie-doggy-mascot.png`. Every library entry resolves to it as an explicit placeholder and reduced-motion fallback. The frontend integration is ready for curated replacements; no database media is involved.

| ID | Visual concept | Delivery | Local reference now | Final recommendation | Motion | Future Storage convention |
| --- | --- | --- | --- | --- | --- | --- |
| `thank-you-heart` | Mascot offering a heart | transparent PNG/WebP pose | bundled mascot placeholder | 1:1, 1024×1024, heart layer or 4-frame loop | 1.2s | `celebrations/v1/thank-you-heart.webp` |
| `happy-jump` | airborne happy hop | 4–6 transparent frames | bundled mascot placeholder | 1:1, 1024×1024 | 1.5s | `celebrations/v1/happy-jump.webp` |
| `high-five` | raised paw toward viewer | transparent PNG/WebP pose | bundled mascot placeholder | 1:1, 1024×1024 | 1.2s | `celebrations/v1/high-five.webp` |
| `confetti` | happy pose with restrained turquoise confetti | 4–6 transparent frames | bundled mascot placeholder | 1:1, 1024×1024 | 1.5s | `celebrations/v1/confetti.webp` |
| `paw-party` | playful paw stamps | transparent PNG/WebP pose | bundled mascot placeholder | 1:1, 1024×1024 | 1.2s | `celebrations/v1/paw-party.webp` |
| `trophy-teaser` | mascot presenting a tiny trophy | transparent PNG/WebP pose | bundled mascot placeholder | 1:1, 1024×1024 | 1.4s | `celebrations/v1/trophy-teaser.webp` |
| `sleepy-good-night` | calm seated/winking night pose | static or 2-frame fade | bundled mascot placeholder | 1:1, 1024×1024 | 0.6s | `celebrations/v1/sleepy-good-night.webp` |
| `long-walk` | proud, energetic well-done pose | 4–6 transparent frames | bundled mascot placeholder | 1:1, 1024×1024 | 1.5s | `celebrations/v1/long-walk.webp` |
| `special-surprise` | polished rare sparkle pose | 6–8 transparent frames | bundled mascot placeholder | 1:1, 1024×1024 | 1.8s | `celebrations/v1/special-surprise.webp` |

All final assets must retain the recognizable turquoise Walkie Doggy Link character, use transparent backgrounds, and avoid text baked into the image. Sound is intentionally absent. Keep a matching static `*-reduced.png` pose for each final asset. Add bundled files under `assets/celebrations/` first; later metadata may use a signed HTTPS Supabase Storage URL while retaining the bundled reduced-motion fallback.

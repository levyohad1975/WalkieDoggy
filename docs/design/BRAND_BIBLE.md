# Walkie Doggy Link Brand Bible

## Brand essence

Walkie Doggy Link’s current visual language is friendly, family-oriented, warm, trustworthy, and modern. Rounded surfaces, soft borders, calm cream backgrounds, turquoise as a controlled brand accent, and the mascot’s upbeat character create playfulness without making routine household coordination feel childish or noisy.

The product is used repeatedly for practical daily actions. Visual work must therefore stay clear, calm, and task-led while leaving room for brief, meaningful mascot delight.

## Brand architecture

- **Walkie Doggy Link:** the product and overall brand.
- **Brand Mascot:** the illustrated Walkie Doggy Link character. Its detailed identity rules live in [MASCOT_SPEC.md](C:\Users\ohadl\Downloads\dogwalkfamilyround5a\docs\design\MASCOT_SPEC.md).
- **Family Dog:** dynamic, family-specific application data; never the brand mascot by default.
- **Wordmark:** the textual “Walkie Doggy Link” brand asset.
- **App Icon:** small-format product representation for operating systems and web contexts.

The wordmark and mascot may appear together in approved compositions but remain separately manageable. “טופי” is not a brand-mascot name.

## Source-of-truth hierarchy

Use this order when visual sources disagree:

1. Explicitly approved `MASTER` brand assets and specifications.
2. [MASCOT_SPEC.md](C:\Users\ohadl\Downloads\dogwalkfamilyround5a\docs\design\MASCOT_SPEC.md) for mascot identity.
3. Current approved theme/token definitions in `src/theme/colors.ts` and `src/theme/tokens.ts`.
4. This Brand Bible.
5. Current, verified shared components and screen-specific specifications.
6. `DRAFT` explorations and generated experiments.

A generated experiment never overrides a higher-authority source. If current code and older prose differ, inspect the implementation and record the decision rather than silently standardizing a guess.

## Color system

The current token source is `src/theme/colors.ts`.

| Role | Token | Verified value |
| --- | --- | --- |
| Primary turquoise | `colors.primary` | `#20A7B5` |
| Deep turquoise | `colors.primaryDark` | `#0B5C75` |
| Soft turquoise | `colors.primarySoft` | `#E4F7F8` |
| Warm accent | `colors.accent` | `#F2994A` |
| Page background | `colors.background` | `#FBF8F3` |
| Main surface | `colors.surface` | `#FFFFFF` |
| Muted surface | `colors.surfaceMuted` | `#F3EEE4` |
| Border/divider | `colors.border` | `#EAE2D3` |
| Primary text | `colors.textPrimary` | `#2E2A24` |
| Secondary text | `colors.textSecondary` | `#8A8171` |
| Inverse text | `colors.textInverse` | `#FFFFFF` |
| Information | `colors.info` / `colors.infoSoft` | `#5B8DEF` / `#E9F0FF` |
| Success | `colors.success` / `colors.successSoft` | `#2F9E5B` / `#E6F5EC` |
| Warning | `colors.warning` / `colors.warningSoft` | `#B76A1F` / `#FFF1DF` |
| Error | `colors.danger` / `colors.dangerSoft` | `#C74A3C` / `#FBE7E4` |
| Pending | `colors.statusPending` / `colors.statusPendingBg` | `#B8AF9C` / `#F3EEE4` |
| Current | `colors.statusCurrent` / `colors.statusCurrentBg` | `#5B8DEF` / `#E9F0FF` |
| Completed | `colors.statusDone` / `colors.statusDoneBg` | `#2F9E5B` / `#E6F5EC` |
| Overdue | `colors.statusOverdue` / `colors.statusOverdueBg` | `#D9705C` / `#FBEAE6` |

Turquoise is the primary brand color, not a replacement for every interface color. Semantic colors retain semantic meaning, particularly pending, completion, danger, and overdue states. Backgrounds should remain calm and readable; desktop should not become an uninterrupted field of brand color. Check contrast in the actual rendered context.

## Typography

The repository establishes React Native’s system font behavior; it does not establish a custom font family. `RtlText` sets `textAlign: 'right'` and `writingDirection: 'rtl'` as the Hebrew-first default, while intentionally centered or LTR content can override it.

`src/theme/tokens.ts` provides the current reusable type scale:

| Use | Token | Size / line height / weight |
| --- | --- | --- |
| Display | `typography.display` | 30 / 38 / 800 |
| Screen title | `typography.screenTitle` | 22 / 30 / 800 |
| Section title | `typography.sectionTitle` | 16 / 23 / 700 |
| Card title | `typography.cardTitle` | 14 / 20 / 700 |
| Body | `typography.body` | 16 / 23 / 600 |
| Meta | `typography.meta` | 13 / 19 / 500 |
| Statistic value | `typography.statValue` | 26 / 32 / 800 |
| Caption | `typography.caption` | 11 / 16 / 700 |

Use hierarchy and line height for clarity, not decorative type. Hebrew, mixed Hebrew/English strings, emoji, dates, and times must remain legible; avoid unnecessary giant desktop headings. Existing components constrain some Dynamic Type scaling where required to preserve usable layouts, so new work should validate both readability and overflow at real device sizes.

## Spacing, radii, elevation, and surfaces

The shared foundation in `src/theme/tokens.ts` is deliberately warm and restrained:

- **Spacing:** `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 20, `xxl` 28, `xxxl` 36.
- **Radii:** `sm` 10, `md` 14, `lg` 18, `xl` 24, and `round` 999.
- **Layout:** 56 px standard row height, 48 px standard button height, 20 px screen padding, and 44 px minimum touch target.
- **Elevation:** `elevation.card` is intentionally subtle (`#000000`, 0.04 opacity, radius 6, Y offset 2, elevation 1).

The intended result is paper-like white surfaces, hairline warm borders, rounded cards, generous breathing room, and little visual heaviness. Reuse tokens before introducing one-off values. Existing screens still contain legacy/ad hoc measurements, so token use is a direction and a verified shared foundation—not evidence that every current screen is fully standardized.

## Wordmark

Current wordmark assets are:

| Path | Verified properties | Role/caveat |
| --- | --- | --- |
| `assets/walkie-doggy-link-wordmark.png` | PNG, 608 × 220 px, 32-bit ARGB | Textual brand asset. |
| `assets/walkie-doggy-link-wordmark-transparent.png` | PNG, 608 × 220 px, 32-bit ARGB | Textual brand asset; the repository does not establish either variant as obsolete. |

Use a separately managed wordmark where textual brand recognition is needed. Do not bake it into new mascot moments merely to identify the product. The current Reference Master contains embedded text, but the planned Clean Master is intended to remove it.

## Mascot in the brand system

The mascot is a signature emotional element: it adds warmth, encouragement, and brief delight to a relevant user task. It must not dominate every screen, compete with the primary walk action, or be confused with the family dog.

Follow [MASCOT_SPEC.md](C:\Users\ohadl\Downloads\dogwalkfamilyround5a\docs\design\MASCOT_SPEC.md) for the authoritative identity, collar/link emblem, lifecycle, and production rules. Prefer the approved Clean Master for in-app moments once it exists; do not permit identity drift.

## Iconography

Current navigation uses a small, consistent emoji vocabulary for tabs: home, schedule, family, history, statistics, and settings. Current components also use emoji for compact actions, status/delight cues, and empty/error states; standard React Native controls and text links are used alongside them.

Keep an icon’s meaning stable, its visual size appropriate to the control, and its direction appropriate for RTL. Use decorative emoji as decoration, not the only communication of critical status or action. The repository does not establish a dedicated vector-icon library or a formal stroke-icon system; do not mandate one without approval.

## UI visual language

- **Cards:** rounded white or softly semantic-tinted surfaces with gentle borders; the primary next-walk card provides the strongest task hierarchy.
- **Primary actions:** turquoise filled controls with inverse text; `Button` uses a minimum 52 px visual height.
- **Secondary actions:** surface-colored, bordered controls or clear text links for lower-emphasis work.
- **Status:** use semantic token pairs and visible labels/icons; overdue is distinct from a completed/skipped state.
- **Forms/inputs:** clear labels, generous touch targets, native date/time controls where implemented, and calm grouped surfaces.
- **Modals:** rounded cards/sheets over a subdued backdrop, with task-focused Hebrew copy and clear dismissal/confirmation paths.
- **Empty/loading/error states:** centered, readable, friendly states; existing empty/error components use emoji sparingly and provide a retry affordance when supplied.
- **Navigation:** Hebrew RTL bottom-tab navigation with deliberately controlled physical order and clear selected state.
- **Statistics/data:** legible hierarchy and semantic meaning must take precedence over decoration; current type tokens include a dedicated `statValue` scale. The repository does not establish a reusable chart component standard.

## RTL visual language

RTL is a core brand behavior. Hebrew reading flow, titles, labels, body text, and form copy default rightward. Check the placement and direction of chevrons/arrows, reading order in mixed rows, dates/times/numbers, mixed LTR strings, text inputs, and any statistics/chart labels.

Do not mechanically mirror a layout without checking its meaning. The current navigation explicitly controls physical tab order, and some rows deliberately use `direction: 'ltr'` internally to obtain the intended Hebrew visual arrangement. Test the rendered result rather than inferring correctness from a flex direction alone.

## Responsive brand principles

Mobile-first does not mean stretching mobile cards across desktop. Preserve readable line lengths, clear hierarchy, and calm composition at wider sizes. Use existing `ContentContainer` where appropriate: its reading width is `breakpoints.readingColumn` (640 px) and its wide width is `breakpoints.desktopContent` (1120 px); current breakpoints are phone 599, tablet 899, and desktop 1200.

Use available space to improve grouping and composition, not simply to enlarge components. Tablet/desktop may use intentional multi-column composition where the task benefits, while keeping form content constrained and readable. Detailed viewport rules belong in future `RESPONSIVE_RULES.md`.

## Motion and delight

Motion should be purposeful, short, warm, responsive, and non-distracting. Honor the OS Reduced Motion setting. When mascot motion is intended, animate the character itself with approved assets—not merely a static image container. Current motion tokens are feedback 160 ms, transition 240 ms, emphasis 360 ms, and celebration maximum 2400 ms.

Detailed asset/frame production remains the scope of future `ANIMATION_GUIDELINES.md` and the existing Mascot Specification.

## Imagery and graphics

Future graphics must support the product task and retain brand consistency. Protect mascot identity, maintain suitable source resolution/transparency for the target, and avoid generic stock-like visuals that conflict with the established stylized warm character language. Do not generate replacement mascot artwork casually; clean-up, text removal, and technical corrections use deterministic editing.

## App icon, favicon, and splash

Current Expo configuration uses:

| Path | Current configured role | Verified properties/caveat |
| --- | --- | --- |
| `assets/icon.png` | General Expo app icon | PNG, 1024 × 1024 px, 24-bit RGB. |
| `assets/adaptive-icon.png` | Android adaptive foreground image | PNG, 1024 × 1024 px, 24-bit RGB; config uses `#FBF8F3` background. |
| `assets/favicon.png` | Web favicon | PNG, 1024 × 1024 px, 24-bit RGB. |
| `assets/splash.png` | Expo splash image | PNG, 816 × 941 px, 24-bit RGB; configured `contain` on `#FBF8F3`. |
| `assets/notification-icon.png` | Expo notifications icon | PNG, 96 × 96 px, 32-bit ARGB; notification accent is `#20A7B5`. |

These are current outputs/configured assets, not automatically declared `MASTER` or `APPROVED`. Future small-format icons should prioritize mascot recognition and must not rely on tiny “Walkie Doggy Link” embedded text.

## Accessibility as brand quality

Accessibility is part of visual quality: sufficient contrast, readable text, 44 px-or-larger touch targets, visible state differences beyond color alone, Reduced Motion support, and keyboard/focus treatment for web-relevant controls. Passing a typecheck or unit test is not visual accessibility validation.

## Do and don’t

**Do**

- Use current tokens and shared primitives where they fit.
- Keep Hebrew readable and RTL behavior intentional.
- Use turquoise deliberately and preserve semantic colors.
- Keep family-dog and mascot identities separate.
- Preserve whitespace, soft surfaces, and task hierarchy.
- Inspect real screen appearance, including responsive and accessibility states.
- Design tablet/desktop composition intentionally.

**Don’t**

- Stretch mobile cards edge-to-edge on desktop.
- Hard-code “טופי” as the mascot identity.
- Regenerate or materially alter the mascot casually.
- Replace semantic colors with turquoise.
- Embed unnecessary text inside future mascot assets.
- Invent arbitrary values where reusable tokens exist.
- Approve visual work based only on tests.

## Current brand asset inventory

| Asset | Role | Lifecycle/status established by repository | Caveat |
| --- | --- | --- | --- |
| `assets/branding/walkie-doggy-mascot.png` | Mascot Reference Master | Current authoritative visual reference | 1024 × 1024 ARGB; embeds wordmark; not the pending Clean Master. |
| `assets/branding/walkie-doggy-mascot-clean.png` | Intended Clean Master | Pending; file absent | Do not treat as existing or approved. |
| `assets/branding/walkie-doggy-link-icon-source.jpg` | Related source icon art | No explicit lifecycle state found | 1254 × 1254 JPEG. |
| `assets/branding/walkie-doggy-link-logo-source.jpg` | Related source logo art | No explicit lifecycle state found | 816 × 941 JPEG. |
| `assets/walkie-doggy-link-wordmark*.png` | Separate textual wordmark variants | No explicit lifecycle state found | Both remain active repository assets. |
| `assets/icon.png`, `assets/adaptive-icon.png`, `assets/favicon.png` | Application icon outputs | Configured current assets | Clean-master replacement targets are documented but pending. |
| `assets/splash.png`, `assets/notification-icon.png` | Launch and notification graphics | Configured current assets | No explicit lifecycle state found. |

## Known gaps and inconsistencies

- The Clean Master is missing; current fallback mascot artwork contains embedded wordmark text.
- Final celebration frame packs are missing; the celebration resolver uses an explicit placeholder/fallback.
- Mascot manifest metadata asks for a transparent Clean Master, while the visible Reference Master includes a turquoise rounded-square treatment. This requires explicit production-art direction, not an unapproved interpretation.
- `src/theme/tokens.ts` provides a substantial foundation, but code comments state that not every existing screen was migrated from legacy/ad hoc sizing.
- `ContentContainer` and breakpoint tokens exist, but responsive adoption is incomplete; representative components include some web-specific adjustments rather than a complete desktop system.
- The repository does not provide a custom-font, icon-library, reusable chart, email-design, or comprehensive visual-QA standard to formalize yet.

## Brand QA checklist

Before approving meaningful visual work, verify:

- Brand identity preserved?
- Mascot compliant when used?
- Existing tokens used appropriately?
- Typography hierarchy correct?
- Hebrew/RTL correct?
- Semantic colors meaningful?
- Spacing and surfaces consistent?
- Responsive composition appropriate?
- Accessibility checked?
- Reduced Motion considered?
- Asset lifecycle/status clear?
- Actual visual inspection performed?

## Document boundaries

- **BRAND_BIBLE.md:** overall visual identity and brand-system rules.
- **MASCOT_SPEC.md:** authoritative mascot identity and production protection.
- **PRODUCT_CONTEXT.md:** factual product and workflow knowledge.
- **CREATIVE_AGENT_CHARTER.md:** Creative Director behavior and governance.

Future documents remain intentionally separate:

- **DESIGN_SYSTEM.md:** detailed implementation tokens/components.
- **RESPONSIVE_RULES.md:** viewport/layout behavior.
- **UX_PRINCIPLES.md:** interaction and experience principles.
- **ANIMATION_GUIDELINES.md:** motion production rules.
- **EMAIL_DESIGN.md:** email-specific design.
- **VISUAL_QA_CHECKLIST.md:** detailed validation procedure.

Avoid duplicating detailed mascot, workflow, or implementation rules here when their authoritative document exists.

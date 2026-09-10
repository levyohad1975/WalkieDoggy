# External Professional Design Sources

## Purpose

This policy defines where the Walkie Doggy Link Creative Director obtains external professional knowledge, when to consult it, and how to weigh it. It is not a snapshot of design advice. When a decision depends on evolving platform behavior, accessibility requirements, store requirements, framework capability, or standards, consult current authoritative guidance.

## Authority hierarchy

Use sources in this order:

1. **`AGENTS.md`** — repository safety, security, production, Supabase, testing, commits, push, and deployment.
2. **Approved Walkie Doggy Link documentation** — project/product, brand, mascot, and approved design decisions.
3. **Applicable accessibility standards** — especially W3C/WCAG for web accessibility.
4. **Official platform design guidance** — Apple for Apple platforms; Android and Material guidance for Android.
5. **Official implementation/framework documentation** — Expo, React Native, and relevant web standards.
6. **High-quality UX research** — evidence and research, not a mandatory platform standard.
7. **Inspiration sources** — lowest authority; never override usability, accessibility, platform requirements, or approved brand rules.

External best practices advise. Approved project-specific design decisions decide within their domain unless they conflict with higher-priority safety, accessibility, or platform requirements.

## Apple design

Primary source: [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/).

Use current Apple guidance for iOS/iPadOS interaction, layout, navigation, typography, color, icons, motion, accessibility, RTL, platform conventions, input methods, and adaptive/window behavior. For specialized accessibility work, also use [Apple HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

Consult current Apple guidance whenever the decision is platform-dependent; do not freeze today’s HIG details into permanent project assumptions.

## Web accessibility

Primary normative source: [W3C Web Accessibility Initiative / WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/).

Use the latest stable WCAG recommendation unless project or legal requirements mandate another version. WCAG 2.2 is the relevant recommendation when this document was created; verify its current status for future standards-sensitive work.

Apply it to contrast, keyboard access, focus, target sizing, input/error behavior, motion, forms, authentication accessibility, non-color-only communication, and perceivable/operable/understandable/robust UI. WCAG is not merely optional visual advice.

## Android and Material

Primary sources: [Android Developers](https://developer.android.com/) and [Material Design](https://m3.material.io/).

Use current guidance for Android interaction conventions, adaptive/large-screen layouts, touch ergonomics, navigation, components, typography, motion, accessibility, and Android-specific behavior. Large-screen design should adapt or recompose—not simply stretch mobile UI.

## Expo

Primary source: [Expo documentation](https://docs.expo.dev/).

Use it for Expo-supported platform behavior, asset handling, fonts, splash/icon configuration, routing/platform behavior where applicable, notifications, and web/native implementation constraints. Expo is an implementation authority, not Walkie Doggy Link’s visual-identity authority.

## React Native

Primary source: [React Native documentation](https://reactnative.dev/docs/getting-started). Specialized source: [React Native accessibility](https://reactnative.dev/docs/accessibility).

Use these sources for cross-platform component behavior, accessibility APIs, platform differences, layout/interaction constraints, and native accessibility semantics. Identical React Native code does not guarantee identical or optimal UX on every platform.

## Web platform

For web standards and browser behavior, prefer W3C and WHATWG specifications. Use [MDN Web Docs](https://developer.mozilla.org/) when practical implementation guidance is useful.

Use these sources for HTML semantics, CSS/layout, browser accessibility, responsive web behavior, PWA/browser capabilities, and Web APIs. Prefer the actual standard/specification for normative questions when practical.

## UX research

Preferred research source: [Nielsen Norman Group](https://www.nngroup.com/).

Use it for UX research, usability evidence, interaction patterns, information architecture, forms, and cognitive/usability considerations. It is a **research source**, not a normative standard. Do not automatically apply general research advice when product context, accessibility, or platform requirements justify another solution.

## RTL and internationalization

Consult current RTL/internationalization guidance from Apple HIG, Android guidance, W3C Internationalization resources, and React Native documentation when implementation-specific.

Walkie Doggy Link is Hebrew/RTL-first. Never copy external LTR examples mechanically. Evaluate reading order, leading/trailing semantics, directional icons, chevrons/arrows, mixed Hebrew/English, numbers, dates, times, forms, charts, and data visualization.

## Motion and Reduced Motion

Use current Apple and Android accessibility/motion guidance, WCAG where applicable, and current framework/platform APIs. Walkie Doggy Link’s `MASCOT_SPEC.md` and future `ANIMATION_GUIDELINES.md` remain authoritative for mascot identity and brand-specific motion; external guidance informs accessibility and platform behavior.

## App icons and store assets

For production app/store assets, consult current official Apple Developer/App Store Connect requirements, Android Developers/Google Play requirements, and Expo configuration documentation. Never rely solely on an old local pixel-size requirement. Verify current requirements before producing final store assets.

## Email design

For email work, distinguish visual brand rules, HTML-email/client compatibility, accessibility, and deliverability/provider constraints. Prefer authoritative provider/platform documentation for technical requirements. This policy does not choose an email implementation stack; future project-specific rules belong in `EMAIL_DESIGN.md`.

## Source freshness

Before deciding based on current OS behavior, browser support, Expo/React Native capability, accessibility standards, App Store/Google Play requirements, or email-client capability, consult the current authoritative source. Do not rely only on model memory or a historical copy of this policy. Record material version/date assumptions in the design report.

## Research quality

Classify every consulted source as:

- **NORMATIVE / OFFICIAL** — standards, platform requirements, or official documentation.
- **RESEARCH** — credible evidence that informs, but does not mandate, a decision.
- **INSPIRATION** — examples used only for creative exploration.

Prefer primary sources. Random blogs, SEO articles, generated galleries, Dribbble/Behance concepts, and social-media opinions are not authoritative evidence; use them only as appropriate inspiration.

## Conflict resolution

- If a visual trend conflicts with WCAG, accessibility wins.
- If generic UX research conflicts with an explicit platform requirement, the platform requirement wins.
- If generic platform styling differs from Walkie Doggy Link branding but both remain usable and accessible, approved project branding may remain.
- If a generative image suggestion conflicts with `MASCOT_SPEC.md`, the Mascot Specification wins.
- If any design instruction conflicts with `AGENTS.md`, `AGENTS.md` wins.

## Research reporting

For substantial design research, report the question researched, authoritative sources consulted, source classification, relevant platform/version/date where material, conclusion, project-specific decision, and unresolved uncertainty. Do not bury external assumptions inside implementation.

## Document boundary

`EXTERNAL_DESIGN_SOURCES.md` defines where external professional knowledge comes from and its authority. It does not replace `BRAND_BIBLE.md`, `MASCOT_SPEC.md`, `PRODUCT_CONTEXT.md`, `CREATIVE_AGENT_CHARTER.md`, or future `DESIGN_SYSTEM.md`, `RESPONSIVE_RULES.md`, `UX_PRINCIPLES.md`, `ANIMATION_GUIDELINES.md`, `EMAIL_DESIGN.md`, and `VISUAL_QA_CHECKLIST.md`.

# Design system sync (Claude Designer → this repo)

A user iterates on the brand / UI in **Claude Designer** (claude.ai/design), exports a handoff bundle, and hands the bundle URL to **Claude Code**. The agent then has to reflect any new design tokens in this codebase. This doc is the standing operating procedure for that hand-off so each round is mechanical rather than re-derived.

> Inputs an agent typically gets:
> 1. A URL like `https://api.anthropic.com/v1/design/h/<hash>`. The body is a **gzipped tarball** of an `itinly-design-system/` folder — not human-readable JSON. Save it locally and `tar -xzf`.
> 2. A short instruction, usually: _"implement the designs using variables/tokens, not hardcoded styles."_

## What's in the bundle

```
itinly-design-system/
├── README.md              # high-level brand context — read first
├── chats/chat1.md         # full back-and-forth with the user. Skim user
│                          # turns to learn what they actually changed.
└── project/
    ├── README.md          # detailed token, voice, and component spec
    ├── colors_and_type.css  # ★ the source-of-truth for token values
    ├── preview/*.html     # per-token visual previews (open if uncertain)
    └── ui_kits/{web,mobile}/  # high-fidelity React/HTML recreations
```

The one file that drives code-side change is **`project/colors_and_type.css`**. It's checked into this repo verbatim at [`apps/web/src/app/design-tokens.css`](../apps/web/src/app/design-tokens.css). The README files describe the intent so you know **why** something changed.

## Architecture

```
apps/web/src/app/
├── design-tokens.css       ← bundle file, dropped in BYTE-FOR-BYTE.
│                             DO NOT hand-edit. Replace its body to update.
└── globals.css             ← imports design-tokens.css; adds Tailwind
                              setup, ShadCN tokens not in the design
                              system, dark-mode lifts for segment tokens,
                              and app-only CSS (timeline grid, print).
```

Components reference the design-system tokens by name (`var(--seg-flight-fg)`, `text-primary`, etc.). They never reference Tailwind 50/600 hex utilities for brand or segment colors.

## The procedure

### 1. Fetch + extract the bundle

```bash
# WebFetch saves the response as a .bin (it's gzip-compressed).
# Re-route to a tempdir and extract:
mkdir -p /tmp/itinly-design && cd /tmp/itinly-design
cp <path-to-saved-.bin> design.tar.gz
tar -xzf design.tar.gz
```

### 2. Read for context

Open in this order, skim the user-side turns to know what they actually changed:

1. `itinly-design-system/README.md` — bundle handoff guidance
2. `itinly-design-system/project/README.md` — token + voice spec
3. `itinly-design-system/chats/chat1.md` — `grep "^## User"` to find the user's intent

### 3. Drop the new tokens in

```bash
cp /tmp/itinly-design/itinly-design-system/project/colors_and_type.css \
   apps/web/src/app/design-tokens.css

# Two `@import url(...)` lines in the bundle file load Inter and the
# Twemoji flag polyfill from CDNs. Production loads both elsewhere
# (next/font/google + providers.tsx). Strip those two lines from the
# top of the file with a single sed before committing:
sed -i '' '/@import url(/d' apps/web/src/app/design-tokens.css

# Same for the `.itinly { ... }` element-style block (production uses
# Tailwind utilities, not a `.itinly` wrapper). If you copy a fresh
# bundle, hand-strip lines from `.itinly { ` through the last
# `.itinly .kicker { ... }` rule.
```

### 4. Read the diff

```bash
git diff -- apps/web/src/app/design-tokens.css
```

Every line of diff is **either a new token to plumb through OR a value
change to verify**. Categorise:

- **Added token:** find a consumer that needs it (or note it as
  "available, not yet used" in the PR body).
- **Changed value:** if the token is one that's already referenced by
  many components (`--primary`, `--brand`), no code change required —
  the components will pick up the new value automatically. Verify in
  preview.
- **Removed token:** rare. If a token disappears from the bundle but a
  component still references it, either restore it as an app-extension
  in `globals.css` or update the consumer.

### 5. Find token consumers

The two long-running places where segment-type colors are consumed:

- [`apps/web/src/components/itinerary-day.tsx`](../apps/web/src/components/itinerary-day.tsx) (`SEGMENT_CONFIG`)
- [`apps/web/src/components/mobile/mobile-segment-card.tsx`](../apps/web/src/components/mobile/mobile-segment-card.tsx) (`SEGMENT_CONFIG`)

Search broadly for hardcoded hex / Tailwind-50/600 utilities in component code that should now reference a token:

```bash
# Hardcoded hex in components
grep -rn "#[0-9A-Fa-f]\{6\}" apps/web/src/components apps/web/src/app

# Tailwind 50/600 segment-color utilities
grep -rnE "(text|bg|border-l)-(blue|indigo|sky|amber|red|purple|orange|green|pink|lime|teal|cyan)-(50|500|600)" apps/web/src/components
```

### 6. Lint + typecheck

```bash
cd apps/web
pnpm lint            # zero warnings, zero errors
npx tsc --noEmit
```

### 7. Verify in preview

Open a trip detail page, query computed colors on segment-row icons, and confirm they match the new token hex values. The fastest verification:

```js
// In browser devtools or via preview_eval
[...document.querySelectorAll('[class*="group/seg"]')].slice(0, 8).map(row => ({
  label: row.querySelector('.font-medium')?.textContent?.slice(0, 25),
  color: getComputedStyle(row.firstElementChild).color,
}))
```

Repeat with `document.documentElement.classList.add('dark')` to verify dark mode.

### 8. Update CLAUDE.md if a new category landed

If the bundle introduces a new token category (e.g. segment colors became a thing in the 2026-05-04 sync), add a corresponding section to [`CLAUDE.md`](../CLAUDE.md) under **Brand palette**.

### 9. Open a PR

Title: `design: sync <what changed>`. Body should call out:

- Bundle hash (the URL the user provided)
- Token-by-token diff summary
- Surfaces verified in preview
- Any leftover follow-ups (e.g. "the design system added a `--shadow-card` token; not yet referenced in components — separate PR.")

## Conventions to keep

- **Tokens beat utilities.** When a Tailwind utility (`bg-blue-50`) maps to a brand or segment token, use the token. Token churn happens; utility churn means hunting through every component.
- **Both modes always.** Every brand / surface / segment token must be legible in dark mode. The bundle's `.dark` block covers brand + surface; dark-mode segment lifts currently live in `globals.css` until the design system formalises them.
- **Don't hand-edit `design-tokens.css`.** Add app-layer extensions (ShadCN-only tokens, missing segment types, dark-mode lifts) to `globals.css` instead, with a comment saying "remove when the design system grows to include this."
- **Comments explain the role.** Each token in `design-tokens.css` carries a short comment explaining where it's used. The bundle's CSS is the source-of-truth for values; the comments are the source-of-truth for intent.
- **No drive-by hex.** If a hex appears in component code, it should be a token reference. The exception is the brand-mark SVG paths in `app-logo.tsx` / `app-wordmark.tsx`, which ship literal hex per the design spec.

## What's been synced

| Date | Bundle | Token categories added/changed |
|---|---|---|
| 2026-05-04 | `XFMQMKA_Ssb4sFP82UlDHg` | Initial drop-in. `colors_and_type.css` checked in verbatim at `design-tokens.css`. New `--seg-{type}-{rail,bg,fg}` trio for the 8 design-system canonical types; 5 product extensions (`transport, show, brunch, tour, cruise`) live in `globals.css` until the design system grows. Refactored `SEGMENT_CONFIG` in `itinerary-day.tsx` and `mobile-segment-card.tsx` from Tailwind 50/600 classes to `var(--seg-…)` references. |

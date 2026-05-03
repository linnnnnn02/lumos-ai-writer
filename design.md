# UI Design Language

## Purpose

This file defines the default visual language for every UI in this repository, including:

- `web`
- `extension/entrypoints/popup`
- `extension/entrypoints/options`

The style is derived from the reference image provided in this thread: a light, premium, AI-product dashboard aesthetic with soft data cards, generous whitespace, warm orange emphasis, and restrained rainbow gradients.

Do not copy the reference layout literally. Reuse its design grammar.

## Design Intent

Build interfaces that feel:

- calm, bright, and high-confidence
- data-capable without looking enterprise-heavy
- soft and premium instead of loud or glassy-for-the-sake-of-glass
- structured by cards, pills, and whitespace rather than dark dividers

The UI should read as "clean AI workspace" instead of "developer tool" or "consumer social app."

## Core Principles

1. Keep the canvas light.
Use warm white or pale stone backgrounds with extremely subtle gradient atmosphere.

2. Let accent color do only one job at a time.
Orange is for action, focus, and highlighted metrics. Do not flood entire screens with orange.

3. Prefer soft containers over hard separators.
Sections should be grouped by rounded cards, tonal surface shifts, or spacing instead of heavy borders.

4. Make density feel intentional.
Information can be rich, but every block should have breathing room, a clear title, and a single visual priority.

5. Use gradients sparingly and strategically.
Gradient is for hero CTAs, featured chips, important stats, and illustration surfaces, not every button or card.

## Color System

### Foundation

- Background base: `#f2f0eb`
- Background glow: `#fffaf4`
- Primary surface: `rgba(255, 255, 255, 0.84)`
- Secondary surface: `rgba(255, 248, 241, 0.92)`
- Elevated surface: `#ffffff`
- Hairline border: `rgba(31, 22, 17, 0.08)`

### Text

- Primary text: `#171311`
- Secondary text: `#6d645d`
- Soft text: `#93877d`

### Accent

- Accent orange: `#f07a2f`
- Accent orange deep: `#c95d1d`
- Accent orange wash: `#fff0e5`

### Supporting Gradient

Use this family only on premium actions and featured highlights:

- Sky: `#67c7ff`
- Blush: `#efb6d0`
- Apricot: `#ffb06a`

Recommended gradient:

```css
linear-gradient(90deg, #67c7ff 0%, #efb6d0 44%, #ff9550 100%)
```

## Typography

### Character

- Headlines should feel geometric, crisp, and confident.
- Body copy should stay neutral, readable, and slightly warm.

### Practical Stack

- Display: `"Space Grotesk", "SF Pro Display", "PingFang SC", sans-serif`
- Body: `"Instrument Sans", "SF Pro Display", "PingFang SC", sans-serif`

### Scale

- Hero title: `48-72px`, tight tracking, line-height around `0.95-1.05`
- Section title: `28-40px`
- Card title: `16-22px`
- Body: `14-18px`
- Eyebrow: `11-12px`, uppercase, wide letter spacing

### Rules

- Use high-contrast large headlines.
- Avoid long paragraphs in dense cards.
- Use muted text for explanation, never for key labels or actions.

## Layout

- Max content width should feel editorial and centered.
- Use large outer padding on desktop and comfortable padding on compact panels.
- Prefer asymmetric but balanced layouts: one strong content block paired with several lighter support cards.
- Maintain generous vertical rhythm between sections.

## Surfaces

### Card Language

- Large feature cards: `28-36px` radius
- Standard cards: `20-24px` radius
- Pills and chips: fully rounded
- Shadows should be broad and soft, never sharp or dark

Recommended shadow direction:

```css
0 20px 60px rgba(48, 34, 22, 0.08)
```

### Surface Hierarchy

1. Page atmosphere
2. White or off-white cards
3. Soft featured cards with warm tint
4. Highlight metrics using orange or gradient emphasis

## Components

### Buttons

- Primary buttons should be pill-shaped.
- Primary CTA may use the signature blue-pink-orange gradient.
- Secondary buttons should be white or translucent white with a light border.
- Avoid squared buttons and heavy dark fills.

### Inputs

- Rounded `14-18px`
- White translucent fill
- Very light border
- Focus should use soft orange or mixed-gradient glow, not hard browser blue

### Chips

- Use for tags, counts, step labels, and state grouping
- Keep them compact and airy
- Prefer tonal backgrounds over outlined-only chips

### Metrics and Snippets

- Metric cards should have one dominant number or title
- Supporting context should remain muted
- Mini visualizations can sit inside pale feature blocks

## Motion

- Use gentle hover lift and shadow bloom
- Keep transitions in the `160-240ms` range
- Avoid bouncy or playful motion
- UI should feel polished, not animated for attention

## Product Mapping

### Web

- Treat the top header as a hero surface, not a plain app bar
- Step screens should feel like a sequence of premium workboards
- Analysis, plan, and rewrite areas should use layered cards and soft featured panels

### Popup

- The popup is a compact control cockpit
- Use fewer visual dividers and stronger card grouping
- Important actions should still feel premium despite the small canvas

### Options

- The options page should read like a lightweight operations dashboard
- Sidebar, note list, and detail panel should share the same card family
- Dense management areas still need air and hierarchy

## Do

- Use whitespace as structure
- Keep text dark and sharp
- Use orange as a precise emphasis tool
- Reserve gradient for premium emphasis
- Prefer frosted white layers over beige blocks when in doubt

## Do Not

- Do not use dark UI by default
- Do not overuse saturated orange backgrounds
- Do not mix many unrelated accent colors
- Do not use harsh shadows, thick borders, or boxy corners
- Do not collapse everything into generic SaaS blue

## Implementation Rule

For any new UI work in this repository:

1. Start from the tokens and rules in this file.
2. Reuse the established surface, button, and spacing language before inventing a new pattern.
3. If a screen needs to diverge, update this file first so the change becomes a deliberate system decision.

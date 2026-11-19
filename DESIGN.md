---
name: Recap Page
description: A vivid, source-first comic index with a purple identity.
colors:
  page: "#fbf9ff"
  surface: "#ffffff"
  surface-strong: "#f0eaff"
  surface-muted: "#e8e1f1"
  text: "#20172b"
  muted: "#51465d"
  line: "#786b85"
  accent-purple: "#6124b8"
  accent-ink: "#ffffff"
  wayfinding-blue: "#174ca6"
  wayfinding-red: "#b82035"
  opening-purple: "#482080"
  opening-muted: "#f0e4ff"
  source-background: "#17111f"
  source-panel: "#241a30"
  source-text: "#ffffff"
  source-muted: "#e1d7ec"
  source-link: "#d7baff"
  mcu-background: "#321656"
  mcu-text: "#ffffff"
  mcu-muted: "#edddff"
  tour-surface: "#ffffff"
  tour-ink: "#20172b"
  tour-muted: "#51465d"
  tour-line: "#675a74"
  focus-ink: "#241536"
  focus-ring: "#ffffff"
  mask-opaque: "#000"
  action-ink: "#38115f"
  action-ink-hover: "#291044"
  control-ink: "#342640"
  red-marker-ink: "#5b1021"
  action-purple-hover: "#4f199a"
  source-border: "#9a8aa8"
  dark-focus-border: "#9c67e9"
typography:
  display:
    fontFamily: '"Franklin Gothic Medium", "Arial Narrow", "Trebuchet MS", sans-serif'
    fontSize: "clamp(2.8rem, 6vw, 5.75rem)"
    fontWeight: 950
    lineHeight: 1.12
    letterSpacing: "-0.065em"
  headline:
    fontFamily: '"Franklin Gothic Medium", "Arial Narrow", "Trebuchet MS", sans-serif'
    fontSize: "clamp(2rem, 4vw, 3.4rem)"
    fontWeight: 900
    lineHeight: 1.12
    letterSpacing: "-0.055em"
  body:
    fontFamily: 'Aptos, "Segoe UI", Arial, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: '"Cascadia Code", Consolas, monospace'
  scale:
    micro: "0.725rem"
    caption: "0.75rem"
    label: "0.8rem"
    label-strong: "0.825rem"
    label-wide: "0.85rem"
    body-small: "0.875rem"
    body-compact: "0.9rem"
    navigation: "0.9375rem"
    body-large: "1.05rem"
    body-emphasis: "1.1rem"
    body-display: "1.125rem"
    title-small: "1.2rem"
    title-compact: "1.25rem"
    title: "1.3rem"
    title-wide: "1.35rem"
    title-large: "1.5rem"
    title-mcu: "1.55rem"
    title-feature: "1.6rem"
    title-display: "1.75rem"
    display-small: "1.8rem"
    display-medium: "2.2rem"
    display-large: "2.25rem"
    display-wide: "2.6rem"
    display-hero: "2.75rem"
    display-feature: "3.5rem"
    display-banner: "4.3rem"
rounded:
  control: "0.25rem"
  panel: "0.75rem"
spacing:
  space-1: "0.375rem"
  space-2: "0.75rem"
  space-3: "1rem"
  space-4: "1.5rem"
  space-5: "2rem"
  space-6: "3rem"
  space-7: "4.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-purple}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1.5rem"
    height: "3rem"
---

# Design System: Recap Page

## Overview

**Creative North Star: "The Sourced Comic Index"**

The page uses Recap Page's established purple identity to frame real reading paths as an organized, browsable index. Large condensed headings, comic-weight borders, and selective blue and red markers create energy without turning the interface into a costume. White space separates the evidence and actions so the page remains legible as it moves between feature explanations and interactive examples. The direction is expressed in the page contract and stylesheet. `pages/index.html:3-6` `pages/site.css:256-285`

**Key Characteristics:**
- Purple is the structural brand color.
- Framed panels and squared controls carry the comic language.
- Blue and red are sparse wayfinding accents.
- Light and dark color schemes share the same hierarchy.

## Colors

The light palette pairs warm lavender-white surfaces with deep purple structure, dark plum text, and distinct blue and red wayfinding accents. The opening and feature sections use denser purple or dark surfaces to create contrast with the white reading panels. `pages/site.css:1-24` `pages/site.css:256-268` `pages/site.css:780-839`

### Primary
- **Recap Purple** (`#6124b8`): Primary actions, selected states, and navigation emphasis.
- **Opening Purple** (`#482080`): The opening section's full-width field.

### Secondary
- **Wayfinding Blue** (`#174ca6`): Timeline markers and links.
- **Wayfinding Red** (`#b82035`): A sparse orientation accent. The embedded app guide uses the app's theme-aware red divider instead.
- **Action Ink** (`#38115f`): Dark foreground for white primary buttons, deepened on hover.
- **Control Ink** (`#342640`): Text on compact demo controls.
- **Marker Ink** (`#5b1021`): Text inside the red-framed demo step marker.
- **Source Plum** (`#17111f`): The dedicated section for guide provenance, with a lighter plum panel.
- **MCU Plum** (`#321656`): The MCU Prep example surface.

### Neutral
- **Lavender White** (`#fbf9ff`): Main page background.
- **White** (`#ffffff`): Reading surfaces, controls, and proof panels.
- **Deep Plum** (`#20172b`): Main text and high-contrast ink.
- **Muted Plum** (`#51465d`): Secondary text on light surfaces.
- **Lavender Gray** (`#e8e1f1`): Muted surface and dividers.
- **Mauve Line** (`#786b85`): Borders and separators.

### Named Rules

**The Wayfinding Rule.** Keep blue and red on specific links, timeline marks, and the demo step marker. Purple remains the primary interface accent.

## Typography

**Display Font:** Franklin Gothic Medium, Arial Narrow, Trebuchet MS, sans-serif

**Body Font:** Aptos, Segoe UI, Arial, sans-serif

**Character:** Condensed system headings bring a direct editorial voice; the neutral sans-serif body face stays comfortable for long explanations and controls. The page uses system fonts rather than downloading a typeface. `pages/site.css:81` `pages/site.css:311-321`

### Hierarchy
- **Display** (950, `clamp(2.8rem, 6vw, 5.75rem)`, 1.12 line-height): Main opening statement.
- **Headline** (900, `clamp(2rem, 4vw, 3.4rem)`, 1.12 line-height): Major section titles.
- **Title** (850, about 1.2rem to 1.75rem): Demo, feature, and panel titles.
- **Body** (400, 1rem, 1.6 line-height): Explanations and practical details.
- **Label** (750 to 850, usually 0.75rem to 0.9rem): Navigation, controls, and status markers.

**The Headline Rule.** Let the heading carry the hierarchy. Do not add a decorative eyebrow above it.

## Layout

Content sits in a centered shell capped at 76rem with 1.5rem minimum side gutters. The opening is an unequal two-column spread, with the direct introduction beside the guided reading demo. It collapses to a single column at narrower widths, and the page continues as a sequence of text-and-proof layouts with native disclosure examples. The spacing scale runs from 0.375rem to 4.5rem; section separation is generous, while controls and related copy stay compact. Supporting sections use a brief scroll-linked entrance only when the browser supports it and reduced motion is not requested. `pages/site.css:31-38` `pages/site.css:126-128` `pages/site.css:280-285` `pages/site.css:1540-1569` `pages/site.css:1708-1713`

## Elevation & Depth

Most surfaces use flat tonal layering and visible borders rather than floating cards. The guided demo gets the one prominent offset shadow so it reads as the working example in the opening; keyboard focus uses a separate high-contrast ring. `pages/site.css:120-122` `pages/site.css:403-409`

**The Framed-First Rule.** Use borders and surface contrast for structure. Reserve shadows for the hero demo and use focus rings only to communicate interaction.

## Shapes

The form language is mostly square: a 0.25rem corner radius for controls, links, and disclosure panels, with a 0.75rem radius reserved for the guided demo. Frames are crisp 2px or 4px strokes. Do not soften the panels into generic rounded cards. `pages/site.css:39-41` `pages/site.css:349-359` `pages/site.css:403-409`

## Components

Interactive elements are tactile and explicit, with border weight, color, and clear state changes carrying most of their character.

### Buttons
- **Shape:** 0.25rem corners.
- **Primary:** Purple fill, white text, 0.75rem by 1.5rem padding, and a 3rem minimum height.
- **Hover / Focus:** A small lift on hover; retain the shared high-contrast focus ring.
- **Secondary:** Transparent or outlined against the surrounding surface.

### Cards / Containers
- **Corner Style:** 0.25rem for feature examples and proof panels; 0.75rem for the guided demo.
- **Background:** White or tonal lavender, with deep purple reserved for the opening, source, and MCU Prep examples.
- **Shadow Strategy:** Mostly flat; the guided demo is the single prominent raised panel.
- **Border:** Use a strong dark frame for hero examples and a muted line for supporting panels.
- **Internal Padding:** 0.75rem for compact examples, 1rem to 1.5rem for larger panels.

### Inputs / Fields
- **Style:** Native select controls with a 2px border, white or page-colored background, and 0.25rem corners.
- **Focus:** The shared 0.2rem outline and offset focus ring.
- **Disabled:** Reduce opacity and show a not-allowed cursor.

### Navigation
- **Style:** Compact system sans-serif links aligned with the wordmark. Hover, focus, and current-page states use purple emphasis and an underline. The navigation wraps at narrow widths.

### Guided App Tour

The actual app's Library and reading view run inside a scripts-only sandbox with temporary sample data. A sticky guide explains the current step, highlights its target, and offers reset and installation actions. Its red divider and purple target outline use the app's theme tokens. The app keeps its own typography, layout, and theme rather than inheriting the project's promotional styling. `pages/demo.css:2-10` `pages/demo.css:12-30`

## Do's and Don'ts

### Do:
- **Do** keep purple as the dominant accent and use blue and red to orient readers.
- **Do** preserve visible borders, crisp panel geometry, and generous separation between sections.
- **Do** keep the reduced-motion, dark-mode, forced-color, and keyboard-focus treatments intact. `pages/site.css:45-62` `pages/site.css:120-122` `pages/site.css:1679-1713` `pages/site.css:1718-1762`

### Don't:
- **Don't** use rounded-card grids as the default page structure.
- **Don't** use gradients or shadows as decoration.
- **Don't** add a downloaded font or use monospace as a visual costume.

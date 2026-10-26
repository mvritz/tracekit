# Dashboard visual design

The dashboard was restyled from the user's [Glassy Dashboard V2 video reference](https://www.instagram.com/p/De6yRJZTglH/). The observed composition uses a warm interior behind a frosted workspace, a floating header and compact icon rail, rounded translucent cards, mint highlights, a bar chart, and a recent-activity table. The video, rather than its caption's theme description, is the visual source of truth.

Helvetica/Swiss typography supplies a compact hierarchy. The user's explicit request for the video's glass surfaces, rounded cards, photographic backdrop, and mint palette takes precedence over the frontend-design skill's flat Swiss surface defaults.

## Structure and behavior

- Floating pill header and icon rail; on mobile the rail becomes a horizontal navigation bar.
- One large execution-time card, four compact run metrics, and a duration/span bar chart.
- Completeness card, record/replay shortcuts, and the searchable trace table below.
- Six real runs per page. Metrics, completeness, chart values, and shortcuts use those runs and are explicitly scoped to the page.
- Chart bars open their trace. The chart selector switches between measured duration and span count. Segmented controls update the existing mode filter.
- The waterfall, inspector, setup, and comparison views use the same material, typography, colors, and accessible focus states.
- Cards enter with a brief fade, blur, and upward movement; hover lifts cards. Reduced-motion preferences disable motion. Translucent surfaces have enough light backing to retain text contrast.

No sample revenue, fake trend percentages, user identities, or decorative telemetry were added. The screenshot content comes from actual executions of the offline demo and regression workflows.

## Original backdrop

Final asset: `apps/dashboard/public/images/workspace-room.webp` (111 KiB). Generated with the built-in `image_gen` tool and encoded as WebP for local use. It is bundled with the dashboard; no external image request is needed at runtime. The reference's media and source code are not redistributed.

Final generation prompt:

> Use case: photorealistic-natural. Asset type: background photograph for a frosted-glass web dashboard. Create a wide landscape 16:9 photograph of a quiet warm contemporary home office/living room. Soft taupe plaster walls, dark charcoal central wall recess, natural walnut horizontal shelves and pale oak desk, large off-white linen curtain and daylight window at the right, restrained soft warm lighting, a small ceramic cup on the desk near the lower left, a subtle green plant at the left edge. Wide straight-on view from desk height. The center of the image should be visually quiet with broad material tones so translucent interface panels can be layered over it. Architecture and room only, no people, no screens, no computers, no UI, no text, no logos. Premium calm architectural interior photography with realistic wood and warm neutral stone, soft depth of field, low contrast, afternoon light. Composition is wide with the desk along the bottom edge; dark neutral area behind center; bright diffuse light at the far right. This is an original asset, not a UI screenshot.

## Verification

The existing component, context, contract, Rust, and browser suites remain applicable. Browser checks cover the new chart selector, synchronized mode controls, viewport overflow, and mobile header position, alongside existing keyboard selection, fixture export, failure inspection, comparison, safe text rendering, offline behavior, and automated WCAG A/AA checks. Actual updated screenshots are in `docs/screenshots/`.

The stored browser benchmark predates this redesign and is explicitly labeled as a historical baseline. Re-run it before making any new UI performance claim.

# Dashboard visual design

The dashboard retains the floating header, compact icon rail, rounded bento cards, and mint accents from the original [video reference](https://www.instagram.com/p/De6yRJZTglH/). The user's subsequent direction replaces the photograph and glass blur with a dark color and a subtle transition. This explicit direction takes precedence over the frontend-design skill's anchor surface defaults.

## Palette and material

- Static diagonal gradient: charcoal `#101512` through forest `#19231d` to `#1d2b23`.
- Opaque `#18211c` workspace and `#202a24` cards, restrained `#354338` borders, light `#e6eee7` text, and mint `#a6d4b6` focus/selection accents.
- Helvetica Neue hierarchy and tabular numerals; monospace for IDs, durations, and code.
- No background image, backdrop filters, entrance blur, decorative shadows, or continuous animations. Color transitions are brief and respect reduced-motion preferences.

The original 111 KiB generated interior image has been removed from the shipped assets. No reference media is redistributed and no external assets are fetched at runtime.

## Structure and behavior

The header floats above a rounded workspace. Three distinct sidebar navigation icons represent traces (pulse), replay comparison (branch), and setup (terminal). On mobile they become a horizontal rail. Source code is linked separately at the rail's end.

One execution-time card, four run metrics, a duration/span chart, a completeness card, record/replay shortcuts, and a searchable table use the six actual runs on the current page. Chart bars open their trace. Metrics remain explicitly scoped to this page; no fabricated trends or identities are shown.

The waterfall mounts visible rows plus four overscan rows on either side in a 500px scroll viewport. All span data remains available for folding, error propagation, selection, and keyboard Home/End/arrow navigation. Deep hierarchies cap indentation at 32 levels without hiding deeper spans. The inspector distinguishes captured null, disabled capture, undefined callbacks, and literal marker strings; older ambiguous captures retain their raw preview.

## Verification

Browser tests cover desktop/mobile overflow, chart controls, keyboard navigation through unmounted rows, late-arriving spans, unchanged completed-trace polling, privacy output, fixture export, failures, replay comparison, XSS text rendering, outages, and automated WCAG A/AA checks. Screenshots in `docs/screenshots/` show real local demo and regression executions. See [measured browser results](benchmarks.md#browser) for before/after samples and their limits.

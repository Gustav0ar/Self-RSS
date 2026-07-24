# Browser and accessibility coverage

`desktop-chromium` runs the complete E2E suite. `mobile-chrome`, `firefox`, and
`webkit` run only `browser-matrix.e2e.spec.ts`, keeping worker/cooldown and other
long-running scenarios on Desktop Chromium.

The axe checks cover stable login, empty onboarding, populated reader,
preferences, and feed-management states. They fail on serious or critical
violations and attach the complete axe result to the Playwright test result.

Reviewed axe exceptions: none. No axe rules or page regions are disabled. If a
future exception is unavoidable, scope it to the specific rule and state,
document the reason here, and retain coverage for the rest of the page.

Automated axe and cross-browser checks complement, but do not replace, manual
keyboard, screen-reader, zoom/reflow, and mobile-device QA.

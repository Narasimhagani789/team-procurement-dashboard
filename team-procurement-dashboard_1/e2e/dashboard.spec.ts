/**
 * End-to-end flows for the Team Procurement Dashboard.
 *
 * These tests target the deployed app (see playwright.config.ts for BASE_URL)
 * and rely on the specific mock data in src/lib/fusion-service.ts:
 *   - 12 requisitions total
 *   - 5 reportees (Harsh, Gani, Narasimha, Deepak, Vishal)
 *   - 3 Business Units (India Operations, US Operations, Singapore Services)
 *   - 2 rows where "Gaurav" is the current approver: REQ-10501, REQ-10518
 *   - 1 on-hold row: REQ-10508
 *   - 1 row with change order pending: REQ-10387
 *   - 1 row stuck 15+ days: REQ-10466
 *   - 1 closed row: REQ-10429
 *
 * If you edit that mock data, these expectations need updating in lockstep.
 */

import { test, expect, type Page } from "@playwright/test";

// Helpers --------------------------------------------------------------------

async function goHome(page: Page) {
  await page.goto("/");
  // Wait for the initial data fetch to populate (180ms simulated latency)
  await expect(page.getByText(/All reportees/i)).toBeVisible();
}

async function dismissDemoBannerIfPresent(page: Page) {
  const banner = page.getByText(/running on mock data/i);
  if (await banner.isVisible().catch(() => false)) {
    await page
      .getByRole("button", { name: /dismiss demo notice/i })
      .click();
    await expect(banner).not.toBeVisible();
  }
}

// ---------------------------------------------------------------------------
// Flow 1: initial page load renders the expected top-level structure
// ---------------------------------------------------------------------------
test("1. loads and renders all major sections", async ({ page }) => {
  await goHome(page);

  await expect(
    page.getByRole("heading", { name: /team procurement/i }),
  ).toBeVisible();

  // Demo banner is visible on fresh load
  await expect(page.getByText(/running on mock data/i)).toBeVisible();

  // All 5 stage tiles
  for (const label of [
    "Pending Approval",
    "Needs Fix",
    "With Buyer",
    "In Receiving",
    "Complete",
  ]) {
    await expect(page.getByText(label).first()).toBeVisible();
  }

  // Aging board title
  await expect(page.getByText(/where time is piling up/i)).toBeVisible();

  // At least one row rendered (mock has 12)
  await expect(page.locator("text=/REQ-\\d+/").first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Flow 2: demo banner can be dismissed and stays dismissed for the session
// ---------------------------------------------------------------------------
test("2. demo banner dismisses and stays dismissed", async ({ page }) => {
  await goHome(page);

  const banner = page.getByText(/running on mock data/i);
  await expect(banner).toBeVisible();

  await page.getByRole("button", { name: /dismiss demo notice/i }).click();
  await expect(banner).not.toBeVisible();

  // Re-click Refresh — banner should not come back (it's dismissed in state)
  await page.getByRole("button", { name: /refresh/i }).click();
  await expect(banner).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Flow 3: reportee filter narrows the list to one person
// ---------------------------------------------------------------------------
test("3. reportee filter narrows list", async ({ page }) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  // Count rows with "All reportees"
  const allRows = await page.locator("text=/REQ-\\d+ ·/").count();
  expect(allRows).toBeGreaterThanOrEqual(10);

  // Filter to Harsh Patel (mock: 2 reqs — REQ-10452 and REQ-10508)
  await page.locator("select").first().selectOption({ label: "Harsh Patel" });

  // Only Harsh's reqs remain
  await expect(page.getByText(/Requester: Harsh Patel/).first()).toBeVisible();
  const filteredRows = await page.locator("text=/REQ-\\d+ ·/").count();
  expect(filteredRows).toBeLessThan(allRows);
  expect(filteredRows).toBeGreaterThanOrEqual(1);

  // No other requester appears
  await expect(page.getByText(/Requester: Gani Subramanian/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Flow 4: search input filters by free text
// ---------------------------------------------------------------------------
test("4. search filters by description", async ({ page }) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  await page.getByPlaceholder(/Search req number/i).fill("GPU");

  // REQ-10488 "GPU server — ML training" should match
  await expect(page.getByText(/REQ-10488/)).toBeVisible();
  // REQ-10452 "Laptop for new joiner" should not
  await expect(page.getByText(/REQ-10452/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Flow 5: stage tile acts as a toggle filter
// ---------------------------------------------------------------------------
test("5. clicking a stage tile filters the list", async ({ page }) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  // Click "Pending Approval" tile
  await page
    .getByRole("button", { name: /Pending Approval/i })
    .first()
    .click();

  // Every visible row should show the Pending Approval badge
  const badges = await page.getByText("Pending Approval").count();
  expect(badges).toBeGreaterThanOrEqual(2); // mock has 3 pending

  // No "Complete" rows should be visible
  await expect(page.getByText(/REQ-10429/)).toHaveCount(0);

  // Click again to untoggle
  await page
    .getByRole("button", { name: /Pending Approval/i })
    .first()
    .click();
  // Full list returns
  await expect(page.getByText(/REQ-10429/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Flow 6: advanced filters panel exposes BU / category / on-hold
// ---------------------------------------------------------------------------
test("6. on-hold-only filter isolates the single on-hold req", async ({
  page,
}) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  await page.getByRole("button", { name: /More filters/i }).click();

  // Check "On-hold items only"
  await page.getByLabel(/On-hold items only/i).check();

  // Only REQ-10508 should remain (mock's single on-hold)
  await expect(page.getByText(/REQ-10508/)).toBeVisible();
  await expect(page.getByText(/On hold/).first()).toBeVisible();

  // Other reqs should be gone
  await expect(page.getByText(/REQ-10452/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Flow 7: exception strip card applies its filter patch
// ---------------------------------------------------------------------------
test("7. exception strip narrows to stuck items", async ({ page }) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  // Click "Stuck 15+ days" exception
  const stuckCard = page
    .getByRole("button", { name: /Stuck 15\+ days/i })
    .first();
  await expect(stuckCard).toBeVisible();
  await stuckCard.click();

  // REQ-10466 is the stuck-16-days JetBrains licence renewal
  await expect(page.getByText(/REQ-10466/)).toBeVisible();

  // A fresh req (<4 days aging) should not be visible
  await expect(page.getByText(/REQ-10452/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Flow 8: detail drawer opens with the right metadata and closes on Escape
// ---------------------------------------------------------------------------
test("8. detail drawer opens, shows approval chain, closes on Escape", async ({
  page,
}) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  // Pick REQ-10501 — waiting on Gaurav, so Approve/Reject should render
  const row = page
    .locator("div")
    .filter({ hasText: /REQ-10501/ })
    .first();
  await row.getByRole("button", { name: /Details/i }).click();

  // Drawer opens (role=dialog)
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/REQ-10501/).first()).toBeVisible();

  // Approval tab content loads
  await expect(drawer.getByText(/Approval chain/i)).toBeVisible();

  // Approve + Reject visible because Gaurav is the current approver
  await expect(drawer.getByRole("button", { name: /^Approve$/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Reject$/ })).toBeVisible();

  // Close via Escape
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Flow 9: saved view persists through a filter reset
// ---------------------------------------------------------------------------
test("9. saved view round-trips a filter", async ({ page, context }) => {
  // Grant clipboard + dialog handling
  context.on("dialog", async (d) => {
    // window.prompt: provide a view name
    if (d.type() === "prompt") await d.accept("E2E test view");
    else await d.accept();
  });

  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  // Apply a filter (e.g. search)
  await page.getByPlaceholder(/Search req number/i).fill("Monitors");
  await expect(page.getByText(/REQ-10508/)).toBeVisible();

  // Save the view (triggers window.prompt — handled by dialog listener above)
  await page.getByRole("button", { name: /Save view/i }).click();

  // Chip appears with our view name
  await expect(page.getByText("E2E test view")).toBeVisible();

  // Clear filters — the search clears
  await page.getByRole("button", { name: /More filters/i }).click();
  await page.getByRole("button", { name: /Clear all/i }).click();
  await expect(page.getByPlaceholder(/Search req number/i)).toHaveValue("");

  // Click the saved view chip → filter returns
  await page.getByRole("button", { name: "E2E test view" }).click();
  await expect(page.getByPlaceholder(/Search req number/i)).toHaveValue(
    "Monitors",
  );
});

// ---------------------------------------------------------------------------
// Flow 10: live polling tick updates the "Updated Xs ago" label
// ---------------------------------------------------------------------------
test("10. live indicator advances after a manual refresh", async ({ page }) => {
  await goHome(page);
  await dismissDemoBannerIfPresent(page);

  // Grab initial "Updated …" text
  const indicator = page.getByText(/Updated /);
  await expect(indicator).toBeVisible();
  const before = (await indicator.textContent()) ?? "";

  // Wait a beat so a fresh refresh reads as different
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Refresh$/ }).click();

  // After refresh, the label should read "just now" or a smaller number
  await expect(async () => {
    const after = (await indicator.textContent()) ?? "";
    expect(after).not.toBe(before);
  }).toPass({ timeout: 5_000 });
});

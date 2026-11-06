
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

const userId = "12345678-1234-4234-8234-123456789012";
const centerId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01";
const animalId = "bbbbbbbb-cccc-4ddd-8eee-fffffffffff1";

function makeRequest(status = "requested") {
  return {
    id: "cccccccc-dddd-4eee-8fff-aaaaaaaaaaa1",
    animal_global_id: animalId,
    assigned_center_id: centerId,
    test_name: "Blood Panel",
    instructions: "Check blood count",
    status,
    unable_reason: null,
    created_at: "2026-11-06T12:00:00Z",
    updated_at: "2026-11-06T12:00:00Z",
  };
}

async function setup(page, request) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.com",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-11-06T12:00:00Z",
  };

  const token = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: userId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: "authenticated",
    }),
    "signature",
  ].join(".");

  await page.route("**/auth/v1/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/user")
        ? user
        : {
            access_token: token,
            refresh_token: "refresh",
            expires_in: 3600,
            token_type: "bearer",
            user,
          },
    })
  );

  await page.route("**/rest/v1/profiles*", (route) =>
    route.fulfill({
      json: {
        ...user,
        role: "diagnostic_staff",
        approval_status: "approved",
        diagnostic_center_id: centerId,
      },
    })
  );

  await page.route(
    "**/rest/v1/rpc/paws_diagnostic_center_id",
    (route) => route.fulfill({ json: centerId })
  );

  await page.route("**/rest/v1/diagnostic_centers*", (route) =>
    route.fulfill({
      json: {
        id: centerId,
        name: "Central Diagnostics",
        approval_status: "approved",
      },
    })
  );

  await page.route("**/rest/v1/diagnostic_requests*", (route) =>
    route.fulfill({ json: [request] })
  );

  await page.goto("/");

  await page.getByLabel("Email", { exact: true })
    .fill("staff@example.com");

  await page.getByLabel("Password", { exact: true })
    .fill("Longer-password1!");

  await page.getByRole("button", { name: "Log In" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Diagnostic Center Queue",
    })
  ).toBeVisible();
}

test("staff sees assigned diagnostic requests", async ({ page }) => {
  await setup(page, makeRequest());

  await expect(
    page.getByRole("heading", { name: "Blood Panel" })
  ).toBeVisible();

  await expect(
    page.getByText("Check blood count")
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Start Request" })
  ).toBeVisible();
});

test("staff progresses from requested to completed", async ({ page }) => {
  const request = makeRequest();
  const updates = [];

  await setup(page, request);

  await page.route(
    "**/rest/v1/rpc/update_diagnostic_request",
    (route) => {
      const args = route.request().postDataJSON();
      updates.push(args);

      request.status = args.next_status;
      request.unable_reason = args.reason;

      return route.fulfill({ json: { ...request } });
    }
  );

  await page.getByRole("button", {
    name: "Start Request",
  }).click();

  await expect(
    page.getByRole("button", { name: "Mark Completed" })
  ).toBeVisible();

  await page.getByRole("button", {
    name: "Mark Completed",
  }).click();

  await expect(
    page.locator("article.treatment-panel").getByText("Status: Completed")
  ).toBeVisible();

  expect(updates.map((item) => item.next_status)).toEqual([
    "in_progress",
    "completed",
  ]);
});

test("unable to complete requires a valid reason", async ({ page }) => {
  const request = makeRequest("in_progress");
  const updates = [];

  await setup(page, request);

  await page.route(
    "**/rest/v1/rpc/update_diagnostic_request",
    (route) => {
      const args = route.request().postDataJSON();
      updates.push(args);

      request.status = args.next_status;
      request.unable_reason = args.reason;

      return route.fulfill({ json: { ...request } });
    }
  );

  await page.getByRole("button", {
    name: "Unable to Complete",
  }).click();

  await expect(
    page.getByRole("alert")
  ).toContainText("Please provide a reason");

  expect(updates).toHaveLength(0);

  await page.getByLabel(
    "Reason if unable to complete"
  ).fill("Testing equipment unavailable");

  await page.getByRole("button", {
    name: "Unable to Complete",
  }).click();

  await expect(
    page.getByText("Testing equipment unavailable")
  ).toBeVisible();

  expect(updates).toHaveLength(1);

  expect(updates[0]).toEqual({
    request_id: request.id,
    next_status: "unable_to_complete",
    reason: "Testing equipment unavailable",
  });
});

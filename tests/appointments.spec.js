
import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

const user = {
  id: "12345678-1234-4234-8234-123456789012",
  aud: "authenticated",
  role: "authenticated",
  email: "vet@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

function token() {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: "authenticated",
    }),
    "signature",
  ].join(".");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/auth/v1/**", async (route) => {
    if (route.request().url().includes("/user")) {
      return route.fulfill({ json: user });
    }

    return route.fulfill({
      json: {
        access_token: token(),
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      },
    });
  });

  await page.route("**/rest/v1/profiles*", (route) =>
    route.fulfill({
      json: {
        ...user,
        full_name: "Test Vet",
        role: "veterinarian",
        approval_status: "approved",
      },
    })
  );

  await page.route("**/rest/v1/animals*", (route) =>
    route.fulfill({
      json: {
        chip_id: "TEST123",
        name: "Mochi",
        animal: "Cat",
        species: "Domestic Shorthair",
      },
    })
  );

  await page.goto("/");

  await page.getByLabel("Email", { exact: true })
    .fill("vet@example.com");
  await page.getByLabel("Password", { exact: true })
    .fill("Test-password1!");
  await page.getByRole("button", { name: "Log In" }).click();

  await page.getByLabel("Unique Chip ID").fill("TEST123");
  await page.getByRole("button", { name: "Search", exact: true })
    .click();

  await page.getByRole("button", { name: "Appointments" })
    .first().click();
});

function futureDate() {
  const date = new Date();
  date.setDate(date.getDate() + 10);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

async function fillAppointment(page, reason, time = "14:00") {
  await page.getByLabel("Date", { exact: true })
    .fill(futureDate());
  await page.getByLabel("Time", { exact: true })
    .fill(time);
  await page.getByLabel("Reason for Visit").fill(reason);
  await page.getByRole("button", { name: "Save Appointment" })
    .click();
}

test("rejects a reason shorter than 5 characters", async ({ page }) => {
  await fillAppointment(page, "Hi");

  await expect(page.getByRole("alert")).toContainText(
    "Reason for visit must be between 5 and 250 characters."
  );
});

test("rejects a reason longer than 250 characters", async ({ page }) => {
  await fillAppointment(page, "A".repeat(251));

  await expect(page.getByRole("alert")).toContainText(
    "Reason for visit must be between 5 and 250 characters."
  );
});

test("prevents duplicate appointments", async ({ page }) => {
  await fillAppointment(page, "Annual checkup");

  await expect(page.getByRole("status")).toContainText(
    "Appointment saved"
  );

  await fillAppointment(page, "Follow-up visit");

  await expect(page.getByRole("alert")).toContainText(
    "An appointment already exists at this date and time."
  );
});

test("accepts a valid appointment", async ({ page }) => {
  await fillAppointment(page, "Annual vaccination");

  await expect(page.getByRole("status")).toContainText(
    "Appointment saved"
  );
  await expect(page.getByText("Annual vaccination")).toBeVisible();
});

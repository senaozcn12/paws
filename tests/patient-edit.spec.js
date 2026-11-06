
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

const originalAnimal = {
  global_id: "11111111-1111-4111-8111-111111111111",
  chip_id: "TEST123",
  name: "Mochi",
  animal: "Cat",
  species: "Domestic Shorthair",
  age: 3,
  sex: "F",
  notes: "",
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

async function setup(page, updateRequests) {
  let animal = { ...originalAnimal };

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

  await page.route("**/rest/v1/animals*", async (route) => {
    const request = route.request();

    if (request.method() === "PATCH") {
      const changes = request.postDataJSON();
      updateRequests.push({
        url: request.url(),
        changes,
      });

      animal = { ...animal, ...changes };
      return route.fulfill({ json: animal });
    }

    return route.fulfill({ json: animal });
  });

  await page.goto("/");

  await page.getByLabel("Email", { exact: true })
    .fill("vet@example.com");

  await page.getByLabel("Password", { exact: true })
    .fill("Longer-password1!");

  await page.getByRole("button", { name: "Log In" })
    .click();

  await page.getByLabel("Unique Chip ID")
    .fill("TEST123");

  await page.getByRole("button", {
    name: "Search",
    exact: true,
  }).click();

  await page.getByRole("button", {
    name: "View Full Record",
  }).click();

  await page.getByRole("button", {
    name: "Edit Patient Information",
  }).click();
}

test("updates patient name without changing IDs", async ({ page }) => {
  const updates = [];
  await setup(page, updates);

  await page.getByLabel("Name", { exact: true })
    .fill("Mochi Updated");

  await page.getByRole("button", {
    name: "Save Changes",
  }).click();

  await expect(page.getByRole("status"))
    .toContainText("Patient information updated successfully");

  expect(updates).toHaveLength(1);
  expect(updates[0].changes).toEqual({
    name: "Mochi Updated",
  });

  expect(updates[0].url).toContain(
    `global_id=eq.${originalAnimal.global_id}`
  );

  expect(updates[0].changes).not.toHaveProperty("global_id");
  expect(updates[0].changes).not.toHaveProperty("chip_id");
});

test("rejects invalid age", async ({ page }) => {
  const updates = [];
  await setup(page, updates);

  const age = page.getByLabel("Age (years)");
  await age.fill("151");

  const isInvalid = await age.evaluate(
    (element) => !element.validity.valid
  );

  expect(isInvalid).toBe(true);
  expect(updates).toHaveLength(0);
});

test("does not save when nothing changed", async ({ page }) => {
  const updates = [];
  await setup(page, updates);

  await page.getByRole("button", {
    name: "Save Changes",
  }).click();

  expect(updates).toHaveLength(0);

  await expect(page.getByRole("button", {
    name: "Edit Patient Information",
  })).toBeVisible();
});

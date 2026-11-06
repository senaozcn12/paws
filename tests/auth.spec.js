import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
const user = { id: '12345678-1234-4234-8234-123456789012', aud: 'authenticated', role: 'authenticated', email: 'vet@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
function token() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, aud: 'authenticated' })}.signature`;
}
async function mock(page, status = 'pending', role = 'veterinarian') {
  await page.route('**/auth/v1/**', async route => {
    const url = route.request().url();
    if (url.includes('/user')) return route.fulfill({ json: user });
    if (url.includes('/logout') || url.includes('/recover')) return route.fulfill({ json: {} });
    return route.fulfill({ json: { access_token: token(), refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user } });
  });
  await page.route('**/rest/v1/diagnostic_centers*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/pharmacies*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/profiles*', route => route.fulfill({ json: { ...user, full_name: 'Vet', role, approval_status: status } }));
}
test('login preserves existing form and provides recovery link', async ({ page }) => {
  await mock(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Veterinarian login' })).toBeVisible();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill('unknown@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
});
test('invalid and expired links allow requesting another', async ({ page }) => {
  await mock(page); await page.goto('/reset-password#error=access_denied&error_code=otp_expired');
  await expect(page.getByRole('alert')).toContainText('invalid or expired');
  await expect(page.getByRole('link', { name: 'Request another link' })).toBeVisible();
});
for (const status of ['pending', 'rejected', 'approved']) {
  test(`recovery wins over ${status} account routing and updates password only`, async ({ page }) => {
    await mock(page, status);
    const updates = [];
    page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/auth/v1/user')) updates.push(request.postDataJSON()); });
    await page.goto(`/reset-password#access_token=${token()}&refresh_token=refresh&token_type=bearer&expires_in=3600&type=recovery`);
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill('Longer-password1!');
    await page.getByLabel('Confirm new password').fill('Different-password1!');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('alert')).toContainText('Passwords must match');
    await page.getByLabel('Confirm new password').fill('Longer-password1!');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('status')).toContainText('password has been updated');
    expect(updates).toEqual([{ password: 'Longer-password1!', code_challenge: null, code_challenge_method: null }]);
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Veterinarian login' })).toBeVisible();
  });
}
test('searchable country and subdivisions support keyboard and clearing', async ({ page }) => {
  await mock(page); await page.goto('/register');
  const country = page.getByRole('combobox', { name: 'Country', exact: true });
  await country.fill('united states'); await country.press('ArrowDown'); await country.press('Enter');
  const region = page.getByRole('combobox', { name: 'State / province / region', exact: true });
  await region.fill('i');
  for (const name of ['Illinois', 'Indiana', 'Iowa']) await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  await region.press('ArrowDown'); await region.press('Enter');
  await expect(region).toHaveValue('Idaho');
  await country.fill('Canada'); await country.press('ArrowDown'); await country.press('Enter');
  await expect(region).toHaveValue('');
  await region.fill('ont'); await region.press('ArrowDown'); await region.press('Enter');
  await expect(region).toHaveValue('Ontario');
  await country.fill('Antarctica'); await country.press('ArrowDown'); await country.press('Enter');
  await expect(page.getByLabel('State / province / region (optional)', { exact: true })).toHaveValue('');
  await page.getByLabel('State / province / region (optional)', { exact: true }).fill('Research station');
  await page.screenshot({ path: 'test-results/registration.png', fullPage: true });
});

for (const status of ['pending', 'rejected']) {
  test(`${status} accounts stay restricted after normal sign in`, async ({ page }) => {
    await mock(page, status); await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill('vet@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Longer-password1!');
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page.getByRole('heading', { name: 'Account status' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(status === 'pending' ? 'awaiting' : 'rejected');
  });
}
test('delivery failures use the same neutral confirmation', async ({ page }) => {
  await mock(page);
  await page.route('**/auth/v1/recover*', route => route.fulfill({ status: 429, json: { message: 'Rate limited' } }));
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill('vet@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
});

test('admin recovery opens password form before review dashboard', async ({ page }) => {
  await mock(page, 'approved', 'admin');
  await page.goto(`/reset-password#access_token=${token()}&refresh_token=refresh&token_type=bearer&expires_in=3600&type=recovery`);
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registration review' })).toHaveCount(0);
});
test('password success with failed signout offers retry', async ({ page }) => {
  await mock(page);
  await page.route('**/auth/v1/logout*', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
  await page.goto(`/reset-password#access_token=${token()}&refresh_token=refresh&token_type=bearer&expires_in=3600&type=recovery`);
  await page.getByLabel('New password', { exact: true }).fill('Longer-password1!');
  await page.getByLabel('Confirm new password').fill('Longer-password1!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toContainText('sign out failed');
  await expect(page.getByRole('button', { name: 'Retry sign out' })).toBeVisible();
});

async function signIn(page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('vet@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Longer-password1!');
  await page.getByRole('button', { name: 'Log In' }).click();
}
test('approved admin uses patient features and reviews requests through Account', async ({ page }) => {
  await mock(page, 'approved', 'admin');
  const applicant = { id: 'applicant', full_name: 'Pending Vet', email: 'pending@example.com', role: 'veterinarian', approval_status: 'pending', country: 'United States', region: 'Illinois' };
  await page.route('**/rest/v1/diagnostic_centers*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/pharmacies*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/profiles*', route => route.fulfill({ json: route.request().url().includes('id=eq.') ? { ...user, role: 'admin', approval_status: 'approved' } : [applicant] }));
  await page.route('**/rest/v1/animals*', route => route.fulfill({ json: { chip_id: 'TEST123', name: 'Buddy', animal: 'Dog' } }));
  await page.route('**/rest/v1/treatments*', route => route.fulfill({ json: [] }));
  const decisions = [];
  await page.route('**/rest/v1/rpc/review_registration', route => {
    const decision = route.request().postDataJSON();
    decisions.push(decision); applicant.approval_status = decision.decision;
    return route.fulfill({ status: 204, body: '' });
  });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Find a patient' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registration review' })).toHaveCount(0);
  await page.getByLabel('Unique Chip ID').fill('TEST123');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Buddy', exact: true })).toBeVisible();
  for (const name of ['Test Results', 'Appointments', 'Treatment History', 'Treatment Notes']) {
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Registration review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find a patient' })).toBeHidden();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Status: approved', { exact: true })).toBeVisible();
  expect(decisions).toEqual([{ applicant_id: 'applicant', decision: 'approved' }]);
  await page.getByRole('button', { name: 'Patient Records', exact: true }).click();
  await expect(page.getByLabel('Unique Chip ID')).toHaveValue('TEST123');
  await expect(page.getByRole('heading', { name: 'Treatment Notes', exact: true }).first()).toBeVisible();
});
test('approved veterinarian has Account information without review controls', async ({ page }) => {
  await mock(page, 'approved'); await signIn(page);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByText('vet@example.com', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});
for (const status of ['pending', 'rejected']) {
  test(`${status} admin cannot open patient records or reviews`, async ({ page }) => {
    await mock(page, status, 'admin'); await signIn(page);
    await expect(page.getByRole('heading', { name: 'Account status' })).toBeVisible();
    await expect(page.getByLabel('Unique Chip ID')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Registration review' })).toHaveCount(0);
  });
}

async function fillAnimal(page, chip = 'NEW_123') {
  await page.getByLabel('Chip ID *', { exact: true }).fill(chip);
  await page.getByLabel('Animal name *', { exact: true }).fill(' Buddy ');
  await page.getByLabel('Animal type *', { exact: true }).fill('Dog');
  await page.getByLabel('Breed / species *', { exact: true }).fill('Pug');
  await page.getByLabel('Age in years (optional)').fill('0');
}
for (const role of ['veterinarian', 'admin']) {
  test(`${role} creates animal with generated Global ID and can search it`, async ({ page }) => {
    await mock(page, 'approved', role);
    const record = { chip_id: 'NEW_123', name: 'Buddy', animal: 'Dog', species: 'Pug', age: 0, sex: 'M', global_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
    const requests = [];
    await page.route('**/rest/v1/rpc/create_animal', async route => {
      requests.push(route.request().postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: record });
    });
    const searches = [];
    await page.route('**/rest/v1/animals*', route => {
      searches.push(route.request().url());
      return route.fulfill({ json: route.request().url().includes('global_id=eq.') ? record : null });
    });
    await signIn(page);
    await page.getByRole('button', { name: 'Create animal', exact: true }).click();
    await fillAnimal(page, ' NEW_123 ');
    await page.getByLabel('Sex (optional)').selectOption('M');
    await page.getByRole('button', { name: 'Save animal', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(record.global_id);
    expect(requests).toHaveLength(1);
    expect(requests[0].details).toMatchObject({ chip_id: 'NEW_123', name: 'Buddy', age: '0', sex: 'M' });
    expect(requests[0].details).not.toHaveProperty('global_id');
    await expect(page.getByText('0 years', { exact: true })).toBeVisible();
    await page.getByLabel('Unique Chip ID or Global ID').fill(record.global_id);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Buddy', exact: true })).toBeVisible();
    expect(searches.some(url => url.includes('global_id=eq.'))).toBe(true);
    await page.getByRole('button', { name: 'View Full Record' }).click();
    await expect(page.getByText(record.global_id, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create animal', exact: true }).click();
    await page.screenshot({ path: `test-results/create-animal-${role}.png`, fullPage: true });
  });
}
test('animal validation and duplicate errors retain inputs and allow correction', async ({ page }) => {
  await mock(page, 'approved');
  let calls = 0;
  await page.route('**/rest/v1/rpc/create_animal', route => { calls++; return route.fulfill({ status: 409, json: { code: '23505', message: 'duplicate key' } }); });
  await signIn(page);
  await page.getByRole('button', { name: 'Create animal', exact: true }).click();
  await fillAnimal(page);
  await page.getByLabel('Animal name *', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Save animal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a Chip ID');
  expect(calls).toBe(0);
  await page.getByLabel('Animal name *', { exact: true }).fill('Buddy');
  await page.getByLabel('Age in years (optional)').fill('-1');
  await page.getByRole('button', { name: 'Save animal', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByLabel('Age in years (optional)').fill('0');
  await page.getByRole('button', { name: 'Save animal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already registered');
  await expect(page.getByLabel('Animal name *', { exact: true })).toHaveValue('Buddy');
  await expect(page.getByLabel('Chip ID *', { exact: true })).toHaveValue('NEW_123');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find a patient' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

const simUrl = process.env.SIM_PUBLIC_URL ?? 'http://localhost:4000';
test.use({
  httpCredentials: {
    username: process.env.FOUNDER_EMAIL ?? 'founder@example.com',
    password: process.env.FOUNDER_PASSWORD ?? 'test-only-founder-password',
  },
});

test('founder controls clock speed and seeded generator from the browser', async ({ page }) => {
  await page.goto(`${simUrl}/sim/admin`);
  try {
    await expect(page.getByRole('heading', { name: 'Demo controls' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop orders' }).click();
    await expect(page.locator('#generator')).toContainText('"enabled": false');
    await page.getByLabel('Seed').fill('123');
    await page.getByRole('button', { name: 'Apply seed while stopped' }).click();
    await expect(page.locator('#generator')).toContainText('"seed": 123');
    await page.getByRole('button', { name: 'Demo · 1 day in 10 minutes' }).click();
    await expect(page.locator('#clock')).toContainText('144×');
    await page.getByRole('button', { name: 'Start orders' }).click();
    await expect(page.locator('#generator')).toContainText('"enabled": true');
    await page.getByRole('button', { name: 'Apply seed while stopped' }).click();
    await expect(page.getByRole('alert')).toContainText('Stop generation');
    await page.screenshot({ path: 'test-results/t-15-controls.png', fullPage: true });
  } finally {
    await page.getByRole('button', { name: 'Stop orders' }).click();
    await expect(page.locator('#generator')).toContainText('"enabled": false');
    await page.getByRole('button', { name: 'Real time · 1×' }).click();
    await expect(page.locator('#clock')).toContainText('1×');
  }
});

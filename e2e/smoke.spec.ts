import { expect, test } from '@playwright/test';

test('home page shows the demo banner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo store. No real payments or deliveries.')).toBeVisible();
});

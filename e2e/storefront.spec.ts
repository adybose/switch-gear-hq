import { expect, test } from '@playwright/test';

// Needs the stack running on a freshly reset database (`npm run demo:reset`).

const BANNER = 'Demo store. No real payments or deliveries.';

test('every storefront page shows the demo banner', async ({ page }) => {
  for (const path of [
    '/',
    '/collections/dev-humour',
    '/products/silk-board-survivor',
    '/cart',
    '/policies/shipping',
    '/policies/returns',
    '/policies/terms',
    '/policies/privacy',
    '/no-such-page',
  ]) {
    await page.goto(path);
    await expect(page.getByTestId('demo-banner'), path).toHaveText(BANNER);
  }
});

test('home lists the four collections and all twelve designs', async ({ page }) => {
  await page.goto('/');
  const collections = page.getByRole('region', { name: 'Collections' }).getByRole('link');
  await expect(collections).toHaveCount(4);
  const designs = page.getByRole('region', { name: 'All designs' }).getByRole('listitem');
  await expect(designs).toHaveCount(12);
});

test('collection page shows only its designs', async ({ page }) => {
  await page.goto('/collections/kaapi-culture');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kaapi Culture');
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(3);
  await page.goto('/collections/no-such-collection');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('pick a variant, add it to the cart and change the quantity', async ({ page }) => {
  await page.goto('/products/silk-board-survivor');
  await expect(page.getByTestId('price')).toContainText('₹599');

  await page.getByRole('button', { name: 'Oversized (220 GSM)' }).click();
  await expect(page.getByTestId('price')).toContainText('₹799');
  await page.getByRole('button', { name: 'Navy' }).click();
  await expect(page.getByRole('img', { name: /Silk Board Survivor tee in Navy/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible(); // oversized chest, S

  const add = page.getByRole('button', { name: 'Choose a size' });
  await expect(add).toBeDisabled();
  await page.getByRole('button', { name: 'L', exact: true }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('status')).toContainText('Added to cart');
  await expect(page.getByTestId('cart-count')).toHaveText('1');

  await page.getByRole('link', { name: 'View cart' }).click();
  const line = page.getByTestId('cart-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('Oversized (220 GSM) · Navy · L');
  await expect(page.getByTestId('subtotal')).toHaveText('₹799');

  await page.getByRole('button', { name: 'Add one Silk Board Survivor' }).click();
  await expect(page.getByTestId('subtotal')).toHaveText('₹1,598');
  await expect(page.getByTestId('cart-count')).toHaveText('2');

  await page.reload();
  await expect(page.getByTestId('subtotal')).toHaveText('₹1,598');

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
});

test('mockups are generated SVGs', async ({ request }) => {
  const res = await request.get('/artwork/kaapi-break.svg?colour=olive');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/svg+xml');
  const svg = await res.text();
  expect(svg).toContain('KAAPI BREAK');
  expect(svg).toContain('#556b2f');
  expect((await request.get('/artwork/no-such-tee.svg')).status()).toBe(404);
  expect((await request.get('/artwork/kaapi-break.png')).status()).toBe(404);
});

test('works on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/products/ship-it-friday');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship It Friday');
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(375);
});

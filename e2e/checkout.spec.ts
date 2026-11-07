import { expect, test, type Page } from '@playwright/test';

// Needs the stack running on a freshly reset database (`npm run demo:reset`).

async function addToCart(page: Page, slug: string, fit: string, size: string, times = 1) {
  await page.goto(`/products/${slug}`);
  await page.getByRole('button', { name: fit }).click();
  await page.getByRole('button', { name: size, exact: true }).click();
  for (let i = 0; i < times; i++) await page.getByRole('button', { name: 'Add to cart' }).click();
}

async function fillCustomer(page: Page, pincode: string, state = 'Karnataka') {
  await page.getByLabel('Full name').fill('Test Customer');
  await page.getByLabel('Email').fill('test.customer@example.com');
  await page.getByLabel('Phone').fill('9876543210');
  await page.getByLabel('Address').fill('1 Demo Street');
  await page.getByLabel('City').fill('Bengaluru');
  await page.getByLabel('State').selectOption(state);
  await page.getByLabel('PIN code').fill(pincode);
}

test('checkout one tee: PIN check, totals, confirmation page', async ({ page }) => {
  await addToCart(page, 'silk-board-survivor', 'Classic (180 GSM)', 'M');
  await page.goto('/cart');
  await page.getByRole('link', { name: 'Checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  await fillCustomer(page, '744101', 'Andaman and Nicobar Islands');
  await expect(page.getByTestId('pincode-error')).toHaveText(
    "Sorry, our courier doesn't deliver to PIN 744101 (Andaman and Nicobar Islands) yet.",
  );
  await page.getByRole('button', { name: 'Place order' }).click();
  // Wait for the refused order to come back before editing the form.
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  await expect(page.getByTestId('pincode-error')).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.getByLabel('State').selectOption('Karnataka');
  await page.getByLabel('PIN code').fill('560034');
  await expect(page.getByTestId('pincode-error')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText('₹678'); // ₹599 + ₹79 shipping

  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/orders\/ORD-\d+\?t=/);
  await expect(page.getByTestId('order-number')).toHaveText(/^ORD-\d+$/);
  await expect(page.getByTestId('order-total')).toHaveText('₹678');
  await expect(page.getByText('Waiting for payment')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('0');

  // The confirmation page needs the signed link.
  const number = await page.getByTestId('order-number').textContent();
  await page.goto(`/orders/${number}`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('three tees get 10% off and free shipping', async ({ page }) => {
  await addToCart(page, 'kaapi-break', 'Classic (180 GSM)', 'L', 3);
  await page.goto('/checkout');
  await expect(page.getByTestId('totals')).toContainText('3 or more tees (10%)');
  await expect(page.getByTestId('totals')).toContainText('Free');
  await expect(page.getByTestId('total')).toHaveText('₹1,617.30');
});

test('an unknown discount code is refused with a message', async ({ page }) => {
  await addToCart(page, 'off-by-one', 'Premium (240 GSM)', 'S');
  await page.goto('/checkout');
  await page.getByPlaceholder('Discount code').fill('nope');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText("The code NOPE isn't valid or has expired.")).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText('₹999');
});

test('the checkout API prices from the catalogue and blocks unserviceable PINs', async ({
  request,
}) => {
  const customer = {
    name: 'Api Customer',
    email: 'api.customer@example.com',
    phone: '9876543210',
    address: '2 Demo Street',
    city: 'Leh',
    state: 'Ladakh',
    pincode: '194101',
  };
  const items = [{ sku: 'SG-SHIPIT-OVR-OLV-XL', qty: 1 }];
  const blocked = await request.post('/api/v1/checkout', { data: { items, customer } });
  expect(blocked.status()).toBe(422);
  expect(await blocked.json()).toMatchObject({ error: 'not_serviceable' });

  const placed = await request.post('/api/v1/checkout', {
    data: {
      items,
      customer: { ...customer, city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    },
  });
  expect(placed.status()).toBe(201);
  const body = (await placed.json()) as {
    orderNumber: string;
    totalPaise: number;
    paymentUrl: string;
  };
  expect(body.orderNumber).toMatch(/^ORD-\d+$/);
  expect(body.totalPaise).toBe(87800); // ₹799 + ₹79
  expect((await request.get(body.paymentUrl)).status()).toBe(200);
});

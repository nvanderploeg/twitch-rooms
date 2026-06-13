import { expect, test } from '@playwright/test';

test('web client home page renders its heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Twitch Room — web client' })).toBeVisible();
});

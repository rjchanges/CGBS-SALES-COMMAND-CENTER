import { expect, test } from '@playwright/test';

test('sales workflow: login, lead, import, call, follow-up, opportunity, analytics, export', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const name = 'E2E Lead ' + suffix;
  await page.goto('/');
  page.on('dialog', (dialog) => dialog.accept('E2E completion note'));
  await page.getByRole('button', { name: /Continue to demo workspace/i }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Rahul/i })).toBeVisible();

  await page.getByRole('link', { name: 'Leads' }).click();
  await page.getByRole('button', { name: 'Add lead', exact: true }).last().click();
  await page.locator('label').filter({ hasText: 'Full name' }).locator('input').fill(name);
  await page.locator('label').filter({ hasText: 'Company *' }).locator('input').fill('E2E Example ' + suffix);
  await page.locator('label').filter({ hasText: 'Email address' }).locator('input').fill('e2e.' + suffix + '@example.test');
  await page.locator('label').filter({ hasText: 'Phone number' }).locator('input').fill('+91 90000 1' + suffix);
  await page.getByRole('button', { name: 'Add lead', exact: true }).last().click();
  await expect(page.getByText(name)).toBeVisible();

  const row = page.locator('tr').filter({ hasText: name });
  await row.getByTitle('Edit lead').click();
  await page.locator('label').filter({ hasText: 'Role / job title' }).locator('input').fill('Sales Director');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Lead updated.')).toBeVisible();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Full Name,Company,Email,Phone\nImported Demo,Import Co,import.' + suffix + '@example.test,+91900002' + suffix),
  });
  await expect(page.getByRole('heading', { name: 'Preview lead import' })).toBeVisible();
  await page.getByRole('button', { name: /Import 1 valid rows/ }).click();
  await expect(page.getByText('Imported Demo')).toBeVisible();

  await page.getByRole('link', { name: 'Calling workspace' }).click();
  await page.getByLabel('Call outcome').selectOption('RNR');
  await page.getByLabel('Call notes').fill('Callback requested during E2E check.');
  await expect(page.getByLabel('Duration in minutes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save call' }).click();
  await expect(page.getByText('Call logged and lead activity updated.')).toBeVisible();

  await page.getByRole('link', { name: 'Follow-ups' }).click();
  const complete = page.getByRole('button', { name: /Complete/ }).first();
  await expect(complete).toBeVisible();
  await complete.click();
  await expect(page.getByText('Follow-up completed.')).toBeVisible();

  await page.getByRole('link', { name: 'Opportunities' }).click();
  await page.getByRole('button', { name: 'New opportunity' }).click();
  await page.locator('label').filter({ hasText: 'Opportunity name' }).locator('input').fill('E2E deal ' + suffix);
  await page.locator('label').filter({ hasText: 'Deal amount' }).locator('input').fill('125000');
  await page.getByRole('button', { name: 'Create opportunity' }).click();
  await expect(page.getByText('E2E deal ' + suffix)).toBeVisible();
  await page.getByLabel('Move E2E deal ' + suffix + ' to stage').selectOption('Closed Won');
  await page.getByRole('button', { name: 'Closed Won', exact: true }).click();
  await expect(page.getByText(/Accomplished by Rahul Raj M/)).toBeVisible();

  await page.getByRole('link', { name: 'Home Page' }).click();
  await expect(page.getByText('E2E deal ' + suffix)).toHaveCount(0);
  await expect(page.getByText('Open pipeline')).toBeVisible();

  await page.getByRole('link', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByText(/Agenda view/)).toBeVisible();

  await page.getByRole('link', { name: 'Reports' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/cgbs-.*\.csv/);
});

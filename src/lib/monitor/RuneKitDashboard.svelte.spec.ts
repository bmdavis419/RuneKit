import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RuneKitDashboard from './RuneKitDashboard.svelte';

describe('RuneKitDashboard', () => {
	it('renders and switches tabs', async () => {
		const { getByRole, getByText } = render(RuneKitDashboard, {
			props: { title: 'RuneKit Dashboard Test' }
		});

		await expect.element(getByText('RuneKit Dashboard Test')).toBeInTheDocument();

		const endpointsTab = getByRole('button', { name: 'endpoints' });
		(endpointsTab.element() as HTMLElement).click();

		await expect.element(getByRole('button', { name: 'Send Request' })).toBeInTheDocument();
	});
});

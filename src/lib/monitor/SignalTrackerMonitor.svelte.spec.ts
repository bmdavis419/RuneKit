import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SignalTrackerMonitor from './SignalTrackerMonitor.svelte';

describe('SignalTrackerMonitor', () => {
	it('starts collapsed and opens to tabs with toggle', async () => {
		const { getByRole, getByText } = render(SignalTrackerMonitor);

		const openButton = getByRole('button', { name: 'Open signal monitor' });
		await expect.element(openButton).toBeInTheDocument();

		(openButton.element() as HTMLElement).click();

		// Wait for opening animation or next tick
		await new Promise((r) => setTimeout(r, 100));

		const feedTab = getByRole('button', { name: 'Feed' });
		const variablesTab = getByRole('button', { name: 'Variables' });
		const rerenderToggle = getByRole('button', { name: /Re-renders/i });

		await expect.element(feedTab).toBeInTheDocument();
		await expect.element(variablesTab).toBeInTheDocument();
		await expect.element(rerenderToggle).toBeInTheDocument();

		(variablesTab.element() as HTMLElement).click();
	});
});

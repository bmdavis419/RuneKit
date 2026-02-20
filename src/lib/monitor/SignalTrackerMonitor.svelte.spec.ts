import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SignalTrackerMonitor from './SignalTrackerMonitor.svelte';

describe('SignalTrackerMonitor', () => {
	it('starts collapsed and opens to tabs with toggle', async () => {
		render(SignalTrackerMonitor);

		const openButton = page.getByRole('button', { name: 'Open signal monitor' });
		await expect.element(openButton).toBeInTheDocument();
		await openButton.click();

		const feedTab = page.getByRole('button', { name: 'Feed' });
		const variablesTab = page.getByRole('button', { name: 'Variables' });
		const rerenderToggle = page.getByRole('button', { name: /Re-renders/i });

		await expect.element(feedTab).toBeInTheDocument();
		await expect.element(variablesTab).toBeInTheDocument();
		await expect.element(rerenderToggle).toBeInTheDocument();

		await variablesTab.click();
		await rerenderToggle.click();
	});
});

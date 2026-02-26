import { fail } from '@sveltejs/kit';
import { add, getAll, remove, toggle } from '$lib/todo-store.js';

export const load = async () => ({ todos: getAll() });

export const actions = {
	add: async ({ request }) => {
		const data = await request.formData();
		const text = (data.get('text') as string)?.trim();
		if (!text) return fail(400, { error: 'Text is required' });
		add(text);
	},

	toggle: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'ID is required' });
		toggle(id);
	},

	remove: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		if (!id) return fail(400, { error: 'ID is required' });
		remove(id);
	}
};

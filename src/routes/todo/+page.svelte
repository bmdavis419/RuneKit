<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Todo } from '$lib/todo-store.js';

	let { data } = $props();

	let todos = $state<Todo[]>(data.todos);
	let input = $state('');
	let filter = $state<'all' | 'active' | 'done'>('all');

	const filtered = $derived(
		filter === 'all'
			? todos
			: filter === 'active'
				? todos.filter((t) => !t.done)
				: todos.filter((t) => t.done)
	);
	const doneCount = $derived(todos.filter((t) => t.done).length);
</script>

<div class="min-h-screen bg-slate-100 p-8 font-mono text-xs">
	<div class="mx-auto max-w-md">
		<div class="mb-6 flex items-baseline justify-between">
			<div>
				<span class="text-[10px] tracking-widest text-slate-400 uppercase">devtools test</span>
				<h1 class="mt-0.5 text-sm font-semibold text-slate-700">Todo App</h1>
			</div>
			<a href="/" class="text-slate-400 hover:text-[#FF815A]">← app tree</a>
		</div>

		<div class="rounded-lg border border-slate-200 bg-white shadow-sm">
			<!-- add form -->
			<form
				method="POST"
				action="?/add"
				class="flex gap-0 border-b border-slate-100"
				use:enhance={({ formData }) => {
					const text = formData.get('text') as string;
					if (!text?.trim()) return;
					todos = [
						...todos,
						{ id: crypto.randomUUID(), text: text.trim(), done: false, createdAt: Date.now() }
					];
					input = '';
					return async ({ update }) => update({ reset: false });
				}}
			>
				<input
					name="text"
					bind:value={input}
					placeholder="what needs doing?"
					class="min-w-0 flex-1 bg-transparent px-4 py-3 text-slate-700 placeholder-slate-300 outline-none"
				/>
				<button
					type="submit"
					class="px-4 py-3 font-semibold text-[#FF815A] transition-colors hover:text-[#e86d48] disabled:cursor-default disabled:text-slate-200"
					disabled={!input.trim()}
				>
					add
				</button>
			</form>

			<!-- list -->
			{#if filtered.length === 0}
				<p class="py-10 text-center text-slate-300">nothing here</p>
			{:else}
				<ul>
					{#each filtered as todo, i (todo.id)}
						<li
							class={`flex items-center gap-3 px-4 py-3 ${i < filtered.length - 1 ? 'border-b border-slate-100' : ''}`}
						>
							<form
								method="POST"
								action="?/toggle"
								use:enhance={() => {
									todos = todos.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t));
									return async ({ update }) => update({ reset: false });
								}}
							>
								<input type="hidden" name="id" value={todo.id} />
								<button
									type="submit"
									class={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${todo.done ? 'border-[#FF815A] bg-[#FF815A]' : 'border-slate-300 hover:border-[#FF815A]'}`}
									aria-label="toggle"
								>
									{#if todo.done}
										<span class="text-[8px] leading-none text-white">✓</span>
									{/if}
								</button>
							</form>

							<span
								class={`flex-1 leading-snug ${todo.done ? 'text-slate-300 line-through' : 'text-slate-600'}`}
							>
								{todo.text}
							</span>

							<form
								method="POST"
								action="?/remove"
								use:enhance={() => {
									todos = todos.filter((t) => t.id !== todo.id);
									return async ({ update }) => update({ reset: false });
								}}
							>
								<input type="hidden" name="id" value={todo.id} />
								<button
									type="submit"
									class="text-slate-200 transition-colors hover:text-red-400"
									aria-label="delete"
								>
									✕
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- footer: filter tabs + count -->
			<div class="flex items-center gap-0.5 border-t border-slate-100 px-3 py-2">
				{#each ['all', 'active', 'done'] as f (f)}
					<button
						type="button"
						onclick={() => (filter = f as typeof filter)}
						class={`rounded px-2 py-1 capitalize transition-colors ${filter === f ? 'bg-[#FF815A] font-semibold text-white' : 'text-slate-400 hover:text-slate-600'}`}
					>
						{f}
					</button>
				{/each}
				<span class="ml-auto text-slate-300">{doneCount}/{todos.length}</span>
			</div>
		</div>

		<p class="mt-4 text-[10px] text-slate-300">
			open <a href="/experiments" class="hover:text-[#FF815A]">signal tracker</a> or
			<a href="/tracker" class="hover:text-[#FF815A]">route tracker</a> to observe
		</p>
	</div>
</div>

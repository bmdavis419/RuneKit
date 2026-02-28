<script lang="ts">
	import { routes, onRoutesUpdated } from 'virtual:runekit/routes';
	import type { RouteNode } from 'virtual:runekit/routes';

	let liveRoutes = $state([...routes]);
	$effect(() => onRoutesUpdated((r) => (liveRoutes = [...r])));

	type TreeNode = { segment: string; id: string; route?: RouteNode; children: TreeNode[] };
	type FlatLine = { prefix: string; segment: string; id: string; route?: RouteNode };

	const buildTree = (routes: RouteNode[]): TreeNode => {
		const root: TreeNode = { segment: '/', id: '/', children: [] };
		for (const route of [...routes].sort((a, b) => a.id.localeCompare(b.id))) {
			if (route.id === '/') {
				root.route = route;
				continue;
			}
			const parts = route.id.split('/').filter(Boolean);
			let node = root;
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const nodeId = '/' + parts.slice(0, i + 1).join('/');
				let child = node.children.find((c) => c.segment === part);
				if (!child) {
					child = { segment: part, id: nodeId, children: [] };
					node.children.push(child);
				}
				if (i === parts.length - 1) child.route = route;
				node = child;
			}
		}
		return root;
	};

	const flatten = (root: TreeNode): FlatLine[] => {
		const lines: FlatLine[] = [{ prefix: '', segment: '/', id: '/', route: root.route }];
		const visit = (node: TreeNode, indent: string, isLast: boolean) => {
			lines.push({
				prefix: indent + (isLast ? '└─ ' : '├─ '),
				segment: node.segment,
				id: node.id,
				route: node.route
			});
			const next = indent + (isLast ? '   ' : '│  ');
			node.children.forEach((c, i) => visit(c, next, i === node.children.length - 1));
		};
		root.children.forEach((c, i) => visit(c, '', i === root.children.length - 1));
		return lines;
	};

	const treeLines = $derived(flatten(buildTree(liveRoutes)));
</script>

<div class="min-h-screen bg-slate-100 p-8 font-mono text-xs">
	<div class="mx-auto max-w-2xl">
		<div class="mb-8 flex items-baseline justify-between">
			<div>
				<span class="text-[10px] tracking-widest text-slate-400 uppercase">devtools</span>
				<h1 class="mt-0.5 text-sm font-semibold text-slate-700">RuneKit</h1>
			</div>
			<a href="/dashboard" class="text-slate-400 hover:text-[#FF815A]">dashboard →</a>
		</div>

		<ul class="space-y-1">
			{#each treeLines as line (line.id)}
				<li class="flex items-baseline gap-0">
					<span class="whitespace-pre text-slate-300 select-none">{line.prefix}</span>
					<span class="text-slate-600">{line.segment}</span>
					{#if line.route}
						<span class="ml-3 flex items-baseline gap-2">
							{#if line.route.layout?.component}
								<span class="text-violet-400">layout</span>
							{/if}
							{#if line.route.layout?.load || line.route.layout?.server}
								<span class="text-violet-300">layout·server</span>
							{/if}
							{#if line.route.page?.component}
								<span class="text-blue-400">page</span>
							{/if}
							{#if line.route.page?.load}
								<span class="text-blue-300">load</span>
							{/if}
							{#if line.route.page?.server?.hasLoad && line.route.page?.server?.hasActions}
								<span class="text-[#FF815A]">server·load+actions</span>
							{:else if line.route.page?.server?.hasActions}
								<span class="text-[#FF815A]">actions</span>
							{:else if line.route.page?.server?.hasLoad}
								<span class="text-[#FF815A]/80">server·load</span>
							{/if}
							{#if line.route.endpoint}
								{#each line.route.endpoint.methods as m (m)}
									<span class="text-emerald-500">{m}</span>
								{/each}
								{#if line.route.endpoint.methods.length === 0}
									<span class="text-emerald-400">endpoint</span>
								{/if}
							{/if}
							{#if line.route.error}
								<span class="text-red-400">error</span>
							{/if}
							{#if line.route.remotes.length > 0}
								<span class="text-rose-400">remote×{line.route.remotes.length}</span>
							{/if}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</div>

<script lang="ts">
	import RuneKit from '../lib/monitor/RuneKit.svelte';
	import './layout.css';

	const { children } = $props();
</script>

{@render children()}
<RuneKit />

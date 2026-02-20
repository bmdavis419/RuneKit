<script lang="ts">
	import SignalTrackerMonitor from '../lib/monitor/SignalTrackerMonitor.svelte';
	import './layout.css';

	const { children } = $props();
</script>

{@render children()}
<SignalTrackerMonitor />

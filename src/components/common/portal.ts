/**
 * Svelte action: moves the element to document.body on mount.
 * Use for overlays/backdrops that need position:fixed relative to viewport.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);

	return {
		destroy(): void {
			if (node.parentNode) {
				node.parentNode.removeChild(node);
			}
		},
	};
}

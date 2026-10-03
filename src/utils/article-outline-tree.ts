export function buildOutlineTree(headings: { index: number; level: number }[]) {
	const nodes = headings.map((heading) => ({
		...heading,
		parent: null as number | null,
		children: [] as number[],
	}));
	const stack: (typeof nodes)[number][] = [];
	for (const node of nodes) {
		while (stack.length && stack[stack.length - 1].level >= node.level)
			stack.pop();
		const parent = stack[stack.length - 1];
		if (parent) {
			node.parent = parent.index;
			parent.children.push(node.index);
		}
		stack.push(node);
	}
	return nodes;
}

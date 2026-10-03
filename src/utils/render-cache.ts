export function createRenderCache<Entry extends { id: string }, Result>(
	render: (entry: Entry) => Promise<Result>,
	enabled: boolean,
) {
	const cache = new Map<string, Promise<Result>>();
	return (entry: Entry): Promise<Result> => {
		if (!enabled) return render(entry);
		const existing = cache.get(entry.id);
		if (existing) return existing;
		const result = render(entry).catch((error) => {
			cache.delete(entry.id);
			throw error;
		});
		cache.set(entry.id, result);
		return result;
	};
}

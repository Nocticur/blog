export function resolveShareImage({
	site,
	generated,
	cover,
	fallback,
}: {
	site: URL | undefined;
	generated?: string;
	cover?: string;
	fallback: string;
}): string {
	for (const candidate of [generated, cover, fallback]) {
		if (!candidate) continue;
		try {
			const image = new URL(candidate, site);
			if (image.protocol === "https:" || image.protocol === "http:")
				return image.href;
		} catch {
			/* Try the next configured image. */
		}
	}
	return "";
}

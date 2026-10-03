export function termToSlug(term: string): string {
	return encodeURIComponent(termToRouteParam(term));
}

export function taxonomyPath(
	kind: "tags" | "categories",
	term: string,
	enabled: boolean,
): string {
	return enabled
		? `/${kind}/${termToSlug(term)}/`
		: `/archive/?${kind === "tags" ? "tag" : "category"}=${encodeURIComponent(term.trim())}`;
}

// Astro params contain decoded text. Encode only when constructing links.
// Reserved path names use an injective ASCII form so every term has one segment.
export function termToRouteParam(term: string): string {
	const value = term.trim();
	if (/[%/\\?#~]/.test(value) || value === "." || value === "..") {
		return `~${Array.from(new TextEncoder().encode(value), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("")}`;
	}
	return value;
}

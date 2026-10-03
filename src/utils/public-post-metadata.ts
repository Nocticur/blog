import type { MarkdownHeading } from "astro";

export function getPublicPostDescription(
	data: { password?: string; description?: string },
	excerpt: string,
): string {
	return data.description?.trim() || (data.password ? "" : excerpt);
}

export function getPublicPostHeadings(
	data: { password?: string },
	headings: MarkdownHeading[],
): MarkdownHeading[] {
	return data.password ? [] : headings;
}

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function renderGuestbookMessage(body: string): string {
	const rendered = marked.parse(body, {
		async: false,
		breaks: true,
		gfm: true,
	});

	return sanitizeHtml(String(rendered), {
		allowedTags: ["p", "br", "a", "img", "strong", "em", "code"],
		allowedAttributes: {
			a: ["href", "title", "target", "rel"],
			img: ["src", "alt", "title", "loading", "decoding", "referrerpolicy"],
		},
		allowedSchemes: ["http", "https"],
		transformTags: {
			a: (_tagName, attributes) => ({
				tagName: "a",
				attribs: {
					...attributes,
					target: "_blank",
					rel: "nofollow noopener noreferrer",
				},
			}),
			img: (_tagName, attributes) => ({
				tagName: "img",
				attribs: {
					...attributes,
					loading: "lazy",
					decoding: "async",
					referrerpolicy: "no-referrer",
				},
			}),
		},
	});
}

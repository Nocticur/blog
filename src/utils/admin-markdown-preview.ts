/** Restrict preview HTML to inert Markdown elements; MDX components are never evaluated. */
export function sanitizeMarkdownHtml(rendered: string): string {
	if (typeof DOMParser === "undefined") return "";
	const document = new DOMParser().parseFromString(rendered, "text/html");
	const allowed = new Set(["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "hr", "strong", "em", "del", "s", "pre", "code", "a", "img", "table", "thead", "tbody", "tr", "th", "td"]);
	const dangerous = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "form", "input", "button", "textarea", "link", "meta", "base"]);
	for (const element of Array.from(document.body.querySelectorAll("*"))) {
		const tag = element.tagName.toLowerCase();
		if (!allowed.has(tag)) {
			if (dangerous.has(tag)) element.remove();
			else element.replaceWith(...Array.from(element.childNodes));
			continue;
		}
		const attrs = tag === "a" ? ["href", "title"] : tag === "img" ? ["src", "alt", "title"] : [];
		for (const attribute of Array.from(element.attributes)) {
			if (!attrs.includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
		}
		const urlAttribute = tag === "a" ? "href" : tag === "img" ? "src" : "";
		if (urlAttribute) {
			const value = element.getAttribute(urlAttribute);
			if (value !== null) {
				let safe = false;
				try {
					const parsed = new URL(value, "https://markdown-preview.invalid/");
					safe = ["https:", "http:"].includes(parsed.protocol) || (tag === "a" && parsed.protocol === "mailto:");
					if (tag === "img" && /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z\d+/=]+$/iu.test(value)) safe = true;
				} catch { /* Invalid URL remains inert. */ }
				if (!safe) element.removeAttribute(urlAttribute);
			}
		}
	}
	return document.body.innerHTML;
}

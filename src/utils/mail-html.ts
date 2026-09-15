const BLOCKED_MAIL_TAGS = new Set([
	"applet",
	"audio",
	"base",
	"button",
	"embed",
	"form",
	"frame",
	"frameset",
	"iframe",
	"input",
	"link",
	"math",
	"meta",
	"object",
	"script",
	"select",
	"source",
	"style",
	"svg",
	"template",
	"textarea",
	"track",
	"video",
]);

const ALLOWED_MAIL_ATTRS = new Set([
	"alt",
	"height",
	"href",
	"src",
	"title",
	"width",
]);

function isSafeMailHref(value: string): boolean {
	return /^(https?:|mailto:|tel:)/i.test(value.trim());
}

function isSafeMailImage(value: string): boolean {
	return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(
		value.trim(),
	);
}

/**
 * Mail HTML is untrusted content. Keep a narrow allowlist instead of trying to
 * make arbitrary CSS safe. Remote resources are intentionally removed to avoid
 * tracking requests and unexpected layout impact.
 */
export function sanitizeMailHtml(html: string): string {
	const template = document.createElement("template");
	template.innerHTML = html;

	const elements = Array.from(template.content.querySelectorAll("*"));
	for (const element of elements) {
		if (BLOCKED_MAIL_TAGS.has(element.tagName.toLowerCase())) {
			element.remove();
			continue;
		}

		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value;

			if (name.startsWith("on") || name === "srcdoc" || name === "style") {
				element.removeAttribute(attribute.name);
				continue;
			}

			if (!ALLOWED_MAIL_ATTRS.has(name)) {
				element.removeAttribute(attribute.name);
				continue;
			}

			if (name === "href" && !isSafeMailHref(value)) {
				element.removeAttribute(attribute.name);
			}

			if (name === "src" && !isSafeMailImage(value)) {
				element.removeAttribute(attribute.name);
			}
		}

		if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) {
			element.setAttribute("target", "_blank");
			element.setAttribute("rel", "noopener noreferrer nofollow");
		}
	}

	return template.innerHTML;
}

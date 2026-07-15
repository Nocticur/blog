function isSafeUrl(value: string): boolean {
	return /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/|\?)/i.test(value.trim());
}

export function renderSimpleMarkdown(text: string): string {
	let html = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");

	html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
	html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
		if (!isSafeUrl(url)) return `[${label}](${url})`;
		return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
	});
	return html.replace(/\n/g, "<br>");
}

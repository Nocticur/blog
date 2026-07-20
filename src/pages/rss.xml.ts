import { loadRenderers } from "astro:container";
import { render } from "astro:content";
import { getContainerRenderer as getMDXRenderer } from "@astrojs/mdx";
import rss, { type RSSFeedItem } from "@astrojs/rss";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getSortedPosts } from "@utils/content-utils";
import { formatDateI18nWithTime } from "@utils/date-utils";
import { url } from "@utils/url-utils";
import type { APIContext } from "astro";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import sanitizeHtml from "sanitize-html";
import { siteConfig } from "@/config";
import pkg from "../../package.json";

function stripInvalidXmlChars(str: string): string {
	return str.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: https://www.w3.org/TR/xml/#charsets
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFDD0-\uFDEF\uFFFE\uFFFF]/g,
		"",
	);
}

async function createRssContainer(renderers: Awaited<ReturnType<typeof loadRenderers>>) {
	const originalConsoleWarn = console.warn;
	console.warn = (...args: Parameters<typeof console.warn>) => {
		const [message] = args;
		// Astro 6 validates its own legacy container defaults, not this project's processor.
		if (
			typeof message === "string" &&
			message.startsWith(
				"[astro] `markdown.gfm` and `markdown.smartypants` are deprecated.",
			)
		) {
			return;
		}
		originalConsoleWarn(...args);
	};

	try {
		return await AstroContainer.create({ renderers });
	} finally {
		console.warn = originalConsoleWarn;
	}
}

export async function GET(context: APIContext): Promise<Response> {
	const blog = await getSortedPosts();
	const renderers = await loadRenderers([getMDXRenderer()]);
	const container = await createRssContainer(renderers);
	const feedItems: RSSFeedItem[] = [];
	for (const post of blog) {
		if (post.data.password) {
			feedItems.push({
				title: post.data.title,
				pubDate: post.data.published,
				description: post.data.description || "",
				link: url(`/posts/${post.id}/`),
				content: i18n(I18nKey.passwordProtectedRss),
			});
			continue;
		}
		const { Content } = await render(post as Parameters<typeof render>[0]);
		const rawContent = await container.renderToString(Content);
		const cleanedContent = stripInvalidXmlChars(rawContent);
		feedItems.push({
			title: post.data.title,
			pubDate: post.data.published,
			description: post.data.description || "",
			link: url(`/posts/${post.id}/`),
			content: sanitizeHtml(cleanedContent, {
				allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
			}),
		});
	}
	const response = await rss({
		title: siteConfig.title,
		description: siteConfig.subtitle || "No description",
		site: context.site ?? "https://firefly.cuteleaf.cn",
		customData: `<templateTheme>Firefly</templateTheme>
		<templateThemeVersion>${pkg.version}</templateThemeVersion>
		<templateThemeUrl>https://github.com/CuteLeaf/Firefly</templateThemeUrl>
		<lastBuildDate>${formatDateI18nWithTime(new Date())}</lastBuildDate>`,
		items: feedItems,
	});
	const headers = new Headers(response.headers);
	headers.set(
		"Cache-Control",
		"public, max-age=3600, stale-while-revalidate=86400",
	);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

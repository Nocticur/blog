import type { CollectionEntry } from "astro:content";
import { siteConfig } from "@/config";
import { coverImageConfig } from "@/config/coverImageConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { ArticleListPost } from "@/types/article-list";
import type { CoverImageSource } from "@/types/cover-image";
import { buildCoverImage } from "@/utils/cover-image";
import { getApiUrlList, processCoverImageSync } from "@/utils/image-utils";
import { renderPostOnce } from "@/utils/post-render";
import { getPublicPostDescription } from "@/utils/public-post-metadata";
import { getFileDirFromPath, getPostUrlBySlug } from "@/utils/url-utils";

const fallbackImagePath = coverImageConfig.randomCoverImage.enable
	? coverImageConfig.randomCoverImage.fallback || ""
	: "";
export const CARD_COVER_WIDTHS = [320, 480, 640];
export const CARD_COVER_SIZES =
	"(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 320px";
export const PINNED_COVER_WIDTHS = [640, 960, 1280];
export const PINNED_COVER_SIZES = "(max-width: 1024px) 96vw, 1024px";
const dateFormatter = new Intl.DateTimeFormat(
	siteConfig.lang.replace("_", "-"),
	{
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	},
);

function getCategoryHue(category: string): number {
	let hash = 2166136261;
	for (let index = 0; index < category.length; index++) {
		hash ^= category.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % 360;
}

async function resolvePostCover(
	entry: CollectionEntry<"posts">,
	widths: number[],
	sizes: string,
): Promise<CoverImageSource | null> {
	const cover = await buildCoverImage({
		image: processCoverImageSync(entry.data.image, entry.id),
		basePath: getFileDirFromPath(entry.filePath || ""),
		widths,
		sizes,
	});
	if (cover) return cover;

	// 没写 image、或本地文件缺失：只有随机图开启时才退到兜底图，否则不渲染封面
	if (!fallbackImagePath) return null;
	return buildCoverImage({ image: fallbackImagePath, widths, sizes });
}

export async function createArticleListPost(
	entry: CollectionEntry<"posts">,
	coverWidths: number[],
	coverSizes: string,
): Promise<ArticleListPost> {
	const [{ remarkPluginFrontmatter }, cover] = await Promise.all([
		renderPostOnce(entry),
		resolvePostCover(entry, coverWidths, coverSizes),
	]);
	const rawCategory = entry.data.category?.trim();
	const category = rawCategory || i18n(I18nKey.uncategorized);
	const tags = (entry.data.tags || []).map((tag) => tag.trim()).filter(Boolean);

	return {
		id: entry.id,
		title: entry.data.title,
		url: getPostUrlBySlug(entry.id),
		publishedIso: entry.data.published.toISOString(),
		publishedTimestamp: entry.data.published.getTime(),
		publishedText: dateFormatter.format(entry.data.published),
		category,
		categoryHue: getCategoryHue(category),
		tags,
		description:
			getPublicPostDescription(
				entry.data,
				remarkPluginFrontmatter.excerpt || "",
			) || i18n(I18nKey.noDescriptionFallback),
		pinned: !!entry.data.pinned,
		password: !!entry.data.password,
		wordCount: Number(remarkPluginFrontmatter.words) || 0,
		cover,
		apiUrls: getApiUrlList(entry.data.image, entry.id),
	};
}

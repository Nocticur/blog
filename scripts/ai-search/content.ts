import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { glob } from "glob";
import { aiSearchConfig } from "../../src/config/aiSearchConfig";

export interface BlogPost {
	title: string;
	category: string;
	tags: string[];
	published: string;
	slug: string;
	content: string;
	hash: string;
}

export interface SearchChunk {
	id: string;
	slug: string;
	text: string;
	metadata: {
		articleTitle: string;
		articlePath: string;
		published: string;
		category: string;
		tags: string;
		heading: string;
		excerpt: string;
	};
}

interface ContentSection {
	heading: string;
	text: string;
	occurrence: number;
}

function shortHash(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeDate(value: unknown): string {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return value === undefined || value === null ? "" : String(value);
}

export async function loadPosts(cwd = process.cwd()): Promise<BlogPost[]> {
	const files = await glob("src/content/posts/**/*.{md,mdx}", { cwd });
	const posts: BlogPost[] = [];

	for (const file of files.sort()) {
		const fullPath = path.resolve(cwd, file);
		const raw = fs.readFileSync(fullPath, "utf-8");
		const { data: frontmatter, content } = matter(raw);
		if (frontmatter.draft) continue;

		const normalized = path.normalize(file).replace(/\\/g, "/");
		const slug = normalized
			.replace(/^\.\//, "")
			.replace(/^src\/content\/posts\//, "")
			.replace(/\.(md|mdx)$/i, "");
		const tags = Array.isArray(frontmatter.tags)
			? frontmatter.tags.map(String)
			: [];

		posts.push({
			title: frontmatter.title ? String(frontmatter.title) : "无标题",
			category: frontmatter.category ? String(frontmatter.category) : "",
			tags,
			published: normalizeDate(frontmatter.published),
			slug,
			content,
			hash: shortHash(raw),
		});
	}
	return posts;
}

function splitByHeadings(content: string, articleTitle: string): ContentSection[] {
	const sections: ContentSection[] = [];
	const headingOccurrences = new Map<string, number>();
	let currentHeadingPath: string[] = [];
	let currentContent: string[] = [];

	function flush() {
		const text = currentContent.join("\n").trim();
		if (text.length < aiSearchConfig.index.minimumChunkCharacters) return;
		const heading = currentHeadingPath.join(" > ") || articleTitle;
		const occurrence = (headingOccurrences.get(heading) ?? 0) + 1;
		headingOccurrences.set(heading, occurrence);
		sections.push({ heading, text, occurrence });
	}

	for (const line of content.split("\n")) {
		const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
		if (!headingMatch) {
			currentContent.push(line);
			continue;
		}

		flush();
		currentContent = [];
		const level = headingMatch[1].length;
		currentHeadingPath = currentHeadingPath.slice(0, level - 1);
		currentHeadingPath[level - 1] = headingMatch[2].trim();
	}
	flush();
	return sections;
}

export function buildChunksForPost(post: BlogPost): SearchChunk[] {
	return splitByHeadings(post.content, post.title).map((section) => {
		const text = [
			`文章：${post.title}`,
			post.published ? `日期：${post.published}` : "",
			post.category ? `分类：${post.category}` : "",
			post.tags.length ? `标签：${post.tags.join(", ")}` : "",
			`章节：${section.heading}`,
			"",
			section.text,
		]
			.filter(Boolean)
			.join("\n");
		return {
			id: shortHash(`${post.slug}::${section.heading}::${section.occurrence}`),
			slug: post.slug,
			text,
			metadata: {
				articleTitle: post.title,
				articlePath: `/posts/${post.slug.toLowerCase()}/`,
				published: post.published,
				category: post.category,
				tags: post.tags.join(", "),
				heading: section.heading,
				excerpt: section.text.slice(
					0,
					aiSearchConfig.index.maximumExcerptCharacters,
				),
			},
		};
	});
}

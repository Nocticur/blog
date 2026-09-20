import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const postsCollection = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		lang: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		author: z.string().optional().default(""),
		sourceLink: z.string().optional().default(""),
		licenseName: z.string().optional().default(""),
		licenseUrl: z.string().optional().default(""),
		comment: z.boolean().optional().default(true),
		password: z.string().optional().default(""),
		passwordHint: z.string().optional().default(""),
		// 仅从公开机器知识入口排除，文章页面仍然保留。
		wikiExclude: z.boolean().optional().default(false),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});

const specCollection = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/spec" }),
	schema: z.object({}),
});


const dynamicCollection = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/dynamic" }),
	schema: z.object({
		published: z.coerce.date(),
		updated: z.coerce.date().optional(),
		title: z.string().optional().default(""),
		description: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		tags: z.array(z.string()).optional().default([]),
		location: z.string().optional().default(""),
		device: z.string().optional().default(""),
		photos: z.array(z.string()).optional().default([]),
		draft: z.boolean().optional().default(false),
		comment: z.boolean().optional().default(true),
	}),
});

const lifeEntrySchema = z.object({
	title: z.string().optional().default(""),
	name: z.string().optional().default(""),
	description: z.string().optional().default(""),
	date: z.coerce.date().optional(),
	updatedAt: z.coerce.date().optional(),
	status: z.enum(["done", "todo", "active"]).optional().default("todo"),
	icon: z.string().optional().default(""),
	time: z.string().optional().default(""),
	province: z.string().optional().default(""),
	city: z.string().optional().default(""),
	experience: z.string().optional().default(""),
	lat: z.number().min(-90).max(90).optional(),
	lng: z.number().min(-180).max(180).optional(),
	photos: z.array(z.string()).optional().default([]),
	tags: z.array(z.string()).optional().default([]),
	cover: z.string().optional().default(""),
	draft: z.boolean().optional().default(false),
});

const lifeCollection = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx,json}", base: "./src/content/life" }),
	schema: lifeEntrySchema,
});
export const collections = {
	posts: postsCollection,
	spec: specCollection,
	dynamic: dynamicCollection,
	life: lifeCollection,
};

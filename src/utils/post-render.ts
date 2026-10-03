import { type CollectionEntry, render } from "astro:content";
import { createRenderCache } from "./render-cache";
export const renderPostOnce = createRenderCache(
	(entry: CollectionEntry<"posts">) => render(entry),
	import.meta.env.PROD,
);

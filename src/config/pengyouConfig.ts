import feeds from "../data/feeds.json";
export type PengyouFeed = {
	name: string;
	url: string;
	avatar?: string;
	enabled?: boolean;
};
export const pengyouConfig = {
	enabled: true,
	pageSize: 12,
	feeds: feeds as PengyouFeed[],
};

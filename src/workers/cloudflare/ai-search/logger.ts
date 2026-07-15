import type { AiSearchLogger } from "@/server/ai-search/contracts";

export const cloudflareAiSearchLogger: AiSearchLogger = {
	error(event, error, fields = {}) {
		const details =
			error instanceof Error
				? {
						errorName: error.name,
						errorMessage: error.message,
						stack: error.stack,
					}
				: { errorMessage: String(error) };
		console.error(JSON.stringify({ event, ...fields, ...details }));
	},
};

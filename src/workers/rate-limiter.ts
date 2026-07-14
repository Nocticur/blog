import { DurableObject } from "cloudflare:workers";

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfter: number;
}

interface RateLimitRow {
	count: number;
	reset_at: number;
}

export class RateLimiter extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS rate_limit (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				count INTEGER NOT NULL,
				reset_at INTEGER NOT NULL
			)
		`);
	}

	check(max: number, windowSeconds: number, now = Date.now()): RateLimitResult {
		if (
			!Number.isInteger(max) ||
			max < 1 ||
			!Number.isInteger(windowSeconds) ||
			windowSeconds < 1
		) {
			throw new Error("Invalid rate limit configuration");
		}

		const row = this.ctx.storage.sql
			.exec("SELECT count, reset_at FROM rate_limit WHERE id = 1")
			.toArray()[0] as unknown as RateLimitRow | undefined;
		const nextReset = now + windowSeconds * 1000;

		if (!row || row.reset_at <= now) {
			this.ctx.storage.sql.exec(
				`INSERT INTO rate_limit (id, count, reset_at) VALUES (1, 1, ?)
				 ON CONFLICT(id) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
				nextReset,
			);
			return { allowed: true, remaining: max - 1, retryAfter: 0 };
		}

		const retryAfter = Math.max(1, Math.ceil((row.reset_at - now) / 1000));
		if (row.count >= max) {
			return { allowed: false, remaining: 0, retryAfter };
		}

		const nextCount = row.count + 1;
		this.ctx.storage.sql.exec(
			"UPDATE rate_limit SET count = ? WHERE id = 1",
			nextCount,
		);
		return {
			allowed: true,
			remaining: Math.max(0, max - nextCount),
			retryAfter: 0,
		};
	}
}

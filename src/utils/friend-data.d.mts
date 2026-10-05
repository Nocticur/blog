import type { FriendLink } from "../types/config";

export function friendWebUrl(value: string): URL;
export function friendUrlKey(value: string): string;
export function isFriendImageUrl(value: unknown): boolean;
export function normalizeFriendDraft(
	draft: Partial<FriendLink> & Record<string, unknown>,
	existing?: Partial<FriendLink> & Record<string, unknown>,
): FriendLink & Record<string, unknown>;

export function normalizeAnnouncements<T>(config: T): T;
export function sortAnnouncementItems<T extends { sort: number }>(items: readonly T[]): T[];
export function visibleAnnouncements<T extends { sort: number; enabled?: boolean }>(config: { items: readonly T[] }): T[];
export function announcementTitle(config: { title?: unknown } | null | undefined): string;
export function announcementDate(now?: Date | string | number): string;
export function validateAnnouncements(config: unknown): string | null;

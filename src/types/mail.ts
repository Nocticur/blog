export interface MailSession {
	address: string;
	jwt: string;
}

export interface MailMessage {
	id: string;
	subject?: string;
	sender?: string;
	address?: string;
	created_at?: string | number;
	is_unread?: boolean;
	metadata?: unknown;
}

export interface MailAttachment {
	filename?: string;
	mimeType?: string;
	disposition?: string;
	size?: number;
}

export interface MailDetail {
	sender?: string;
	subject?: string;
	text?: string;
	html?: string;
	attachments?: MailAttachment[];
}

export interface MailListResponse {
	results: MailMessage[];
	count: number;
}

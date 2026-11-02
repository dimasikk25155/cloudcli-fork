export interface MailAttachment {
    id: string;
    filename: string;
    contentType: string;
    size: number;
}
export interface MailMessage {
    inboxId: string;
    messageId: string;
    threadId: string;
    from: string;
    to: string[];
    subject: string;
    text: string;
    timestamp: string;
    attachments: MailAttachment[];
    labels: string[];
}
export interface MailDraftInput {
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    replyToId?: string;
    attachments: {
        filename: string;
        contentType: string;
        content: string;
    }[];
}
export interface MailDraft {
    inboxId: string;
    input: MailDraftInput;
    state: 'draft' | 'approved' | 'sending' | 'accepted' | 'uncertain';
    approval?: {
        userId: number;
        at: string;
        snapshot: MailDraftInput;
    };
    messageId?: string;
    threadId?: string;
}

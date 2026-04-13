import { Resend } from 'resend';

export interface SendInsightEmailParams {
  to: string[];
  subject: string;
  markdownBody: string;
  from?: string;
}

export interface SendInsightEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Convert simple markdown to basic HTML. Handles headers, bold, bullets,
 * and line breaks — good enough for the weekly insight reports.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const htmlLines: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Close list if we've left bullet territory
    if (inList && !trimmed.startsWith('- ') && !trimmed.startsWith('* ')) {
      htmlLines.push('</ul>');
      inList = false;
    }

    if (trimmed === '') {
      htmlLines.push('<br>');
      continue;
    }

    // Headers
    const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = Math.min(headerMatch[1]!.length + 1, 6); // # → h2, ## → h3, etc.
      htmlLines.push(`<h${level}>${inlineMd(headerMatch[2]!)}</h${level}>`);
      continue;
    }

    // Bullets
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) {
        htmlLines.push('<ul>');
        inList = true;
      }
      htmlLines.push(`<li>${inlineMd(trimmed.slice(2))}</li>`);
      continue;
    }

    // Plain text paragraph
    htmlLines.push(`<p>${inlineMd(trimmed)}</p>`);
  }

  if (inList) htmlLines.push('</ul>');

  return htmlLines.join('\n');
}

/** Handle inline formatting: **bold** and _italic_. */
function inlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
}

export async function sendInsightEmail(
  params: SendInsightEmailParams,
): Promise<SendInsightEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  const from =
    params.from ?? process.env.EMAIL_FROM ?? 'Budget Tracker <noreply@example.com>';

  const html = markdownToHtml(params.markdownBody);

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html,
    });

    if (error) {
      return { sent: false, error: error.message };
    }

    return { sent: true, messageId: data?.id };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Unknown email error',
    };
  }
}

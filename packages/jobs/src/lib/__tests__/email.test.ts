import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: mockSend },
  })),
}));

import { sendInsightEmail, markdownToHtml } from '../email.ts';

describe('markdownToHtml', () => {
  it('converts headers (# → h2, ## → h3)', () => {
    expect(markdownToHtml('# Title')).toContain('<h2>Title</h2>');
    expect(markdownToHtml('## Subtitle')).toContain('<h3>Subtitle</h3>');
    expect(markdownToHtml('### Deep')).toContain('<h4>Deep</h4>');
  });

  it('converts **bold** to <strong>', () => {
    const result = markdownToHtml('This is **important** text');
    expect(result).toContain('<strong>important</strong>');
  });

  it('converts __bold__ to <strong>', () => {
    const result = markdownToHtml('This is __important__ text');
    expect(result).toContain('<strong>important</strong>');
  });

  it('converts *italic* to <em>', () => {
    const result = markdownToHtml('This is *subtle* text');
    expect(result).toContain('<em>subtle</em>');
  });

  it('converts bullet lists (- and *)', () => {
    const md = '- Item one\n- Item two';
    const html = markdownToHtml(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Item one</li>');
    expect(html).toContain('<li>Item two</li>');
    expect(html).toContain('</ul>');
  });

  it('converts * bullet lists', () => {
    const md = '* First\n* Second';
    const html = markdownToHtml(md);
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('<li>Second</li>');
  });

  it('wraps plain text in <p> tags', () => {
    const result = markdownToHtml('Just a paragraph.');
    expect(result).toContain('<p>Just a paragraph.</p>');
  });

  it('inserts <br> for empty lines', () => {
    const result = markdownToHtml('Line one\n\nLine two');
    expect(result).toContain('<br>');
  });

  it('closes list before non-list content', () => {
    const md = '- Item\nParagraph after';
    const html = markdownToHtml(md);
    const ulClose = html.indexOf('</ul>');
    const para = html.indexOf('<p>Paragraph after</p>');
    expect(ulClose).toBeLessThan(para);
  });
});

describe('sendInsightEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it('returns sent: false when RESEND_API_KEY is unset', async () => {
    const result = await sendInsightEmail({
      to: ['test@example.com'],
      subject: 'Test',
      markdownBody: '# Hello',
    });

    expect(result).toEqual({
      sent: false,
      error: 'RESEND_API_KEY not configured',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('calls Resend with correct params when API key is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-123' }, error: null });

    await sendInsightEmail({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Weekly Report — Apr 7–13',
      markdownBody: '# Report\n\nAll good.',
    });

    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0]![0];
    expect(call.to).toEqual(['a@example.com', 'b@example.com']);
    expect(call.subject).toBe('Weekly Report — Apr 7–13');
    expect(call.from).toBe('Budget Tracker <noreply@example.com>');
    expect(call.html).toContain('<h2>Report</h2>');
  });

  it('uses custom EMAIL_FROM env var', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'Custom <custom@example.com>';
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-456' }, error: null });

    await sendInsightEmail({
      to: ['test@example.com'],
      subject: 'Test',
      markdownBody: 'Body',
    });

    expect(mockSend.mock.calls[0]![0].from).toBe('Custom <custom@example.com>');
  });

  it('uses from param over env var', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'Env <env@example.com>';
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-789' }, error: null });

    await sendInsightEmail({
      to: ['test@example.com'],
      subject: 'Test',
      markdownBody: 'Body',
      from: 'Override <override@example.com>',
    });

    expect(mockSend.mock.calls[0]![0].from).toBe('Override <override@example.com>');
  });

  it('returns sent: true with messageId on success', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-abc' }, error: null });

    const result = await sendInsightEmail({
      to: ['test@example.com'],
      subject: 'Test',
      markdownBody: 'Body',
    });

    expect(result).toEqual({ sent: true, messageId: 'msg-abc' });
  });

  it('returns sent: false with error when Resend returns an error', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid API key' },
    });

    const result = await sendInsightEmail({
      to: ['test@example.com'],
      subject: 'Test',
      markdownBody: 'Body',
    });

    expect(result).toEqual({ sent: false, error: 'Invalid API key' });
  });

  it('returns sent: false with error when Resend throws', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    mockSend.mockRejectedValueOnce(new Error('Network failure'));

    const result = await sendInsightEmail({
      to: ['test@example.com'],
      subject: 'Test',
      markdownBody: 'Body',
    });

    expect(result).toEqual({ sent: false, error: 'Network failure' });
  });
});

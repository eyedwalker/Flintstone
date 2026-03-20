import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../../../core/services/api.service';
import { ROLE_ACCESS_LEVELS, RoleLevelValue } from '../../../../lib/models/knowledge-base.model';

export interface IActionGroupCall {
  actionGroupName: string;
  apiPath?: string;
  verb?: string;
  parameters?: Array<{ name: string; type?: string; value?: string }>;
  result?: string;
}

export interface IChatMessage {
  role: 'user' | 'assistant';
  text: string;
  actionGroupCalls?: IActionGroupCall[];
}

@Component({
  selector: 'bcc-chat-tester',
  templateUrl: './chat-tester.component.html',
  styleUrls: ['./chat-tester.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatTesterComponent implements AfterViewChecked {
  @Input() assistantId = '';
  @Input() tenantId = '';
  @Input() canChat = false;

  chatMessages: IChatMessage[] = [];
  chatInput = '';
  chatSessionId = '';
  chatLoading = false;
  testRoleLevel: RoleLevelValue = 4;
  readonly roleAccessLevels = ROLE_ACCESS_LEVELS;
  private shouldScrollChat = false;

  @ViewChild('chatBody') chatBodyRef!: ElementRef<HTMLDivElement>;

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
  ) {}

  ngAfterViewChecked(): void {
    if (this.shouldScrollChat && this.chatBodyRef) {
      const el = this.chatBodyRef.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollChat = false;
    }
  }

  async sendChatMessage(): Promise<void> {
    const text = this.chatInput.trim();
    if (!text || this.chatLoading) return;

    this.chatMessages.push({ role: 'user', text });
    this.chatInput = '';
    this.chatLoading = true;
    this.shouldScrollChat = true;
    this.cdr.markForCheck();

    const res = await this.api.post<{ reply: string; sessionId: string; actionGroupCalls?: IActionGroupCall[] }>(
      `/assistants/${this.assistantId}/chat`,
      { message: text, sessionId: this.chatSessionId || undefined, testRoleLevel: this.testRoleLevel },
    );

    if (res.success && res.data) {
      this.chatSessionId = res.data.sessionId;
      this.chatMessages.push({
        role: 'assistant',
        text: res.data.reply,
        actionGroupCalls: res.data.actionGroupCalls,
      });
    } else {
      this.chatMessages.push({ role: 'assistant', text: `Error: ${res.error ?? 'Unknown error'}` });
    }
    this.chatLoading = false;
    this.shouldScrollChat = true;
    this.cdr.markForCheck();
  }

  clearChat(): void {
    this.chatMessages = [];
    this.chatSessionId = '';
  }

  onTestRoleChange(): void {
    this.chatMessages = [];
    this.chatSessionId = '';
  }

  onChatKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendChatMessage();
    }
  }

  /** Convert markdown images, data URIs, and S3 chart URLs in text to <img> tags */
  renderMessage(text: string): SafeHtml {
    // Replace ![alt](url) markdown images (data URIs or image file URLs)
    let html = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, src) => {
        if (/^data:image\//.test(src) || /\.(svg|png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(src)) {
          return `<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0;">`;
        }
        return match;
      });
    // Replace raw base64 SVG data URIs
    html = html.replace(/(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)/g,
      (src) => `<img src="${src}" alt="Chart" style="max-width:100%;border-radius:8px;margin:8px 0;">`);
    // Replace S3 chart URLs
    html = html.replace(/(https:\/\/[a-z0-9.-]+\.s3\.[a-z0-9-]+\.amazonaws\.com\/[^\s"'<>]+\.svg)/gi,
      (src) => `<img src="${src}" alt="Chart" style="max-width:100%;border-radius:8px;margin:8px 0;">`);
    // Escape remaining HTML but preserve our img tags
    const imgPlaceholders: string[] = [];
    html = html.replace(/<img [^>]+>/g, (match) => { imgPlaceholders.push(match); return `%%IMG${imgPlaceholders.length - 1}%%`; });
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    for (let i = 0; i < imgPlaceholders.length; i++) {
      html = html.replace(`%%IMG${i}%%`, imgPlaceholders[i]);
    }
    // Basic markdown: **bold**, newlines
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  // ── Report/chart helpers for extracting data from action group results ──

  private parseResult(call: IActionGroupCall): Record<string, unknown> | null {
    if (!call.result) return null;
    try {
      return typeof call.result === 'string' ? JSON.parse(call.result) : call.result;
    } catch {
      return null;
    }
  }

  getActionGroupLabel(calls: IActionGroupCall[]): string {
    const name = calls[0]?.actionGroupName ?? '';
    if (name.includes('snowflake') || name.includes('Snowflake')) return 'Snowflake Analytics';
    if (name.includes('front-office') || name.includes('Front')) return 'Front Office';
    // Detect by apiPath patterns
    const paths = calls.map(c => c.apiPath ?? '').join(' ');
    if (/patient|office|provider|appointment|sms|email/i.test(paths)) return 'Front Office';
    if (/query|chart|report|table|describe/i.test(paths)) return 'Snowflake Analytics';
    return name || 'Agent Tools';
  }

  getActionGroupIcon(calls: IActionGroupCall[]): string {
    const label = this.getActionGroupLabel(calls);
    if (label === 'Snowflake Analytics') return 'ac_unit';
    if (label === 'Front Office') return 'calendar_today';
    return 'build';
  }

  getDownloadUrl(call: IActionGroupCall): string | null {
    const p = this.parseResult(call);
    return (p?.['download_url'] as string) ?? null;
  }

  getFilename(call: IActionGroupCall): string {
    const p = this.parseResult(call);
    return (p?.['filename'] as string) ?? 'Download Report';
  }

  getRowCount(call: IActionGroupCall): number | null {
    const p = this.parseResult(call);
    return (p?.['rows'] as number) ?? (p?.['total_rows'] as number) ?? null;
  }

  getChartImage(call: IActionGroupCall): string | null {
    const p = this.parseResult(call);
    return (p?.['chart_image'] as string) ?? null;
  }
}

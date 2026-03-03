import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ROLE_ACCESS_LEVELS, RoleLevelValue } from '../../../../lib/models/knowledge-base.model';

export interface IChatMessage {
  role: 'user' | 'assistant';
  text: string;
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

    const res = await this.api.post<{ reply: string; sessionId: string }>(
      `/assistants/${this.assistantId}/chat`,
      { message: text, sessionId: this.chatSessionId || undefined, testRoleLevel: this.testRoleLevel },
    );

    if (res.success && res.data) {
      this.chatSessionId = res.data.sessionId;
      this.chatMessages.push({ role: 'assistant', text: res.data.reply });
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
}

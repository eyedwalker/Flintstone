import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  HostListener,
} from '@angular/core';
import { FormGroup } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

/** Pre-built template for launcher or chat interface */
export interface IUiTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  css: string;
  html?: string;
}

@Component({
  selector: 'bcc-ui-builder',
  templateUrl: './ui-builder.component.html',
  styleUrls: ['./ui-builder.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiBuilderComponent {
  @Input() form!: FormGroup;
  @Input() assistant: any;

  @Output() launcherUiGenerated = new EventEmitter<void>();
  @Output() chatUiGenerated = new EventEmitter<void>();

  activeUiComponent: 'launcher' | 'chat' = 'launcher';
  selectedLauncherTemplate = '';
  selectedChatTemplate = '';
  launcherAiPrompt = '';
  chatAiPrompt = '';
  generatingLauncherUi = false;
  generatingChatUi = false;
  launcherCode = '';
  launcherCssCode = '';
  chatCssCode = '';
  launcherCodeMode: 'visual' | 'code' = 'visual';
  chatCodeMode: 'visual' | 'code' = 'visual';
  pastedImagePreview: string | null = null;
  imageDropActive = false;

  readonly launcherTemplates: IUiTemplate[] = [
    {
      id: 'classic',
      name: 'Classic Circle',
      description: 'Simple circle with chat icon',
      icon: 'chat_bubble',
      css: '',
      html: '',
    },
    {
      id: 'pill',
      name: 'Pill with Text',
      description: 'Rounded pill shape with label',
      icon: 'smart_button',
      css: '.awsac-bubble { border-radius: 28px; width: auto; padding: 0 20px; gap: 8px; }',
      html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><span style="color:#fff;font-size:14px;font-weight:600">Chat with us</span>',
    },
    {
      id: 'pulse',
      name: 'Animated Pulse',
      description: 'Circle with pulsing ring animation',
      icon: 'radio_button_checked',
      css: '.awsac-bubble { animation: awsac-pulse-ring 2s ease-out infinite; }\n@keyframes awsac-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(0,111,180,0.5); } 70% { box-shadow: 0 0 0 15px rgba(0,111,180,0); } 100% { box-shadow: 0 0 0 0 rgba(0,111,180,0); } }',
    },
    {
      id: 'square',
      name: 'Rounded Square',
      description: 'Subtle rounded square design',
      icon: 'crop_square',
      css: '.awsac-bubble { border-radius: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); }',
    },
  ];

  readonly chatTemplates: IUiTemplate[] = [
    {
      id: 'modern',
      name: 'Modern',
      description: 'Clean, bright default design',
      icon: 'web',
      css: '',
    },
    {
      id: 'dark',
      name: 'Dark Mode',
      description: 'Dark background, light text',
      icon: 'dark_mode',
      css: '.awsac-panel { background: #1a1a2e; }\n.awsac-header { background: #16213e; }\n.awsac-messages { background: #1a1a2e; }\n.awsac-msg.assistant .awsac-msg-text { background: #2d2d44; color: #e0e0e0; }\n.awsac-msg.user .awsac-msg-text { background: #0f3460; }\n.awsac-input-wrap { background: #16213e; border-top-color: #2d2d44; }\n.awsac-input { background: #1a1a2e; color: #e0e0e0; }\n.awsac-welcome { background: #2d2d44; color: #e0e0e0; }\n.awsac-trend-chip { background: rgba(0,111,180,0.2); color: #64b5f6; }',
    },
    {
      id: 'glass',
      name: 'Glass Morphism',
      description: 'Frosted glass with blur backdrop',
      icon: 'blur_on',
      css: '.awsac-panel { background: rgba(255,255,255,0.75); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.3); }\n.awsac-header { background: rgba(0,111,180,0.85); backdrop-filter: blur(8px); }\n.awsac-messages { background: transparent; }\n.awsac-msg.assistant .awsac-msg-text { background: rgba(255,255,255,0.6); backdrop-filter: blur(4px); }\n.awsac-input-wrap { background: rgba(255,255,255,0.5); }',
    },
    {
      id: 'compact',
      name: 'Compact',
      description: 'Smaller, minimal chat panel',
      icon: 'compress',
      css: '.awsac-panel { width: 320px; height: 440px; border-radius: 16px; }\n.awsac-header { padding: 10px 14px; font-size: 14px; }\n.awsac-messages { padding: 8px; }\n.awsac-msg .awsac-msg-text { padding: 6px 10px; font-size: 13px; }\n.awsac-input { font-size: 13px; padding: 8px; }',
    },
  ];

  get assistantId(): string {
    return this.assistant?.assistantId ?? this.assistant?.id ?? '';
  }

  constructor(
    private assistantManager: AssistantManager,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
  ) {}

  /** Initialize launcher code from saved config, restoring CSS sections */
  initFromConfig(customLauncherHtml: string, customCss?: string): void {
    this.launcherCode = customLauncherHtml ?? '';
    if (customCss) {
      const sections = this.splitCssSections(customCss);
      this.launcherCssCode = sections.launcher;
      this.chatCssCode = sections.chat;
    } else {
      this.launcherCssCode = '';
      this.chatCssCode = '';
    }
  }

  /**
   * Parse pasted code (e.g. from Figma) into HTML and CSS parts.
   * Extracts <style> blocks into CSS, and everything else into HTML.
   */
  parsePastedCode(raw: string): { html: string; css: string } {
    let css = '';
    // Extract <style> blocks
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    while ((match = styleRegex.exec(raw)) !== null) {
      css += match[1].trim() + '\n';
    }
    // Remove <style> blocks from the raw input
    let html = raw.replace(styleRegex, '').trim();
    // If remaining text looks like pure CSS (has selectors with braces), move it to CSS
    if (!css && /^\s*[.#@\w[\],:>~+\-\s]+\{[\s\S]+\}\s*$/m.test(html)) {
      css = html;
      html = '';
    }
    return { html: html.trim(), css: css.trim() };
  }

  /** Handle paste events for image-to-UI generation */
  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        event.preventDefault();
        const file = items[i].getAsFile();
        if (file) this.handleImageFile(file);
        return;
      }
    }
  }

  onImageDrop(event: DragEvent): void {
    event.preventDefault();
    this.imageDropActive = false;
    const file = event.dataTransfer?.files?.[0];
    if (file?.type.startsWith('image/')) {
      this.handleImageFile(file);
    }
  }

  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    this.imageDropActive = true;
  }

  onImageDragLeave(): void {
    this.imageDropActive = false;
  }

  private handleImageFile(file: File): void {
    if (file.size > MAX_IMAGE_SIZE) {
      this.snackBar.open('Image is too large (max 5 MB)', 'OK', { duration: 4000 });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.pastedImagePreview = reader.result as string;
      this.cdr.markForCheck(); // OnPush: trigger re-render after async FileReader
    };
    reader.onerror = () => {
      this.snackBar.open('Failed to read image file', 'OK', { duration: 4000 });
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  clearPastedImage(): void {
    this.pastedImagePreview = null;
  }

  /**
   * Unified paste handler for the "paste anything" box.
   * Accepts raw Figma CSS properties, HTML, SVG, mixed code, or full CSS rules.
   * Routes content to the correct HTML/CSS fields automatically.
   */
  onUnifiedPaste(event: ClipboardEvent, component: 'launcher' | 'chat'): void {
    const text = event.clipboardData?.getData('text/plain')?.trim();
    if (!text) return;
    event.preventDefault();
    // Clear the paste box (it's just a pass-through, not a model)
    const target = event.target as HTMLTextAreaElement;
    if (target) target.value = '';

    const hasHtmlTags = /<[a-z][\s\S]*>/i.test(text);
    const hasCssSelectors = /[.#@\w[\],:>~+\-\s]+\{[\s\S]+?\}/m.test(text);
    const hasStyleTag = /<style[\s\S]*?<\/style>/i.test(text);
    // Detect raw CSS properties (like Figma output): "property: value;" lines without selectors
    const looksLikeRawCssProps = /^[\s\w-]+:\s*.+;?\s*$/m.test(text) && !hasCssSelectors && !hasHtmlTags;

    if (looksLikeRawCssProps) {
      // Raw Figma CSS — wrap in .awsac-bubble { ... }
      const cleaned = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('/*') && !line.startsWith('//'))
        // Remove position:absolute and large dimensions that don't apply to a 56px bubble
        .filter(line => !/^position\s*:/i.test(line))
        .filter(line => {
          const widthMatch = line.match(/^width\s*:\s*(\d+)/i);
          if (widthMatch && parseInt(widthMatch[1]) > 200) return false;
          const heightMatch = line.match(/^height\s*:\s*(\d+)/i);
          if (heightMatch && parseInt(heightMatch[1]) > 200) return false;
          return true;
        })
        .map(line => `  ${line}${line.endsWith(';') ? '' : ';'}`)
        .join('\n');
      const wrappedCss = `.awsac-bubble {\n${cleaned}\n}`;

      if (component === 'launcher') {
        this.launcherCssCode = wrappedCss;
        this.applyLauncherCode();
      } else {
        this.chatCssCode = wrappedCss;
        this.applyChatCode();
      }
      this.cdr.markForCheck();
      this.snackBar.open('Figma CSS wrapped in .awsac-bubble selector and applied', '', { duration: 3000 });
      return;
    }

    // Has HTML + CSS or <style> tags — use the smart parser
    if ((hasHtmlTags && hasCssSelectors) || hasStyleTag) {
      const parsed = this.parsePastedCode(text);
      if (component === 'launcher') {
        if (parsed.html) this.launcherCode = parsed.html;
        if (parsed.css) this.launcherCssCode = parsed.css;
        this.applyLauncherCode();
      } else {
        if (parsed.css) this.chatCssCode = parsed.css;
        this.applyChatCode();
      }
      this.cdr.markForCheck();
      this.snackBar.open('Code auto-split into HTML and CSS fields', '', { duration: 3000 });
      return;
    }

    // Pure HTML/SVG — put in HTML field
    if (hasHtmlTags) {
      if (component === 'launcher') {
        this.launcherCode = text;
        this.applyLauncherCode();
      }
      this.cdr.markForCheck();
      this.snackBar.open('HTML applied to launcher', '', { duration: 3000 });
      return;
    }

    // Pure CSS rules — put in CSS field
    if (hasCssSelectors) {
      if (component === 'launcher') {
        this.launcherCssCode = text;
        this.applyLauncherCode();
      } else {
        this.chatCssCode = text;
        this.applyChatCode();
      }
      this.cdr.markForCheck();
      this.snackBar.open('CSS applied', '', { duration: 3000 });
      return;
    }

    // Fallback: treat as raw CSS properties
    const wrapped = `.awsac-bubble {\n  ${text.replace(/\n/g, '\n  ')}\n}`;
    if (component === 'launcher') {
      this.launcherCssCode = wrapped;
      this.applyLauncherCode();
    } else {
      this.chatCssCode = wrapped;
      this.applyChatCode();
    }
    this.cdr.markForCheck();
    this.snackBar.open('Code applied as CSS', '', { duration: 3000 });
  }

  /**
   * Handle paste in a code textarea — auto-split mixed HTML+CSS from Figma exports.
   * If the pasted text contains both markup and CSS rules, split them into the correct fields.
   */
  onCodePaste(event: ClipboardEvent, component: 'launcher' | 'chat'): void {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;

    // Only auto-split if the pasted content looks like it has both HTML and CSS
    const hasHtml = /<[a-z][\s\S]*>/i.test(text);
    const hasCss = /[.#@\w[\],:>~+\-\s]+\{[\s\S]+?\}/m.test(text);
    const hasStyleTag = /<style[\s\S]*?<\/style>/i.test(text);

    if ((hasHtml && hasCss) || hasStyleTag) {
      event.preventDefault();
      const parsed = this.parsePastedCode(text);

      if (component === 'launcher') {
        if (parsed.html) this.launcherCode = parsed.html;
        if (parsed.css) this.launcherCssCode = parsed.css;
        this.applyLauncherCode();
      } else {
        if (parsed.css) this.chatCssCode = parsed.css;
        this.applyChatCode();
      }
      this.cdr.markForCheck();
      this.snackBar.open('Code auto-split into HTML and CSS fields', '', { duration: 3000 });
    }
    // If it's pure HTML or pure CSS, let the default paste behavior handle it
  }

  /** Generate UI code from pasted image */
  async generateFromImage(): Promise<void> {
    if (!this.pastedImagePreview) return;
    const component = this.activeUiComponent;
    if (component === 'launcher') {
      this.generatingLauncherUi = true;
    } else {
      this.generatingChatUi = true;
    }

    try {
      const result = await this.assistantManager.generateWidgetUi(
        this.assistantId, component, undefined, this.pastedImagePreview
      );

      if (result.success && result.data) {
        if (component === 'launcher') {
          if (result.data.html) this.launcherCode = result.data.html;
          if (result.data.css) this.launcherCssCode = result.data.css;
          this.applyLauncherCode();
          this.launcherCodeMode = 'code';
          this.launcherUiGenerated.emit();
        } else {
          if (result.data.css) this.chatCssCode = result.data.css;
          this.applyChatCode();
          this.chatCodeMode = 'code';
          this.chatUiGenerated.emit();
        }
        this.snackBar.open('UI generated from image \u2014 review the code and save', '', { duration: 4000 });
      } else {
        this.snackBar.open(`Generation failed: ${result.error || 'Unknown error'}`, 'OK', { duration: 5000 });
      }
    } catch (err) {
      this.snackBar.open(`Generation error: ${String(err)}`, 'OK', { duration: 5000 });
    } finally {
      this.generatingLauncherUi = false;
      this.generatingChatUi = false;
      this.pastedImagePreview = null;
      this.cdr.markForCheck();
    }
  }

  /** Select a launcher template */
  selectLauncherTemplate(template: IUiTemplate): void {
    this.selectedLauncherTemplate = template.id;
    this.launcherCssCode = template.css;
    this.launcherCode = template.html ?? '';
    this.applyLauncherCode();
  }

  /** Select a chat template */
  selectChatTemplate(template: IUiTemplate): void {
    this.selectedChatTemplate = template.id;
    this.chatCssCode = template.css;
    this.applyChatCode();
  }

  /** Generate launcher UI from AI prompt */
  async generateLauncherUi(): Promise<void> {
    const prompt = this.launcherAiPrompt?.trim();
    if (!prompt || this.generatingLauncherUi) return;
    this.generatingLauncherUi = true;
    const currentCode = this.launcherCode || this.launcherCssCode
      ? JSON.stringify({ html: this.launcherCode, css: this.launcherCssCode })
      : undefined;
    const result = await this.assistantManager.generateWidgetUi(
      this.assistantId, 'launcher', prompt, undefined, currentCode
    );
    if (result.success && result.data) {
      if (result.data.html) this.launcherCode = result.data.html;
      if (result.data.css) this.launcherCssCode = result.data.css;
      this.applyLauncherCode();
      this.selectedLauncherTemplate = '';
      this.launcherCodeMode = 'code';
      this.launcherUiGenerated.emit();
      this.snackBar.open('Launcher UI generated \u2014 review and save', '', { duration: 3000 });
    } else {
      this.snackBar.open(`Generation failed: ${result.error || 'Unknown error'}`, 'OK', { duration: 5000 });
    }
    this.generatingLauncherUi = false;
    this.cdr.markForCheck();
  }

  /** Generate chat UI from AI prompt */
  async generateChatUi(): Promise<void> {
    const prompt = this.chatAiPrompt?.trim();
    if (!prompt || this.generatingChatUi) return;
    this.generatingChatUi = true;
    const result = await this.assistantManager.generateWidgetUi(
      this.assistantId, 'chat', prompt, undefined, this.chatCssCode || undefined
    );
    if (result.success && result.data) {
      if (result.data.css) this.chatCssCode = result.data.css;
      this.applyChatCode();
      this.selectedChatTemplate = '';
      this.chatCodeMode = 'code';
      this.chatUiGenerated.emit();
      this.snackBar.open('Chat UI generated \u2014 review and save', '', { duration: 3000 });
    } else {
      this.snackBar.open(`Generation failed: ${result.error || 'Unknown error'}`, 'OK', { duration: 5000 });
    }
    this.generatingChatUi = false;
    this.cdr.markForCheck();
  }

  /** Apply launcher code to the form's customCss and customLauncherHtml */
  applyLauncherCode(): void {
    this.form.get('customLauncherHtml')?.setValue(this.launcherCode);
    this.mergeCssIntoForm();
  }

  /** Apply chat CSS to the form */
  applyChatCode(): void {
    this.mergeCssIntoForm();
  }

  /** Merge launcher + chat CSS into the single customCss form field, preserving user's manual CSS */
  private mergeCssIntoForm(): void {
    const existing = this.form.get('customCss')?.value ?? '';
    const sections = this.splitCssSections(existing);

    const parts: string[] = [];
    if (this.launcherCssCode) parts.push('/* Launcher */\n' + this.launcherCssCode);
    if (this.chatCssCode) parts.push('/* Chat Interface */\n' + this.chatCssCode);
    if (sections.other.trim()) parts.push(sections.other.trim());
    this.form.get('customCss')?.setValue(parts.join('\n\n'));
  }

  /** Split a combined CSS string into launcher, chat, and user-authored sections */
  private splitCssSections(css: string): { launcher: string; chat: string; other: string } {
    if (!css) return { launcher: '', chat: '', other: '' };

    const launcherStart = css.indexOf('/* Launcher */');
    const chatStart = css.indexOf('/* Chat Interface */');

    let launcher = '';
    let chat = '';
    let other = css;

    if (launcherStart >= 0) {
      const end = chatStart >= 0 && chatStart > launcherStart ? chatStart : css.length;
      launcher = css.slice(launcherStart + '/* Launcher */'.length, end).trim();
      other = css.slice(0, launcherStart) + css.slice(end);
    }
    if (chatStart >= 0) {
      const afterMarker = chatStart + '/* Chat Interface */'.length;
      // Find the next section marker or end of string
      const nextSection = other.indexOf('/* Launcher */', afterMarker);
      const end = nextSection >= 0 ? nextSection : css.length;
      chat = css.slice(afterMarker, end).trim();
      other = css.slice(0, chatStart) + css.slice(end);
    }

    // Clean up double newlines from section removal
    other = other.replace(/\n{3,}/g, '\n\n').trim();
    return { launcher, chat, other };
  }

  /** Reset launcher to default */
  resetLauncher(): void {
    this.launcherCode = '';
    this.launcherCssCode = '';
    this.selectedLauncherTemplate = 'classic';
    this.applyLauncherCode();
  }

  /** Reset chat interface to default */
  resetChat(): void {
    this.chatCssCode = '';
    this.selectedChatTemplate = 'modern';
    this.applyChatCode();
  }

  /** Get safe HTML for launcher preview — ensures SVG is sized and white for bubble contrast */
  get launcherPreviewHtml(): SafeHtml {
    let html = this.launcherCode || '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    html = this.prepareSvgForBubble(html);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Normalize an SVG for display inside the colored launcher bubble */
  private prepareSvgForBubble(html: string): string {
    // Add width/height if missing (Figma exports often omit them)
    if (/<svg\b/i.test(html) && !/\bwidth\s*=/i.test(html.match(/<svg[^>]*>/i)?.[0] ?? '')) {
      html = html.replace(/<svg\b/i, '<svg width="28" height="28"');
    }
    // Figma SVGs use fill="none" on root — force white for visibility
    html = html.replace(/<svg([^>]*)fill="none"/i, '<svg$1fill="white"');
    // Add fill="white" to shape elements that have no fill attribute
    html = html.replace(/<(path|circle|rect|polygon)(?![^>]*fill=)/gi, '<$1 fill="white"');
    return html;
  }
}

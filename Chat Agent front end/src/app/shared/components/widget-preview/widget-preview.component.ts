import { Component, Input, OnChanges, ViewChild, ElementRef } from '@angular/core';
import { IAssistant } from '../../../../lib/models/tenant.model';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'bcc-widget-preview',
  templateUrl: './widget-preview.component.html',
  styleUrls: ['./widget-preview.component.scss'],
})
export class WidgetPreviewComponent implements OnChanges {
  @Input() assistant!: IAssistant;
  @Input() customCss = '';
  @Input() customLauncherHtml = '';
  @ViewChild('previewFrame') frameRef!: ElementRef<HTMLIFrameElement>;

  get iframeSrcDoc(): string {
    if (!this.assistant) return '';
    const c = this.assistant.widgetConfig;
    const escapedCss = (this.customCss || '').replace(/<\/style/gi, '<\\/style');
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body{margin:0;height:100vh;background:#f5f7fa;font-family:sans-serif;}</style>
  ${escapedCss ? `<style>${escapedCss}</style>` : ''}
</head>
<body>
  <div style="padding:20px;color:#666;font-size:13px;">Preview</div>
  <script src="${environment.widgetCdnUrl}"><\/script>
  <script>
    if(typeof AWSAgentChat !== 'undefined'){
      AWSAgentChat.init({
        apiEndpoint: '${environment.chatApiBaseUrl}/chat',
        position: '${c.position}',
        primaryColor: '${c.primaryColor}',
        secondaryColor: '${c.secondaryColor}',
        title: '${c.title.replace(/'/g, "\\'")}',
        welcomeMessage: '${c.welcomeMessage.replace(/'/g, "\\'")}',
        placeholder: '${c.placeholder.replace(/'/g, "\\'")}',
        showTimestamp: ${c.showTimestamp},
        persistSession: false,
        zIndex: 9999,
        trendingQuestions: ${JSON.stringify(c.trendingQuestions)},
        ${this.customLauncherHtml ? `customLauncherHtml: '${this.customLauncherHtml.replace(/'/g, "\\'").replace(/\n/g, '')}',` : ''}
      });
    }
  <\/script>
</body>
</html>`;
  }

  ngOnChanges(): void {}
}

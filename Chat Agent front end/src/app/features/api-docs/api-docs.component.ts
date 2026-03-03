import { Component, OnInit, OnDestroy } from '@angular/core';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-api-docs',
  template: `
    <div class="api-docs-container">
      <div class="api-docs-header">
        <h1>API Documentation</h1>
        <p class="subtitle">OpenAPI 3.0.3 specification for the {{ appName }} API</p>
      </div>
      <div id="swagger-ui"></div>
    </div>
  `,
  styleUrls: ['./api-docs.component.scss'],
})
export class ApiDocsComponent implements OnInit, OnDestroy {
  appName = environment.appName;
  private linkEl: HTMLLinkElement | null = null;

  ngOnInit(): void {
    this.linkEl = document.createElement('link');
    this.linkEl.rel = 'stylesheet';
    this.linkEl.href = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';
    document.head.appendChild(this.linkEl);

    import('swagger-ui-dist/swagger-ui-bundle').then((mod) => {
      const SwaggerUIBundle = mod.default || mod;
      SwaggerUIBundle({
        dom_id: '#swagger-ui',
        url: `${environment.apiBaseUrl}/docs/openapi.yaml`,
        deepLinking: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 1,
        filter: true,
        tryItOutEnabled: false,
      });
    });
  }

  ngOnDestroy(): void {
    if (this.linkEl) {
      document.head.removeChild(this.linkEl);
      this.linkEl = null;
    }
  }
}

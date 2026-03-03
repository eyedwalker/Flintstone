import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, from, switchMap, catchError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { OrgContextService } from '../services/org-context.service';
import { environment } from '../../../environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private auth: AuthService,
    private orgCtx: OrgContextService,
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Only attach headers to our API
    if (!req.url.startsWith(environment.apiBaseUrl) && !req.url.startsWith(environment.chatApiBaseUrl)) {
      return next.handle(req);
    }

    const headers: Record<string, string> = {};
    const token = this.auth.idToken;
    if (token) headers['Authorization'] = token;
    const orgId = this.orgCtx.activeOrgId;
    if (orgId) headers['X-Organization-Id'] = orgId;

    const authReq = req.clone({ setHeaders: headers });

    return next.handle(authReq).pipe(
      catchError((error: HttpErrorResponse) => {
        // Status 0 can mean API Gateway rejected with 401 but CORS headers
        // were missing from the error response, so the browser blocked it.
        if (error.status === 401 || error.status === 0) {
          // Try refreshing token
          return from(this.auth.refreshToken()).pipe(
            switchMap((refreshed) => {
              if (!refreshed) {
                this.auth.signOut();
                return throwError(() => error);
              }
              const retryHeaders: Record<string, string> = {};
              const newToken = this.auth.idToken;
              if (newToken) retryHeaders['Authorization'] = newToken;
              if (orgId) retryHeaders['X-Organization-Id'] = orgId;
              return next.handle(req.clone({ setHeaders: retryHeaders }));
            }),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}

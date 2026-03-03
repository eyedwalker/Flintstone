import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';

@Injectable()
export class RetryInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Only retry safe (GET) requests
    if (req.method !== 'GET') return next.handle(req);

    return next.handle(req).pipe(
      retry({
        count: 2,
        delay: (error: HttpErrorResponse, retryCount: number) => {
          // Only retry on network errors or 5xx
          if (error.status === 0 || error.status >= 500) {
            return timer(Math.pow(2, retryCount) * 500);
          }
          return throwError(() => error);
        },
      }),
    );
  }
}

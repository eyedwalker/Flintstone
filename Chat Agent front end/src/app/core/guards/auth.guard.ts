import { Injectable } from '@angular/core';
import { CanActivate, CanActivateChild, Router, UrlTree } from '@angular/router';
import { Observable, from, of } from 'rxjs';
import { map, take, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/** Protects routes that require authentication. Also refreshes expired tokens. */
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate, CanActivateChild {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.auth.authState$.pipe(
      take(1),
      switchMap((state) => {
        if (!state.isAuthenticated) {
          return of(this.router.parseUrl('/auth/login'));
        }
        // If token is expired, try to refresh before allowing navigation
        if (this.auth.isTokenExpired()) {
          return from(this.auth.refreshToken()).pipe(
            map((refreshed) => refreshed ? true : this.router.parseUrl('/auth/login')),
          );
        }
        return of(true);
      }),
    );
  }

  canActivateChild(): Observable<boolean | UrlTree> {
    return this.canActivate();
  }
}

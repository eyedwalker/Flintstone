import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/** Prevents authenticated users from accessing auth pages (login, signup) */
@Injectable({ providedIn: 'root' })
export class GuestGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.auth.authState$.pipe(
      take(1),
      map((state) =>
        state.isAuthenticated ? this.router.parseUrl('/dashboard') : true
      )
    );
  }
}

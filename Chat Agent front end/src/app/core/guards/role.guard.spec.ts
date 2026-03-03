import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot } from '@angular/router';
import { RoleGuard } from './role.guard';
import { OrgContextService } from '../services/org-context.service';

describe('RoleGuard', () => {
  let guard: RoleGuard;
  let mockOrgCtx: jasmine.SpyObj<OrgContextService>;
  let mockRouter: jasmine.SpyObj<Router>;

  beforeEach(() => {
    mockOrgCtx = jasmine.createSpyObj('OrgContextService', ['hasRole'], { currentRole: 'admin' });
    mockRouter = jasmine.createSpyObj('Router', ['parseUrl']);
    mockRouter.parseUrl.and.returnValue({} as any);

    TestBed.configureTestingModule({
      providers: [
        RoleGuard,
        { provide: OrgContextService, useValue: mockOrgCtx },
        { provide: Router, useValue: mockRouter },
      ],
    });
    guard = TestBed.inject(RoleGuard);
  });

  it('should allow access when no minRole is set', () => {
    const route = { data: {} } as unknown as ActivatedRouteSnapshot;
    expect(guard.canActivate(route)).toBe(true);
  });

  it('should allow admin to access admin routes', () => {
    const route = { data: { minRole: 'admin' } } as unknown as ActivatedRouteSnapshot;
    expect(guard.canActivate(route)).toBe(true);
  });

  it('should redirect viewer from admin routes', () => {
    Object.defineProperty(mockOrgCtx, 'currentRole', { get: () => 'viewer' });
    const route = { data: { minRole: 'admin' } } as unknown as ActivatedRouteSnapshot;
    const result = guard.canActivate(route);
    expect(result).not.toBe(true);
    expect(mockRouter.parseUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('should redirect when no current role', () => {
    Object.defineProperty(mockOrgCtx, 'currentRole', { get: () => null });
    const route = { data: { minRole: 'admin' } } as unknown as ActivatedRouteSnapshot;
    const result = guard.canActivate(route);
    expect(result).not.toBe(true);
    expect(mockRouter.parseUrl).toHaveBeenCalledWith('/dashboard');
  });
});

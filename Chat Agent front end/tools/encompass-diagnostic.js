/**
 * Encompass/Eyefinity SPA Diagnostic Script
 *
 * Paste this into the browser DevTools console on pm-st-2.eyefinity.com
 * It will scan and report all available data sources that the chat widget
 * could potentially access from the host page.
 *
 * Output is printed to console AND copied to clipboard as JSON.
 */
(function() {
  'use strict';

  const report = {
    timestamp: new Date().toISOString(),
    url: location.href,
    title: document.title,
    version: null,
    framework: null,
    user: {},
    navigation: {},
    storage: {},
    cookies: {},
    globalObjects: {},
    dom: {},
    apiEndpoints: [],
    forms: [],
    iframes: [],
    meta: {},
  };

  // ─── 1. App Version ──────────────────────────────────────────
  try {
    const versionEl = document.querySelector('[class*="version"], [id*="version"]')
      || [...document.querySelectorAll('*')].find(el => /Version:\s*[\d.]+/.test(el.textContent) && el.children.length === 0);
    if (versionEl) report.version = versionEl.textContent.trim();
  } catch(e) {}

  // ─── 2. Detect Framework ─────────────────────────────────────
  try {
    if (window.angular) {
      report.framework = { name: 'AngularJS', version: window.angular.version?.full || 'unknown' };
    } else if (document.querySelector('[ng-version]')) {
      report.framework = { name: 'Angular', version: document.querySelector('[ng-version]').getAttribute('ng-version') };
    } else if (window.React || document.querySelector('[data-reactroot]')) {
      report.framework = { name: 'React', version: window.React?.version || 'unknown' };
    } else if (window.Vue) {
      report.framework = { name: 'Vue', version: window.Vue.version || 'unknown' };
    } else if (window.Ext) {
      report.framework = { name: 'ExtJS/Sencha', version: window.Ext.version || window.Ext.versions?.core?.version || 'unknown' };
    } else if (window.jQuery) {
      report.framework = { name: 'jQuery', version: window.jQuery.fn?.jquery || 'unknown' };
    } else if (window.Backbone) {
      report.framework = { name: 'Backbone', version: window.Backbone.VERSION || 'unknown' };
    } else if (window.Ember) {
      report.framework = { name: 'Ember', version: window.Ember.VERSION || 'unknown' };
    }
    // Also check for additional libraries
    const libs = [];
    if (window.jQuery) libs.push('jQuery ' + (window.jQuery.fn?.jquery || ''));
    if (window._) libs.push('Lodash/Underscore');
    if (window.moment) libs.push('Moment.js');
    if (window.Backbone) libs.push('Backbone');
    if (window.ko) libs.push('Knockout');
    if (window.Ext) libs.push('ExtJS');
    if (window.kendo) libs.push('Kendo UI');
    if (window.DevExpress) libs.push('DevExtreme');
    if (window.Telerik) libs.push('Telerik');
    if (window.dhtmlx) libs.push('DHTMLX');
    if (libs.length) report.framework = { ...(report.framework || {}), libraries: libs };
  } catch(e) {}

  // ─── 3. Logged-In User Info ───────────────────────────────────
  try {
    // Check common patterns for user display
    const adminEl = document.querySelector('[class*="user"], [class*="admin"], [id*="user"], [id*="admin"]');
    // Also try text content scan for "Admin in" pattern visible in screenshot
    const allText = document.body.innerText;
    const adminMatch = allText.match(/Admin in (\d+)/);
    if (adminMatch) report.user.adminContext = adminMatch[0];

    // Check for user-related cookies
    const userCookies = document.cookie.split(';').filter(c =>
      /user|session|auth|token|uid|login|acct|account/i.test(c.trim().split('=')[0])
    );
    if (userCookies.length) report.user.cookies = userCookies.map(c => {
      const [name] = c.trim().split('=');
      return name; // Just names, not values (for security)
    });

    // AngularJS scope user data
    if (window.angular) {
      try {
        const rootScope = angular.element(document.body).scope()?.$root;
        if (rootScope) {
          const userKeys = Object.keys(rootScope).filter(k =>
            !k.startsWith('$') && !k.startsWith('_') &&
            /user|auth|session|account|profile|current|logged|admin|staff|provider|office/i.test(k)
          );
          if (userKeys.length) {
            report.user.angularScopeKeys = userKeys;
            report.user.angularScopeData = {};
            userKeys.forEach(k => {
              try {
                const val = rootScope[k];
                report.user.angularScopeData[k] = typeof val === 'object' ? JSON.parse(JSON.stringify(val)) : val;
              } catch(e) { report.user.angularScopeData[k] = '(circular/unserializable)'; }
            });
          }
        }
      } catch(e) {}
    }
  } catch(e) {}

  // ─── 4. Navigation & Route Structure ──────────────────────────
  try {
    // Top nav links
    const navLinks = [...document.querySelectorAll('nav a, .nav a, [class*="nav"] a, header a, [role="navigation"] a, .navbar a')];
    report.navigation.topNav = navLinks.map(a => ({
      text: a.textContent.trim(),
      href: a.getAttribute('href') || a.getAttribute('ng-href') || a.getAttribute('ui-sref') || '',
      onclick: a.getAttribute('onclick') || a.getAttribute('ng-click') || '',
    })).filter(n => n.text);

    // Dashboard tiles/cards (the big buttons in the screenshot)
    const tiles = [...document.querySelectorAll('[class*="tile"], [class*="card"], [class*="dashboard"] a, [class*="module"] a')];
    if (tiles.length === 0) {
      // Try broader selector for the grid of links
      const bigLinks = [...document.querySelectorAll('a')].filter(a => {
        const rect = a.getBoundingClientRect();
        return rect.width > 150 && rect.height > 80; // Large clickable areas
      });
      report.navigation.dashboardTiles = bigLinks.map(a => ({
        text: a.textContent.trim().replace(/\s+/g, ' '),
        href: a.getAttribute('href') || '',
        onclick: a.getAttribute('onclick') || a.getAttribute('ng-click') || '',
      }));
    } else {
      report.navigation.dashboardTiles = tiles.map(t => ({
        text: t.textContent.trim().replace(/\s+/g, ' '),
        href: t.getAttribute('href') || '',
      }));
    }

    // Sub-nav / tab bar
    const subNav = [...document.querySelectorAll('[class*="subnav"] a, [class*="tab"] a, .nav-tabs a, .nav-pills a')];
    if (subNav.length) {
      report.navigation.subNav = subNav.map(a => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href') || '',
      }));
    }

    // AngularJS routes
    if (window.angular) {
      try {
        const injector = angular.element(document.body).injector();
        if (injector) {
          try {
            const routeProvider = injector.get('$route');
            if (routeProvider?.routes) {
              report.navigation.angularRoutes = Object.keys(routeProvider.routes).filter(r => !r.startsWith('null'));
            }
          } catch(e) {}
          try {
            const stateService = injector.get('$state');
            if (stateService) {
              const states = stateService.get();
              report.navigation.uiRouterStates = states.map(s => ({
                name: s.name,
                url: s.url,
                abstract: s.abstract || false,
              })).filter(s => s.name);
            }
          } catch(e) {}
        }
      } catch(e) {}
    }
  } catch(e) {}

  // ─── 5. Local Storage & Session Storage ───────────────────────
  try {
    const lsKeys = Object.keys(localStorage);
    report.storage.localStorage = {};
    lsKeys.forEach(k => {
      try {
        const val = localStorage.getItem(k);
        // Show key + type + size, truncate large values
        const parsed = JSON.parse(val);
        report.storage.localStorage[k] = {
          type: Array.isArray(parsed) ? 'array' : typeof parsed,
          size: val.length,
          preview: val.length > 200 ? val.substring(0, 200) + '...' : val,
          keys: typeof parsed === 'object' && parsed ? Object.keys(parsed).slice(0, 20) : undefined,
        };
      } catch(e) {
        report.storage.localStorage[k] = { type: 'string', size: (localStorage.getItem(k) || '').length };
      }
    });

    const ssKeys = Object.keys(sessionStorage);
    report.storage.sessionStorage = {};
    ssKeys.forEach(k => {
      try {
        const val = sessionStorage.getItem(k);
        const parsed = JSON.parse(val);
        report.storage.sessionStorage[k] = {
          type: Array.isArray(parsed) ? 'array' : typeof parsed,
          size: val.length,
          preview: val.length > 200 ? val.substring(0, 200) + '...' : val,
          keys: typeof parsed === 'object' && parsed ? Object.keys(parsed).slice(0, 20) : undefined,
        };
      } catch(e) {
        report.storage.sessionStorage[k] = { type: 'string', size: (sessionStorage.getItem(k) || '').length };
      }
    });
  } catch(e) {}

  // ─── 6. Cookies (names only, not values) ──────────────────────
  try {
    report.cookies = document.cookie.split(';').reduce((acc, c) => {
      const [name, ...rest] = c.trim().split('=');
      const val = rest.join('=');
      acc[name] = {
        size: val.length,
        looksLikeJWT: val.split('.').length === 3 && val.length > 100,
        looksLikeSession: /^[a-f0-9-]{20,}$/i.test(val),
      };
      return acc;
    }, {});
  } catch(e) {}

  // ─── 7. Window Global Objects (app-specific) ──────────────────
  try {
    // Filter out standard browser globals
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const standardKeys = new Set(Object.keys(iframe.contentWindow));
    document.body.removeChild(iframe);

    const appGlobals = Object.keys(window).filter(k => {
      if (standardKeys.has(k)) return false;
      if (k.startsWith('_') && k.startsWith('__')) return false;
      if (['webpackJsonp', 'webpackChunk'].some(w => k.startsWith(w))) return false;
      return true;
    });

    report.globalObjects.customGlobals = appGlobals.slice(0, 100).map(k => {
      try {
        const val = window[k];
        return {
          name: k,
          type: typeof val,
          isFunction: typeof val === 'function',
          isObject: typeof val === 'object' && val !== null,
          keys: typeof val === 'object' && val ? Object.keys(val).slice(0, 15) : undefined,
        };
      } catch(e) { return { name: k, type: 'inaccessible' }; }
    });

    // Look for service/API objects
    const apiPatterns = /api|service|client|http|fetch|ajax|rest|endpoint|config|app|store|state|dispatch|reducer/i;
    report.globalObjects.potentialAPIs = appGlobals.filter(k => apiPatterns.test(k)).slice(0, 30);
  } catch(e) {}

  // ─── 8. AngularJS Services & Scope Data ───────────────────────
  try {
    if (window.angular) {
      const injector = angular.element(document.body).injector();
      if (injector) {
        // List all registered services
        const providerCache = injector.get('$injector');
        report.globalObjects.angularServices = [];

        // Try to get common service names
        const serviceNames = ['$http', '$resource', '$state', '$stateParams', '$rootScope',
          'userService', 'UserService', 'authService', 'AuthService',
          'patientService', 'PatientService', 'appointmentService', 'AppointmentService',
          'orderService', 'OrderService', 'claimService', 'ClaimService',
          'inventoryService', 'InventoryService', 'reportService', 'ReportService',
          'officeService', 'OfficeService', 'providerService', 'ProviderService',
          'configService', 'ConfigService', 'settingsService', 'SettingsService',
          'sessionService', 'SessionService', 'notificationService',
          'messageService', 'MessageService', 'alertService',
        ];

        serviceNames.forEach(name => {
          try {
            const svc = injector.get(name);
            if (svc) {
              report.globalObjects.angularServices.push({
                name,
                type: typeof svc,
                methods: typeof svc === 'object' ? Object.keys(svc).filter(k => typeof svc[k] === 'function').slice(0, 20) : [],
                properties: typeof svc === 'object' ? Object.keys(svc).filter(k => typeof svc[k] !== 'function').slice(0, 20) : [],
              });
            }
          } catch(e) {} // Service doesn't exist
        });
      }

      // Walk the scope tree to find data-bearing scopes
      const rootScope = angular.element(document.body).scope()?.$root;
      if (rootScope) {
        const scopeData = {};
        const walk = (scope, depth) => {
          if (depth > 5) return;
          Object.keys(scope).forEach(k => {
            if (!k.startsWith('$') && !k.startsWith('_') && typeof scope[k] !== 'function') {
              try {
                const val = scope[k];
                if (val !== undefined && val !== null && val !== '') {
                  scopeData[k] = {
                    type: typeof val,
                    isArray: Array.isArray(val),
                    length: Array.isArray(val) ? val.length : undefined,
                    keys: typeof val === 'object' && !Array.isArray(val) ? Object.keys(val).slice(0, 15) : undefined,
                    sample: typeof val === 'string' ? val.substring(0, 100) : (typeof val === 'number' || typeof val === 'boolean' ? val : undefined),
                  };
                }
              } catch(e) {}
            }
          });
          let child = scope.$$childHead;
          while (child) {
            walk(child, depth + 1);
            child = child.$$nextSibling;
          }
        };
        walk(rootScope, 0);
        report.globalObjects.angularScopeData = scopeData;
      }
    }
  } catch(e) {}

  // ─── 9. DOM Structure: Forms, Tables, Data Attributes ─────────
  try {
    // All forms
    report.forms = [...document.querySelectorAll('form')].map(f => ({
      id: f.id || '(unnamed)',
      action: f.action || '',
      method: f.method || 'GET',
      fields: [...f.elements].map(el => ({
        name: el.name || el.id,
        type: el.type || el.tagName.toLowerCase(),
        value: el.type === 'password' ? '***' : (el.value || '').substring(0, 50),
      })).filter(el => el.name),
    }));

    // Data tables
    const tables = [...document.querySelectorAll('table')];
    report.dom.tables = tables.map(t => {
      const headers = [...t.querySelectorAll('th')].map(th => th.textContent.trim());
      const rows = t.querySelectorAll('tbody tr').length;
      return { id: t.id || t.className?.split(' ')[0] || '(unnamed)', headers, rowCount: rows };
    }).filter(t => t.headers.length > 0);

    // Elements with data- attributes
    const dataElements = [...document.querySelectorAll('[data-patient-id], [data-member-id], [data-office-id], [data-provider-id], [data-user-id], [data-account-id], [data-id]')];
    if (dataElements.length) {
      report.dom.dataAttributes = dataElements.slice(0, 20).map(el => {
        const attrs = {};
        [...el.attributes].filter(a => a.name.startsWith('data-')).forEach(a => attrs[a.name] = a.value);
        return { tag: el.tagName, text: el.textContent.trim().substring(0, 50), attrs };
      });
    }

    // Hidden inputs (often contain IDs, tokens, context)
    const hiddenInputs = [...document.querySelectorAll('input[type="hidden"]')];
    report.dom.hiddenInputs = hiddenInputs.map(i => ({
      name: i.name || i.id,
      valuePreview: (i.value || '').substring(0, 80),
    })).filter(i => i.name);
  } catch(e) {}

  // ─── 10. Iframes ──────────────────────────────────────────────
  try {
    report.iframes = [...document.querySelectorAll('iframe')].map(f => ({
      id: f.id,
      src: f.src,
      name: f.name,
      width: f.width,
      height: f.height,
    }));
  } catch(e) {}

  // ─── 11. Meta Tags ────────────────────────────────────────────
  try {
    const metas = [...document.querySelectorAll('meta')];
    metas.forEach(m => {
      const name = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      if (name) report.meta[name] = m.getAttribute('content');
    });
  } catch(e) {}

  // ─── 12. Network/XHR Interception Snapshot ────────────────────
  // This sets up a temporary intercept to capture API calls as you navigate
  try {
    if (!window.__encompassDiagXHRLog) {
      window.__encompassDiagXHRLog = [];
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        window.__encompassDiagXHRLog.push({ method, url: String(url), time: new Date().toISOString() });
        if (window.__encompassDiagXHRLog.length > 200) window.__encompassDiagXHRLog.shift();
        return origOpen.apply(this, arguments);
      };

      const origFetch = window.fetch;
      window.fetch = function(input, init) {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        window.__encompassDiagXHRLog.push({ method: init?.method || 'GET', url, time: new Date().toISOString() });
        return origFetch.apply(this, arguments);
      };

      report.apiEndpoints = ['XHR/Fetch interceptor installed. Navigate around the app, then run:',
        'JSON.stringify(window.__encompassDiagXHRLog, null, 2)'];
    } else {
      report.apiEndpoints = window.__encompassDiagXHRLog;
    }
  } catch(e) {}

  // ─── 13. CSS Classes / Modernizr Features ─────────────────────
  try {
    const htmlClasses = document.documentElement.className.split(/\s+/).filter(Boolean);
    report.dom.htmlFeatureClasses = htmlClasses.length;
    report.dom.bodyClass = document.body.className;
  } catch(e) {}

  // ─── Output ───────────────────────────────────────────────────
  console.log('%c ═══ ENCOMPASS SPA DIAGNOSTIC REPORT ═══ ', 'background:#1565C0;color:white;font-size:14px;padding:4px 8px;');

  console.group('📋 App Info');
  console.log('URL:', report.url);
  console.log('Version:', report.version);
  console.log('Framework:', report.framework);
  console.groupEnd();

  console.group('👤 User Context');
  console.log(report.user);
  console.groupEnd();

  console.group('🗺️ Navigation & Routes');
  console.log('Top Nav:', report.navigation.topNav);
  console.log('Dashboard Tiles:', report.navigation.dashboardTiles);
  if (report.navigation.angularRoutes) console.log('Angular Routes:', report.navigation.angularRoutes);
  if (report.navigation.uiRouterStates) console.log('UI Router States:', report.navigation.uiRouterStates);
  console.groupEnd();

  console.group('💾 Storage');
  console.log('LocalStorage keys:', Object.keys(report.storage.localStorage || {}));
  console.log('SessionStorage keys:', Object.keys(report.storage.sessionStorage || {}));
  console.log('Cookies:', Object.keys(report.cookies));
  console.groupEnd();

  console.group('🔌 Global Objects & Services');
  console.log('Custom Globals:', report.globalObjects.customGlobals?.map(g => g.name));
  console.log('Potential APIs:', report.globalObjects.potentialAPIs);
  if (report.globalObjects.angularServices?.length) console.log('Angular Services:', report.globalObjects.angularServices);
  if (report.globalObjects.angularScopeData) console.log('Scope Data:', report.globalObjects.angularScopeData);
  console.groupEnd();

  console.group('📄 DOM');
  console.log('Forms:', report.forms);
  console.log('Tables:', report.dom.tables);
  console.log('Hidden Inputs:', report.dom.hiddenInputs);
  console.log('Data Attributes:', report.dom.dataAttributes);
  console.groupEnd();

  console.group('🌐 Network');
  console.log(report.apiEndpoints);
  console.log('➡️  Navigate around the app, then run: JSON.stringify(window.__encompassDiagXHRLog, null, 2)');
  console.groupEnd();

  // Copy full report to clipboard
  try {
    const json = JSON.stringify(report, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      console.log('%c ✅ Full report copied to clipboard! Paste it back here for analysis. ', 'background:#4CAF50;color:white;padding:4px 8px;');
    });
  } catch(e) {
    console.log('Could not auto-copy. Use: copy(JSON.stringify(report, null, 2))');
  }

  // Also expose for manual access
  window.__encompassDiagReport = report;
  console.log('%c Access full report: window.__encompassDiagReport ', 'background:#FF9800;color:white;padding:2px 6px;');

  return report;
})();

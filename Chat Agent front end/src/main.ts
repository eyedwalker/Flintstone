import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { validateEnvironment } from './app/core/utils/env-validator';

validateEnvironment();

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));

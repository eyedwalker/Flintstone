import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { BillingComponent } from './billing.component';
import { UpgradeComponent } from './upgrade/upgrade.component';

const routes: Routes = [
  { path: '', component: BillingComponent },
  { path: 'upgrade', component: UpgradeComponent },
];

@NgModule({
  declarations: [BillingComponent, UpgradeComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class BillingModule {}

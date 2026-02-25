import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { HierarchyManagerComponent } from './hierarchy-manager/hierarchy-manager.component';
import { NodeFormComponent } from './node-form/node-form.component';

const routes: Routes = [
  { path: '', component: HierarchyManagerComponent },
  { path: 'nodes/new', component: NodeFormComponent },
  { path: 'nodes/:nodeId', component: NodeFormComponent },
];

@NgModule({
  declarations: [HierarchyManagerComponent, NodeFormComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class HierarchyModule {}

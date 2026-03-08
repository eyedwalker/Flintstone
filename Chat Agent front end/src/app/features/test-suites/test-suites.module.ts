import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { TestSuiteListComponent } from './test-suite-list.component';
import { TestCaseEditorComponent } from './test-case-editor.component';
import { TestRunViewerComponent } from './test-run-viewer.component';
import { TestResultDetailDialogComponent } from './test-result-detail-dialog.component';
import { TestImprovementsDialogComponent } from './test-improvements-dialog.component';

const routes: Routes = [
  { path: '', component: TestSuiteListComponent },
  { path: ':suiteId/cases', component: TestCaseEditorComponent },
  { path: 'runs/:runId', component: TestRunViewerComponent },
];

@NgModule({
  declarations: [
    TestSuiteListComponent,
    TestCaseEditorComponent,
    TestRunViewerComponent,
    TestResultDetailDialogComponent,
    TestImprovementsDialogComponent,
  ],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class TestSuitesModule {}

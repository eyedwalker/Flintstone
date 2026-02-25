import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AssistantListComponent } from './assistant-list/assistant-list.component';
import { AssistantFormComponent } from './assistant-form/assistant-form.component';
import { KnowledgeBaseComponent } from '../knowledge-base/knowledge-base.component';
import { ModelConfigComponent } from '../model-config/model-config.component';
import { GuardrailsComponent } from '../guardrails/guardrails.component';
import { WidgetConfiguratorComponent } from '../widget-configurator/widget-configurator.component';
import { EmbedCodeComponent } from '../embed-code/embed-code.component';
import { MetricsComponent } from '../metrics/metrics.component';

const routes: Routes = [
  { path: '', component: AssistantListComponent },
  { path: 'new', component: AssistantFormComponent },
  { path: ':id', component: AssistantFormComponent },
  { path: ':id/knowledge-base', component: KnowledgeBaseComponent },
  { path: ':id/model', component: ModelConfigComponent },
  { path: ':id/guardrails', component: GuardrailsComponent },
  { path: ':id/widget', component: WidgetConfiguratorComponent },
  { path: ':id/embed', component: EmbedCodeComponent },
  { path: ':id/metrics', component: MetricsComponent },
];

@NgModule({
  declarations: [
    AssistantListComponent,
    AssistantFormComponent,
    KnowledgeBaseComponent,
    ModelConfigComponent,
    GuardrailsComponent,
    WidgetConfiguratorComponent,
    EmbedCodeComponent,
    MetricsComponent,
  ],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AssistantsModule {}

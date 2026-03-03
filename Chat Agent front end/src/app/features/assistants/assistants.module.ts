import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';
import { AssistantListComponent } from './assistant-list/assistant-list.component';
import { AssistantFormComponent } from './assistant-form/assistant-form.component';
import { KnowledgeBaseComponent } from '../knowledge-base/knowledge-base.component';
import { ModelConfigComponent } from '../model-config/model-config.component';
import { GuardrailsComponent } from '../guardrails/guardrails.component';
import { WidgetConfiguratorComponent } from '../widget-configurator/widget-configurator.component';
import { UiBuilderComponent } from '../widget-configurator/ui-builder/ui-builder.component';
import { TypingConfigComponent } from '../widget-configurator/typing-config/typing-config.component';
import { ContextConfigComponent } from '../widget-configurator/context-config/context-config.component';
import { TrendingQuestionsComponent } from '../widget-configurator/trending-questions/trending-questions.component';
import { EmbedCodeComponent } from '../embed-code/embed-code.component';
import { ChatTesterComponent } from '../embed-code/chat-tester/chat-tester.component';
import { SnippetDisplayComponent } from '../embed-code/snippet-display/snippet-display.component';
import { MetricsComponent } from '../metrics/metrics.component';
import { AssistantKbPickerComponent } from './assistant-kb-picker/assistant-kb-picker.component';
import { EditContentDialogComponent } from '../../shared/components/edit-content-dialog/edit-content-dialog.component';
import { VimeoBrowserDialogComponent } from '../../shared/components/vimeo-browser-dialog/vimeo-browser-dialog.component';

const routes: Routes = [
  { path: '', component: AssistantListComponent },
  { path: 'new', component: AssistantFormComponent },
  { path: ':id', component: AssistantFormComponent },
  { path: ':id/knowledge-base', component: KnowledgeBaseComponent },
  { path: ':id/kb-picker', component: AssistantKbPickerComponent },
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
    UiBuilderComponent,
    TypingConfigComponent,
    ContextConfigComponent,
    TrendingQuestionsComponent,
    EmbedCodeComponent,
    ChatTesterComponent,
    SnippetDisplayComponent,
    MetricsComponent,
    AssistantKbPickerComponent,
    EditContentDialogComponent,
    VimeoBrowserDialogComponent,
  ],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AssistantsModule {}

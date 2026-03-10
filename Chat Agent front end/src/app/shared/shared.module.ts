import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MaterialModule } from './material.module';

import { HeaderComponent } from './components/header/header.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { FileUploaderComponent } from './components/file-uploader/file-uploader.component';
import { CodePreviewComponent } from './components/code-preview/code-preview.component';
import { PlacementPickerComponent } from './components/placement-picker/placement-picker.component';
import { WidgetPreviewComponent } from './components/widget-preview/widget-preview.component';
import { MetricCardComponent } from './components/metric-card/metric-card.component';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';
import { EditContentDialogComponent } from './components/edit-content-dialog/edit-content-dialog.component';
import { VimeoBrowserDialogComponent } from './components/vimeo-browser-dialog/vimeo-browser-dialog.component';

const COMPONENTS = [
  HeaderComponent,
  SidebarComponent,
  FileUploaderComponent,
  CodePreviewComponent,
  PlacementPickerComponent,
  WidgetPreviewComponent,
  MetricCardComponent,
  ConfirmDialogComponent,
  EditContentDialogComponent,
  VimeoBrowserDialogComponent,
];

@NgModule({
  declarations: COMPONENTS,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule, MaterialModule],
  exports: [
    ...COMPONENTS,
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    MaterialModule,
  ],
})
export class SharedModule {}

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { ControlContainer, FormGroup, FormArray, FormBuilder, FormGroupDirective, Validators } from '@angular/forms';
import { ContextFieldType } from '../../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-context-config',
  templateUrl: './context-config.component.html',
  styleUrls: ['./context-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  viewProviders: [{ provide: ControlContainer, useExisting: FormGroupDirective }],
})
export class ContextConfigComponent {
  @Input() form!: FormGroup;

  readonly contextTemplates: { label: string; type: ContextFieldType; key: string; expression: string }[] = [
    { label: 'Page URL', type: 'expression', key: 'pageUrl', expression: 'window.location.href' },
    { label: 'Page Title', type: 'expression', key: 'pageTitle', expression: 'document.title' },
    { label: 'User Agent', type: 'userAgent', key: 'userAgent', expression: 'navigator.userAgent' },
    { label: 'Referrer', type: 'expression', key: 'referrer', expression: 'document.referrer' },
    { label: 'Screen Size', type: 'expression', key: 'screenSize', expression: 'window.innerWidth+"x"+window.innerHeight' },
    { label: 'Language', type: 'expression', key: 'language', expression: 'navigator.language' },
    { label: 'Geolocation', type: 'geolocation', key: 'location', expression: '' },
    { label: 'Custom localStorage', type: 'localStorage', key: '', expression: '' },
    { label: 'Custom Cookie', type: 'cookie', key: '', expression: '' },
    { label: 'Custom DOM Element', type: 'dom', key: '', expression: '' },
    { label: 'Custom JS Expression', type: 'expression', key: '', expression: '' },
  ];

  constructor(private fb: FormBuilder) {}

  get customFieldsArray(): FormArray {
    return this.form.get('customFields') as FormArray;
  }

  addContextField(): void {
    this.customFieldsArray.push(this.fb.group({
      key: ['', Validators.required],
      type: ['expression', Validators.required],
      expression: [''],
    }));
  }

  removeContextField(i: number): void {
    this.customFieldsArray.removeAt(i);
  }

  addContextFromTemplate(template: { label: string; type: ContextFieldType; key: string; expression: string }): void {
    this.customFieldsArray.push(this.fb.group({
      key: [template.key, Validators.required],
      type: [template.type, Validators.required],
      expression: [template.expression],
    }));
  }

  getExpressionLabel(type: string): string {
    switch (type) {
      case 'localStorage': return 'Storage key';
      case 'sessionStorage': return 'Storage key';
      case 'cookie': return 'Cookie name';
      case 'dom': return 'CSS selector';
      case 'userAgent': return 'Expression';
      case 'geolocation': return 'Expression';
      default: return 'JS expression';
    }
  }

  getExpressionPlaceholder(type: string): string {
    switch (type) {
      case 'localStorage': return 'e.g. authToken';
      case 'sessionStorage': return 'e.g. userPrefs';
      case 'cookie': return 'e.g. session_id';
      case 'dom': return 'e.g. #user-name';
      case 'userAgent': return 'navigator.userAgent';
      case 'geolocation': return 'Auto-detected';
      default: return 'e.g. window.currentUser?.id';
    }
  }
}

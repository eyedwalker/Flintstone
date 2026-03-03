import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { ControlContainer, FormGroup, FormArray, FormBuilder, FormGroupDirective } from '@angular/forms';
import { TypingIndicatorStyle } from '../../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-typing-config',
  templateUrl: './typing-config.component.html',
  styleUrls: ['./typing-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  viewProviders: [{ provide: ControlContainer, useExisting: FormGroupDirective }],
})
export class TypingConfigComponent {
  @Input() form!: FormGroup;

  readonly typingStyles: { value: TypingIndicatorStyle; label: string; icon: string }[] = [
    { value: 'dots', label: 'Bouncing Dots', icon: 'more_horiz' },
    { value: 'phrases', label: 'Animated Phrases', icon: 'text_fields' },
    { value: 'spinner-phrases', label: 'Spinner + Phrases', icon: 'autorenew' },
  ];

  readonly defaultTypingPhrases: string[] = [
    'Adjusting my lenses\u2026',
    'Looking into that\u2026',
    'Focusing on your question\u2026',
    'Polishing up a response\u2026',
    'Examining the details\u2026',
    'Bringing things into focus\u2026',
    'Scanning for the best answer\u2026',
    'Fine-tuning my vision\u2026',
  ];

  constructor(private fb: FormBuilder) {}

  get typingPhrasesArray(): FormArray {
    return this.form.get('typingPhrases') as FormArray;
  }

  addTypingPhrase(): void {
    if (this.typingPhrasesArray.length >= 12) return;
    this.typingPhrasesArray.push(this.fb.control(''));
  }

  removeTypingPhrase(i: number): void {
    this.typingPhrasesArray.removeAt(i);
  }

  resetTypingPhrases(): void {
    this.typingPhrasesArray.clear();
    this.defaultTypingPhrases.forEach((p) => this.typingPhrasesArray.push(this.fb.control(p)));
  }
}

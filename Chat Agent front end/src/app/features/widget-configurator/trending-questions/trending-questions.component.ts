import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { ControlContainer, FormGroup, FormArray, FormBuilder, FormGroupDirective, Validators } from '@angular/forms';

@Component({
  selector: 'bcc-trending-questions',
  templateUrl: './trending-questions.component.html',
  styleUrls: ['./trending-questions.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  viewProviders: [{ provide: ControlContainer, useExisting: FormGroupDirective }],
})
export class TrendingQuestionsComponent {
  @Input() form!: FormGroup;

  constructor(private fb: FormBuilder) {}

  get trendingArray(): FormArray {
    return this.form.get('trendingQuestions') as FormArray;
  }

  addQuestion(): void {
    if (this.trendingArray.length >= 6) return;
    this.trendingArray.push(this.fb.control('', Validators.required));
  }

  removeQuestion(i: number): void {
    this.trendingArray.removeAt(i);
  }
}

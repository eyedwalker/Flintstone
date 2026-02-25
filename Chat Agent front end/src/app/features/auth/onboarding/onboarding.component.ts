import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from '../../../core/services/auth.service';
import { HierarchyManager } from '../../../../lib/managers/hierarchy.manager';
import { HierarchyEngine } from '../../../../lib/engines/hierarchy.engine';
import { IHierarchyTemplate, IHierarchyLevel } from '../../../../lib/models/hierarchy.model';
import { ApiService } from '../../../core/services/api.service';

interface IOnboardingStep {
  label: string;
  icon: string;
}

/** Multi-step onboarding: org setup → hierarchy builder → first node → plan selection */
@Component({
  selector: 'bcc-onboarding',
  templateUrl: './onboarding.component.html',
  styleUrls: ['./onboarding.component.scss'],
})
export class OnboardingComponent implements OnInit {
  currentStep = 0;
  loading = false;

  readonly steps: IOnboardingStep[] = [
    { label: 'Organization', icon: 'business' },
    { label: 'Hierarchy', icon: 'account_tree' },
    { label: 'First Node', icon: 'location_on' },
    { label: 'Plan', icon: 'credit_card' },
  ];

  /** Step 1 — Organization details */
  orgForm: FormGroup;

  /** Step 2 — Hierarchy definition */
  templates: IHierarchyTemplate[] = [];
  selectedTemplate: IHierarchyTemplate | null = null;
  customLevels!: FormArray;
  hierarchyForm!: FormGroup;

  /** Step 3 — First root node */
  nodeForm: FormGroup;

  /** Step 4 — Plan selection */
  selectedPlan: 'free' | 'starter' | 'pro' = 'free';

  organizationId = '';

  readonly levelIcons = [
    'business', 'location_on', 'groups', 'group', 'account_tree',
    'corporate_fare', 'store', 'apartment', 'map', 'hub',
  ];

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private hierarchyManager: HierarchyManager,
    private hierarchyEngine: HierarchyEngine,
    private api: ApiService,
  ) {
    this.orgForm = this.fb.group({
      organizationName: ['', [Validators.required, Validators.minLength(2)]],
      industry: [''],
      website: [''],
    });

    this.nodeForm = this.fb.group({
      nodeName: ['', [Validators.required, Validators.minLength(2)]],
    });
  }

  ngOnInit(): void {
    this.templates = this.hierarchyEngine.getTemplates();
    this.organizationId = this.auth.currentUser?.sub ?? uuidv4();
    this.initHierarchyForm();
  }

  private initHierarchyForm(): void {
    this.customLevels = this.fb.array([]);
    this.hierarchyForm = this.fb.group({
      inheritAssistants: [true],
      customLevels: this.customLevels,
    });
  }

  // ─── Step 2: Hierarchy ─────────────────────────────────────────

  selectTemplate(template: IHierarchyTemplate): void {
    this.selectedTemplate = template;
    this.customLevels.clear();
    if (template.id === 'custom') {
      this.addCustomLevel();
    } else {
      template.levels.forEach((l) => {
        this.customLevels.push(this.fb.group({
          name: [l.name, Validators.required],
          icon: [l.icon],
        }));
      });
    }
  }

  addCustomLevel(): void {
    if (this.customLevels.length >= 5) return;
    this.customLevels.push(this.fb.group({
      name: ['', Validators.required],
      icon: ['business'],
    }));
  }

  removeCustomLevel(index: number): void {
    if (this.customLevels.length <= 1) return;
    this.customLevels.removeAt(index);
  }

  getLevels(): IHierarchyLevel[] {
    return this.customLevels.controls.map((ctrl, i) => ({
      id: `${this.organizationId}-level-${i}`,
      name: ctrl.get('name')?.value ?? '',
      depth: i,
      allowsAssistants: i === this.customLevels.length - 1,
      icon: ctrl.get('icon')?.value ?? 'business',
    }));
  }

  setLevelIcon(index: number, icon: string): void {
    this.customLevels.at(index).get('icon')?.setValue(icon);
  }

  // ─── Navigation ────────────────────────────────────────────────

  canProceed(): boolean {
    if (this.currentStep === 0) return this.orgForm.valid;
    if (this.currentStep === 1) {
      return !!this.selectedTemplate && this.customLevels.valid && this.customLevels.length > 0;
    }
    if (this.currentStep === 2) return this.nodeForm.valid;
    return true;
  }

  async next(): Promise<void> {
    if (!this.canProceed() || this.loading) return;
    this.loading = true;
    try {
      if (this.currentStep === 0) await this.saveOrganization();
      else if (this.currentStep === 1) await this.saveHierarchy();
      else if (this.currentStep === 2) await this.saveFirstNode();
      else await this.finishOnboarding();
      if (this.currentStep < this.steps.length - 1) this.currentStep++;
    } catch (err) {
      this.snackBar.open('Something went wrong — please try again', 'OK', { duration: 4000 });
    }
    this.loading = false;
  }

  back(): void {
    if (this.currentStep > 0) this.currentStep--;
  }

  // ─── Save Operations ───────────────────────────────────────────

  private async saveOrganization(): Promise<void> {
    const { organizationName, industry, website } = this.orgForm.value;
    const result = await this.api.put('/tenants/me', {
      organizationName,
      slug: organizationName.toLowerCase().replace(/\s+/g, '-'),
      industry: industry || null,
      website: website || null,
    });
    if (!result.success) throw new Error(result.error);
  }

  private async saveHierarchy(): Promise<void> {
    const levels = this.getLevels();
    const result = await this.hierarchyManager.saveDefinition(
      this.organizationId,
      levels,
      this.hierarchyForm.get('inheritAssistants')?.value ?? true,
      this.selectedTemplate?.id
    );
    if (!result.success) throw new Error(result.error);
  }

  private async saveFirstNode(): Promise<void> {
    const levels = this.getLevels();
    const rootLevel = levels[0];
    const result = await this.hierarchyManager.createNode(
      this.organizationId,
      rootLevel.id,
      0,
      this.nodeForm.value.nodeName,
      null
    );
    if (!result.success) throw new Error(result.error);

    await this.hierarchyManager.assignUser(
      this.auth.currentUser?.sub ?? '',
      result.data!.id,
      this.organizationId,
      'owner',
      this.auth.currentUser?.email ?? '',
      this.auth.currentUser?.attributes?.['name'] ?? ''
    );
  }

  private async finishOnboarding(): Promise<void> {
    if (this.selectedPlan !== 'free') {
      this.router.navigate(['/billing/upgrade'], { queryParams: { plan: this.selectedPlan, newUser: true } });
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}

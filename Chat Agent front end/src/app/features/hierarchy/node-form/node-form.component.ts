import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HierarchyManager } from '../../../../lib/managers/hierarchy.manager';
import { AuthService } from '../../../core/services/auth.service';
import { IHierarchyNode, IHierarchyDefinition } from '../../../../lib/models/hierarchy.model';

/** Create or edit a hierarchy node */
@Component({
  selector: 'bcc-node-form',
  templateUrl: './node-form.component.html',
  styleUrls: ['./node-form.component.scss'],
})
export class NodeFormComponent implements OnInit {
  form!: FormGroup;
  loading = false;
  saving = false;
  organizationId = '';
  isNew = true;
  nodeId = '';
  parentNodeId: string | null = null;
  levelId = '';
  depth = 0;
  definition: IHierarchyDefinition | null = null;
  parentNode: IHierarchyNode | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private hierarchyManager: HierarchyManager,
    private auth: AuthService,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.organizationId = this.auth.currentUser?.sub ?? '';
    this.nodeId = this.route.snapshot.paramMap.get('nodeId') ?? '';
    this.isNew = !this.nodeId || this.nodeId === 'new';

    this.parentNodeId = this.route.snapshot.queryParamMap.get('parentNodeId');
    this.levelId = this.route.snapshot.queryParamMap.get('levelId') ?? '';
    this.depth = Number(this.route.snapshot.queryParamMap.get('depth') ?? '0');

    this.initForm();
    this.loading = true;

    const defResult = await this.hierarchyManager.getDefinition(this.organizationId);
    this.definition = defResult.data ?? null;

    if (this.parentNodeId) {
      const nodesResult = await this.hierarchyManager.listNodes(this.organizationId);
      this.parentNode = nodesResult.data?.find((n) => n.id === this.parentNodeId) ?? null;
    }

    if (!this.isNew) {
      await this.loadNode();
    }

    this.loading = false;
  }

  private initForm(): void {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      metadata: this.fb.array([]),
    });
  }

  private async loadNode(): Promise<void> {
    const result = await this.hierarchyManager.listNodes(this.organizationId);
    const node = result.data?.find((n) => n.id === this.nodeId);
    if (!node) return;

    this.levelId = node.levelId;
    this.depth = node.depth;
    this.parentNodeId = node.parentNodeId;

    this.form.patchValue({ name: node.name });
    Object.entries(node.metadata ?? {}).forEach(([key, value]) => {
      this.metadataArray.push(this.fb.group({ key: [key], value: [value] }));
    });
  }

  get metadataArray(): FormArray {
    return this.form.get('metadata') as FormArray;
  }

  get levelName(): string {
    return this.definition?.levels.find((l) => l.id === this.levelId)?.name ?? 'Node';
  }

  get parentPath(): string {
    return this.parentNode?.path ?? '';
  }

  get previewPath(): string {
    const name = this.form.get('name')?.value ?? '...';
    return this.parentPath ? `${this.parentPath} / ${name}` : name;
  }

  addMetadata(): void {
    this.metadataArray.push(this.fb.group({ key: [''], value: [''] }));
  }

  removeMetadata(index: number): void {
    this.metadataArray.removeAt(index);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving) return;
    this.saving = true;

    const name: string = this.form.value.name;
    const metadata: Record<string, string> = {};
    (this.form.value.metadata as Array<{ key: string; value: string }>)
      .filter((m) => m.key.trim())
      .forEach((m) => { metadata[m.key.trim()] = m.value; });

    try {
      if (this.isNew) {
        const result = await this.hierarchyManager.createNode(
          this.organizationId,
          this.levelId,
          this.depth,
          name,
          this.parentNodeId,
        );
        if (!result.success) throw new Error(result.error);
        this.snackBar.open(`${this.levelName} created`, '', { duration: 2500 });
      } else {
        const result = await this.hierarchyManager.updateNode(this.nodeId, { name, metadata });
        if (!result.success) throw new Error(result.error);
        this.snackBar.open(`${this.levelName} updated`, '', { duration: 2500 });
      }
      this.router.navigate(['/hierarchy']);
    } catch {
      this.snackBar.open('Save failed — please try again', 'OK', { duration: 4000 });
    }

    this.saving = false;
  }

  cancel(): void {
    this.router.navigate(['/hierarchy']);
  }
}

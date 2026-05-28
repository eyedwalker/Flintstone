import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestSuiteManager } from '../../../lib/managers/test-suite.manager';
import { ITestSuite, ITestCase, TestCategory, ITestTurn } from '../../../lib/models/test-suite.model';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'bcc-test-case-editor',
  templateUrl: './test-case-editor.component.html',
  styleUrls: ['./test-case-editor.component.scss'],
})
export class TestCaseEditorComponent implements OnInit, OnDestroy {
  suiteId = '';
  suite: ITestSuite | null = null;
  cases: ITestCase[] = [];
  filteredCases: ITestCase[] = [];
  loading = false;
  generating = false;
  searchTerm = '';
  categoryFilter = '';
  expandedCaseId = '';

  categories: TestCategory[] = [
    'factual', 'multi-turn', 'procedural', 'video-citation',
    'role-based', 'out-of-scope', 'adversarial', 'edge-case',
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private tsManager: TestSuiteManager,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
  ) {}

  ngOnDestroy(): void {
    if (this.generationPollTimer) clearInterval(this.generationPollTimer);
  }

  async ngOnInit(): Promise<void> {
    this.suiteId = this.route.snapshot.paramMap.get('suiteId') ?? '';
    if (!this.suiteId) return;
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    const [suiteRes, casesRes] = await Promise.all([
      this.tsManager.getSuite(this.suiteId),
      this.tsManager.listCases(this.suiteId),
    ]);
    this.suite = suiteRes.data ?? null;
    this.cases = casesRes.data ?? [];
    this.applyFilters();
    this.loading = false;
  }

  applyFilters(): void {
    let filtered = [...this.cases];
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(term) ||
        c.turns.some((t: ITestTurn) => t.userMessage.toLowerCase().includes(term))
      );
    }
    if (this.categoryFilter) {
      filtered = filtered.filter(c => c.category === this.categoryFilter);
    }
    this.filteredCases = filtered;
  }

  async generateContentTests(): Promise<void> {
    const count = parseInt(prompt('How many content quality test cases?', '200') ?? '', 10);
    if (!count || count < 1) return;

    this.generating = true;
    this.generatingType = 'content';
    const res = await this.tsManager.generateCases(this.suiteId, {
      count,
      categories: ['factual', 'multi-turn', 'procedural', 'video-citation', 'out-of-scope'],
    });

    if (res.success) {
      this.snackBar.open(`Generating ~${count} content test cases in background. Refresh to see progress.`, '', { duration: 5000 });
      // Start polling for new cases
      this.startGenerationPolling();
    } else {
      this.generating = false;
      this.snackBar.open(`Generation failed: ${res.error}`, 'Dismiss', { duration: 5000 });
    }
  }

  async generateSafetyTests(): Promise<void> {
    const count = parseInt(prompt('How many safety/security test cases?', '50') ?? '', 10);
    if (!count || count < 1) return;

    this.generating = true;
    this.generatingType = 'safety';
    const res = await this.tsManager.generateCases(this.suiteId, {
      count,
      categories: ['adversarial', 'edge-case'],
    });

    if (res.success) {
      this.snackBar.open(`Generating ~${count} safety test cases in background. Refresh to see progress.`, '', { duration: 5000 });
      this.startGenerationPolling();
    } else {
      this.generating = false;
      this.snackBar.open(`Generation failed: ${res.error}`, 'Dismiss', { duration: 5000 });
    }
  }

  private generationPollTimer: any;
  generatingType = '';

  private startGenerationPolling(): void {
    let prevCount = this.cases.length;
    this.generationPollTimer = setInterval(async () => {
      const casesRes = await this.tsManager.listCases(this.suiteId);
      const newCases = casesRes.data ?? [];
      if (newCases.length > prevCount) {
        prevCount = newCases.length;
        this.cases = newCases;
        this.applyFilters();
      }
      // Stop polling after 10 min or if count stabilizes after several checks
      if (newCases.length === prevCount) {
        // Keep polling — generation may still be running
      }
    }, 5000);

    // Stop polling after 10 minutes max
    setTimeout(() => {
      this.stopGenerationPolling();
    }, 600000);
  }

  stopGenerationPolling(): void {
    if (this.generationPollTimer) {
      clearInterval(this.generationPollTimer);
      this.generationPollTimer = null;
    }
    this.generating = false;
    this.generatingType = '';
    this.load(); // Final refresh
  }

  refreshCases(): void {
    this.load();
  }

  importing = false;

  triggerFileImport(): void {
    const input = document.getElementById('test-case-import-input') as HTMLInputElement | null;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const category = window.prompt(
      'Category to apply to all imported cases?\n(factual, multi-turn, procedural, video-citation, role-based, out-of-scope, adversarial, edge-case)',
      'factual',
    );
    if (!category) return;
    if (!this.categories.includes(category as TestCategory)) {
      this.snackBar.open(`Invalid category "${category}". Aborted.`, 'Dismiss', { duration: 5000 });
      return;
    }

    this.importing = true;
    try {
      const rows = await this.parseQAFile(file);
      if (rows.length === 0) {
        this.snackBar.open('No prompt/answer rows found in file.', 'Dismiss', { duration: 5000 });
        return;
      }

      const cases: Partial<ITestCase>[] = rows.map(r => ({
        name: r.prompt.length > 60 ? r.prompt.slice(0, 57) + '...' : r.prompt,
        category: category as TestCategory,
        priority: 'medium',
        turns: [{ userMessage: r.prompt, expectedBehavior: r.answer }],
        tags: ['imported'],
      }));

      const res = await this.tsManager.importCases(this.suiteId, cases);
      if (res.success) {
        this.snackBar.open(`Imported ${res.data?.imported ?? rows.length} cases.`, '', { duration: 4000 });
        await this.load();
      } else {
        this.snackBar.open(`Import failed: ${res.error}`, 'Dismiss', { duration: 6000 });
      }
    } catch (e) {
      this.snackBar.open(`Failed to parse file: ${(e as Error).message}`, 'Dismiss', { duration: 6000 });
    } finally {
      this.importing = false;
    }
  }

  private async parseQAFile(file: File): Promise<{ prompt: string; answer: string }[]> {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('Workbook has no sheets');
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    if (rows.length === 0) return [];

    // Find prompt/answer columns by fuzzy header match
    const headers = Object.keys(rows[0]);
    const promptKey = headers.find(h => /^(prompt|question|user[\s_]?message|query|input)$/i.test(h.trim()));
    const answerKey = headers.find(h => /^(expected[\s_]?answer|answer|expected|response|reply|output|expected[\s_]?behavior)$/i.test(h.trim()));

    if (!promptKey || !answerKey) {
      throw new Error(
        `Could not find prompt and answer columns. Expected headers like "Prompt" and "Expected Answer". Found: ${headers.join(', ')}`,
      );
    }

    return rows
      .map(r => ({
        prompt: String(r[promptKey] ?? '').trim(),
        answer: String(r[answerKey] ?? '').trim(),
      }))
      .filter(r => r.prompt && r.answer);
  }

  async createCase(): Promise<void> {
    const res = await this.tsManager.createCase(this.suiteId, {
      name: 'New Test Case',
      category: 'factual',
      turns: [{ userMessage: '', expectedBehavior: '' }],
    });
    if (res.success && res.data) {
      this.cases.unshift(res.data);
      this.expandedCaseId = res.data.id;
      this.applyFilters();
    }
  }

  toggleExpand(tc: ITestCase): void {
    this.expandedCaseId = this.expandedCaseId === tc.id ? '' : tc.id;
  }

  addTurn(tc: ITestCase): void {
    tc.turns.push({ userMessage: '', expectedBehavior: '' });
  }

  removeTurn(tc: ITestCase, index: number): void {
    if (tc.turns.length <= 1) return;
    tc.turns.splice(index, 1);
  }

  async saveCase(tc: ITestCase): Promise<void> {
    const res = await this.tsManager.updateCase(this.suiteId, tc.id, {
      name: tc.name,
      category: tc.category,
      priority: tc.priority,
      turns: tc.turns,
      roleLevel: tc.roleLevel,
      tags: tc.tags,
      enabled: tc.enabled,
    });
    if (res.success) {
      this.snackBar.open('Saved', '', { duration: 1500 });
    }
  }

  async deleteCase(tc: ITestCase, event: Event): Promise<void> {
    event.stopPropagation();
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Test Case',
        message: `Delete "${tc.name}"?`,
        confirmText: 'Delete',
        confirmColor: 'warn',
      },
    });

    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    const res = await this.tsManager.deleteCase(this.suiteId, tc.id);
    if (res.success) {
      this.cases = this.cases.filter(c => c.id !== tc.id);
      this.applyFilters();
      this.snackBar.open('Deleted', '', { duration: 2000 });
    }
  }

  async toggleEnabled(tc: ITestCase): Promise<void> {
    tc.enabled = !tc.enabled;
    await this.tsManager.updateCase(this.suiteId, tc.id, { enabled: tc.enabled });
  }

  goBack(): void {
    this.router.navigate(['/test-suites']);
  }

  getCategoryCount(category: string): number {
    return this.cases.filter(c => c.category === category).length;
  }

  get enabledCount(): number { return this.cases.filter(c => c.enabled).length; }
  get aiGeneratedCount(): number { return this.cases.filter(c => c.source === 'ai-generated').length; }
  get userCreatedCount(): number { return this.cases.filter(c => c.source === 'user-created').length; }

  priorityColor(p: string): string {
    switch (p) {
      case 'high': return '#c62828';
      case 'medium': return '#e65100';
      case 'low': return '#2e7d32';
      default: return '';
    }
  }
}

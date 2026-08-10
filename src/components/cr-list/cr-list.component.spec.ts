import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrListComponent } from './cr-list.component';
import { SessionService } from '../../session/session.service';
import { CrApiService } from '../../api/cr-api.service';
import { users } from '../../api/fixtures';
import { CrSummary, CrStatus, ReqUser } from '../../models/cr.models';

const flush = () => new Promise((r) => setTimeout(r, 0));

const settle = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), 0));
const settleReject = (message: string): Promise<never> =>
	new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));

const mixedRows: CrSummary[] = [
	{ id: 'CR-P', title: 'Pending', status: 'PENDING_APPROVAL', orgCode: 'org-alpha', delta: 1, currency: 'USD', updatedAt: '2026-03-02T10:00:00.000Z' },
	{ id: 'CR-A', title: 'Approved', status: 'APPROVED', orgCode: 'org-alpha', delta: 2, currency: 'USD', updatedAt: '2026-03-02T11:00:00.000Z' },
	{ id: 'CR-R', title: 'Rejected', status: 'REJECTED', orgCode: 'org-alpha', delta: 3, currency: 'USD', updatedAt: '2026-03-02T12:00:00.000Z' },
	{ id: 'CR-D', title: 'Draft', status: 'DRAFT', orgCode: 'org-alpha', delta: 0, currency: 'USD', updatedAt: '2026-03-02T13:00:00.000Z' },
];

function rowStatuses(el: HTMLElement): string[] {
	return Array.from(el.querySelectorAll('.cr-list__row .cr-status')).map((node) => node.textContent?.trim() ?? '');
}

function rowIds(el: HTMLElement): string[] {
	return Array.from(el.querySelectorAll('.cr-list__row td:first-child')).map((node) => node.textContent?.trim() ?? '');
}

async function render(
	user: ReqUser,
	options?: { api?: Partial<CrApiService>; settle?: boolean },
): Promise<ComponentFixture<CrListComponent>> {
	const providers: { provide: unknown; useValue: unknown }[] = [{ provide: SessionService, useValue: { user } }];
	if (options?.api) {
		providers.push({ provide: CrApiService, useValue: options.api });
	}

	TestBed.configureTestingModule({
		imports: [CrListComponent],
		providers,
	});
	await TestBed.compileComponents();
	const fixture = TestBed.createComponent(CrListComponent);
	fixture.detectChanges(); // ngOnInit -> load()
	if (options?.settle !== false) {
		await flush(); // let the mock API resolve
		fixture.detectChanges(); // render the loaded/empty/error state
	}
	return fixture;
}

function applyFilter(fixture: ComponentFixture<CrListComponent>, status: CrStatus | 'ALL'): void {
	fixture.componentInstance.onFilterChange(status);
	fixture.detectChanges();
}

describe('CrListComponent', () => {
	afterEach(() => {
		TestBed.resetTestingModule();
	});

	it('renders a row per change request in the user org', async () => {
		const fixture = await render(users.approver);
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row').length).toBe(3); // org-alpha: CR-1, CR-2, CR-3
	});

	it('shows the empty state when the org has no change requests', async () => {
		const fixture = await render({ id: 'x', orgCode: 'org-empty', policies: ['cr_r_o'] });
		expect(fixture.nativeElement.querySelector('.cr-list__empty')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});

	it('shows the loading state before the API settles', async () => {
		const fixture = await render(users.approver, {
			api: {
				listChangeRequests: () => new Promise(() => undefined),
			},
			settle: false,
		});
		expect(fixture.nativeElement.querySelector('.cr-list__loading')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});

	it('shows the error state when the API fails', async () => {
		const fixture = await render(users.approver, {
			api: {
				listChangeRequests: () => settleReject('Network error'),
			},
		});
		const error = fixture.nativeElement.querySelector('.cr-list__error');
		expect(error).not.toBeNull();
		expect(error.textContent).toContain('Network error');
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});

	it('emits stateChange with error so the shell can hide detail', async () => {
		const states: string[] = [];
		TestBed.configureTestingModule({
			imports: [CrListComponent],
			providers: [
				{ provide: SessionService, useValue: { user: users.approver } },
				{ provide: CrApiService, useValue: { listChangeRequests: () => settleReject('Network error') } },
			],
		});
		await TestBed.compileComponents();
		const fixture = TestBed.createComponent(CrListComponent);
		fixture.componentInstance.stateChange.subscribe((state) => states.push(state.status));
		fixture.detectChanges();
		await flush();
		fixture.detectChanges();
		expect(states[states.length - 1]).toBe('error');
	});

	describe('status filter', () => {
		async function renderMixed(): Promise<ComponentFixture<CrListComponent>> {
			return render(users.approver, {
				api: {
					listChangeRequests: () => settle(mixedRows.map((row) => ({ ...row }))),
				},
			});
		}

		it('ALL filter renders all available rows', async () => {
			const fixture = await renderMixed();
			applyFilter(fixture, 'ALL');
			expect(rowIds(fixture.nativeElement)).toEqual(['CR-P', 'CR-A', 'CR-R', 'CR-D']);
			expect(fixture.componentInstance.visibleRows.map((r) => r.id)).toEqual(['CR-P', 'CR-A', 'CR-R', 'CR-D']);
		});

		it('PENDING_APPROVAL renders only pending rows', async () => {
			const fixture = await renderMixed();
			applyFilter(fixture, 'PENDING_APPROVAL');
			expect(rowStatuses(fixture.nativeElement)).toEqual(['PENDING_APPROVAL']);
			expect(rowIds(fixture.nativeElement)).toEqual(['CR-P']);
			expect(fixture.componentInstance.visibleRows.map((r) => r.id)).toEqual(['CR-P']);
		});

		it('APPROVED renders only approved rows', async () => {
			const fixture = await renderMixed();
			applyFilter(fixture, 'APPROVED');
			expect(rowStatuses(fixture.nativeElement)).toEqual(['APPROVED']);
			expect(rowIds(fixture.nativeElement)).toEqual(['CR-A']);
			expect(fixture.componentInstance.visibleRows.map((r) => r.id)).toEqual(['CR-A']);
		});

		it('REJECTED renders only rejected rows', async () => {
			const fixture = await renderMixed();
			applyFilter(fixture, 'REJECTED');
			expect(rowStatuses(fixture.nativeElement)).toEqual(['REJECTED']);
			expect(rowIds(fixture.nativeElement)).toEqual(['CR-R']);
			expect(fixture.componentInstance.visibleRows.map((r) => r.id)).toEqual(['CR-R']);
		});

		it('changing the filter updates the rendered table without changing loaded state', async () => {
			const fixture = await renderMixed();
			applyFilter(fixture, 'PENDING_APPROVAL');
			expect(rowIds(fixture.nativeElement)).toEqual(['CR-P']);

			applyFilter(fixture, 'APPROVED');
			expect(rowIds(fixture.nativeElement)).toEqual(['CR-A']);
			expect(fixture.componentInstance.state.status).toBe('loaded');
			expect(fixture.componentInstance.state.data?.map((r) => r.id)).toEqual(['CR-P', 'CR-A', 'CR-R', 'CR-D']);
		});

		it('keeps loaded state when the filter matches no rows', async () => {
			const fixture = await renderMixed();
			applyFilter(fixture, 'CANCELLED');
			expect(fixture.componentInstance.state.status).toBe('loaded');
			expect(fixture.nativeElement.querySelector('.cr-list__empty')).toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__table')).not.toBeNull();
			expect(fixture.nativeElement.querySelectorAll('.cr-list__row').length).toBe(0);
			expect(fixture.componentInstance.visibleRows).toEqual([]);
		});
	});
});

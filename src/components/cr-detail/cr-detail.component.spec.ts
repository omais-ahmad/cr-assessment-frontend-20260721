import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrDetailComponent } from './cr-detail.component';
import { SessionService } from '../../session/session.service';
import { CrApiService } from '../../api/cr-api.service';
import { users } from '../../api/fixtures';
import { CrDetail, ReqUser } from '../../models/cr.models';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), 0));
const settleReject = (message: string): Promise<never> =>
	new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 0));

async function render(
	user: ReqUser,
	id: string,
	options?: { api?: Partial<CrApiService>; settle?: boolean },
): Promise<ComponentFixture<CrDetailComponent>> {
	const providers: { provide: unknown; useValue: unknown }[] = [{ provide: SessionService, useValue: { user } }];
	if (options?.api) {
		providers.push({ provide: CrApiService, useValue: options.api });
	}

	TestBed.configureTestingModule({
		imports: [CrDetailComponent],
		providers,
	});
	await TestBed.compileComponents();
	const fixture = TestBed.createComponent(CrDetailComponent);
	fixture.componentInstance.id = id;
	fixture.detectChanges(); // ngOnInit -> load()
	if (options?.settle !== false) {
		await flush(); // let the mock API resolve
		fixture.detectChanges(); // render the loaded/error state
	}
	return fixture;
}

function diffKindsBySku(el: HTMLElement): Record<string, string> {
	const result: Record<string, string> = {};
	el.querySelectorAll('.cr-diff__row').forEach((row) => {
		const sku = row.querySelector('td')?.textContent?.trim() ?? '';
		const kind = row.getAttribute('data-kind') ?? '';
		result[sku] = kind;
	});
	return result;
}

function timelineActions(el: HTMLElement): string[] {
	return Array.from(el.querySelectorAll('.cr-timeline__action')).map((node) => node.textContent?.trim() ?? '');
}

describe('CrDetailComponent', () => {
	afterEach(() => {
		TestBed.resetTestingModule();
	});

	it('loads and renders the change request title', async () => {
		const fixture = await render(users.approver, 'CR-1');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Add 1 unit of SKU-A');
	});

	it('renders totals and delta from the loaded CR', async () => {
		const fixture = await render(users.approver, 'CR-1');
		const totals = fixture.nativeElement.querySelector('.cr-detail__totals').textContent;
		expect(totals).toContain('USD 8,000.00');
		expect(totals).toContain('USD 8,500.00');
		expect(fixture.nativeElement.querySelector('.cr-detail__delta').textContent).toContain('USD 500.00');
	});

	it('renders a quantity-only change as changed and unchanged rows as unchanged', async () => {
		const fixture = await render(users.approver, 'CR-1'); // SKU-A qty 10→11; SKU-B identical
		const kinds = diffKindsBySku(fixture.nativeElement);
		expect(kinds['SKU-A']).toBe('changed');
		expect(kinds['SKU-B']).toBe('unchanged');
	});

	it('renders a description-only change as changed', async () => {
		const fixture = await render(users.approver, 'CR-2'); // SKU-B description changes; same qty/price
		expect(diffKindsBySku(fixture.nativeElement)['SKU-B']).toBe('changed');
	});

	it('renders added and removed rows from the diff', async () => {
		const detail: CrDetail = {
			id: 'CR-X',
			title: 'Add and remove',
			status: 'PENDING_APPROVAL',
			orgCode: 'org-alpha',
			delta: 100,
			currency: 'USD',
			updatedAt: '2026-03-02T10:00:00.000Z',
			agreementId: 'AGR-X',
			baselineLineItems: [
				{ sku: 'SKU-KEEP', description: 'Keep', quantity: 1, unitPrice: 10 },
				{ sku: 'SKU-GONE', description: 'Gone', quantity: 2, unitPrice: 20 },
			],
			proposedLineItems: [
				{ sku: 'SKU-KEEP', description: 'Keep', quantity: 1, unitPrice: 10 },
				{ sku: 'SKU-NEW', description: 'New', quantity: 3, unitPrice: 30 },
			],
			baselineTotal: 50,
			newTotal: 100,
			audit: [{ action: 'CREATE', byUserId: 'alice', at: '2026-03-02T09:00:00.000Z' }],
		};

		const fixture = await render(users.approver, 'CR-X', {
			api: { getChangeRequest: () => settle({ ...detail }) },
		});
		const kinds = diffKindsBySku(fixture.nativeElement);
		expect(kinds['SKU-GONE']).toBe('removed');
		expect(kinds['SKU-NEW']).toBe('added');
		expect(kinds['SKU-KEEP']).toBe('unchanged');
	});

	it('renders the timeline chronologically oldest-first even when audit is reverse-ordered', async () => {
		const fixture = await render(users.approver, 'CR-1');
		// Fixture audit order is SEND_FOR_APPROVAL, SUBMIT, CREATE — UI must show CREATE first.
		expect(timelineActions(fixture.nativeElement)).toEqual(['CREATE', 'SUBMIT', 'SEND_FOR_APPROVAL']);
		expect(fixture.componentInstance.detail?.audit.map((e) => e.action)).toEqual([
			'SEND_FOR_APPROVAL',
			'SUBMIT',
			'CREATE',
		]);
	});

	it('enables Approve for an authorized user on a pending CR', async () => {
		const fixture = await render(users.approver, 'CR-1');
		const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
		expect(approveBtn.disabled).toBe(false);
	});

	it('disables Approve for a read-only viewer on a pending CR', async () => {
		const fixture = await render(users.viewer, 'CR-1'); // viewer: cr_r_o only; CR-1 is PENDING_APPROVAL
		const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
		expect(approveBtn.disabled).toBe(true);
	});

	it('disables Approve for a non-pending CR even when the user can approve', async () => {
		const fixture = await render(users.approver, 'CR-2'); // APPLIED
		const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
		expect(approveBtn.disabled).toBe(true);
	});

	it('shows the loading state before the API settles', async () => {
		const fixture = await render(users.approver, 'CR-1', {
			api: { getChangeRequest: () => new Promise(() => undefined) },
			settle: false,
		});
		expect(fixture.nativeElement.querySelector('.cr-detail__loading')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-detail__header')).toBeNull();
	});

	it('shows the error state when the API fails', async () => {
		const fixture = await render(users.approver, 'CR-1', {
			api: { getChangeRequest: () => settleReject('Network error') },
		});
		const error = fixture.nativeElement.querySelector('.cr-detail__error');
		expect(error).not.toBeNull();
		expect(error.textContent).toContain('Network error');
		expect(fixture.nativeElement.querySelector('.cr-detail__header')).toBeNull();
	});
});

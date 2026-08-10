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
	fixture.componentRef.setInput('id', id);
	fixture.detectChanges(); // ngOnChanges -> load()
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

	it('reloads when the id input changes to another CR', async () => {
		const fixture = await render(users.approver, 'CR-1');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Add 1 unit of SKU-A');

		fixture.componentRef.setInput('id', 'CR-2');
		fixture.detectChanges(); // ngOnChanges -> load()
		await flush();
		fixture.detectChanges();

		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Replace SKU-B supplier');
		expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('APPLIED');
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
		expect(approveBtn).not.toBeNull();
		expect(approveBtn.disabled).toBe(false);
	});

	it('hides Approve for a read-only viewer on a pending CR', async () => {
		const fixture = await render(users.viewer, 'CR-1'); // viewer: cr_r_o only; CR-1 is PENDING_APPROVAL
		expect(fixture.nativeElement.querySelector('.cr-detail__header')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-actions__approve')).toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
	});

	it('hides Approve for a non-pending CR even when the user can approve', async () => {
		const fixture = await render(users.approver, 'CR-2'); // APPLIED
		expect(fixture.nativeElement.querySelector('.cr-detail__header')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-actions__approve')).toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
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

	describe('approve action', () => {
		const pendingDetail: CrDetail = {
			id: 'CR-1',
			title: 'Add 1 unit of SKU-A',
			status: 'PENDING_APPROVAL',
			orgCode: 'org-alpha',
			delta: 500,
			currency: 'USD',
			updatedAt: '2026-03-02T10:00:00.000Z',
			agreementId: 'AGR-1',
			baselineLineItems: [{ sku: 'SKU-A', description: 'Widget A', quantity: 10, unitPrice: 500 }],
			proposedLineItems: [{ sku: 'SKU-A', description: 'Widget A', quantity: 11, unitPrice: 500 }],
			baselineTotal: 8000,
			newTotal: 8500,
			audit: [{ action: 'CREATE', byUserId: 'alice', at: '2026-03-02T09:00:00.000Z' }],
		};

		function approvedFrom(pending: CrDetail): CrDetail {
			return {
				...pending,
				status: 'APPROVED',
				updatedAt: '2026-03-02T12:00:00.000Z',
				audit: [
					...pending.audit,
					{ action: 'APPROVE', byUserId: users.approver.id, at: '2026-03-02T12:00:00.000Z' },
				],
			};
		}

		it('calls the approve API once and updates the UI on success', async () => {
			const approved = approvedFrom(pendingDetail);
			const approve = jest.fn(() => settle(approved));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					approve,
				},
			});

			const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
			expect(approveBtn.disabled).toBe(false);

			approveBtn.click();
			await flush();
			fixture.detectChanges();

			expect(approve).toHaveBeenCalledTimes(1);
			expect(approve).toHaveBeenCalledWith(users.approver, 'CR-1', expect.any(String));
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('APPROVED');
			expect(fixture.nativeElement.querySelector('.cr-actions__approve')).toBeNull();
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-actions__error')).toBeNull();
		});

		it('does not call the approve API for a read-only viewer', async () => {
			const approve = jest.fn(() => settle(approvedFrom(pendingDetail)));
			const fixture = await render(users.viewer, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					approve,
				},
			});

			await fixture.componentInstance.approve();
			fixture.detectChanges();

			expect(approve).not.toHaveBeenCalled();
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('PENDING_APPROVAL');
		});

		it('does not call the approve API for a non-pending CR', async () => {
			const nonPending: CrDetail = { ...pendingDetail, status: 'APPLIED' };
			const approve = jest.fn(() => settle(approvedFrom(pendingDetail)));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle(nonPending),
					approve,
				},
			});

			await fixture.componentInstance.approve();
			fixture.detectChanges();

			expect(approve).not.toHaveBeenCalled();
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('APPLIED');
		});

		it('ignores duplicate approve attempts while a request is in flight', async () => {
			let resolveApprove!: (value: CrDetail) => void;
			const approve = jest.fn(
				() =>
					new Promise<CrDetail>((resolve) => {
						resolveApprove = resolve;
					}),
			);
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					approve,
				},
			});

			const first = fixture.componentInstance.approve();
			const second = fixture.componentInstance.approve();
			fixture.detectChanges();

			expect(fixture.componentInstance.submitting).toBe(true);
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(true);
			expect(approve).toHaveBeenCalledTimes(1);

			resolveApprove(approvedFrom(pendingDetail));
			await Promise.all([first, second]);
			fixture.detectChanges();

			expect(approve).toHaveBeenCalledTimes(1);
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('APPROVED');
		});

		it('shows an action error and keeps the CR pending when approve fails', async () => {
			const approve = jest.fn(() => settleReject('Network error'));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					approve,
				},
			});

			await fixture.componentInstance.approve();
			fixture.detectChanges();

			expect(approve).toHaveBeenCalledTimes(1);
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('PENDING_APPROVAL');
			expect(fixture.nativeElement.querySelector('.cr-actions__error').textContent).toContain('Network error');
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(false);
		});
	});

	describe('reject action', () => {
		const pendingDetail: CrDetail = {
			id: 'CR-1',
			title: 'Add 1 unit of SKU-A',
			status: 'PENDING_APPROVAL',
			orgCode: 'org-alpha',
			delta: 500,
			currency: 'USD',
			updatedAt: '2026-03-02T10:00:00.000Z',
			agreementId: 'AGR-1',
			baselineLineItems: [{ sku: 'SKU-A', description: 'Widget A', quantity: 10, unitPrice: 500 }],
			proposedLineItems: [{ sku: 'SKU-A', description: 'Widget A', quantity: 11, unitPrice: 500 }],
			baselineTotal: 8000,
			newTotal: 8500,
			audit: [{ action: 'CREATE', byUserId: 'alice', at: '2026-03-02T09:00:00.000Z' }],
		};

		function rejectedFrom(pending: CrDetail, reason: string): CrDetail {
			return {
				...pending,
				status: 'REJECTED',
				updatedAt: '2026-03-02T12:30:00.000Z',
				audit: [
					...pending.audit,
					{ action: 'REJECT', byUserId: users.approver.id, at: '2026-03-02T12:30:00.000Z', note: reason },
				],
			};
		}

		it('calls the reject API once with the trimmed reason and updates the UI on success', async () => {
			const reason = 'Pricing exceeds agreement';
			const rejected = rejectedFrom(pendingDetail, reason);
			const reject = jest.fn(() => settle(rejected));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					reject,
				},
			});

			fixture.componentInstance.rejectControl.setValue(`  ${reason}  `);
			fixture.detectChanges();
			const rejectBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__reject-btn');
			expect(rejectBtn.disabled).toBe(false);

			rejectBtn.click();
			await flush();
			fixture.detectChanges();

			expect(reject).toHaveBeenCalledTimes(1);
			expect(reject).toHaveBeenCalledWith(users.approver, 'CR-1', expect.any(String), reason);
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('REJECTED');
			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-actions__approve')).toBeNull();
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-actions__error')).toBeNull();
		});

		it('does not call the reject API for a read-only viewer', async () => {
			const reject = jest.fn(() => settle(rejectedFrom(pendingDetail, 'nope')));
			const fixture = await render(users.viewer, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					reject,
				},
			});

			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
			fixture.componentInstance.rejectControl.setValue('Not allowed');
			await fixture.componentInstance.reject();
			fixture.detectChanges();

			expect(reject).not.toHaveBeenCalled();
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('PENDING_APPROVAL');
		});

		it('does not call the reject API for a non-pending CR', async () => {
			const nonPending: CrDetail = { ...pendingDetail, status: 'APPLIED' };
			const reject = jest.fn(() => settle(rejectedFrom(pendingDetail, 'nope')));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle(nonPending),
					reject,
				},
			});

			fixture.componentInstance.rejectControl.setValue('Too late');
			await fixture.componentInstance.reject();
			fixture.detectChanges();

			expect(reject).not.toHaveBeenCalled();
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('APPLIED');
			expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
		});

		it('blocks reject when the reason is empty without submitting', async () => {
			const reject = jest.fn(() => settle(rejectedFrom(pendingDetail, 'nope')));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					reject,
				},
			});

			fixture.componentInstance.rejectControl.setValue('');
			await fixture.componentInstance.reject();
			fixture.detectChanges();

			expect(reject).not.toHaveBeenCalled();
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-actions__reason-error')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('PENDING_APPROVAL');
		});

		it('blocks reject when the reason is whitespace-only without submitting', async () => {
			const reject = jest.fn(() => settle(rejectedFrom(pendingDetail, 'nope')));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					reject,
				},
			});

			fixture.componentInstance.rejectControl.setValue('   \t  ');
			await fixture.componentInstance.reject();
			fixture.detectChanges();

			expect(reject).not.toHaveBeenCalled();
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-actions__reason-error')).not.toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-actions__reject-btn').disabled).toBe(true);
		});

		it('ignores duplicate reject attempts while a request is in flight', async () => {
			let resolveReject!: (value: CrDetail) => void;
			const reject = jest.fn(
				() =>
					new Promise<CrDetail>((resolve) => {
						resolveReject = resolve;
					}),
			);
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					reject,
				},
			});

			fixture.componentInstance.rejectControl.setValue('Duplicate guard');
			const first = fixture.componentInstance.reject();
			const second = fixture.componentInstance.reject();
			fixture.detectChanges();

			expect(fixture.componentInstance.submitting).toBe(true);
			expect(fixture.nativeElement.querySelector('.cr-actions__reject-btn').disabled).toBe(true);
			expect(reject).toHaveBeenCalledTimes(1);

			resolveReject(rejectedFrom(pendingDetail, 'Duplicate guard'));
			await Promise.all([first, second]);
			fixture.detectChanges();

			expect(reject).toHaveBeenCalledTimes(1);
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('REJECTED');
		});

		it('shows an action error and keeps the CR pending when reject fails', async () => {
			const reject = jest.fn(() => settleReject('Network error'));
			const fixture = await render(users.approver, 'CR-1', {
				api: {
					getChangeRequest: () => settle({ ...pendingDetail }),
					reject,
				},
			});

			fixture.componentInstance.rejectControl.setValue('Still pending after failure');
			await fixture.componentInstance.reject();
			fixture.detectChanges();

			expect(reject).toHaveBeenCalledTimes(1);
			expect(fixture.componentInstance.submitting).toBe(false);
			expect(fixture.nativeElement.querySelector('.cr-status').textContent).toContain('PENDING_APPROVAL');
			expect(fixture.nativeElement.querySelector('.cr-actions__error').textContent).toContain('Network error');
			expect(fixture.nativeElement.querySelector('.cr-actions__reject-btn').disabled).toBe(false);
		});
	});
});

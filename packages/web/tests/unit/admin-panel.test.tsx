import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPanel } from '../../src/components/admin/admin-panel';

const mocks = vi.hoisted(() => ({
	useAuth: vi.fn(),
	useAdminSettings: vi.fn(),
	useAdminUsers: vi.fn(),
	updateSettings: { mutate: vi.fn(), isPending: false },
	createUser: { mutateAsync: vi.fn(), isPending: false },
	updateUser: { mutateAsync: vi.fn(), isPending: false },
	resetPassword: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('../../src/providers/auth', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../src/hooks/queries', () => ({
	useAdminSettings: mocks.useAdminSettings,
	useAdminUsers: mocks.useAdminUsers,
	useUpdateAdminSettings: () => mocks.updateSettings,
	useCreateAdminUser: () => mocks.createUser,
	useUpdateAdminUser: () => mocks.updateUser,
	useResetAdminPassword: () => mocks.resetPassword,
}));

describe('AdminPanel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.useAdminSettings.mockReturnValue({
			data: { registrationLocked: false },
			isLoading: false,
			isError: false,
		});
		mocks.useAdminUsers.mockReturnValue({
			data: { pages: [{ users: [], hasMore: false, cursor: null }] },
			isLoading: false,
			isError: false,
			hasNextPage: false,
		});
	});

	it('does not enable admin reads for an ordinary user', () => {
		mocks.useAuth.mockReturnValue({ user: { role: 'user' } });

		render(<AdminPanel />);

		expect(screen.getByRole('alert').textContent).toContain('Administrator access required');
		expect(mocks.useAdminSettings).toHaveBeenCalledWith(false);
		expect(mocks.useAdminUsers).toHaveBeenCalledWith(false);
	});

	it('renders admin controls and updates registration policy', () => {
		mocks.useAuth.mockReturnValue({ user: { role: 'admin' } });

		render(<AdminPanel />);
		fireEvent.click(screen.getByRole('checkbox', { name: /lock public registration/i }));

		expect(screen.getByRole('heading', { name: /administration/i })).toBeTruthy();
		expect(mocks.useAdminSettings).toHaveBeenCalledWith(true);
		expect(mocks.updateSettings.mutate.mock.calls[0]?.[0]).toBe(true);
	});
});

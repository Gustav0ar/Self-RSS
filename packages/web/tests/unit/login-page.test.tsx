import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../../src/components/auth/login-page';

const apiFetchMock = vi.fn();
const loginMock = vi.fn();
const registerMock = vi.fn();

vi.mock('@/lib/api', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/providers/auth', () => ({
	useAuth: () => ({
		login: loginMock,
		register: registerMock,
	}),
}));

describe('LoginPage registration availability', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not expose registration when the API reports it disabled', async () => {
		apiFetchMock.mockResolvedValue({ data: { registrationEnabled: false } });

		render(<LoginPage />);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith('/auth/registration-status');
		});

		expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
	});

	it('does not expose registration when registration status cannot be loaded', async () => {
		apiFetchMock.mockRejectedValue(new Error('status unavailable'));

		render(<LoginPage />);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith('/auth/registration-status');
		});

		expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
	});

	it('allows registration only when the API reports it enabled', async () => {
		apiFetchMock.mockResolvedValue({ data: { registrationEnabled: true } });
		registerMock.mockResolvedValue(undefined);

		render(<LoginPage />);

		const registerButton = await screen.findByRole('button', { name: 'Register' });
		fireEvent.click(registerButton);

		fireEvent.change(screen.getByLabelText('Email'), {
			target: { value: 'new@example.com' },
		});
		fireEvent.change(screen.getByLabelText('Password'), {
			target: { value: 'password123' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

		await waitFor(() => {
			expect(registerMock).toHaveBeenCalledWith('', 'new@example.com', 'password123');
		});
	});
});

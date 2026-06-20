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

describe('LoginPage - login flow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiFetchMock.mockResolvedValue({ data: { registrationEnabled: false } });
	});

	it('submits credentials to the auth provider in login mode', async () => {
		loginMock.mockResolvedValue(undefined);

		render(<LoginPage />);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalledWith('/auth/registration-status', expect.any(Object));
		});

		fireEvent.change(screen.getByLabelText('Email'), {
			target: { value: 'user@example.com' },
		});
		fireEvent.change(screen.getByLabelText('Password'), {
			target: { value: 'password123' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

		await waitFor(() => {
			expect(loginMock).toHaveBeenCalledWith('user@example.com', 'password123');
		});
	});

	it('surfaces the error message when login throws', async () => {
		loginMock.mockRejectedValue(new Error('Invalid credentials'));

		render(<LoginPage />);

		await waitFor(() => {
			expect(apiFetchMock).toHaveBeenCalled();
		});

		fireEvent.change(screen.getByLabelText('Email'), {
			target: { value: 'wrong@example.com' },
		});
		fireEvent.change(screen.getByLabelText('Password'), {
			target: { value: 'bad' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

		await waitFor(() => {
			expect(screen.getByText('Invalid credentials')).toBeTruthy();
		});
	});
});

describe('LoginPage - register flow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiFetchMock.mockResolvedValue({ data: { registrationEnabled: true } });
	});

	it('submits the registration form to the auth provider', async () => {
		registerMock.mockResolvedValue(undefined);

		render(<LoginPage />);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Register' }));
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

	it('surfaces the register error message on failure', async () => {
		registerMock.mockRejectedValue(new Error('Email already registered'));

		render(<LoginPage />);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Register' }));
		fireEvent.change(screen.getByLabelText('Email'), {
			target: { value: 'taken@example.com' },
		});
		fireEvent.change(screen.getByLabelText('Password'), {
			target: { value: 'password123' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

		await waitFor(() => {
			expect(screen.getByText('Email already registered')).toBeTruthy();
		});
	});

	it('toggles between the login and register headers', async () => {
		render(<LoginPage />);

		await waitFor(() => {
			expect(screen.getByText('Sign in to your account')).toBeTruthy();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Register' }));
		expect(screen.getByText('Create an account')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		expect(screen.getByText('Sign in to your account')).toBeTruthy();
	});
});

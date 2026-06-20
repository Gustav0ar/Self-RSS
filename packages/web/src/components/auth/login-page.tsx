import { ArrowRight, Rss, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthErrorFallback } from '@/components/error-fallbacks';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/providers/auth';

function LoginPageContent() {
	const { login, register } = useAuth();
	const [mode, setMode] = useState<'login' | 'register'>('login');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
	const canRegister = registrationEnabled === true;

	useEffect(() => {
		const controller = new AbortController();

		async function checkRegistrationStatus() {
			try {
				const res = await apiFetch<{ data: { registrationEnabled: boolean } }>(
					'/auth/registration-status',
					{ signal: controller.signal },
				);
				setRegistrationEnabled(res.data.registrationEnabled);
				if (!res.data.registrationEnabled) {
					setMode('login');
				}
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					return;
				}
				setRegistrationEnabled(false);
				setMode('login');
			}
		}

		void checkRegistrationStatus();
		return () => {
			controller.abort();
		};
	}, []);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			if (mode === 'login') {
				await login(email, password);
			} else {
				if (!canRegister) {
					setMode('login');
					setError('Registration is currently closed');
					return;
				}
				await register('', email, password);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'An error occurred');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4 py-10">
			<div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
				<section className="surface-card motion-enter hidden rounded-[2rem] p-10 lg:flex lg:flex-col lg:justify-between">
					<div>
						<div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/12 text-primary">
							<Rss className="h-7 w-7" />
						</div>
						<p className="mt-8 text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
							Reading workspace
						</p>
						<h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-foreground xl:text-5xl">
							Modern RSS reading that feels calm, focused, and fast.
						</h1>
						<p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground">
							Keep your feeds organized, search across everything, and move through articles with a
							clean reader designed for long sessions.
						</p>
					</div>

					<div className="grid gap-4 md:grid-cols-3">
						<div className="surface-muted rounded-3xl p-5">
							<Sparkles className="h-5 w-5 text-primary" />
							<h2 className="mt-3 text-sm font-semibold">Focused</h2>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">
								A reader surface built for deep reading instead of clutter.
							</p>
						</div>
						<div className="surface-muted rounded-3xl p-5">
							<ArrowRight className="h-5 w-5 text-primary" />
							<h2 className="mt-3 text-sm font-semibold">Fluid</h2>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">
								Fast search, keyboard navigation, and smooth transitions throughout.
							</p>
						</div>
						<div className="surface-muted rounded-3xl p-5">
							<ShieldCheck className="h-5 w-5 text-primary" />
							<h2 className="mt-3 text-sm font-semibold">Secure</h2>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">
								Short-lived access tokens with refresh handled through secure cookies.
							</p>
						</div>
					</div>
				</section>

				<section className="surface-card motion-scale rounded-[2rem] p-6 shadow-2xl sm:p-8">
					<div className="mx-auto w-full max-w-sm">
						<div className="flex flex-col items-center gap-3 text-center">
							<div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/12 text-primary lg:hidden">
								<Rss className="h-7 w-7" />
							</div>
							<div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/12 text-primary max-lg:hidden">
								<Rss className="h-7 w-7" />
							</div>
							<h1 className="text-2xl font-semibold tracking-tight">SelfFeed</h1>
							<p className="text-sm text-muted-foreground">
								{mode === 'login' ? 'Sign in to your account' : 'Create an account'}
							</p>
							{mode === 'register' ? (
								<p className="rounded-2xl bg-primary/8 px-4 py-3 text-center text-xs leading-5 text-muted-foreground">
									On a fresh install, the first registered account becomes the admin.
								</p>
							) : null}
						</div>

						{error ? (
							<div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
								{error}
							</div>
						) : null}

						<form onSubmit={handleSubmit} className="mt-6 space-y-4">
							<div>
								<label htmlFor="email" className="mb-2 block text-sm font-medium">
									Email
								</label>
								<input
									id="email"
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									required
									className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
								/>
							</div>

							<div>
								<label htmlFor="password" className="mb-2 block text-sm font-medium">
									Password
								</label>
								<input
									id="password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									className="input-surface h-12 w-full rounded-2xl px-4 text-sm outline-none"
								/>
							</div>

							<button
								type="submit"
								disabled={loading}
								className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50"
							>
								{loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
							</button>
						</form>

						<div className="mt-6 text-center text-sm text-muted-foreground">
							{mode === 'login' ? (
								canRegister ? (
									<>
										Don&apos;t have an account?{' '}
										<button
											type="button"
											onClick={() => setMode('register')}
											className="font-medium text-primary hover:underline"
										>
											Register
										</button>
									</>
								) : null
							) : (
								<>
									Already have an account?{' '}
									<button
										type="button"
										onClick={() => setMode('login')}
										className="font-medium text-primary hover:underline"
									>
										Sign in
									</button>
								</>
							)}
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}

export function LoginPage() {
	return (
		<ErrorBoundary fallback={AuthErrorFallback}>
			<LoginPageContent />
		</ErrorBoundary>
	);
}

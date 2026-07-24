import { KeyRound, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { QueryFailure } from '@/components/query-failure';
import {
	useAdminSettings,
	useAdminUsers,
	useCreateAdminUser,
	useResetAdminPassword,
	useUpdateAdminSettings,
	useUpdateAdminUser,
} from '@/hooks/queries';
import { useAuth } from '@/providers/auth';

export function AdminPanel() {
	const { user: currentUser } = useAuth();
	const isAdmin = currentUser?.role === 'admin';
	const settings = useAdminSettings(isAdmin);
	const usersQuery = useAdminUsers(isAdmin);
	const updateSettings = useUpdateAdminSettings();
	const createUser = useCreateAdminUser();
	const updateUser = useUpdateAdminUser();
	const resetPassword = useResetAdminPassword();
	const [createError, setCreateError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [resetUserId, setResetUserId] = useState<string | null>(null);
	const users = useMemo(
		() => usersQuery.data?.pages.flatMap((page) => page.users) ?? [],
		[usersQuery.data],
	);

	if (!isAdmin) {
		return (
			<div className="p-6">
				<div role="alert" className="rounded-2xl border border-red-500/25 bg-red-500/5 p-5">
					<p className="font-medium">Administrator access required</p>
					<p className="mt-1 text-sm text-muted-foreground">
						This workspace is only available to administrators.
					</p>
				</div>
			</div>
		);
	}

	async function handleCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setCreateError(null);
		const form = new FormData(event.currentTarget);
		try {
			await createUser.mutateAsync({
				email: String(form.get('email') ?? ''),
				password: String(form.get('password') ?? ''),
				role: form.get('role') === 'admin' ? 'admin' : 'user',
			});
			event.currentTarget.reset();
		} catch (error) {
			setCreateError(error instanceof Error ? error.message : 'User could not be created');
		}
	}

	return (
		<div className="motion-enter h-full overflow-auto p-4 sm:p-6">
			<div className="mx-auto max-w-5xl">
				<header className="mb-6 flex flex-wrap items-end justify-between gap-4">
					<div>
						<p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
							Instance controls
						</p>
						<h1 className="mt-1 text-2xl font-semibold tracking-tight">Administration</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
							Control registration and manage who can read from this SelfFeed instance.
						</p>
					</div>
					<div className="surface-muted inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-muted-foreground">
						<ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
						Protected workspace
					</div>
				</header>

				{actionError ? (
					<p
						role="alert"
						className="mb-4 rounded-2xl border border-red-500/25 bg-red-500/5 p-3 text-sm"
					>
						{actionError}
					</p>
				) : null}

				<div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
					<div className="space-y-5">
						<section className="surface-muted rounded-[1.5rem] p-5">
							<h2 className="text-sm font-semibold">Registration</h2>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								When locked, only administrators can create accounts.
							</p>
							{settings.isError && !settings.data ? (
								<QueryFailure
									title="Could not load registration settings"
									error={settings.error}
									onRetry={() => void settings.refetch()}
									isRetrying={settings.isFetching}
									compact
									className="mt-4"
								/>
							) : (
								<label className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/60 p-4">
									<span className="text-sm font-medium">Lock public registration</span>
									<input
										type="checkbox"
										checked={settings.data?.registrationLocked ?? false}
										disabled={!settings.data || updateSettings.isPending}
										onChange={(event) =>
											updateSettings.mutate(event.target.checked, {
												onError: (error) => setActionError(error.message),
											})
										}
										className="h-5 w-5 accent-primary"
									/>
								</label>
							)}
						</section>

						<section className="surface-muted rounded-[1.5rem] p-5">
							<div className="flex items-center gap-2">
								<UserPlus className="h-4 w-4 text-primary" aria-hidden="true" />
								<h2 className="text-sm font-semibold">Create account</h2>
							</div>
							<form className="mt-4 space-y-3" onSubmit={(event) => void handleCreate(event)}>
								<label className="block text-xs font-medium">
									Email
									<input
										name="email"
										type="email"
										required
										className="input-surface mt-1.5 h-11 w-full rounded-2xl px-3 text-sm"
									/>
								</label>
								<label className="block text-xs font-medium">
									Temporary password
									<input
										name="password"
										type="password"
										minLength={8}
										required
										className="input-surface mt-1.5 h-11 w-full rounded-2xl px-3 text-sm"
									/>
								</label>
								<label className="block text-xs font-medium">
									Role
									<select
										name="role"
										className="input-surface mt-1.5 h-11 w-full rounded-2xl px-3 text-sm"
									>
										<option value="user">Reader</option>
										<option value="admin">Administrator</option>
									</select>
								</label>
								{createError ? (
									<p role="alert" className="text-xs text-red-500">
										{createError}
									</p>
								) : null}
								<button
									type="submit"
									disabled={createUser.isPending}
									className="inline-flex h-10 w-full items-center justify-center rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
								>
									{createUser.isPending ? 'Creating...' : 'Create account'}
								</button>
							</form>
						</section>
					</div>

					<section className="surface-muted rounded-[1.5rem] p-5">
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<Users className="h-4 w-4 text-primary" aria-hidden="true" />
								<h2 className="text-sm font-semibold">Accounts</h2>
							</div>
							<span className="text-xs text-muted-foreground">{users.length} loaded</span>
						</div>

						{usersQuery.isError && users.length === 0 ? (
							<QueryFailure
								title="Could not load accounts"
								error={usersQuery.error}
								onRetry={() => void usersQuery.refetch()}
								isRetrying={usersQuery.isFetching}
								className="mt-4"
							/>
						) : (
							<div className="mt-4 space-y-3">
								{users.map((user) => {
									const isCurrent = user.id === currentUser.id;
									return (
										<article
											key={user.id}
											className="rounded-2xl border border-border/70 bg-background/60 p-4"
										>
											<div className="flex flex-wrap items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="truncate text-sm font-medium">{user.email}</p>
													<p className="mt-1 text-xs text-muted-foreground">
														{user.isActive ? 'Active' : 'Disabled'}
														{isCurrent ? ' · This account' : ''}
													</p>
												</div>
												<div className="flex flex-wrap items-center gap-2">
													<select
														aria-label={`Role for ${user.email}`}
														value={user.role}
														disabled={isCurrent || updateUser.isPending}
														onChange={(event) => {
															const role = event.target.value === 'admin' ? 'admin' : 'user';
															if (
																!window.confirm(
																	`Change ${user.email} to ${role === 'admin' ? 'administrator' : 'reader'} and revoke their sessions?`,
																)
															) {
																event.target.value = user.role;
																return;
															}
															updateUser.mutate(
																{
																	id: user.id,
																	role,
																},
																{ onError: (error) => setActionError(error.message) },
															);
														}}
														className="input-surface h-9 rounded-xl px-2 text-xs"
													>
														<option value="user">Reader</option>
														<option value="admin">Admin</option>
													</select>
													<button
														type="button"
														disabled={isCurrent || updateUser.isPending}
														onClick={() => {
															if (
																user.isActive &&
																!window.confirm(`Disable ${user.email} and revoke their sessions?`)
															) {
																return;
															}
															updateUser.mutate(
																{ id: user.id, isActive: !user.isActive },
																{ onError: (error) => setActionError(error.message) },
															);
														}}
														className="h-9 rounded-xl border border-border px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
													>
														{user.isActive ? 'Disable' : 'Activate'}
													</button>
													<button
														type="button"
														onClick={() => setResetUserId(resetUserId === user.id ? null : user.id)}
														className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-medium hover:bg-accent"
													>
														<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
														Reset
													</button>
												</div>
											</div>
											{resetUserId === user.id ? (
												<form
													className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row"
													onSubmit={(event) => {
														event.preventDefault();
														const password = String(
															new FormData(event.currentTarget).get('password') ?? '',
														);
														resetPassword.mutate(
															{ id: user.id, password },
															{
																onSuccess: () => setResetUserId(null),
																onError: (error) => setActionError(error.message),
															},
														);
													}}
												>
													<input
														name="password"
														type="password"
														minLength={8}
														required
														aria-label={`New password for ${user.email}`}
														placeholder="New password"
														className="input-surface h-10 flex-1 rounded-xl px-3 text-sm"
													/>
													<button
														type="submit"
														disabled={resetPassword.isPending}
														className="h-10 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60"
													>
														Reset and revoke sessions
													</button>
												</form>
											) : null}
										</article>
									);
								})}
								{usersQuery.hasNextPage ? (
									<button
										type="button"
										onClick={() => void usersQuery.fetchNextPage()}
										disabled={usersQuery.isFetchingNextPage}
										className="h-10 w-full rounded-2xl border border-border text-sm font-medium hover:bg-accent disabled:opacity-60"
									>
										{usersQuery.isFetchingNextPage ? 'Loading...' : 'Load more accounts'}
									</button>
								) : null}
							</div>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}

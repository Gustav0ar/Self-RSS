export function registerServiceWorker(): void {
	if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
	window.addEventListener(
		'load',
		() => {
			const hadController = Boolean(navigator.serviceWorker.controller);
			void navigator.serviceWorker
				.register('/sw.js', { scope: '/' })
				.then((registration) => {
					let reloading = false;
					navigator.serviceWorker.addEventListener('controllerchange', () => {
						if (!hadController || reloading) return;
						reloading = true;
						window.location.reload();
					});
					const checkForUpdate = () => {
						if (navigator.onLine) void registration.update();
					};
					window.addEventListener('online', checkForUpdate);
					document.addEventListener('visibilitychange', () => {
						if (document.visibilityState === 'visible') checkForUpdate();
					});
				})
				.catch(() => undefined);
		},
		{ once: true },
	);
}

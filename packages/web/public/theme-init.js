(() => {
	let stored = null;
	try {
		stored = localStorage.getItem('rss-theme');
	} catch {
		// Restricted storage contexts fall back to system color scheme.
	}
	const theme = stored === 'dark' || stored === 'amoled' || stored === 'light' ? stored : null;
	if (
		theme === 'dark' ||
		theme === 'amoled' ||
		(!theme && matchMedia('(prefers-color-scheme: dark)').matches)
	) {
		document.documentElement.classList.add('dark');
	}
})();

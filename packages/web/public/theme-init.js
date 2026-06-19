(() => {
	const stored = localStorage.getItem('rss-theme');
	const theme = stored === 'dark' || stored === 'amoled' || stored === 'light' ? stored : null;
	if (
		theme === 'dark' ||
		theme === 'amoled' ||
		(!theme && matchMedia('(prefers-color-scheme: dark)').matches)
	) {
		document.documentElement.classList.add('dark');
	}
})();

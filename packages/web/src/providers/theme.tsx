import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

type Theme = 'light' | 'dark' | 'amoled' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'amoled';

interface ThemeContextValue {
	theme: Theme;
	resolvedTheme: ResolvedTheme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'rss-theme';

function getSystemTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
	return theme === 'system' ? getSystemTheme() : theme;
}

function applyThemeClasses(resolvedTheme: ResolvedTheme) {
	const root = document.documentElement;
	root.classList.toggle('dark', resolvedTheme === 'dark');
	root.classList.toggle('amoled', resolvedTheme === 'amoled');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(() => {
		if (typeof window === 'undefined') return 'system';
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark' || stored === 'amoled' || stored === 'system') {
			return stored;
		}
		return 'system';
	});

	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		localStorage.setItem(STORAGE_KEY, newTheme);
	}, []);

	useEffect(() => {
		const resolved = resolveTheme(theme);
		setResolvedTheme(resolved);
		applyThemeClasses(resolved);
	}, [theme]);

	useEffect(() => {
		if (theme !== 'system') return;

		const mql = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			const resolved = resolveTheme('system');
			setResolvedTheme(resolved);
			applyThemeClasses(resolved);
		};

		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	}, [theme]);

	const value = useMemo(
		() => ({ theme, resolvedTheme, setTheme }),
		[theme, resolvedTheme, setTheme],
	);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
	return ctx;
}

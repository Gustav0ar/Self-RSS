import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

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
}

function readStoredTheme(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStoredTheme(value: Theme) {
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// Restricted storage contexts keep the theme in memory for the current session.
	}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(() => {
		if (typeof window === 'undefined') return 'system';
		const stored = readStoredTheme();
		if (stored === 'amoled') {
			writeStoredTheme('dark');
			return 'dark';
		}
		if (stored === 'light' || stored === 'dark' || stored === 'system') {
			return stored;
		}
		return 'system';
	});

	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		writeStoredTheme(newTheme);
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

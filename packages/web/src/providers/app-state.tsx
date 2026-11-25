import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from 'react';

interface AppStateValue {
	selectedFeedId?: string;
	selectedCategoryId?: string;
	selectedArticleId: string | null;
	syncingFeedId: string | null;
	feedSyncError: string | null;
	setSelectedFeedId: (feedId?: string) => void;
	setSelectedCategoryId: (categoryId?: string) => void;
	setSelectedArticleId: (articleId: string | null) => void;
	setSyncingFeedId: Dispatch<SetStateAction<string | null>>;
	setFeedSyncError: Dispatch<SetStateAction<string | null>>;
	applySelection: (selection: {
		feedId?: string;
		categoryId?: string;
		articleId: string | null;
	}) => void;
	selectAllFeeds: () => void;
	selectFeed: (feedId: string) => void;
	selectCategory: (categoryId: string) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({
	children,
	resetKey,
}: {
	children: ReactNode;
	resetKey?: string;
}) {
	return <AppStateStore key={resetKey ?? 'default'}>{children}</AppStateStore>;
}

function AppStateStore({ children }: { children: ReactNode }) {
	const [selectedFeedId, setSelectedFeedId] = useState<string | undefined>();
	const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();
	const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
	const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
	const [feedSyncError, setFeedSyncError] = useState<string | null>(null);
	const scopeRef = useRef<{ feedId?: string; categoryId?: string }>({});
	scopeRef.current = { feedId: selectedFeedId, categoryId: selectedCategoryId };

	const applySelection = useCallback(
		({
			feedId,
			categoryId,
			articleId,
		}: {
			feedId?: string;
			categoryId?: string;
			articleId: string | null;
		}) => {
			const nextFeedId = feedId;
			const nextCategoryId = feedId ? undefined : categoryId;
			const contextChanged =
				scopeRef.current.feedId !== nextFeedId || scopeRef.current.categoryId !== nextCategoryId;
			scopeRef.current = { feedId: nextFeedId, categoryId: nextCategoryId };

			setSelectedFeedId(nextFeedId);
			setSelectedCategoryId(nextCategoryId);
			setSelectedArticleId(articleId);

			if (contextChanged) {
				setFeedSyncError(null);
				if (!nextFeedId) {
					setSyncingFeedId(null);
				}
			}
		},
		[],
	);

	const selectAllFeeds = useCallback(() => {
		applySelection({ articleId: null });
		setSyncingFeedId(null);
	}, [applySelection]);

	const selectFeed = useCallback(
		(feedId: string) => {
			applySelection({ feedId, articleId: null });
		},
		[applySelection],
	);

	const selectCategory = useCallback(
		(categoryId: string) => {
			applySelection({ categoryId, articleId: null });
			setSyncingFeedId(null);
		},
		[applySelection],
	);

	const value = useMemo<AppStateValue>(
		() => ({
			selectedFeedId,
			selectedCategoryId,
			selectedArticleId,
			syncingFeedId,
			feedSyncError,
			setSelectedFeedId,
			setSelectedCategoryId,
			setSelectedArticleId,
			setSyncingFeedId,
			setFeedSyncError,
			applySelection,
			selectAllFeeds,
			selectFeed,
			selectCategory,
		}),
		[
			applySelection,
			feedSyncError,
			selectAllFeeds,
			selectCategory,
			selectFeed,
			selectedArticleId,
			selectedCategoryId,
			selectedFeedId,
			syncingFeedId,
		],
	);

	return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
	const context = useContext(AppStateContext);
	if (!context) throw new Error('useAppState must be used within AppStateProvider');
	return context;
}

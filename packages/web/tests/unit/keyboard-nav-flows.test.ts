import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardNav } from '../../src/hooks/use-keyboard-nav';

describe('useKeyboardNav', () => {
	function makeContext() {
		const onSelect = vi.fn();
		const onToggleRead = vi.fn();
		const onOpenExternal = vi.fn();
		const onRefresh = vi.fn();
		return { onSelect, onToggleRead, onOpenExternal, onRefresh };
	}

	it('does nothing when the hook is disabled', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1'],
				selectedId: null,
				enabled: false,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
		expect(ctx.onSelect).not.toHaveBeenCalled();
	});

	it('moves the selection down with j and up with k', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2', 'a-3'],
				selectedId: 'a-1',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));

		expect(ctx.onSelect).toHaveBeenNthCalledWith(1, 'a-2');
		expect(ctx.onSelect).toHaveBeenNthCalledWith(2, 'a-1');
	});

	it('continues from the last known selection slot after reader media takes focus and the item leaves the list', () => {
		const ctx = makeContext();
		const { rerender } = renderHook(
			({ articleIds, selectedId }: { articleIds: string[]; selectedId: string | null }) =>
				useKeyboardNav({
					articleIds,
					selectedId,
					enabled: true,
					...ctx,
				}),
			{
				initialProps: {
					articleIds: ['a-1', 'a-2', 'a-3', 'a-4'],
					selectedId: 'a-3',
				},
			},
		);
		rerender({ articleIds: ['a-1', 'a-2', 'a-4'], selectedId: 'a-3' });

		const video = document.createElement('video');
		document.body.appendChild(video);
		video.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
		video.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		document.body.removeChild(video);

		expect(ctx.onSelect).toHaveBeenNthCalledWith(1, 'a-4');
		expect(ctx.onSelect).toHaveBeenNthCalledWith(2, 'a-2');
	});

	it('uses the latest active article when reader media receives a key handled by an older listener', () => {
		const ctx = makeContext();
		const keyHandlers: EventListener[] = [];
		const addEventListenerSpy = vi
			.spyOn(window, 'addEventListener')
			.mockImplementation((type, listener) => {
				if (type === 'keydown') {
					keyHandlers.push(listener as EventListener);
				}
			});

		const { rerender, unmount } = renderHook(
			({ selectedId }: { selectedId: string | null }) =>
				useKeyboardNav({
					articleIds: ['a-1', 'a-2', 'a-3'],
					selectedId,
					enabled: true,
					...ctx,
				}),
			{
				initialProps: { selectedId: null as string | null },
			},
		);

		const initialKeyHandler = keyHandlers[0];
		expect(initialKeyHandler).toBeTruthy();

		rerender({ selectedId: 'a-2' });

		const video = document.createElement('video');
		const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true });
		Object.defineProperty(event, 'target', { value: video });
		initialKeyHandler?.(event);

		expect(ctx.onSelect).toHaveBeenCalledWith('a-3');

		unmount();
		addEventListenerSpy.mockRestore();
	});

	it('stays on a missing boundary article instead of jumping to the wrong neighbor', () => {
		const ctx = makeContext();
		const { rerender } = renderHook(
			({ articleIds, selectedId }: { articleIds: string[]; selectedId: string | null }) =>
				useKeyboardNav({
					articleIds,
					selectedId,
					enabled: true,
					...ctx,
				}),
			{
				initialProps: {
					articleIds: ['a-1', 'a-2', 'a-3'],
					selectedId: 'a-1',
				},
			},
		);

		rerender({ articleIds: ['a-2', 'a-3'], selectedId: 'a-1' });
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
		expect(ctx.onSelect).toHaveBeenLastCalledWith('a-1');

		rerender({ articleIds: ['a-1', 'a-2', 'a-3'], selectedId: 'a-3' });
		rerender({ articleIds: ['a-1', 'a-2'], selectedId: 'a-3' });
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
		expect(ctx.onSelect).toHaveBeenLastCalledWith('a-3');
	});

	it('skips the handler when the user is typing in an input', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2'],
				selectedId: null,
				enabled: true,
				...ctx,
			}),
		);

		const input = document.createElement('input');
		document.body.appendChild(input);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
		document.body.removeChild(input);

		expect(ctx.onSelect).not.toHaveBeenCalled();
	});

	it('toggles the read state for the current article with m', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2'],
				selectedId: 'a-2',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
		expect(ctx.onToggleRead).toHaveBeenCalledWith('a-2');
	});

	it('opens the article in a new tab with v', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2'],
				selectedId: 'a-1',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
		expect(ctx.onOpenExternal).toHaveBeenCalledWith('a-1');
	});

	it('triggers the refresh action with r', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1'],
				selectedId: 'a-1',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
		expect(ctx.onRefresh).toHaveBeenCalled();
	});

	it('clamps to the last article when j is pressed at the end of the list', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2'],
				selectedId: 'a-2',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
		expect(ctx.onSelect).toHaveBeenCalledWith('a-2');
	});

	it('clamps to the first article when k is pressed at the start of the list', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2'],
				selectedId: 'a-1',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
		expect(ctx.onSelect).toHaveBeenCalledWith('a-1');
	});

	it('treats ArrowUp / ArrowDown as aliases for k / j', () => {
		const ctx = makeContext();
		renderHook(() =>
			useKeyboardNav({
				articleIds: ['a-1', 'a-2'],
				selectedId: 'a-1',
				enabled: true,
				...ctx,
			}),
		);

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(ctx.onSelect).toHaveBeenLastCalledWith('a-2');

		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(ctx.onSelect).toHaveBeenLastCalledWith('a-1');
	});
});

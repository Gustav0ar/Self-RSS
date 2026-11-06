/** Use an explicitly linked original image instead of enlarging its feed thumbnail. */
export function promoteLinkedArticleImage(image: Element): void {
	const href = image.closest('a[href]')?.getAttribute('href')?.trim();
	// A picture's sources control image selection, so preserve its responsive variants.
	if (!href || image.closest('picture')) return;

	try {
		const url = new URL(href, 'https://placeholder.invalid');
		if (!['http:', 'https:'].includes(url.protocol)) return;
		if (!/\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?)$/i.test(url.pathname)) return;
	} catch {
		return;
	}

	if (href === image.getAttribute('src')) return;
	image.setAttribute('src', href);
	// Thumbnail candidates and dimensions no longer describe the selected image.
	for (const attribute of ['srcset', 'sizes', 'width', 'height']) {
		image.removeAttribute(attribute);
	}
}

export function baseCategorySlug(name: string): string {
	const slug = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (slug) {
		return slug;
	}

	return `cat-${stableHash(name).toString(36).slice(0, 6)}`;
}

export function uniqueCategorySlug(name: string, usedSlugs: ReadonlySet<string>): string {
	const baseSlug = baseCategorySlug(name);
	if (!usedSlugs.has(baseSlug)) {
		return baseSlug;
	}

	let counter = 2;
	let candidate = `${baseSlug}-${counter}`;
	while (usedSlugs.has(candidate)) {
		counter += 1;
		candidate = `${baseSlug}-${counter}`;
	}
	return candidate;
}

function stableHash(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}
	return hash;
}

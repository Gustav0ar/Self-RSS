const [, , reportPath = 'audit-results.json', threshold = 'high'] = Bun.argv;

const severityRank = new Map([
	['low', 0],
	['moderate', 1],
	['high', 2],
	['critical', 3],
]);

const minimumRank = severityRank.get(threshold);
if (minimumRank === undefined) {
	throw new Error(`Unknown audit threshold: ${threshold}`);
}

const reportText = await Bun.file(reportPath)
	.text()
	.catch(() => '');
if (reportText.trim().length === 0) {
	console.log('No Bun audit advisories found.');
	process.exit(0);
}

const report = JSON.parse(reportText) as Record<
	string,
	Array<{ id: number; title: string; severity: string; url?: string }>
>;
const blockingFindings = Object.entries(report).flatMap(([packageName, findings]) =>
	findings
		.filter((finding) => (severityRank.get(finding.severity) ?? -1) >= minimumRank)
		.map((finding) => ({
			packageName,
			...finding,
		})),
);

if (blockingFindings.length === 0) {
	console.log(`No Bun audit advisories at or above '${threshold}'.`);
	process.exit(0);
}

for (const finding of blockingFindings) {
	console.error(
		`${finding.packageName}: ${finding.severity} ${finding.id} ${finding.title} ${finding.url ?? ''}`,
	);
}
process.exit(1);

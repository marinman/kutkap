/** Outline whose proportions match a width:height ratio, as in CapCut's ratio menu. */
export function AspectRatioShape({ ratio }: { ratio: number }) {
	const maxSize = 16;
	const width = ratio >= 1 ? maxSize : ratio * maxSize;
	const height = ratio >= 1 ? maxSize / ratio : maxSize;

	return (
		<div
			style={{ width, height, borderWidth: 1.5 }}
			className="shrink-0 rounded-xs border-current opacity-60"
		/>
	);
}

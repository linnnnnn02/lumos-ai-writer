const numericClaimPattern =
  /(?:\d+(?:\.\d+)?(?:%|％|分钟|小时|天|周|月|年|公里|千米|米|元|倍|成|次)?|[零〇一二两三四五六七八九十百千万亿]+(?:%|％|分钟|小时|天|周|月|年|公里|千米|米|元|倍|成|次))/g

export function findUnsupportedNumericClaims(
  candidate: string,
  groundingSource: string,
) {
  const groundedClaims = new Set(groundingSource.match(numericClaimPattern) ?? [])
  return Array.from(new Set(candidate.match(numericClaimPattern) ?? []))
    .filter((claim) => !groundedClaims.has(claim))
}

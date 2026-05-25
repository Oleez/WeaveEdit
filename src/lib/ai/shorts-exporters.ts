import type { ShortExtractionResult } from "./types";

const CSV_COLUMNS = [
  "id",
  "title",
  "hook",
  "platform",
  "goal",
  "startSec",
  "endSec",
  "durationSec",
  "hookScore",
  "retentionScore",
  "completenessScore",
  "controversyScore",
  "clarityScore",
  "ctaOpportunity",
  "warnings",
  "transcriptExcerpt",
  "hashtags",
];

export function serializeShortsToJson(result: ShortExtractionResult): string {
  return JSON.stringify(result, null, 2);
}

export function serializeShortsToCsv(result: ShortExtractionResult): string {
  const rows = result.candidates.map((candidate) => [
    candidate.id,
    candidate.titleSuggestion,
    candidate.hookLine,
    candidate.platformFit,
    candidate.clipGoal,
    formatNumber(candidate.startSec),
    formatNumber(candidate.endSec),
    formatNumber(candidate.durationSec),
    formatNumber(candidate.scores.hook),
    formatNumber(candidate.scores.retention),
    formatNumber(candidate.scores.completeness),
    formatNumber(candidate.scores.controversy),
    formatNumber(candidate.scores.clarity),
    candidate.hasCtaOpportunity ? "yes" : "no",
    candidate.warnings.join(";"),
    candidate.transcriptExcerpt,
    candidate.suggestedHashtags.join(" "),
  ]);

  return [CSV_COLUMNS, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function escapeCsvCell(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? (Math.round(value * 100) / 100).toString() : "0";
}

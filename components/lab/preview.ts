import type { LabRecord } from "./model";

// Card previews omit an imported context heading; the stored details remain intact.
export function withoutContextHeading(value?: string) {
  return (value || "").replace(/^\s*(?:#{1,6}\s*)?(?:\*{1,2})?Research context\s*[—–-][^\r\n]*(?:\r?\n|$)\s*/i, "").trim();
}
export function projectSummary(record: LabRecord) {
  return withoutContextHeading(record.data.details) || withoutContextHeading(record.data.notes).replace(/[#*_`$]/g, "").replace(/\s+/g, " ").slice(0, 180);
}
export function updatePreview(record: LabRecord) {
  const title = record.data.title || "";
  return /^Source update\s*:/i.test(title.trim())
    ? withoutContextHeading(record.data.summary).replace(/\s+/g, " ") || title
    : title;
}


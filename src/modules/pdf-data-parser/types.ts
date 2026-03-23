import type { DeviceRecord } from "../../types";

export type PdfDataTemplate = "simple-table" | "rich-table" | "unknown";

export interface PdfDataParseResult {
  template: PdfDataTemplate;
  records: DeviceRecord[];
  dataPages: number;
  rawRows: number;
}

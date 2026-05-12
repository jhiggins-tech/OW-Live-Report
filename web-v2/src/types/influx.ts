export interface InfluxSeries {
  name?: string;
  tags?: Record<string, string>;
  columns: string[];
  values: Array<Array<number | string | null>>;
}

export interface InfluxStatementResult {
  statement_id?: number;
  series?: InfluxSeries[];
  error?: string;
}

export interface InfluxResponse {
  results: InfluxStatementResult[];
  error?: string;
}

export interface ParsedSeries<TRow = Record<string, number | string | null>> {
  name: string;
  tags: Record<string, string>;
  rows: TRow[];
}

export type PipelineStage =
  | "load_bot"
  | "resolve_browser_profile"
  | "crawl"
  | "extract"
  | "analyze"
  | "store"
  | "complete"
  | "failed";

export interface PipelineStageResult {
  stage: PipelineStage;
  status: "started" | "success" | "failed";
  message?: string;
  createdAt: string;
}

export interface PipelineRun {
  id: string;
  botId: number;
  stages: PipelineStageResult[];
  startedAt: string;
  completedAt: string | null;
}

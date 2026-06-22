import type { PipelineRun, PipelineStage } from "./pipelineTypes";

export function createPipelineRun(botId: number): PipelineRun {
  return {
    id: `job_${Date.now()}_${botId}`,
    botId,
    stages: [],
    startedAt: new Date().toISOString(),
    completedAt: null
  };
}

export function recordStage(
  run: PipelineRun,
  stage: PipelineStage,
  status: "started" | "success" | "failed",
  message?: string
): void {
  run.stages.push({
    stage,
    status,
    message,
    createdAt: new Date().toISOString()
  });
}

export function completePipelineRun(run: PipelineRun): PipelineRun {
  run.completedAt = new Date().toISOString();
  return run;
}

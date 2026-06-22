import { completePipelineRun, createPipelineRun, recordStage } from "../pipeline/jobOrchestrator";
import type { PipelineRun, PipelineStage } from "../pipeline/pipelineTypes";

/*
 * Source repo: https://github.com/harry0703/MoneyPrinterTurbo
 * Reuse reason: MoneyPrinterTurbo organizes generation as explicit task stages with
 * status updates and saved outputs. Its implementation is Python/video-specific, so we
 * reuse the pattern through this adapter around our crawler pipeline instead of copying
 * unrelated video-generation services.
 */

export interface PipelineTaskStep<TContext> {
  stage: PipelineStage;
  run: (context: TContext) => Promise<TContext> | TContext;
}

export async function runPipelineTask<TContext>(
  botId: number,
  initialContext: TContext,
  steps: Array<PipelineTaskStep<TContext>>
): Promise<{ context: TContext; job: PipelineRun }> {
  const job = createPipelineRun(botId);
  let context = initialContext;

  try {
    for (const step of steps) {
      recordStage(job, step.stage, "started");
      context = await step.run(context);
      recordStage(job, step.stage, "success");
    }

    recordStage(job, "complete", "success");
    return { context, job: completePipelineRun(job) };
  } catch (error) {
    recordStage(job, "failed", "failed", error instanceof Error ? error.message : "Unknown pipeline error");
    completePipelineRun(job);
    throw error;
  }
}

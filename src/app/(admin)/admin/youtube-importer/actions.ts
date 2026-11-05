"use server";

import { assignSelectedCandidates, cancelImportJob, deleteImportJob, getJobSummary, listCandidates, pauseImportJob, resumeImportJob, runDiscoveryStep, runImportStep, setCandidatesSelected, startChannelImport, startChannelSync } from "@/features/youtube/import/import.service";
import { runAction } from "@/lib/http/action";

export async function startChannelImportAction(input: unknown) {
  return runAction("startChannelImport", (actor) => startChannelImport(actor, input));
}

export async function startChannelSyncAction(channelId: string) {
  return runAction("startChannelSync", (actor) => startChannelSync(actor, channelId));
}

export async function runDiscoveryStepAction(jobId: string) {
  return runAction("runDiscoveryStep", (actor) => runDiscoveryStep(actor, jobId));
}

export async function runImportStepAction(jobId: string) {
  return runAction("runImportStep", (actor) => runImportStep(actor, jobId));
}

export async function cancelImportJobAction(jobId: string) {
  return runAction("cancelImportJob", async (actor) => {
    await cancelImportJob(actor, jobId);
    return undefined;
  });
}

export async function pauseImportJobAction(jobId: string) {
  return runAction("pauseImportJob", async (actor) => {
    await pauseImportJob(actor, jobId);
    return undefined;
  });
}

export async function resumeImportJobAction(jobId: string) {
  return runAction("resumeImportJob", (actor) => resumeImportJob(actor, jobId));
}

export async function deleteImportJobAction(jobId: string) {
  return runAction("deleteImportJob", async (actor) => {
    await deleteImportJob(actor, jobId);
    return undefined;
  });
}

export async function getJobSummaryAction(jobId: string) {
  return runAction("getJobSummary", (actor) => getJobSummary(actor, jobId));
}

export async function listCandidatesAction(input: unknown) {
  return runAction("listCandidates", (actor) => listCandidates(actor, input));
}

export async function setCandidatesSelectedAction(input: unknown) {
  return runAction("setCandidatesSelected", (actor) => setCandidatesSelected(actor, input));
}

export async function assignSelectedCandidatesAction(input: unknown) {
  return runAction("assignSelectedCandidates", (actor) => assignSelectedCandidates(actor, input));
}

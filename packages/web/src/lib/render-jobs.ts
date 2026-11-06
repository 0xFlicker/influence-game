export type RenderJobRow={id:string;executionId:string;gameId:string;workload:"trailer"|"studio-export";state:string;progress:number;attempt:number;
  rendererDigest:string;failure:string|null;createdAt:string;updatedAt:string;output:{sha256:string|null;byteLength:number|null}|null;
  game:{id:string;slug:string;kind:"influence"|"werewolf";title:string|null};requester:string};
export type RenderMonitorPage={jobs:RenderJobRow[];summary:{total:number;matching:number;active:number;failed:number;succeeded:number};nextCursor:string|null};
export const renderStateLabels:Record<string,string>={uploading_inputs:"Waiting for uploads",queued:"Queued",rendering:"Rendering",uploading:"Uploading",verifying:"Verifying",succeeded:"Completed",failed:"Failed",cancelled:"Cancelled"};
export const renderFailureLabels:Record<string,string>={renderer_unavailable:"The renderer changed after this job was queued. Order a new export with the current renderer.",worker_failed:"The render worker failed. Retry the frozen cut or inspect its worker logs.",worker_lease_expired:"The worker stopped reporting progress. Its output was not accepted.",
  submission_unresolved:"Confirming cloud submission. The same request will be reconciled automatically.",output_integrity:"The output did not pass verification. No download was accepted.",worker_exited_before_claim:"The worker exited before starting this render."};

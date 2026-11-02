import {expect,test} from "bun:test";
import {renderWorkerError} from "./worker-error";
test("render diagnostics preserve the failed path while removing task and signed URL credentials",()=> {
  const result=renderWorkerError(new Error("Fetch https://bucket.invalid/video.mp4?X-Amz-Credential=private&X-Amz-Signature=secret failed; token=task-secret Bearer foreign-token"),["task-secret"]);
  expect(result.message).toContain("https://bucket.invalid/video.mp4");
  for(const secret of ["X-Amz-","private","secret","foreign-token"])expect(result.message).not.toContain(secret);
  expect(result.message).toContain("[redacted]");
});

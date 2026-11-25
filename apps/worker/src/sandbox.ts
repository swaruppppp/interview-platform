import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  runtimeMs: number;
}

export function runContainer(
  image: string,
  hostDir: string,
  cmd: string[],
  stdinData: string,
  timeoutMs: number,
  readOnlyMount = true
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const mountMode = readOnlyMount ? "ro" : "rw";

    const dockerArgs = [
      "run",
      "-i",
      "--rm",
      "--network=none",
      "--memory=256m",
      "--memory-swap=256m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--read-only",
      "--tmpfs", "/tmp:rw,exec,nosuid,size=64m",
      "-v", `${hostDir}:/sandbox:${mountMode}`,
      "-w", "/sandbox",
      image,
      ...cmd,
    ];

    const child = spawn("docker", dockerArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const MAX_BYTES = 256 * 1024;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_BYTES) stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_BYTES) stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
        timedOut,
        runtimeMs: Date.now() - start,
      });
    });

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

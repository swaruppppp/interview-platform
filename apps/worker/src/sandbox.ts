import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  runtimeMs: number;
}

const PISTON_URL = process.env.PISTON_URL ?? "https://emkc.org/api/v2/piston/execute";

const PISTON_RUNTIME: Record<string, { language: string; version: string; file: string }> = {
  "sandbox-cpp": { language: "c++", version: "10.2.0", file: "solution.cpp" },
  "sandbox-py": { language: "python", version: "3.10.0", file: "solution.py" },
  "sandbox-js": { language: "javascript", version: "18.15.0", file: "solution.js" },
};

export async function runContainer(
  image: string,
  hostDir: string,
  cmd: string[],
  stdinData: string,
  timeoutMs: number,
  readOnlyMount = true,
  sourceCode?: string
): Promise<ExecResult> {
  if (process.env.SANDBOX_MODE !== "docker" && sourceCode) {
    const start = Date.now();
    const rt = PISTON_RUNTIME[image] ?? PISTON_RUNTIME["sandbox-js"];
    const res = await fetch(PISTON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: rt.language,
        version: rt.version,
        files: [{ name: rt.file, content: sourceCode }],
        stdin: stdinData,
        run_timeout: timeoutMs,
      }),
    });
    const data = (await res.json()) as any;
    const compile = data.compile;
    if (compile && compile.code !== 0) {
      return {
        stdout: "",
        stderr: compile.stderr || compile.output || "Compilation failed",
        exitCode: compile.code ?? 1,
        timedOut: false,
        runtimeMs: Date.now() - start,
      };
    }
    const run = data.run ?? {};
    return {
      stdout: (run.stdout ?? "").trim(),
      stderr: (run.stderr ?? "").trim(),
      exitCode: run.code ?? 0,
      timedOut: run.signal === "SIGKILL",
      runtimeMs: Date.now() - start,
    };
  }

  return new Promise((resolve) => {
    const start = Date.now();
    const mountMode = readOnlyMount ? "ro" : "rw";
    const dockerArgs = [
      "run", "-i", "--rm", "--network=none", "--memory=256m", "--memory-swap=256m",
      "--cpus=0.5", "--pids-limit=64", "--read-only",
      "--tmpfs", "/tmp:rw,exec,nosuid,size=64m",
      "-v", `${hostDir}:/sandbox:${mountMode}`, "-w", "/sandbox",
      image, ...cmd,
    ];
    const child = spawn("docker", dockerArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1, timedOut, runtimeMs: Date.now() - start });
    });
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

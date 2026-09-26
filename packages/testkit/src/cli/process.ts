import { spawn } from "node:child_process";

export function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    // Windows resolves pnpm/npx to .cmd shims, which Node only spawns through a shell.
    // ponytail: args are joined unquoted there, so keep Windows callers' args free of spaces.
    const shell = process.platform === "win32";
    const child = spawn(command, args, { stdio: "inherit", env, shell });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

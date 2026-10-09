import { spawn } from "node:child_process";

const children = ["@kultroom/api", "@kultroom/web"].map((workspace) =>
  spawn("npm", ["run", "dev", "-w", workspace], { stdio: "inherit", shell: false }),
);

function shutdown(signal) {
  for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await Promise.race(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
shutdown("SIGTERM");

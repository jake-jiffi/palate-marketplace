/**
 * still-page-server.mjs - serve a page where nothing moves, and ask palate-pick to prove it does.
 *
 * docs-truth claims the motion proof MEASURES the page rather than taking the agent's word for
 * it. That claim is about what a command does, so the suite runs it: a grep would go on passing
 * after the measurement was deleted. Exits 0 only if palate-pick refused; its stderr is printed
 * so the caller can check the refusal names the fault.
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const [, , cli, projectDir] = process.argv;
const HTML = `<!doctype html><meta charset="utf-8"><title>Still</title>
<style>body{margin:0}header{height:120px;background:#222}section{min-height:1400px}</style>
<header>Header</header><section><p>Nothing here moves.</p></section><section><p>Nor here.</p></section>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});
server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  execFile(process.execPath, [cli, projectDir, "--proof", url], { encoding: "utf8" }, (err, stdout, stderr) => {
    server.close();
    process.stdout.write(stdout || "");
    process.stderr.write(stderr || "");
    process.exitCode = err ? (err.code ?? 1) : 0;
  });
});

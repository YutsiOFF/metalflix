// Publishes the built site to GitHub Pages.
//
// GitHub Pages serves the `gh-pages` branch of YutsiOFF/metalflix: this builds
// the app and force-pushes only the build output (dist/), never the sources.
//
// Usage: npm run deploy
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REMOTE = "https://github.com/YutsiOFF/metalflix.git";
const SITE = "https://yutsioff.github.io/metalflix/";

execFileSync("npm", ["run", "build"], { stdio: "inherit", shell: true });

const work = mkdtempSync(join(tmpdir(), "metalflix-pages-"));
cpSync("dist", work, { recursive: true });
writeFileSync(join(work, ".nojekyll"), "");

const git = (...args) =>
  execFileSync("git", ["-c", "user.name=metalflix", "-c", "user.email=metalflix@users.noreply.github.com", ...args], {
    cwd: work,
    stdio: "inherit",
  });

git("init", "-b", "gh-pages");
git("add", "-A");
git("commit", "-m", "deploy: build du site");
git("remote", "add", "origin", REMOTE);
git("push", "--force", "origin", "gh-pages");

rmSync(work, { recursive: true, force: true });
console.log(`\nPublié : ${SITE}`);

/* Risk scoring and release policy. Pure functions — easy to test and audit.
   The rules mirror the OPA bundle documented in policies/aegis.patch.release.rego */

export type DiffStats = {
  files: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export function parseUnifiedDiff(diff: string): DiffStats {
  const files = new Set<string>();
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ /dev/null")) {
      const p = line.slice(4).trim().replace(/^b\//, "");
      if (p !== "/dev/null") files.add(p);
    } else if (line.startsWith("--- a/") || line.startsWith("--- /dev/null")) {
      const p = line.slice(4).trim().replace(/^a\//, "");
      if (p !== "/dev/null") files.add(p);
    } else if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { files: [...files], filesChanged: files.size, insertions, deletions };
}

const SENSITIVE = /(^|\/)(auth|security|secrets?|crypto|keys?|permissions?|migrations?)(\/|\.|_)|\.github\/workflows\/|(^|\/)\.env|Dockerfile$/i;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|requirements[\w-]*\.txt|go\.mod|Cargo\.toml)$/;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|uv\.lock|go\.sum|Cargo\.lock)$/;
const TEST_FILE = /(\.test\.|\.spec\.|_test\.go$|(^|\/)tests?\/|test_[\w]+\.py$)/;

export type RiskInput = {
  diff: DiffStats;
  localised: string[];
  rawDiff?: string;
};

export type RiskReport = {
  score: number;
  factors: { name: string; weight: number; detail: string }[];
  filesOutsideLocalised: string[];
  touchesSensitive: string[];
  touchesManifest: boolean;
  deletesTests: boolean;
  introducesEgress: boolean;
};

export function scoreRisk({ diff, localised, rawDiff = "" }: RiskInput): RiskReport {
  const factors: RiskReport["factors"] = [];
  const loc = new Set(localised);
  const filesOutsideLocalised = diff.files.filter(
    (f) => !loc.has(f) && ![...loc].some((l) => l.endsWith(f) || f.endsWith(l)) && !TEST_FILE.test(f),
  );
  const touchesSensitive = diff.files.filter((f) => SENSITIVE.test(f));
  const touchesManifest = diff.files.some((f) => MANIFEST.test(f) || LOCKFILE.test(f));
  const deletedTestLines = rawDiff
    .split("\n")
    .filter((l) => /^-\s*(it|test|def test_|func Test|#\[test\])/.test(l)).length;
  const deletesTests = deletedTestLines > 0;
  const introducesEgress = /^\+.*\b(fetch\(|axios\.|requests\.(get|post)|http\.Get|reqwest::|curl |wget )/m.test(rawDiff);

  const add = (name: string, weight: number, detail: string) => {
    if (weight > 0) factors.push({ name, weight: Math.round(weight * 100) / 100, detail });
  };
  add("size", Math.min(0.2, (diff.insertions + diff.deletions) / 400), `${diff.insertions}+ / ${diff.deletions}−`);
  add("spread", Math.min(0.15, Math.max(0, diff.filesChanged - 1) * 0.04), `${diff.filesChanged} files`);
  add("outside_localised", Math.min(0.3, filesOutsideLocalised.length * 0.12), filesOutsideLocalised.join(", ") || "—");
  add("deletion_ratio", diff.deletions > diff.insertions * 2 && diff.deletions > 10 ? 0.1 : 0, "deletes far more than it adds");
  add("manifest", touchesManifest ? 0.15 : 0, "dependency manifest or lockfile changed");
  add("sensitive", touchesSensitive.length ? 0.4 : 0, touchesSensitive.join(", "));
  add("deletes_tests", deletesTests ? 0.35 : 0, `${deletedTestLines} test declarations removed`);
  add("egress", introducesEgress ? 0.3 : 0, "adds a network call");

  const score = Math.min(1, factors.reduce((a, f) => a + f.weight, 0.02));
  return {
    score: Math.round(score * 100) / 100,
    factors,
    filesOutsideLocalised,
    touchesSensitive,
    touchesManifest,
    deletesTests,
    introducesEgress,
  };
}

export const RISK_CEILING = Number(process.env.FORGE_RISK_CEILING ?? "0.35");

export type PolicyDecision = {
  policy: string;
  allow: boolean;
  deny: string[];
  evaluated: { rule: string; pass: boolean }[];
};

export function evaluatePolicy(input: {
  risk: RiskReport;
  provenRed: boolean;
  provenGreen: boolean;
  reproduced: boolean;
}): PolicyDecision {
  const rules: { rule: string; pass: boolean; deny?: string }[] = [
    { rule: "failure_reproduced", pass: input.reproduced, deny: "failure was not reproduced on the parent commit" },
    { rule: "regression_test_proven_red", pass: input.provenRed, deny: "regression test did not fail before the patch" },
    { rule: "regression_test_proven_green", pass: input.provenGreen, deny: "regression test did not pass after the patch" },
    { rule: "risk_below_ceiling", pass: input.risk.score < RISK_CEILING, deny: `risk ${input.risk.score} ≥ ceiling ${RISK_CEILING}` },
    { rule: "no_sensitive_paths", pass: input.risk.touchesSensitive.length === 0, deny: "sensitive paths require human review" },
    { rule: "no_test_deletion", pass: !input.risk.deletesTests, deny: "patch deletes existing tests" },
    { rule: "no_network_egress", pass: !input.risk.introducesEgress, deny: "patch introduces network egress" },
  ];
  const deny = rules.filter((r) => !r.pass).map((r) => r.deny!);
  return {
    policy: "aegis.patch.release/v4",
    allow: deny.length === 0,
    deny,
    evaluated: rules.map(({ rule, pass }) => ({ rule, pass })),
  };
}

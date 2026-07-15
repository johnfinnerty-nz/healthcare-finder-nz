import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { evaluateEvidenceClaim } from "./lib/provider-validation-policy.mjs";

export function evaluateProviderValidationFixture(options = {}) {
  const fixturePath = options.fixture || "tests/fixtures/provider-validation/claim-eval-v1.json";
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const results = fixture.cases.map((testCase) => {
    const capturedAt = testCase.claim.capturedAt || fixture.capturedAt;
    const claim = {
      sourceUrl: "https://example-provider.nz/team",
      sourceType: "provider_owned",
      confidence: "high",
      exactExcerpt: true,
      subjectMatched: true,
      subjectType: "provider",
      subjectName: testCase.provider.name,
      capturedAt,
      expiresAt: "2099-01-01T00:00:00.000Z",
      verification: {
        decision: "supported",
        confidence: "high",
        excerptMatched: true
      },
      ...testCase.claim
    };
    const policy = evaluateEvidenceClaim(claim, {
      provider: testCase.provider,
      allClaims: [claim, ...(testCase.corroboratingClaims || [])],
      now: new Date(fixture.evaluatedAt),
      requireModelVerification: true,
      pageApplicationCount: testCase.pageApplicationCount || 1
    });
    return {
      id: testCase.id,
      expected: testCase.expectedAccepted,
      actual: policy.accepted,
      reasons: policy.reasons,
      highRisk: Boolean(testCase.highRisk)
    };
  });

  const truePositives = results.filter((item) => item.expected && item.actual).length;
  const falsePositives = results.filter((item) => !item.expected && item.actual).length;
  const falseNegatives = results.filter((item) => item.expected && !item.actual).length;
  const trueNegatives = results.filter((item) => !item.expected && !item.actual).length;
  const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1;
  const recall = truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : 1;
  const highRiskFalsePositives = results.filter((item) => item.highRisk && !item.expected && item.actual).length;
  return {
    version: fixture.version,
    fixturePath,
    cases: results.length,
    truePositives,
    trueNegatives,
    falsePositives,
    falseNegatives,
    highRiskFalsePositives,
    precision,
    recall,
    passed: precision >= 0.995 && highRiskFalsePositives === 0,
    failures: results.filter((item) => item.expected !== item.actual)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluateProviderValidationFixture({ fixture: process.argv[2] });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}


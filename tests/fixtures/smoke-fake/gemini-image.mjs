console.log(JSON.stringify({
  status: "error", error_kind: "quota_exhausted",
  reason: "429 RESOURCE_EXHAUSTED\n(agy conversation 00000000-0000-0000-0000-000000000001)",
}));
process.exitCode = 1;

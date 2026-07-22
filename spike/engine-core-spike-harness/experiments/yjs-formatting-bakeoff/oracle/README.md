# Formatting bake-off reviewed inputs

This directory is the complete reviewed-input boundary for OpenSpec task 2.4.
It contains no candidate implementation, execution harness, observed result, or
selected winner. Implementation output must never be copied into these files or
used to revise an expected semantic value.

`contract.v2.json` freezes the closed event/operation language, candidate API,
canonical `FormattingEvidence`, canonical JSON, origins, diagnostics, quotas,
exact metric aggregation, winner rule, and security rules.
`fixtures.v2.json` freezes the initial package, derivable exact canonical states,
event programs, checkpoints, update identities and delivery permutations,
history journals, repair/retention records, semantic provenance, and rejection
probes. `generator.v2.json` freezes unsigned xorshift32 over immutable genesis
ranges, formatting-only operations, causal disable fallback, replica shadows,
atomic missing-target rejection, dependency retry, duplicate idempotence, exact
event expansion, terminal convergence, candidate derivation checks, and
independent hashes per seed.
`representation-contracts.v2.json` separately freezes Candidate A/B normalized
ID derivations and storage evidence; those values never enter the common
semantic fingerprint or cross-candidate eligibility. `manifest.v2.json` closes
the artifact set and binds the four reviewed JSON inputs
with independently computed SHA-256 hashes.

Event templates containing `${name}` expand from their fixture's reviewed matrix;
templates without placeholders are shared prerequisites. Null operation fields
are omitted after typed substitution. No expected field names either candidate's
storage root or mutation mechanism. Candidate-specific bytes, traces,
measurements, pass/fail records, and winner belong only in a future result
artifact produced after both exact candidates run against this immutable bundle.

Review rules:

- Change any reviewed input only before candidate implementation, then recompute
  every manifest hash and obtain review again.
- Execute events exactly in program order at their declared revision, origin,
  session, group, checkpoint, and state-vector relation.
- Concurrent fixtures start replicas A/B/C from the same declared snapshot.
  Only the listed encoded-update delivery permutations are valid.
- A rejected operation leaves every state surface named by
  `atomicNoWriteSurfaces` byte-for-byte unchanged.
- Task 2.4 remains unchecked until both candidates have run, one passes every
  mandatory gate, and independent full verification is green.

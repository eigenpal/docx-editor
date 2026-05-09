#!/usr/bin/env bash
# Hermetic tests for .github/cla/cla.sh — no network, no git, no gh calls.
# Run locally:  bash .github/cla/cla.test.sh
# Run in CI:    same command, wired into .github/workflows/ci.yml.

set -uo pipefail
cd "$(dirname "$0")/../.."

# shellcheck source=cla.sh
source .github/cla/cla.sh

PASS=0
FAIL=0
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  \xe2\x9c\x93 %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  \xe2\x9c\x97 %s\n      expected: %q\n      got:      %q\n' "$name" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_true() {
  local name="$1"; shift
  if "$@"; then
    printf '  \xe2\x9c\x93 %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  \xe2\x9c\x97 %s (command returned non-zero)\n' "$name"
    FAIL=$((FAIL + 1))
  fi
}

assert_false() {
  local name="$1"; shift
  if ! "$@"; then
    printf '  \xe2\x9c\x93 %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  \xe2\x9c\x97 %s (command returned zero)\n' "$name"
    FAIL=$((FAIL + 1))
  fi
}

ALLOW='dependabot[bot] github-actions[bot] renovate[bot] jedrazb'

echo "cla_allowlisted:"
assert_true  "bracketed bot name matches literally"      cla_allowlisted "dependabot[bot]" "$ALLOW"
assert_true  "plain user matches"                        cla_allowlisted "jedrazb" "$ALLOW"
assert_false "stranger does not match"                   cla_allowlisted "stranger" "$ALLOW"
assert_false "username prefix is not a partial match"    cla_allowlisted "depend" "$ALLOW"
assert_false "username substring is not a partial match" cla_allowlisted "abot" "$ALLOW"

echo
echo "cla_signed:"
SIGS="$TMPDIR/sigs.json"
echo '{"signedContributors":[{"name":"alice","id":111,"signed_at":"2026-05-09T10:00:00Z","pull_request_no":1}]}' > "$SIGS"
assert_true  "alice (id 111) is recognized" cla_signed 111 "$SIGS"
assert_false "id 222 not recognized"        cla_signed 222 "$SIGS"

echo
echo "cla_add_signature:"
echo '{"signedContributors":[]}' > "$SIGS"
cla_add_signature "bob" 222 "2026-05-09T10:00:00Z" 5 "$SIGS"
assert_eq "first add records bob" \
  '[{"name":"bob","id":222,"signed_at":"2026-05-09T10:00:00Z","pull_request_no":5}]' \
  "$(jq -c .signedContributors "$SIGS")"

cla_add_signature "carol" 333 "2026-05-09T10:01:00Z" 6 "$SIGS"
assert_eq "second add appends carol" \
  '2' \
  "$(jq '.signedContributors | length' "$SIGS")"

echo
echo "sign-once guarantee (the load-bearing test):"
# Scenario: alice signed on PR #1. She opens PR #2, then later comments the
# sign phrase again on PR #2 by mistake. The `cla_signed` gate must short-circuit
# so we never re-append, never re-commit, never re-push.
echo '{"signedContributors":[{"name":"alice","id":111,"signed_at":"2026-05-09T10:00:00Z","pull_request_no":1}]}' > "$SIGS"
assert_true "returning signer recognized → caller skips append+push" \
  cla_signed 111 "$SIGS"

# What if alice posts the sign phrase a SECOND time (duplicate sign)?
# We test the gate: cla_signed returns true, so the orchestrator skips the
# add+commit+push branch entirely.
before_count=$(jq '.signedContributors | length' "$SIGS")
if cla_signed 111 "$SIGS"; then
  : # gate fired, no append happens
else
  cla_add_signature "alice" 111 "would-not-happen" 99 "$SIGS"
fi
after_count=$(jq '.signedContributors | length' "$SIGS")
assert_eq "duplicate sign comment is a no-op (count unchanged)" \
  "$before_count" "$after_count"

echo
echo "cla_org_member (mocked):"
# Override the real function with a stub for hermetic testing. The stub
# treats only "alice" and "carol" as eigenpal members. Mirrors the real
# function's contract: empty $org means "no org check, return 1."
cla_org_member() {
  [ -z "$2" ] && return 1
  case "$1" in
    alice|carol) return 0 ;;
    *) return 1 ;;
  esac
}
assert_true  "alice is a member of eigenpal"   cla_org_member "alice" "eigenpal"
assert_false "stranger is not a member"        cla_org_member "stranger" "eigenpal"
assert_false "no org configured → not a match" cla_org_member "alice" ""

echo
echo "cla_should_skip (allowlist + org-member combined):"
assert_true  "literal allowlist match → skip"           cla_should_skip "dependabot[bot]" "$ALLOW" ""
assert_true  "named maintainer match → skip"            cla_should_skip "jedrazb"         "$ALLOW" ""
assert_false "non-allowlisted, no org configured → don't skip" \
                                                        cla_should_skip "stranger"        "$ALLOW" ""
assert_true  "org member match (mocked alice) → skip"   cla_should_skip "alice"           "$ALLOW" "eigenpal"
assert_false "non-allowlisted, non-org-member → don't skip" \
                                                        cla_should_skip "stranger"        "$ALLOW" "eigenpal"
assert_true  "literal allowlist still wins when org configured" \
                                                        cla_should_skip "jedrazb"         "$ALLOW" "eigenpal"
assert_false "empty allowlist + empty org → no one skipped" \
                                                        cla_should_skip "anyone"          ""        ""

echo
echo "cla_render_unsigned_comment (single contributor — uses 'you'):"
body=$(cla_render_unsigned_comment "https://e.x/CLA.md" "I sign" "<!-- m -->" \
  '{"signed":[],"unsigned":["alice"]}')
case "$body" in *"that you sign"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "uses singular 'you' for single contributor" "1" "$ok"
case "$body" in *"that you all sign"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "does NOT use 'you all' for single contributor" "0" "$ok"
case "$body" in *"committers have signed the CLA"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "does NOT show committer matrix for single contributor" "0" "$ok"
case "$body" in *"https://e.x/CLA.md"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "includes CLA URL" "1" "$ok"
case "$body" in *"cla-recheck"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "mentions the cla-recheck keyword" "1" "$ok"
case "$body" in *"<!-- m -->"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "includes sticky-comment marker" "1" "$ok"

echo
echo "cla_render_unsigned_comment (multiple contributors — uses 'you all' + matrix):"
body=$(cla_render_unsigned_comment "https://e.x/CLA.md" "I sign" "<!-- m -->" \
  '{"signed":["alice"],"unsigned":["bob","carol"]}')
case "$body" in *"that you all sign"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "uses plural 'you all' for >1 contributor" "1" "$ok"
case "$body" in *"**1** out of **3** committers have signed the CLA"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "shows '1 out of 3' summary" "1" "$ok"
case "$body" in *":white_check_mark: [alice](https://github.com/alice)"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "alice (signed) shown with check + profile link" "1" "$ok"
case "$body" in *":x: @bob"*":x: @carol"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "bob and carol (unsigned) shown with x" "1" "$ok"

echo
echo "cla_render_unsigned_comment (with unknown committer warning):"
body=$(cla_render_unsigned_comment "https://e.x/CLA.md" "I sign" "<!-- m -->" \
  '{"signed":[],"unsigned":["bob"],"unknown":[{"name":"Anonymous Coward","email":"anon@example.com"}]}')
case "$body" in *"Anonymous Coward"*"seems not to be a GitHub user"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "names the unknown committer with the standard warning" "1" "$ok"
case "$body" in *"add the email address used for this commit to your account"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "links to GitHub help on email linking" "1" "$ok"

body=$(cla_render_unsigned_comment "https://e.x/CLA.md" "I sign" "<!-- m -->" \
  '{"signed":[],"unsigned":["bob"],"unknown":[{"name":"X","email":"x@y"},{"name":"Y","email":"y@z"}]}')
case "$body" in *"**X, Y** seem not to be a GitHub user"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "uses plural 'seem' for >1 unknown" "1" "$ok"

body=$(cla_render_unsigned_comment "https://e.x/CLA.md" "I sign" "<!-- m -->" \
  '{"signed":[],"unsigned":["bob"]}')
case "$body" in *"not to be a GitHub user"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "no unknown section when status_json has no .unknown key" "0" "$ok"

echo
echo "cla_render_signed_comment:"
body=$(cla_render_signed_comment "<!-- m -->")
case "$body" in *"All contributors have signed the CLA"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "matches action's all-signed wording" "1" "$ok"
case "$body" in *"✍️"*"✅"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "includes the celebratory emoji" "1" "$ok"
case "$body" in *"<!-- m -->"*) ok=1 ;; *) ok=0 ;; esac
assert_eq "includes sticky-comment marker" "1" "$ok"

echo
echo "GraphQL author-extraction filters (regression guard):"
# Sample response shaped exactly like the GraphQL query in cla_main returns.
# This catches the bug where switching to (or away from) gh's REST shape would
# silently drop every author and let unsigned PRs pass.
gql_sample='{"nodes":[
  {"commit":{"author":{"email":"alice@example.com","name":"Alice","user":{"login":"alice","databaseId":111}}}},
  {"commit":{"author":{"email":"alice@example.com","name":"Alice","user":{"login":"alice","databaseId":111}}}},
  {"commit":{"author":{"email":"throwaway@example.com","name":"Anon Coward","user":null}}}
]}'
linked=$(echo "$gql_sample" | jq -c '[.nodes[].commit.author | select(.user != null) | {login: .user.login, id: .user.databaseId}] | unique_by(.id)')
assert_eq "linked authors are deduped by databaseId" \
  '[{"login":"alice","id":111}]' "$linked"
unknown=$(echo "$gql_sample" | jq -c '[.nodes[].commit.author | select(.user == null) | {name: .name, email: .email}] | unique_by("\(.name)<\(.email)>")')
assert_eq "unknown author surfaces with name + email" \
  '[{"name":"Anon Coward","email":"throwaway@example.com"}]' "$unknown"

echo
echo "cla_init_signatures:"
NEW="$TMPDIR/sub/cla.json"
cla_init_signatures "$NEW"
[ -f "$NEW" ] && exists=1 || exists=0
assert_eq "creates parent directory + file" "1" "$exists"
assert_eq "initial structure is empty array" \
  '{"signedContributors":[]}' "$(jq -c . "$NEW")"

echo '{"signedContributors":[{"name":"x","id":1,"signed_at":"y","pull_request_no":1}]}' > "$NEW"
cla_init_signatures "$NEW"
assert_eq "existing signatures file is preserved" \
  "x" "$(jq -r '.signedContributors[0].name' "$NEW")"

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

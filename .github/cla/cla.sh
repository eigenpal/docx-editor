#!/usr/bin/env bash
# CLA workflow logic. Sourced by .github/workflows/cla.yml (which calls cla_main)
# and tested by .github/cla/cla.test.sh (which sources and calls the pure
# functions). Side effects (git push, gh api) live only in cla_main.

set -euo pipefail

# 0 if $login is in space-separated $allowlist; bracket characters in bot
# names like "dependabot[bot]" are matched literally.
cla_allowlisted() {
  local login="$1" allowlist="$2"
  [[ " $allowlist " == *" $login "* ]]
}

# 0 if $user_id is already in $signatures_file's signedContributors.
cla_signed() {
  local user_id="$1" signatures_file="$2"
  local count
  count=$(jq --argjson id "$user_id" \
    '[.signedContributors[] | select(.id == $id)] | length' \
    "$signatures_file")
  [ "$count" != "0" ]
}

# Append a signature row in place. Caller is responsible for the idempotency
# check (cla_signed) before invoking — this function always appends.
cla_add_signature() {
  local name="$1" user_id="$2" ts="$3" pr="$4" signatures_file="$5"
  jq --arg name "$name" --argjson id "$user_id" --arg ts "$ts" --argjson pr "$pr" \
    '.signedContributors += [{name: $name, id: $id, signed_at: $ts, pull_request_no: $pr}]' \
    "$signatures_file" > "$signatures_file.tmp"
  mv "$signatures_file.tmp" "$signatures_file"
}

# 0 if $login is a public member of $org. Returns 1 for non-members, private
# members (default GITHUB_TOKEN can't see them), unknown orgs, and API errors —
# fail-closed: anyone not provably an org member must sign once.
# Tests override this function with a stub.
cla_org_member() {
  local login="$1" org="$2"
  [ -z "$org" ] && return 1
  gh api "orgs/$org/members/$login" --silent 2>/dev/null
}

# 0 if $login should be skipped from the CLA check entirely (no JSON row,
# no comment listing, no warning) — either because they're on the literal
# allowlist or because they're a public member of $org.
cla_should_skip() {
  local login="$1" allowlist="$2" org="${3:-}"
  cla_allowlisted "$login" "$allowlist" && return 0
  [ -n "$org" ] && cla_org_member "$login" "$org" && return 0
  return 1
}

# Render the "please sign" comment shown to a PR author who hasn't signed yet.
# The leading @-mention notifies the PR author on initial post; edits to the
# sticky comment on subsequent workflow runs don't re-notify, so this is a
# one-time ping per contributor.
cla_render_unsigned_comment() {
  local cla_url="$1" sign_phrase="$2" marker="$3" pr_author_login="$4"
  cat <<EOF
@${pr_author_login} thank you for your submission, we really appreciate it. Like many open-source projects, we ask that you sign our [Contributor License Agreement](${cla_url}) before we can accept your contribution. You can sign the CLA by just posting a Pull Request Comment same as the below format.

---

${sign_phrase}

---

<sub>You can retrigger this bot by commenting **cla-recheck** in this Pull Request.</sub>
<sub>Posted by the CLA bot.</sub>

${marker}
EOF
}

cla_render_signed_comment() {
  local marker="$1"
  cat <<EOF
All contributors have signed the CLA  ✍️ ✅

<sub>Posted by the CLA bot.</sub>

${marker}
EOF
}

cla_init_signatures() {
  local signatures_file="$1"
  mkdir -p "$(dirname "$signatures_file")"
  [ -f "$signatures_file" ] || echo '{"signedContributors":[]}' > "$signatures_file"
}

# Orchestrates the full workflow. The only function with side effects.
# Required env: REPO, PR_NUMBER, EVENT_NAME, ALLOWLIST, CLA_URL, SIGN_PHRASE.
# Required env when EVENT_NAME=issue_comment: COMMENT_USER_LOGIN, COMMENT_USER_ID.
cla_main() {
  local signatures="signatures/version1/cla.json"
  local marker='<!-- cla-bot -->'

  cla_init_signatures "$signatures"

  # Record signature first if this run was triggered by a sign comment.
  # Skipped for: allowlisted bots/maintainers, org members, and signers
  # already on file. Idempotent across all three cases.
  if [ "${EVENT_NAME:-}" = "issue_comment" ]; then
    if cla_should_skip "$COMMENT_USER_LOGIN" "$ALLOWLIST" "${CLA_ORG:-}"; then
      :  # allowlisted or org member — no JSON row needed
    elif ! cla_signed "$COMMENT_USER_ID" "$signatures"; then
      cla_add_signature "$COMMENT_USER_LOGIN" "$COMMENT_USER_ID" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_NUMBER" "$signatures"
      git config user.name "$GIT_AUTHOR_NAME"
      git config user.email "$GIT_AUTHOR_EMAIL"
      git add "$signatures"
      git commit -m "Record CLA signature for @${COMMENT_USER_LOGIN} (PR #${PR_NUMBER})"
      # Push uses the App installation token set by the workflow (see cla.yml).
      # The App must be on the main-branch ruleset's bypass list for this to
      # succeed under any required-status-checks rule.
      git push origin main
    fi
  fi

  # The PR author is the signer of record. They're the GitHub identity
  # submitting the contribution and accepting the CLA's representations
  # (Section 4 covers their authority to license commits authored by
  # tools/co-authors with unlinked emails). We do not check individual
  # commit authors — git's commit.author field is local-config metadata,
  # not legal personhood.
  local pr_data pr_author_login pr_author_id head_sha
  # GraphQL `author` is an Actor interface — User, Bot, Mannequin, etc. each
  # expose `databaseId` separately, so we ask for it on every concrete type
  # we expect to see authoring PRs (mostly User and Bot in practice).
  pr_data=$(gh api graphql \
    -F owner="${REPO%/*}" -F name="${REPO#*/}" -F number="$PR_NUMBER" \
    -f query='
      query($owner:String!, $name:String!, $number:Int!) {
        repository(owner:$owner, name:$name) {
          pullRequest(number:$number) {
            headRefOid
            author {
              __typename
              login
              ... on User { databaseId }
              ... on Bot { databaseId }
            }
          }
        }
      }')
  head_sha=$(echo "$pr_data" | jq -r '.data.repository.pullRequest.headRefOid')
  local pr_author_type
  pr_author_type=$(echo "$pr_data" | jq -r '.data.repository.pullRequest.author.__typename // empty')
  pr_author_login=$(echo "$pr_data" | jq -r '.data.repository.pullRequest.author.login // empty')
  pr_author_id=$(echo "$pr_data" | jq -r '.data.repository.pullRequest.author.databaseId // empty')

  # GraphQL returns Bot logins as bare slugs ("dependabot"), but the allowlist
  # and every other GitHub API surface uses the "[bot]" suffix. Normalize so
  # `dependabot[bot]` in the allowlist actually matches a Dependabot PR.
  if [ "$pr_author_type" = "Bot" ] && [[ "$pr_author_login" != *"[bot]" ]]; then
    pr_author_login="${pr_author_login}[bot]"
  fi

  if [ -z "$pr_author_login" ]; then
    echo "ERROR: PR #${PR_NUMBER} has no identifiable GitHub author (deleted account?)" >&2
    exit 1
  fi

  # Allowlist short-circuits before we need the numeric id. Without this guard
  # in place, a Bot or Mannequin author with a null databaseId would still
  # pass via cla_should_skip even though the id is empty.
  local pr_author_signed=false
  if cla_should_skip "$pr_author_login" "$ALLOWLIST" "${CLA_ORG:-}"; then
    pr_author_signed=true
  elif [ -n "$pr_author_id" ] && cla_signed "$pr_author_id" "$signatures"; then
    pr_author_signed=true
  fi

  local body status_state status_desc
  if "$pr_author_signed"; then
    status_state="success"
    status_desc="PR author has signed the CLA"
    body=$(cla_render_signed_comment "$marker")
  else
    status_state="failure"
    status_desc="Awaiting CLA signature from PR author"
    body=$(cla_render_unsigned_comment "$CLA_URL" "$SIGN_PHRASE" "$marker" "$pr_author_login")
  fi

  # Upsert the sticky CLA comment (one per PR, identified by the marker).
  # `--slurp` is load-bearing: `gh api --paginate` outputs one JSON array per
  # page, and without `-s` jq's `first` would only see the first page's matches.
  local existing
  existing=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate \
    | jq -rs --arg m "$marker" 'add | [.[] | select(.body | contains($m)) | .id] | first // empty')
  if [ -n "$existing" ]; then
    gh api -X PATCH "repos/${REPO}/issues/comments/${existing}" -f body="$body" > /dev/null
  else
    gh api -X POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -f body="$body" > /dev/null
  fi

  # Set the commit status check on the PR head.
  gh api -X POST "repos/${REPO}/statuses/${head_sha}" \
    -f state="$status_state" \
    -f context="CLA" \
    -f description="$status_desc" \
    -f target_url="$CLA_URL" > /dev/null
}

# Run cla_main when this script is executed directly (from the workflow).
# Stay quiet when sourced (from the test file or an interactive shell).
if [ "${BASH_SOURCE[0]:-}" = "${0}" ]; then
  cla_main
fi
